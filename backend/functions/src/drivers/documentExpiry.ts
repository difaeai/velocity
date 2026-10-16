/**
 * Papers go stale, and nobody tells us.
 *
 * Verification at onboarding answers "are these documents good today". This
 * answers it again every day afterwards, for every approved driver, for as long
 * as they drive. A licence that was valid when a driver joined in March is not
 * valid in October, and until this job existed nothing in the system noticed —
 * the expiry dates were collected at onboarding and then never read again.
 *
 * WHAT IT DOES, once a night:
 *   · warns a driver as their licence, CNIC or registration approaches expiry,
 *     once per threshold (30, 14, 7, 3, 1 days) so the reminders escalate
 *     rather than nag;
 *   · on the day a document lapses, takes the driver offline and suspends them,
 *     reopening exactly the one card they have to redo.
 *
 * SUSPENDED, NOT REJECTED. A driver whose licence ran out has not done anything
 * wrong — they have an errand to run. Suspension is reversible by re-uploading
 * the document, keeps their rating, trips and commission history intact, and
 * reads differently in the app. Rejection is for applications that failed.
 *
 * MID-TRIP SAFETY. This only ever flips `online` to false and drops the role.
 * It does not cancel a trip in progress: ending a ride under a passenger
 * because a date rolled over at 2 a.m. would strand them at the roadside, which
 * is a far worse outcome than one more completed trip on a day-old licence. The
 * driver simply cannot be offered anything new.
 *
 * The expiry maths is the SAME resolveExpiry() the onboarding decision uses, run
 * against the same stored dates, so a document can never be good enough to join
 * on and not good enough to keep driving on, or the reverse.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { auth, db, FieldValue } from '../lib/firebase';
import { sendToUser } from '../lib/fcm';
import { applyRole } from '../users';
import {
  EXPIRING_DOCUMENTS,
  EXPIRING_DOCUMENT_LABEL,
  EXPIRING_DOCUMENT_SECTION,
  resolveExpiry,
  type ExpiringDocument,
  type ExpiryVerdict,
  type SectionKey,
} from '../domain/driverVerification';
import { getVerificationConfig } from './verification';

/** Drivers examined per run. A night is long; this is about memory, not time. */
const PAGE_SIZE = 200;

/** The form field holding each document's typed expiry date. */
const TYPED_FIELD: Record<ExpiringDocument, string> = {
  license: 'licenseExpiry',
  cnic: 'cnicExpiry',
  vehicleRegistration: 'vehicleDocExpiry',
};

/**
 * The expiry for one document, preferring what the engine read off the card.
 *
 * `verification.expiries` is what the vision model saw printed, already
 * reconciled against what the driver typed. It is the better source — a driver
 * who typed 2030 on a card that reads 2026 should be stopped in 2026 — and the
 * typed field is the fallback for drivers verified before the engine existed.
 */
function expiryFor(
  driver: FirebaseFirestore.DocumentData,
  key: ExpiringDocument,
  now: number,
  warnWithinDays: number,
): ExpiryVerdict {
  const resolved = driver.verification?.expiries?.[key]?.resolved as string | undefined;
  return resolveExpiry({
    printed: resolved ?? null,
    typed: (driver[TYPED_FIELD[key]] as string | undefined) ?? null,
    now,
    warnWithinDays,
  });
}

/** The largest threshold the driver has not yet been warned at. */
function thresholdToWarn(
  daysLeft: number,
  thresholds: number[],
  alreadyWarnedAt: number | null,
): number | null {
  // Descending, so a driver who first appears at 5 days left gets the 7-day
  // message rather than three messages in one night.
  const candidates = [...thresholds].sort((a, b) => b - a).filter((t) => daysLeft <= t);
  const next = candidates[candidates.length - 1] ?? null;
  if (next === null) return null;
  if (alreadyWarnedAt !== null && alreadyWarnedAt <= next) return null;
  return next;
}

