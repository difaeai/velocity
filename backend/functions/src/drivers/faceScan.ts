/**
 * The live face scan — the two callables that run it, for both of its jobs.
 *
 * The scheme, and why it is shaped this way, is in domain/faceScan.ts. The
 * short version: the SERVER decides which poses to ask for, after the applicant
 * has already started, and checks the frames against what it asked rather than
 * against anything the handset claims. Everything in this file exists to keep
 * that true.
 *
 *   startFaceScan()  → mints a scan id and a pose sequence, stores both, and
 *                      returns only the poses. Three minutes to complete.
 *   submitFaceScan() → takes the frames, re-reads the poses FROM FIRESTORE,
 *                      scores them, and burns the scan id either way.
 *
 * A scan is single-use. Not because replaying frames would pass — the poses
 * would have to match, and they are redrawn each time — but because a scan id
 * that could be submitted twice is a scan id that could be submitted once by
 * the applicant and once by whoever is standing behind them.
 *
 * TWO PURPOSES, one mechanism:
 *
 *   · `onboarding` — the last step of an application. Refused until the CNIC and
 *     the licence are actually stored, because the whole point of taking it last
 *     is that the live face is then measured against the papers that were just
 *     submitted. A pass enqueues the verification engine by itself: the driver
 *     does not have to press anything again.
 *
 *   · `daily` — the first time an approved driver opens the app each Pakistan
 *     day. Measured against the face enrolled when they were approved, which is
 *     a selfie-to-selfie comparison and the only face comparison in this system
 *     allowed to stop somebody driving. See domain/faceCheckIn.ts.
 *
 * ENROLMENT. A passing scan whose identity is settled leaves its frame-0
 * descriptor in `driverFaceEnrolment/{uid}` — 128 numbers, server-only, never
 * returned to a handset and never written to the driver document. That is the
 * reference every later daily check is measured against, and it is refreshed on
 * every pass so it follows a driver through a beard and a decade rather than
 * drifting away from them.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { isWarmPing, warmUp } from '../lib/warmup';
import { faceEngineReady } from '../lib/localVision';
import { readFaceScan } from '../lib/driverVerificationLocal';
import { enqueueDriverVerification, getVerificationConfig } from './verification';
import {
  CHALLENGE_PROMPT,
  FACE_SCAN_ATTEMPTS_PER_HOUR,
  FACE_SCAN_FRAMES,
  FACE_SCAN_TTL_SECONDS,
  combineIdentity,
  identityMessage,
  pickChallenges,
  scoreFaceScan,
  type FaceChallenge,
  type FaceScanIdentity,
  type FaceScanPurpose,
  type FaceScanStatus,
} from '../domain/faceScan';
import {
  FACE_CHECK_IN_ATTEMPTS_PER_HOUR,
  FACE_CHECK_IN_FRAMES,
  scoreFaceCheckIn,
} from '../domain/faceCheckIn';
import { pktDayKey } from '../domain/dailyTarget';

/** Where a scan lives while it is running and after it is scored. */
const SCANS = 'driverFaceScans';

/**
 * The enrolled face, one document per driver.
 *
 * Its own collection rather than a field on the driver document, for one
 * reason: the driver document is readable by its owner, and a face descriptor
 * is biometric data that nobody — including the driver whose face it is — has
 * any use for on a handset. A client that could read it could also compare
 * candidate faces against it offline until one fitted. No client rule exists
 * for this collection at all; see firestore.rules.
 */
const ENROLMENT = 'driverFaceEnrolment';

const startSchema = z.object({
  purpose: z.enum(['onboarding', 'daily']).optional(),
});

/**
 * Start a scan: get a scan id and the poses to perform.
 *
 * Open to any signed-in user for onboarding, not only drivers — the whole point
 * is that it runs during onboarding, before anybody has the driver role.
 */
