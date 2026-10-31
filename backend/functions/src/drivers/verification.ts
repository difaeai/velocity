/**
 * The driver verification engine — the part that actually decides.
 *
 * A driver finishes onboarding and, seconds later, is either driving, told
 * exactly what to fix, or sitting in a queue a human will clear. No admin has
 * to be awake for the first two.
 *
 * HOW A DECISION IS MADE, in order:
 *   1. Facts from our own database  — is this CNIC, plate or licence already on
 *      somebody else's account? (findDuplicates, below.) This is the check that
 *      catches the actual fraud pattern here: one person, six accounts, or a
 *      driver working on a relative's papers.
 *   2. The live face scan           — already scored when the applicant did it
 *      (drivers/faceScan.ts); read here as a fact about the application.
 *   3. The papers                   — read on this machine, all of them in one
 *      pass, so they can be compared against each other. Tesseract for the
 *      text, a face descriptor for the photographs; no API key, no third party,
 *      and a driver's CNIC never leaves the function. See
 *      lib/driverVerificationLocal.ts for what that engine can and cannot see.
 *   4. Judgement                    — domain/driverVerification.ts, pure and
 *      tested, turns all of the above into approve / reject / review.
 *
 * WHY A JOB DOCUMENT AND NOT AN INLINE CALL. Reading six images takes about ten
 * seconds of the function's own CPU. Holding a callable open for that means an
 * applicant on a weak signal watching a spinner that can time out and leave
 * them unsure whether they submitted at all. Instead `submitDriverOnboarding`
 * writes a job and returns immediately; this trigger does the work and writes
 * the verdict onto `drivers/{uid}`, which the app is already streaming — so the
 * screen changes under them when it is done, and a dropped connection costs
 * nothing.
 *
 * Jobs are append-only: one new document per submission, never updated in place
 * by the thing that reads them. That is what keeps the trigger from retriggering
 * itself, and it leaves a per-attempt audit trail for free.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAdmin } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import { applyRole } from '../users';
import { readDriverDocuments, verificationEngineReady } from '../lib/driverVerificationLocal';
import {
  DEFAULT_VERIFICATION_CONFIG,
  REQUIRED_DOCUMENTS,
  decideDriverVerification,
  normalizeCnic,
  normalizePlate,
  type Agreement,
  type DocumentKind,
  type DuplicateHit,
  type FaceScanState,
  type SubmittedDetails,
  type VerificationConfig,
  type VerificationDecision,
} from '../domain/driverVerification';

/** Queue of verification attempts. One document per submission, never reused. */
export const VERIFICATION_JOBS = 'driverVerificationJobs';

/** The admin-editable knobs. Catalogue in code, chosen values here. */
const CONFIG_DOC = 'adminConfig/driverVerification';

/** Which driver-doc field holds the Storage path for each document slot. */
const DOCUMENT_PATH_FIELD: Record<DocumentKind, string> = {
  selfie: 'photoDocPath',
  license: 'licenseDocPath',
  cnicFront: 'cnicDocPath',
  cnicBack: 'cnicBackDocPath',
  vehicleRegistration: 'vehicleDocPath',
  vehiclePhoto: 'vehiclePhotoDocPath',
};

export async function getVerificationConfig(): Promise<VerificationConfig> {
  try {
    const snap = await db.doc(CONFIG_DOC).get();
    if (!snap.exists) return DEFAULT_VERIFICATION_CONFIG;
    const raw = snap.data() ?? {};
    return {
      ...DEFAULT_VERIFICATION_CONFIG,
      ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null)),
    } as VerificationConfig;
  } catch (e) {
    // A config read that fails must not decide anything by accident.
    logger.error('Could not read verification config; using defaults', { e });
    return DEFAULT_VERIFICATION_CONFIG;
  }
}

/**
 * Put an application in the queue. Called by submitDriverOnboarding and by the
 * admin re-run; writing the job is the only thing either of them has to do.
 */