export const sweepDriverDocumentExpiry = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'Asia/Karachi', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const config = await getVerificationConfig();
    const now = Date.now();
    let scanned = 0;
    let warned = 0;
    let suspended = 0;
    let stamped = 0;

    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db
        .collection('drivers')
        .where('verificationStatus', '==', 'approved')
        .orderBy('__name__')
        .limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);

      const page = await q.get();
      if (page.empty) break;

      for (const doc of page.docs) {
        scanned++;
        const driver = doc.data();

        /**
         * Carry the daily-face-check switch down to the driver document.
         *
         * The security rules and the trip guards both have to know whether this
         * driver is gated on the morning face check, and neither can afford a
         * second document read to find out — so the flag lives on the driver
         * record and this is what keeps it in step with `adminConfig`. Written
         * only when it actually differs, so an unchanged setting costs nothing.
         *
         * This is also the only thing that reaches drivers who were approved
         * before the switch was flipped: turning it on takes effect for new
         * drivers immediately and for everyone else by two in the morning.
         */
        if (driver.faceCheckIn?.required !== config.dailyFaceCheckIn) {
          await doc.ref.set(
            {
              faceCheckIn: { required: config.dailyFaceCheckIn },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          stamped++;
        }

        const expired: ExpiringDocument[] = [];
        const warnings: Array<{ key: ExpiringDocument; daysLeft: number; threshold: number }> = [];

        for (const key of EXPIRING_DOCUMENTS) {
          const verdict = expiryFor(driver, key, now, config.minDaysBeforeExpiry);
          if (verdict.state === 'expired') {
            expired.push(key);
          } else if (verdict.state === 'valid' || verdict.state === 'expiring') {
            const daysLeft = verdict.daysLeft ?? Number.MAX_SAFE_INTEGER;
            const warnedAt = (driver.expiryWarnings?.[key] as number | undefined) ?? null;
            const threshold = thresholdToWarn(daysLeft, config.warnDaysBeforeExpiry, warnedAt);
            if (threshold !== null) warnings.push({ key, daysLeft, threshold });
          }
        }

        if (expired.length) {
          await suspendForExpiry(doc.id, expired);
          suspended++;
        } else if (warnings.length) {
          await warnAboutExpiry(doc.id, warnings);
          warned++;
        }
      }

      cursor = page.docs[page.docs.length - 1];
      if (page.size < PAGE_SIZE) break;
    }

    logger.info('Driver document expiry sweep complete', { scanned, warned, suspended, stamped });
  },
);

async function suspendForExpiry(driverId: string, expired: ExpiringDocument[]): Promise<void> {
  const labels = expired.map((k) => EXPIRING_DOCUMENT_LABEL[k]);
  const sections: SectionKey[] = [...new Set(expired.map((k) => EXPIRING_DOCUMENT_SECTION[k]))];
  const human = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  const reason = `Your ${human} ${labels.length === 1 ? 'has' : 'have'} expired. Upload the renewed ${labels.length === 1 ? 'document' : 'documents'} to start driving again.`;

  await applyRole(driverId, 'passenger');
  await auth.revokeRefreshTokens(driverId).catch(() => undefined);
  await db.doc(`drivers/${driverId}`).set(
    {
      verificationStatus: 'suspended',
      online: false,
      reviewReason: reason,
      rejectedSections: sections,
      reviewedBy: 'expiry-sweep',
      expiredDocuments: expired,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection('auditLogs').add({
    type: 'driver.suspended_document_expired',
    actor: 'expiry-sweep',
    targetUid: driverId,
    documents: expired,
    createdAt: FieldValue.serverTimestamp(),
  });

  await sendToUser(driverId, '⚠️ Your documents have expired', reason);
  logger.info('Driver suspended for expired documents', { driverId, expired });
}

async function warnAboutExpiry(
  driverId: string,
  warnings: Array<{ key: ExpiringDocument; daysLeft: number; threshold: number }>,
): Promise<void> {
  // Remember the threshold rather than the date, so the next, tighter warning
  // still fires and the same one never fires twice.
  const stamp: Record<string, number> = {};
  for (const w of warnings) stamp[w.key] = w.threshold;

  await db.doc(`drivers/${driverId}`).set(
    { expiryWarnings: stamp, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  const soonest = warnings.reduce((a, b) => (a.daysLeft <= b.daysLeft ? a : b));
  const label = EXPIRING_DOCUMENT_LABEL[soonest.key];
  const body =
    soonest.daysLeft <= 1
      ? `Your ${label} expires ${soonest.daysLeft === 0 ? 'today' : 'tomorrow'}. Renew it and upload the new one, or you will not be able to take rides.`
      : `Your ${label} expires in ${soonest.daysLeft} days. Upload the renewed document before then to keep driving without a break.`;

  await sendToUser(driverId, '📄 Document expiring soon', body);
}