export const startFaceScan = onCall(async (req) => {
  const { uid } = requireAuth(req);
  // Sent as the intro screen opens, so the driver tapping Start meets a warm instance.
  if (isWarmPing(req.data)) return warmUp();
  const parsed = startSchema.safeParse(req.data ?? {});
  if (!parsed.success) invalid('Unknown face scan type.');
  const purpose: FaceScanPurpose = parsed.data.purpose ?? 'onboarding';

  const driverSnap = await db.doc(`drivers/${uid}`).get();

  if (purpose === 'onboarding') {
    // THE SEQUENCE, enforced here and not only in the app.
    //
    // A scan is worth having only once there is something to compare it with.
    // Taken before the documents it proves a live person and nothing else —
    // which is the one thing we were never short of. So the papers come first
    // and the face comes last, and this is the line that makes that true for a
    // patched build as well as for the checklist.
    const hasCnic = Boolean(driverSnap.get('cnicDocPath'));
    const hasLicence = Boolean(driverSnap.get('licenseDocPath'));
    if (!hasCnic || !hasLicence) {
      throw new HttpsError(
        'failed-precondition',
        'Upload your CNIC and your driving licence first. The face scan is the last step — we compare your face with the photos on those documents.',
      );
    }
    await rateLimit(uid, 'startFaceScan', FACE_SCAN_ATTEMPTS_PER_HOUR, 3600);
  } else {
    // A daily check belongs to a driver who already has an account to check.
    if (driverSnap.get('verificationStatus') !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'The daily face check is for approved drivers.',
      );
    }
    await rateLimit(uid, 'faceCheckIn', FACE_CHECK_IN_ATTEMPTS_PER_HOUR, 3600);
  }

  const frames = purpose === 'daily' ? FACE_CHECK_IN_FRAMES : FACE_SCAN_FRAMES;
  const challenges = pickChallenges(frames);
  const ref = db.collection(SCANS).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + FACE_SCAN_TTL_SECONDS * 1000);

  await ref.set({
    scanId: ref.id,
    uid,
    purpose,
    challenges,
    status: 'pending' as FaceScanStatus,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  logger.info('Face scan started', { uid, scanId: ref.id, purpose });
  return {
    ok: true,
    scanId: ref.id,
    purpose,
    // The prompts travel with the ids so the app never has to keep its own copy
    // of the wording — one less thing that can drift out of step with what the
    // scoring was told the applicant was asked to do.
    challenges: challenges.map((c) => ({ challenge: c, prompt: CHALLENGE_PROMPT[c] })),
    expiresAtMs: expiresAt.toMillis(),
    frames,
  };
});

const submitSchema = z.object({
  scanId: z.string().min(1).max(128).regex(/^[^/]+$/),
  /** Storage paths for the frames, in the order the poses were asked. */
  framePaths: z.array(z.string().min(1).max(512)).min(1).max(6),
});

/**
 * Finish a scan: hand in the frames and get a verdict.
 *
 * Scored inline, on this machine. A few images through three small networks is
 * about two seconds, and the applicant is sitting there looking at the camera
 * screen waiting to be told whether it worked — a background job would mean a
 * spinner with nothing behind it.
 */
// 1 GiB, measured: three frames and the card photographs peak at about 320 MB
// and take under two seconds. The documents path needs far more; this one does
// not read any text, so it never loads the language model.
export const submitFaceScan = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const { uid } = requireAuth(req);
  // Sent as the camera opens: the face models load while the driver is still
  // turning their head, instead of after the last frame.
  if (isWarmPing(req.data)) {
    await faceEngineReady();
    return warmUp();
  }
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the scan id and the captured frames.');
  const { scanId, framePaths } = parsed.data;

  const ref = db.collection(SCANS).doc(scanId);
  const snap = await ref.get();
  if (!snap.exists) invalid('That face scan was not found. Please start a new one.');

  const scan = snap.data()!;
  if (scan.uid !== uid) {
    // Somebody else's scan id. Never say which — just that it is not usable.
    throw new HttpsError('permission-denied', 'That face scan does not belong to you.');
  }
  if (scan.used === true) invalid('That face scan has already been used. Please start a new one.');

  const expiresAt = scan.expiresAt as Timestamp | undefined;
  if (!expiresAt || expiresAt.toMillis() < Date.now()) {
    await ref.update({ status: 'failed', used: true, reason: 'expired' });
    invalid('The face scan timed out. Please start a new one.');
  }

  // Read from the STORED scan, never from the request: the purpose decides what
  // the face is compared against and what a failure costs, and a handset that
  // could choose it could ask for the comparison it expects to pass.
  const purpose: FaceScanPurpose = scan.purpose === 'daily' ? 'daily' : 'onboarding';
  const challenges = (scan.challenges ?? []) as FaceChallenge[];
  if (framePaths.length !== challenges.length) {
    invalid(`This scan needs ${challenges.length} frames.`);
  }
  // Uploads land in Cloud Storage directly, so the path has to be re-checked
  // here — otherwise a scan could be "completed" with somebody else's frames.
  for (const path of framePaths) {
    if (!path.startsWith(`drivers/${uid}/`)) {
      throw new HttpsError('permission-denied', 'Those frames do not belong to your account.');
    }
  }

  // Burn the id before doing any work. A scan that crashes mid-verification is
  // spent — the applicant starts a fresh one and gets fresh poses, which is
  // exactly the behaviour we want and costs them ten seconds.
  await ref.update({ used: true, framePaths, submittedAt: FieldValue.serverTimestamp() });

  const driverRef = db.doc(`drivers/${uid}`);
  const driverSnap = await driverRef.get();

  // What there is to compare against. The two cards for an onboarding scan —
  // both of them, because being on one borrowed card is easy and being on two
  // is not (see IDENTITY_MUST_BE_PROVEN). The enrolled face for a daily check,
  // with the CNIC as the fallback for a driver approved before enrolment
  // existed.
  const cnicPath = (driverSnap.get('cnicDocPath') as string | undefined) ?? null;
  const licensePath = (driverSnap.get('licenseDocPath') as string | undefined) ?? null;
  const enrolled = purpose === 'daily' ? await readEnrolment(uid) : null;

  const report = await readFaceScan({
    frames: framePaths.map((path, index) => ({ index, path })),
    asked: challenges,
    // A daily check does not look at the licence at all: it is asking "are you
    // the driver on this account", not "are these papers yours", and that was
    // settled when the account was approved.
    idPhotos: purpose === 'daily' ? { cnic: cnicPath } : { cnic: cnicPath, license: licensePath },
    reference: enrolled,
  });

  const liveness = scoreFaceScan({ report, asked: challenges });

  await ref.update({
    status: liveness.status,
    posesMatched: liveness.posesMatched,
    reasons: liveness.reasons,
    // The descriptor is stripped: the scan document is admin-readable, and 128
    // numbers describing a face do not belong in a record kept for audit.
    report: report ? stripDescriptor(report) : null,
    matchesIdPhoto: report?.matchesIdPhoto ?? 'unclear',
    scoredAt: FieldValue.serverTimestamp(),
  });

  return purpose === 'daily'
    ? await finishDailyCheck({ uid, scanId, driverRef, report, liveness, enrolled })
    : await finishOnboardingScan({ uid, scanId, driverRef, driverSnap, report, liveness });
});

