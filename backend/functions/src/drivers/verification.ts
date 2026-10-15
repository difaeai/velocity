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
 *   3. The papers                   — one Claude vision call over every document
 *      at once, so they can be compared against each other.
 *   4. Judgement                    — domain/driverVerification.ts, pure and
 *      tested, turns all of the above into approve / reject / review.
 *
 * WHY A JOB DOCUMENT AND NOT AN INLINE CALL. The vision call takes ten to forty
 * seconds over six images. Holding a callable open for that means an applicant
 * on a weak signal watching a spinner that can time out and leave them unsure
 * whether they submitted at all. Instead `submitDriverOnboarding` writes a job
 * and returns immediately; this trigger does the work and writes the verdict
 * onto `drivers/{uid}`, which the app is already streaming — so the screen
 * changes under them when it is done, and a dropped connection costs nothing.
 *
 * Jobs are append-only: one new document per submission, never updated in place
 * by the thing that reads them. That is what keeps the trigger from retriggering
 * itself, and it leaves a per-attempt audit trail for free.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import { applyRole } from '../users';
import { readDriverDocuments, verificationAIConfigured } from '../lib/driverVerificationAI';
import {
  DEFAULT_VERIFICATION_CONFIG,
  REQUIRED_DOCUMENTS,
  decideDriverVerification,
  normalizeCnic,
  normalizePlate,
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
    | { status?: string; matchesDocuments?: string; passedAt?: { toMillis?: () => number } }
    | undefined;
  if (!scan?.status) {
    return { status: 'missing', matchesDocuments: 'unclear', passedAtMs: null };
  }
  const status =
    scan.status === 'passed' || scan.status === 'failed' || scan.status === 'review'
      ? scan.status
      : 'missing';
  const matches =
    scan.matchesDocuments === 'match' || scan.matchesDocuments === 'mismatch'
      ? scan.matchesDocuments
      : 'unclear';
  const passedAtMs =
    typeof scan.passedAt?.toMillis === 'function' ? scan.passedAt.toMillis() : null;
  return { status, matchesDocuments: matches, passedAtMs };
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
    // `off` means no model at all — the deterministic checks still run and
    // everything lands in the review queue.
    config.mode === 'off' ? Promise.resolve(null) : readDriverDocuments(documents),
  ]);

  const decision = decideDriverVerification({
    report,
    submitted,
    duplicates,
    faceScan: faceScanState(driver),
    now: Date.now(),
    config,
  });

  await applyDecision({ driverId, decision, report, duplicates, config, by: 'engine' });
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
}): Promise<void> {
  const { driverId, decision, config, by } = params;
  const ref = db.doc(`drivers/${driverId}`);

  const verification = {
    status: decision.status,
    riskScore: decision.riskScore,
    reasons: decision.reasons,
    expiries: decision.expiries,
    duplicates: params.duplicates,
    report: params.report ?? null,
    aiChecked: verificationAIConfigured() && config.mode !== 'off',
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
        updatedAt: FieldValue.serverTimestamp(),
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
 * The worker. Fires once per queued job.
 *
 * Generous timeout and memory: six images, downloaded and base64'd, through a
 * vision model at high effort. The default 60 s would cut an honest application
 * off halfway and leave it pending forever.
 */
export const processDriverVerification = onDocumentCreated(
  { document: `${VERIFICATION_JOBS}/{jobId}`, timeoutSeconds: 540, memory: '1GiB' },
  async (event) => {
    const job = event.data?.data();
    const jobId = event.params.jobId;
    if (!job?.driverId) return;
    const driverId = job.driverId as string;

    try {
      await event.data!.ref.update({ status: 'running', startedAt: FieldValue.serverTimestamp() });
      const decision = await runDriverVerification(driverId);
      await event.data!.ref.update({
        status: 'done',
        decision: decision?.status ?? 'skipped',
        riskScore: decision?.riskScore ?? null,
        finishedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // A crash must not strand the applicant on "verifying" forever: put them
      // in the human queue, which is where an unverifiable application belongs.
      logger.error('Driver verification job failed', { jobId, driverId, e });
      await event.data!.ref.update({
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
  },
);

/** Admin-only: run the engine again on one driver, e.g. after a config change. */
export const adminRerunDriverVerification = onCall(
  { timeoutSeconds: 540, memory: '1GiB' },
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

/** Admin-only: read or change the engine's thresholds. */
export const adminVerificationSettings = onCall(async (req) => {
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
    aiConfigured: verificationAIConfigured(),
  };
});
