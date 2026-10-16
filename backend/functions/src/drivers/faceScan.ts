/**
 * The live face scan — the two callables that run it.
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
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { readFaceScan } from '../lib/driverVerificationLocal';
import {
  CHALLENGE_PROMPT,
  FACE_SCAN_ATTEMPTS_PER_HOUR,
  FACE_SCAN_FRAMES,
  FACE_SCAN_TTL_SECONDS,
  pickChallenges,
  scoreFaceScan,
  type FaceChallenge,
  type FaceScanStatus,
} from '../domain/faceScan';

/** Where a scan lives while it is running and after it is scored. */
const SCANS = 'driverFaceScans';

/**
 * Start a scan: get a scan id and the poses to perform.
 *
 * Open to any signed-in user, not only drivers — the whole point is that this
 * runs during onboarding, before anybody has the driver role.
 */
export const startFaceScan = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'startFaceScan', FACE_SCAN_ATTEMPTS_PER_HOUR, 3600);

  const challenges = pickChallenges(FACE_SCAN_FRAMES);
  const ref = db.collection(SCANS).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + FACE_SCAN_TTL_SECONDS * 1000);

  await ref.set({
    scanId: ref.id,
    uid,
    challenges,
    status: 'pending' as FaceScanStatus,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  logger.info('Face scan started', { uid, scanId: ref.id });
  return {
    ok: true,
    scanId: ref.id,
    // The prompts travel with the ids so the app never has to keep its own copy
    // of the wording — one less thing that can drift out of step with what the
    // model is told the applicant was asked to do.
    challenges: challenges.map((c) => ({ challenge: c, prompt: CHALLENGE_PROMPT[c] })),
    expiresAtMs: expiresAt.toMillis(),
    frames: FACE_SCAN_FRAMES,
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
 * Scored inline, on this machine. Four images through three small networks is
 * about two seconds, and the applicant is sitting there looking at the camera
 * screen waiting to be told whether it worked — a background job would mean a
 * spinner with nothing behind it.
 */
// 1 GiB, measured: three frames and the card photograph peak at about 320 MB
// and take under two seconds. The documents path needs far more; this one does
// not read any text, so it never loads the language model.
export const submitFaceScan = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const { uid } = requireAuth(req);
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

  // The CNIC front, when they have already uploaded one, so the live face can
  // be compared with the card in the same call. Absent during a scan taken
  // before the documents — then it is simply a liveness check, and the face
  // comparison happens later against the full application.
  const driverSnap = await db.doc(`drivers/${uid}`).get();
  const idPhotoPath = (driverSnap.get('cnicDocPath') as string | undefined) ?? null;

  const report = await readFaceScan({
    frames: framePaths.map((path, index) => ({ index, path })),
    asked: challenges,
    idPhotoPath,
  });

  const verdict = scoreFaceScan({ report, asked: challenges });

  await ref.update({
    status: verdict.status,
    posesMatched: verdict.posesMatched,
    reasons: verdict.reasons,
    report: report ?? null,
    matchesIdPhoto: report?.matchesIdPhoto ?? 'unclear',
    scoredAt: FieldValue.serverTimestamp(),
  });

  // The driver doc carries the summary so every surface — the onboarding
  // screen, the admin queue, the verification engine — reads one field rather
  // than querying the scan collection.
  await db.doc(`drivers/${uid}`).set(
    {
      driverId: uid,
      faceScan: {
        scanId,
        status: verdict.status,
        matchesDocuments: report?.matchesIdPhoto ?? 'unclear',
        posesMatched: verdict.posesMatched,
        posesAsked: verdict.posesAsked,
        passedAt: verdict.status === 'passed' ? FieldValue.serverTimestamp() : null,
        checkedAt: FieldValue.serverTimestamp(),
        reasons: verdict.reasons,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Face scan scored', { uid, scanId, status: verdict.status, matched: verdict.posesMatched });

  return {
    ok: verdict.status === 'passed',
    status: verdict.status,
    message: verdict.message,
    posesMatched: verdict.posesMatched,
    posesAsked: verdict.posesAsked,
    // A failed scan can be retried immediately; the rate limit on startFaceScan
    // is what stops somebody grinding through poses until a photo happens to fit.
    canRetry: verdict.status === 'failed',
  };
});
