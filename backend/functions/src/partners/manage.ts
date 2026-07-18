/**
 * Partner Program — admin edit and delete.
 *
 * Suspension (wallet.ts) is the reversible lever: history kept, earning paused.
 * Deletion here is the permanent one: the partner doc, their application, their
 * wallet, both fleets and every referral edge go, so the person drops back to
 * "never applied" — their app flips to the fresh Earn with Velocity landing the
 * moment the docs vanish (usePartnerStatus listens to them live) and they are
 * free to apply again, while their recruits are freed to join another fleet.
 *
 * The one thing deletion refuses to swallow is money in flight: a pending or
 * approved withdrawal must be settled or rejected first, because deleting the
 * wallet under it would strand a real rupee amount nobody can pay out anymore.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';

const updateSchema = z.object({
  partnerId: z.string().min(1).max(128),
  fullName: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  mobile: z.string().trim().min(10).max(20).optional(),
  tier: z.enum(['free', 'pro']).optional(),
});

/** Admin-only: edit a partner's basic details. */
export const adminUpdatePartner = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = updateSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid partner update.');
  const { partnerId, fullName, city, mobile, tier } = parsed.data;

  const ref = db.doc(`partners/${partnerId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('No partner found for this id.');

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fullName !== undefined) patch.fullName = fullName;
  if (city !== undefined) patch.city = city;
  if (mobile !== undefined) patch.mobile = mobile;
  if (tier !== undefined) patch.tier = tier;
  await ref.set(patch, { merge: true });

  // The fleets carry the partner's name — a renamed partner whose fleets still
  // advertise the old name confuses every recruit who previews the code.
  if (fullName !== undefined) {
    const fleets = await db.collection('partner_fleets').where('partnerId', '==', partnerId).get();
    const batch = db.batch();
    for (const f of fleets.docs) {
      const type = f.get('type') as string;
      batch.set(
        f.ref,
        {
          name: `${fullName} — ${type === 'driver' ? 'Driver' : 'Passenger'} Fleet`,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  await db.collection('auditLogs').add({
    type: 'partner.updated',
    actor: admin.uid,
    targetUid: partnerId,
    fields: Object.keys(patch).filter((k) => k !== 'updatedAt'),
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Partner updated', { actor: admin.uid, partnerId });
  return { ok: true };
});

/** Deletes every doc a query matches, in commit-sized chunks. */
async function deleteAll(query: FirebaseFirestore.Query): Promise<number> {
  let removed = 0;
  // Loop because one partner can in principle have more than a batch of edges.
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) return removed;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) return removed;
  }
}

const deleteSchema = z.object({
  partnerId: z.string().min(1).max(128),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Admin-only: permanently remove a partner from the program.
 *
 * Deletes the partner, their application, wallet, both fleets, and every
 * referral edge bound to them. Their recruits become unbound (free to redeem a
 * different code), and the ex-partner's app returns to the fresh landing page,
 * from which they may apply again. Fraud logs and audit logs are deliberately
 * kept — deletion removes the partner, not the record of what happened.
 */
export const adminDeletePartner = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = deleteSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { partnerId, reason } = parsed.data;

  const partnerRef = db.doc(`partners/${partnerId}`);
  const partnerSnap = await partnerRef.get();
  if (!partnerSnap.exists) invalid('No partner found for this id.');

  // Money in flight blocks deletion — settle or reject the withdrawal first.
  // Status is filtered in code: one partner has few withdrawal docs, and the
  // partnerId+status pair has no composite index.
  const withdrawals = await db
    .collection('withdraw_requests')
    .where('partnerId', '==', partnerId)
    .get();
  const hasOpen = withdrawals.docs.some((d) =>
    ['pending', 'approved'].includes(d.get('status') as string),
  );
  if (hasOpen) {
    invalid('This partner has an unsettled withdrawal. Pay or reject it before deleting.');
  }

  const drivers = await deleteAll(
    db.collection('driver_referrals').where('partnerId', '==', partnerId),
  );
  const passengers = await deleteAll(
    db.collection('passenger_referrals').where('partnerId', '==', partnerId),
  );
  await deleteAll(db.collection('partner_fleets').where('partnerId', '==', partnerId));

  const batch = db.batch();
  batch.delete(partnerRef);
  batch.delete(db.doc(`partner_wallets/${partnerId}`));
  // Without this the ex-partner's app would show their stale application
  // status instead of the fresh landing page.
  batch.delete(db.doc(`partner_applications/${partnerId}`));
  await batch.commit();

  await db.collection('auditLogs').add({
    type: 'partner.deleted',
    actor: admin.uid,
    targetUid: partnerId,
    reason: reason ?? null,
    unboundDrivers: drivers,
    unboundPassengers: passengers,
    createdAt: FieldValue.serverTimestamp(),
  });

  await notifyUser(
    partnerId,
    'Partner account removed',
    reason ?? 'Your Velocity partner account has been removed. You may apply again from Earn with Velocity.',
    'ride',
    { partnerEvent: 'deleted' },
  );

  logger.info('Partner deleted', { actor: admin.uid, partnerId, drivers, passengers });
  return { ok: true, unboundDrivers: drivers, unboundPassengers: passengers };
});