// ── Onboarding ───────────────────────────────────────────────────────────────

/**
 * Record an onboarding scan and, when it passed, start the engine.
 *
 * The driver pressed nothing to get here except "start the face scan": the
 * documents went up before this screen opened, and the verdict follows on its
 * own. That sequence — papers, then face, then decision — is the thing this
 * feature is for, and leaving the last step to a second button press would mean
 * applications sitting in `awaiting_face_scan` because somebody's battery died.
 */
async function finishOnboardingScan(params: {
  uid: string;
  scanId: string;
  driverRef: FirebaseFirestore.DocumentReference;
  driverSnap: FirebaseFirestore.DocumentSnapshot;
  report: FaceScanIdentity | null;
  liveness: ReturnType<typeof scoreFaceScan>;
}) {
  const { uid, scanId, driverRef, driverSnap, report, liveness } = params;
  const { requireLicenceFaceMatch } = await getVerificationConfig();

  const matchesCnic = report?.matchesCnic ?? 'unclear';
  const matchesLicense = report?.matchesLicense ?? 'unclear';
  const identity = combineIdentity(
    { cnic: matchesCnic, license: matchesLicense },
    requireLicenceFaceMatch,
  );

  // The driver doc carries the summary so every surface — the onboarding
  // screen, the admin queue, the verification engine — reads one field rather
  // than querying the scan collection.
  await driverRef.set(
    {
      driverId: uid,
      faceScan: {
        scanId,
        status: liveness.status,
        matchesDocuments: identity,
        matchesCnic,
        matchesLicense,
        distances: report?.distances ?? null,
        posesMatched: liveness.posesMatched,
        posesAsked: liveness.posesAsked,
        passedAt: liveness.status === 'passed' ? FieldValue.serverTimestamp() : null,
        checkedAt: FieldValue.serverTimestamp(),
        reasons: liveness.reasons,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Enrol only a face that was actually shown to be the face on the papers.
  // Enrolling an unsettled one would quietly make whoever did the scan the
  // reference every future daily check is measured against — which is the
  // substitution this whole feature exists to catch, performed by us.
  if (liveness.status === 'passed' && identity === 'match' && report?.descriptor) {
    await writeEnrolment({ uid, descriptor: report.descriptor, scanId, source: 'onboarding' });
  }

  // The application is waiting on exactly this. Only enqueued once the papers
  // are in place — a scan taken outside an application (an admin asking for a
  // fresh one, say) must not re-open a settled file.
  let queued = false;
  const papersPresent = Boolean(driverSnap.get('cnicDocPath') && driverSnap.get('licenseDocPath'));
  const status = driverSnap.get('verificationStatus') as string | undefined;
  if (liveness.status === 'passed' && papersPresent && status && status !== 'approved') {
    await driverRef.set(
      {
        verificationStatus: 'pending',
        verification: {
          status: 'verifying',
          riskScore: null,
          reasons: [],
          startedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await enqueueDriverVerification(uid, 'onboarding');
    queued = true;
  }

  logger.info('Face scan scored', {
    uid,
    scanId,
    purpose: 'onboarding',
    status: liveness.status,
    matched: liveness.posesMatched,
    identity,
    queued,
  });

  return {
    ok: liveness.status === 'passed',
    purpose: 'onboarding' as const,
    status: liveness.status,
    // A pass says what the comparison found; a failure says what to do about
    // the camera. Never both, and never a risk score.
    message: liveness.status === 'passed' ? identityMessage(identity) : liveness.message,
    identity,
    posesMatched: liveness.posesMatched,
    posesAsked: liveness.posesAsked,
    /** True when the application has gone to the engine and the driver is done. */
    submitted: queued,
    // A failed scan can be retried immediately; the rate limit on startFaceScan
    // is what stops somebody grinding through poses until a photo happens to fit.
    canRetry: liveness.status === 'failed',
  };
}

// ── The daily check ──────────────────────────────────────────────────────────

/**
 * Record a daily check and say whether the driver may work today.
 *
 * Writes `drivers/{uid}.faceCheckIn`, which is what the guards, the security
 * rules and the app all read. `required` is re-stamped from the config on every
 * check so that turning the requirement on or off reaches a driver the next
 * morning rather than at some unrelated moment.
 */
async function finishDailyCheck(params: {
  uid: string;
  scanId: string;
  driverRef: FirebaseFirestore.DocumentReference;
  report: FaceScanIdentity | null;
  liveness: ReturnType<typeof scoreFaceScan>;
  enrolled: number[] | null;
}) {
  const { uid, scanId, driverRef, report, liveness, enrolled } = params;
  const { dailyFaceCheckIn } = await getVerificationConfig();

  const verdict = scoreFaceCheckIn({
    liveness,
    // Null, not 'unclear', when there is nothing enrolled: those are different
    // situations and only one of them may stop a driver.
    reference: enrolled ? (report?.matchesReference ?? 'unclear') : null,
    card: report?.matchesCnic ?? 'unclear',
  });

  const day = pktDayKey();
  await driverRef.set(
    {
      faceCheckIn: {
        day,
        status: verdict.status,
        required: dailyFaceCheckIn,
        distance: report?.distances?.reference ?? null,
        scanId,
        reasons: verdict.reasons,
        passedAt: verdict.allowed ? FieldValue.serverTimestamp() : null,
        checkedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (verdict.enrol && report?.descriptor) {
    await writeEnrolment({ uid, descriptor: report.descriptor, scanId, source: 'daily' });
  }

  // A check that reads as somebody else is the single most interesting row this
  // feature produces, and it is not a verdict — it is a thing a person should
  // look at today. Logged where admins already look for exactly that.
  if (verdict.status !== 'passed') {
    await db.collection('auditLogs').add({
      type: `driver.face_check_${verdict.status}`,
      actor: 'face-check',
      targetUid: uid,
      day,
      reasons: verdict.reasons,
      distance: report?.distances?.reference ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  logger.info('Daily face check scored', {
    uid,
    scanId,
    status: verdict.status,
    allowed: verdict.allowed,
    enrolled: Boolean(enrolled),
    reasons: verdict.reasons,
  });

  return {
    ok: verdict.allowed,
    purpose: 'daily' as const,
    status: verdict.status,
    message: verdict.message,
    identity: report?.matchesReference ?? 'unclear',
    posesMatched: liveness.posesMatched,
    posesAsked: liveness.posesAsked,
    submitted: false,
    canRetry: !verdict.allowed,
    /** Whether the requirement is actually being enforced for this driver. */
    required: dailyFaceCheckIn,
    day,
  };
}

// ── Enrolment ────────────────────────────────────────────────────────────────

/** The 128 numbers this driver's face is, or null if they were never enrolled. */
async function readEnrolment(uid: string): Promise<number[] | null> {
  const snap = await db.doc(`${ENROLMENT}/${uid}`).get();
  const descriptor = snap.get('descriptor') as number[] | undefined;
  // A descriptor of the wrong length cannot be compared and must not be
  // half-used: faceDistance would reject it anyway, but failing here keeps the
  // "no enrolment" path — which is forgiving — rather than the "unclear" one.
  return Array.isArray(descriptor) && descriptor.length === 128 ? descriptor : null;
}

async function writeEnrolment(params: {
  uid: string;
  descriptor: number[];
  scanId: string;
  source: 'onboarding' | 'daily';
}): Promise<void> {
  await db.doc(`${ENROLMENT}/${params.uid}`).set(
    {
      uid: params.uid,
      descriptor: params.descriptor,
      scanId: params.scanId,
      source: params.source,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Everything about a scan except the biometric template it produced. */
function stripDescriptor<T extends { descriptor?: unknown }>(report: T): Omit<T, 'descriptor'> {
  const rest: Record<string, unknown> = { ...report };
  delete rest.descriptor;
  return rest as Omit<T, 'descriptor'>;
}