export async function enqueueDriverVerification(
  driverId: string,
  trigger: 'onboarding' | 'resubmission' | 'admin' | 'expiry',
): Promise<string> {
  const ref = db.collection(VERIFICATION_JOBS).doc();
  await ref.set({
    jobId: ref.id,
    driverId,
    trigger,
    status: 'queued',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Everyone else already holding one of this applicant's identifiers.
 *
 * Three single-field equality queries, which Firestore indexes automatically —
 * no composite index to deploy, and nothing here needs the `drivers` collection
 * scanned. A CNIC is normalised to digits before comparison because the form
 * stores it hyphenated and older records are inconsistent, so the query is run
 * on both spellings.
 */
async function findDuplicates(params: {
  driverId: string;
  cnic: string;
  plate: string;
  licenseNumber: string | null;
}): Promise<DuplicateHit[]> {
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();

  const digits = normalizeCnic(params.cnic);
  const spellings = new Set<string>();
  if (params.cnic) spellings.add(params.cnic.trim());
  if (digits.length === 13) {
    spellings.add(digits);
    spellings.add(`${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`);
  }

  const collect = async (
    field: DuplicateHit['field'],
    queryField: string,
    values: Iterable<string>,
  ): Promise<void> => {
    for (const value of values) {
      if (!value) continue;
      const snap = await db.collection('drivers').where(queryField, '==', value).limit(5).get();
      for (const doc of snap.docs) {
        if (doc.id === params.driverId) continue;
        const key = `${field}:${doc.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const status = (doc.get('verificationStatus') as string | undefined) ?? 'unknown';
        // A rejected shell of an account is not somebody holding the identity —
        // very often it is this same person's own earlier, failed attempt.
        if (status === 'rejected') continue;

        const banned = (await db.doc(`users/${doc.id}`).get()).get('banned') === true;
        hits.push({ field, value, driverId: doc.id, status, banned });
      }
    }
  };

  await collect('cnic', 'cnic', spellings);

  const plate = normalizePlate(params.plate);
  if (plate) {
    // Plates are stored as typed, so compare on the raw value and the common
    // spellings rather than hoping every record was normalised on the way in.
    await collect('plate', 'plate', new Set([params.plate.trim().toUpperCase(), plate]));
  }

  if (params.licenseNumber) {
    await collect('licenseNumber', 'licenseNumber', new Set([params.licenseNumber]));
  }

  return hits;
}

/** Read the face scan off the driver doc, in the shape the decision wants. */
function faceScanState(driver: FirebaseFirestore.DocumentData): FaceScanState {
  const scan = driver.faceScan as
    | {
        status?: string;
        matchesDocuments?: string;
        matchesCnic?: string;
        matchesLicense?: string;
        passedAt?: { toMillis?: () => number };
        checkedAt?: { toMillis?: () => number };
      }
    | undefined;
  if (!scan?.status) {
    return { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null };
  }
  const status =
    scan.status === 'passed' || scan.status === 'failed' || scan.status === 'review'
      ? scan.status
      : 'missing';
  const agreement = (value: string | undefined): Agreement =>
    value === 'match' || value === 'mismatch' ? value : 'unclear';
  const passedAtMs =
    typeof scan.passedAt?.toMillis === 'function' ? scan.passedAt.toMillis() : null;

  /**
   * Was this scan taken after the papers it is about to be credited against?
   *
   * `documentsStoredAt` is stamped by submitDriverOnboarding. Both timestamps
   * are the server's own, so the comparison is sound. A driver record from
   * before either field existed leaves this UNDEFINED rather than false:
   * "unknown" lets the scan be used (the identity gate still has to find a
   * match on both cards), whereas false would quietly discard a perfectly good
   * scan taken by somebody who did nothing wrong.
   */
  const storedAt = driver.documentsStoredAt as { toMillis?: () => number } | undefined;
  const checkedAtMs =
    typeof scan.checkedAt?.toMillis === 'function' ? scan.checkedAt.toMillis() : null;
  const afterDocuments =
    typeof storedAt?.toMillis === 'function' && checkedAtMs !== null
      ? checkedAtMs >= storedAt.toMillis()
      : undefined;

  return {
    status,
    matchesDocuments: agreement(scan.matchesDocuments),
    // Only reported when the scan actually carries them: an older record where
    // the two cards were never measured separately must read as "not measured"
    // (which falls back to the uploaded photograph) rather than as "unclear on
    // both", which would look like a comparison that failed.
    ...(scan.matchesCnic !== undefined ? { matchesCnic: agreement(scan.matchesCnic) } : {}),
    ...(scan.matchesLicense !== undefined ? { matchesLicense: agreement(scan.matchesLicense) } : {}),
    ...(afterDocuments !== undefined ? { afterDocuments } : {}),
    passedAtMs,
  };
}

/**
 * Run one application end to end and apply the outcome.
 *
 * Exported so the admin re-run and the trigger share exactly one code path —
 * an admin pressing "check again" must get the same answer the engine gave.
 */
export async function runDriverVerification(driverId: string): Promise<VerificationDecision | null> {
  const ref = db.doc(`drivers/${driverId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('Verification job for an unknown driver', { driverId });
    return null;
  }
  const driver = snap.data()!;

  // Already approved and nothing resubmitted — nothing to do. Guards against a
  // duplicate job and against an admin re-running a settled application.
  if (driver.verificationStatus === 'approved' && driver.verification?.status === 'approved') {
    logger.info('Verification skipped: already approved', { driverId });
    return null;
  }

  const config = await getVerificationConfig();

  const present: SubmittedDetails['present'] = {};
  const documents: Array<{ kind: DocumentKind; path: string }> = [];
  for (const kind of REQUIRED_DOCUMENTS) {
    const path = driver[DOCUMENT_PATH_FIELD[kind]] as string | undefined;
    present[kind] = Boolean(path);
    if (path) documents.push({ kind, path });
  }

  const submitted: SubmittedDetails = {
    fullName: (driver.fullName as string | undefined) ?? '',
    cnic: (driver.cnic as string | undefined) ?? '',
    plate: (driver.plate as string | undefined) ?? '',
    vehicleType: (driver.vehicleType as string | undefined) ?? '',
    vehicleLabel: (driver.vehicleLabel as string | undefined) ?? '',
    dob: (driver.dob as string | undefined) ?? null,
    licenseExpiry: (driver.licenseExpiry as string | undefined) ?? null,
    cnicExpiry: (driver.cnicExpiry as string | undefined) ?? null,
    vehicleDocExpiry: (driver.vehicleDocExpiry as string | undefined) ?? null,
    present,
  };

  const [duplicates, report] = await Promise.all([
    findDuplicates({
      driverId,
      cnic: submitted.cnic,
      plate: submitted.plate,
      licenseNumber: (driver.licenseNumber as string | undefined) ?? null,
    }),
    // `off` means the papers are not read at all — the deterministic checks
    // still run and everything lands in the review queue.
    config.mode === 'off'
      ? Promise.resolve(null)
      : readDriverDocuments(documents, { cnic: submitted.cnic }),
  ]);

  const decision = decideDriverVerification({
    report,
    submitted,
    duplicates,
    faceScan: faceScanState(driver),
    now: Date.now(),
    config,
  });

  // Remember the licence number the model read, so the duplicate check above
  // can use it NEXT time. Nothing else in the system ever captures it — the
  // onboarding form does not ask for one — so without this the licence arm of
  // findDuplicates would be a query that can never match anything.
  //
  // It is only ever a growing index: the first driver on a licence is checked
  // against nobody, and everyone after them is checked against the first.
  const licenseNumber =
    report?.documents.find((d) => d.kind === 'license')?.fields.idNumber?.trim() || null;

  await applyDecision({
    driverId,
    decision,
    report,
    duplicates,
    config,
    by: 'engine',
    licenseNumber,
  });
  return decision;
}

/**
 * Write a decision into the world: driver status, role, audit log, push.
 *
 * The role is the part that matters — `approved` without the custom claim is a
 * driver who cannot sign in as one, and a revoked role without `rejected` is a
 * driver whose app says they are approved and whose every call is denied. They
 * move together or not at all.
 */
async function applyDecision(params: {
  driverId: string;
  decision: VerificationDecision;
  report: unknown;
  duplicates: DuplicateHit[];
  config: VerificationConfig;
  by: string;
  /** Read off the licence, for the next applicant's duplicate check. */
  licenseNumber?: string | null;
}): Promise<void> {
  const { driverId, decision, config, by } = params;
  const ref = db.doc(`drivers/${driverId}`);
  // Only written when we actually read one — a null here would wipe a number
  // an earlier, clearer photograph had already given us.
  const licensePatch = params.licenseNumber ? { licenseNumber: params.licenseNumber } : {};

  const verification = {
    status: decision.status,
    riskScore: decision.riskScore,
    reasons: decision.reasons,
    expiries: decision.expiries,
    duplicates: params.duplicates,
    // Whose face these papers were matched to, and on what evidence. Recorded
    // on every decision including the ones where it settled nothing — "never
    // managed to check" is exactly what an admin needs to see.
    identity: decision.identity,
    report: params.report ?? null,
    // Whether the papers were actually READ, not whether a reader was
    // configured. Those are different questions, and believing the second one
    // answered the first is how this engine once sent every applicant to a
    // human for weeks while looking like it was being careful.
    aiChecked: params.report !== null,
    engine: 'local',
    mode: config.mode,
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: by,
  };

  if (decision.status === 'approved') {
    await applyRole(driverId, 'driver');
    await ref.set(
      {
        verificationStatus: 'approved',
        approvedBy: 'ai',
        approvedAt: FieldValue.serverTimestamp(),
        reviewReason: null,
        rejectedSections: [],
        verification,
        /**
         * The daily face check starts the moment an account becomes a driving
         * account. `required` carries the admin switch down to where the
         * security rules and the trip guards can see it without a second read;
         * `day` is deliberately left unset, so the first thing this driver is
         * asked for is a check (see domain/faceCheckIn.ts, reason 'never').
         */
        faceCheckIn: { required: config.dailyFaceCheckIn },
        updatedAt: FieldValue.serverTimestamp(),
        ...licensePatch,
      },
      { merge: true },
    );
    await sendToUser(
      driverId,
      '✅ You are approved to drive',
      'Your documents were verified. Open the app, go online and start taking rides.',
    );
  } else if (decision.status === 'rejected') {
    // Revoke rather than merely mark: a resubmission that fails must not leave
    // a driver role granted by an earlier pass still sitting on the token.
    await applyRole(driverId, 'passenger');
    await auth.revokeRefreshTokens(driverId).catch(() => undefined);
    await ref.set(
      {
        verificationStatus: 'rejected',
        online: false,
        reviewReason: decision.driverMessage,
        rejectedSections: decision.rejectedSections,
        reviewedBy: 'ai',
        verification,
        ...licensePatch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await sendToUser(driverId, '❌ Your application needs fixing', decision.driverMessage);
  } else {
    await ref.set(
      {
        verificationStatus: 'pending',
        reviewReason: null,
        verification,
        ...licensePatch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await sendToUser(
      driverId,
      '⏳ Your documents are being reviewed',
      'Our team is checking your application. We will let you know as soon as it is done.',
    );
  }

  await db.collection('auditLogs').add({
    type: `driver.verification_${decision.status}`,
    actor: by,
    targetUid: driverId,
    riskScore: decision.riskScore,
    reasons: decision.reasons.map((r) => r.code),
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver verification decided', {
    driverId,
    status: decision.status,
    risk: decision.riskScore,
    codes: decision.reasons.map((r) => r.code),
  });
}

/**
 * Run one queued job: mark it running, decide, record the outcome.
 *
 * Shared by the sweeper below and by nothing else today, but kept separate
 * from the schedule so the retry path and the first attempt cannot drift.
 */
async function processVerificationJob(
  jobRef: FirebaseFirestore.DocumentReference,
  driverId: string,
): Promise<void> {
  try {
    await jobRef.update({ status: 'running', startedAt: FieldValue.serverTimestamp() });
    const decision = await runDriverVerification(driverId);
    await jobRef.update({
      status: 'done',
      decision: decision?.status ?? 'skipped',
      riskScore: decision?.riskScore ?? null,
      finishedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // A crash must not strand the applicant on "verifying" forever: put them
    // in the human queue, which is where an unverifiable application belongs.
    logger.error('Driver verification job failed', { jobId: jobRef.id, driverId, e });
    await jobRef.update({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      finishedAt: FieldValue.serverTimestamp(),
    });
    await db.doc(`drivers/${driverId}`).set(
      {
        verificationStatus: 'pending',
        verification: {
          status: 'review',
          riskScore: 0,
          reasons: [
            {
              code: 'engine_error',
              detail: 'The automatic check could not be completed.',
              severity: 'minor',
            },
          ],
          decidedAt: FieldValue.serverTimestamp(),
          decidedBy: 'engine',
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

/**
 * The worker: every minute, pick up whatever was queued.
 *
 * WHY A SCHEDULE AND NOT A FIRESTORE TRIGGER. An `onDocumentCreated` on the
 * job collection is the obvious design and was the first one written. It
 * cannot be deployed here: a Gen-2 Firestore trigger runs on Eventarc, which
 * needs `roles/eventarc.eventReceiver` and `roles/run.invoker` on the compute
 * service agent and `roles/iam.serviceAccountTokenCreator` on the Pub/Sub one.
 * This project has never had an Eventarc function, the deploy service account
 * cannot grant itself those roles, and the whole deploy fails — taking every
 * unrelated function down with it. It is the third time this codebase has
 * reached for a document trigger and backed away; see the notes in
 * drivers/geohashSweeper.ts and pricing/engine.ts for the other two.
 *
 * The cost of the schedule is a driver waiting up to a minute rather than a
 * few seconds, which is why the app says "Checking your documents…" from the
 * moment they submit instead of claiming to be done.
 *
 * MEMORY IS MEASURED, NOT GUESSED. One application — six images, each decoded,
 * read for text and put through three networks — peaks at about 850 MB in this
 * process (scripts/smoke-local-vision.cjs prints the figure). At 1 GiB that is
 * close enough to the ceiling to matter, and running out is not a failure this
 * file can catch: the instance is killed, `processVerificationJob` never reaches
 * its error branch, and the job sits in `running` forever with an applicant
 * watching a spinner. 2 GiB it is. Gen-2 allocates the same single CPU at both
 * sizes, so the only cost is per GB-second on an application that takes ten.
 */
const JOBS_PER_RUN = 5;

export const sweepDriverVerificationJobs = onSchedule(
  { schedule: '* * * * *', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION, timeoutSeconds: 540, memory: '2GiB' },
  async () => {
    const snap = await db
      .collection(VERIFICATION_JOBS)
      .where('status', '==', 'queued')
      .limit(JOBS_PER_RUN)
      .get();
    if (snap.empty) {
      // Says so out loud rather than returning in silence. A sweeper that logs
      // nothing on an empty queue is indistinguishable in Cloud Logging from
      // one that is not running at all — and this one runs every minute, so
      // "no log line" is exactly what a broken schedule looks like too.
      // `debug` keeps 1,440 of these a day out of the way of real entries.
      logger.debug('Driver verification sweep: queue empty');
      return;
    }

    // Sequentially, not in parallel: each job is six images through Tesseract
    // and three networks, and five of those at once in one instance is how a
    // function runs out of memory and fails all five instead of finishing one.
    for (const doc of snap.docs) {
      const driverId = doc.get('driverId') as string | undefined;
      if (!driverId) {
        await doc.ref.update({ status: 'error', error: 'Job has no driverId.' });
        continue;
      }
      await processVerificationJob(doc.ref, driverId);
    }
    logger.info('Driver verification sweep complete', { processed: snap.size });

    await releaseStrandedApplications();
  },
);

/** How long an application may wait at the face-scan step before it is decided. */
const FACE_SCAN_HOLD_MINUTES = 30;

/**
 * Nobody is left holding a camera they never opened.
 *
 * An application whose papers are stored waits for the face scan — that is the
 * sequence. If the applicant closes the app at that point, or their battery
 * dies, or the camera permission is refused, the application would wait for
 * ever: no job was queued, so nothing is coming to decide it, and the driver
 * sees "submitted" with nothing happening behind it.
 *
 * So after half an hour the engine runs anyway. The verdict will almost
 * certainly be `review` — no live face was matched to the two cards, which is
 * the one thing an automatic approval requires — and a human either clears it
 * or asks them to finish the scan. Either way a person is looking at it, which
 * is the point.
 */
async function releaseStrandedApplications(): Promise<void> {
  const cutoff = Timestamp.fromMillis(Date.now() - FACE_SCAN_HOLD_MINUTES * 60_000);
  const stranded = await db
    .collection('drivers')
    .where('verification.status', '==', 'awaiting_face_scan')
    .where('verification.startedAt', '<', cutoff)
    .limit(10)
    .get();
  if (stranded.empty) return;

  for (const doc of stranded.docs) {
    // Moved out of the holding state FIRST, so a slow job cannot cause the next
    // sweep to queue the same application a second time.
    await doc.ref.set(
      { verification: { status: 'verifying' }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await enqueueDriverVerification(doc.id, 'onboarding');
  }
  logger.info('Released applications stranded at the face scan', { count: stranded.size });
}

/** Admin-only: run the engine again on one driver, e.g. after a config change. */
export const adminRerunDriverVerification = onCall(
  // Same work as the sweeper, so the same memory. See the note above it.
  { timeoutSeconds: 540, memory: '2GiB' },
  async (req) => {
    const admin = requireAdmin(req);
    const parsed = z.object({ driverId: docId }).safeParse(req.data);
    if (!parsed.success) invalid('Provide a valid driverId.');
    const { driverId } = parsed.data;

    const ref = db.doc(`drivers/${driverId}`);
    if (!(await ref.get()).exists) invalid('Unknown driver.');

    // Clear the settled status so runDriverVerification does not short-circuit
    // on "already approved" — an admin asking for a re-check means re-check.
    await ref.set({ verification: { status: 'rerunning' } }, { merge: true });
    const decision = await runDriverVerification(driverId);

    await db.collection('auditLogs').add({
      type: 'driver.verification_rerun',
      actor: admin.uid,
      targetUid: driverId,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      status: decision?.status ?? 'skipped',
      riskScore: decision?.riskScore ?? null,
      reasons: decision?.reasons ?? [],
    };
  },
);

/** Admin-only: read or change the engine's thresholds. 1GiB: `engineReady` loads the models, which ran 256MiB out of memory. */
export const adminVerificationSettings = onCall({ memory: '1GiB' }, async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      patch: z
        .object({
          mode: z.enum(['full', 'suggest', 'off']).optional(),
          autoApproveMaxRisk: z.number().min(0).max(100).optional(),
          autoRejectMinRisk: z.number().min(0).max(100).optional(),
          minDaysBeforeExpiry: z.number().min(0).max(365).optional(),
          warnDaysBeforeExpiry: z.array(z.number().min(0).max(365)).max(8).optional(),
          requireHighConfidence: z.boolean().optional(),
          rejectOnDuplicateCnic: z.boolean().optional(),
          requireFaceScan: z.boolean().optional(),
          requireLicenceFaceMatch: z.boolean().optional(),
          dailyFaceCheckIn: z.boolean().optional(),
        })
        .optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) invalid('Invalid verification settings.');

  const patch = parsed.data.patch;
  if (patch && Object.keys(patch).length) {
    // An approve threshold above the reject threshold would make both branches
    // true and the order of the ifs would silently decide every application.
    const next = { ...(await getVerificationConfig()), ...patch };
    if (next.autoApproveMaxRisk >= next.autoRejectMinRisk) {
      invalid('The auto-approve ceiling has to be below the auto-reject floor.');
    }
    await db.doc(CONFIG_DOC).set(
      { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.auth!.uid },
      { merge: true },
    );
  }

  return {
    ok: true,
    config: await getVerificationConfig(),
    // Loads the models and the OCR worker and reports whether they came up.
    // There is no key to check any more, so readiness is the only thing worth
    // asking — and asking it costs about a second on a cold instance.
    engineReady: await verificationEngineReady(),
  };
});
