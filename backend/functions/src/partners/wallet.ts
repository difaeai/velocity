/**
 * Partner Program — wallet, maturation, withdrawals and clawbacks.
 * ----------------------------------------------------------------------------
 * A partner wallet has four numbers and they must always agree:
 *
 *   pending    earned, still inside the fraud-hold window, NOT withdrawable
 *   balance    matured, withdrawable, not yet requested
 *   withdrawn  actually paid out
 *   lifetime   everything ever earned (never decreases except on a clawback)
 *
 * Money moves pending → balance → withdrawn, one direction, and every move
 * happens in a transaction that also moves the row that caused it. The invariant
 * that matters: a rupee is in exactly one of those buckets at any moment, so a
 * partner can never withdraw the same earning twice, and a clawback can never
 * take money that was already legitimately paid out.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { getPartnerSettings } from './config';
import { requirePartner } from './applications';
import { logFraud } from './fraud';
import type { PartnerRideStatus, WithdrawalStatus } from './types';

/**
 * Move matured commission from `pending` into the withdrawable balance.
 *
 * Runs every 30 minutes rather than on a timer per transaction: thousands of
 * one-rupee credits do not each deserve their own scheduled job, and a partner
 * seeing money mature within the half-hour is indistinguishable from instant.
 */
export const maturePartnerEarnings = onSchedule('every 30 minutes', async () => {
  const due = await db
    .collection('partner_transactions')
    .where('status', '==', 'pending')
    .where('maturesAt', '<=', new Date())
    .limit(500)
    .get();

  if (due.empty) return;

  // Group by partner so one wallet write covers all of that partner's matured
  // rows, instead of N contended writes on the same document.
  const byPartner = new Map<string, { ids: string[]; total: number }>();
  for (const doc of due.docs) {
    const partnerId = doc.get('partnerId') as string;
    const cut = (doc.get('fleetCommission') as number) ?? 0;
    const entry = byPartner.get(partnerId) ?? { ids: [], total: 0 };
    entry.ids.push(doc.id);
    entry.total += cut;
    byPartner.set(partnerId, entry);
  }

  for (const [partnerId, { ids, total }] of byPartner) {
    try {
      await db.runTransaction(async (tx) => {
        // Re-read each row inside the transaction: a clawback may have reversed
        // it between the query above and this write, and maturing a reversed row
        // would resurrect money that was taken back.
        const snaps = await Promise.all(
          ids.map((id) => tx.get(db.doc(`partner_transactions/${id}`))),
        );
        let matured = 0;
        for (const snap of snaps) {
          if (snap.get('status') !== 'pending') continue;
          matured += (snap.get('fleetCommission') as number) ?? 0;
          tx.update(snap.ref, {
            status: 'available',
            maturedAt: FieldValue.serverTimestamp(),
          });
        }
        if (matured === 0) return;
        tx.set(
          db.doc(`partner_wallets/${partnerId}`),
          {
            pending: FieldValue.increment(-matured),
            balance: FieldValue.increment(matured),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
      logger.info('Matured partner earnings', { partnerId, rows: ids.length, total });
    } catch (err) {
      logger.error('Failed to mature partner earnings', { partnerId, err });
    }
  }
});

const markRideSchema = z.object({
  tripId: z.string().min(1).max(128),
  status: z.enum(['completed', 'cancelled', 'scam', 'fraud']),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Admin-only: re-judge a ride after the fact and claw back what it paid.
 *
 * Reversal takes from `pending` first — money still inside the hold window is
 * the whole reason the window exists. If the earning already matured we take it
 * from `balance`, and if the partner has already withdrawn it, the balance goes
 * negative and stays there: the debt is real, and netting it against future
 * earnings is the honest outcome. Silently forgiving it would make withdrawing
 * fast the winning strategy for a fraudster.
 */
export const adminMarkRideStatus = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = markRideSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid ride status.');
  const { tripId, status, reason } = parsed.data;

  const rows = await db
    .collection('partner_transactions')
    .where('tripId', '==', tripId)
    .get();
  if (rows.empty) invalid('No partner commission was paid on this ride.');

  const genuine = status === 'completed';

  for (const row of rows.docs) {
    const partnerId = row.get('partnerId') as string;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(row.ref);
      const wasReversed = fresh.get('status') === 'reversed';
      const cut = (fresh.get('fleetCommission') as number) ?? 0;
      const walletRef = db.doc(`partner_wallets/${partnerId}`);

      if (!genuine && !wasReversed && cut > 0) {
        const wallet = await tx.get(walletRef);
        const pending = (wallet.get('pending') as number) ?? 0;
        const fromPending = Math.min(pending, cut);
        const fromBalance = cut - fromPending;

        tx.set(
          walletRef,
          {
            pending: FieldValue.increment(-fromPending),
            balance: FieldValue.increment(-fromBalance),
            lifetimeEarnings: FieldValue.increment(-cut),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(
          db.doc(`partners/${partnerId}`),
          {
            completedRides: FieldValue.increment(-1),
            flaggedRides: FieldValue.increment(1),
            lifetimeEarnings: FieldValue.increment(-cut),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(
          db.doc(`partner_fleets/${fresh.get('fleetId')}`),
          {
            completedRides: FieldValue.increment(-1),
            lifetimeEarnings: FieldValue.increment(-cut),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      tx.update(row.ref, {
        rideStatus: status as PartnerRideStatus,
        status: genuine ? fresh.get('status') : 'reversed',
        fleetCommission: genuine ? cut : 0,
        reversedCommission: genuine ? null : cut,
        fraudReason: genuine ? null : (reason ?? 'Ride marked fraudulent by Velocity.'),
        reviewedBy: admin.uid,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    });

    if (!genuine) {
      await logFraud({
        kind: 'ride_loop',
        partnerId,
        subjectUid: (row.get('memberUid') as string) ?? partnerId,
        tripId,
        detail: reason ?? `Admin marked ride ${tripId} as ${status}.`,
      });
      await notifyUser(
        partnerId,
        'Scam ride detected ⚠️',
        `A ride in your fleet was marked "${status}". Its commission has been reversed.`,
        'ride',
        { partnerEvent: 'scam_ride', tripId },
      );
    }
  }

  await db.doc(`trips/${tripId}`).set({ partnerRideStatus: status }, { merge: true });
  await db.collection('auditLogs').add({
    type: 'partner.ride.restatused',
    actor: admin.uid,
    tripId,
    status,
    reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Ride re-statused', { actor: admin.uid, tripId, status });
  return { ok: true, status, rows: rows.size };
});

const withdrawSchema = z.object({
  amount: z.number().int().positive().max(10_000_000),
  method: z.enum(['easypaisa', 'jazzcash', 'bank']),
  accountName: z.string().trim().min(2).max(100),
  accountNumber: z.string().trim().min(5).max(34),
  /** Required for bank transfers; ignored for wallets. */
  bankName: z.string().trim().max(80).optional(),
});

export const requestPartnerWithdrawal = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await requirePartner(uid);

  const parsed = withdrawSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid withdrawal.');
  const { amount, method, accountName, accountNumber, bankName } = parsed.data;

  if (method === 'bank' && !bankName) invalid('Tell us which bank to send it to.');

  const settings = await getPartnerSettings();
  if (amount < settings.minWithdrawal) {
    invalid(`The minimum withdrawal is ${settings.minWithdrawal} PKR.`);
  }

  const reqRef = db.collection('withdraw_requests').doc();

  await db.runTransaction(async (tx) => {
    const wallet = await tx.get(db.doc(`partner_wallets/${uid}`));
    const balance = (wallet.get('balance') as number) ?? 0;
    if (balance < amount) {
      // Naming `pending` explicitly, because a partner staring at a big pending
      // number and a "not enough balance" error will otherwise assume a bug.
      const pending = (wallet.get('pending') as number) ?? 0;
      invalid(
        pending > 0
          ? `Only ${balance} PKR is available. Another ${pending} PKR is still clearing.`
          : `Only ${balance} PKR is available to withdraw.`,
      );
    }

    // Debit immediately: the money leaves the balance the moment it is claimed,
    // so two withdrawal requests cannot both be funded by the same rupees while
    // an admin takes a day to approve the first.
    tx.set(
      db.doc(`partner_wallets/${uid}`),
      {
        balance: FieldValue.increment(-amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(reqRef, {
      id: reqRef.id,
      partnerId: uid,
      amount,
      method,
      accountName,
      accountNumber,
      bankName: bankName ?? null,
      status: 'pending' as WithdrawalStatus,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('Partner withdrawal requested', { uid, amount, method });
  return { ok: true, requestId: reqRef.id };
});

const reviewWithdrawSchema = z.object({
  requestId: z.string().min(1).max(128),
  decision: z.enum(['approve', 'reject', 'paid']),
  reason: z.string().trim().max(300).optional(),
});

export const adminReviewWithdrawal = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewWithdrawSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid review.');
  const { requestId, decision, reason } = parsed.data;

  const reqRef = db.doc(`withdraw_requests/${requestId}`);
  let partnerId = '';
  let amount = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) invalid('Withdrawal request not found.');
    const status = snap.get('status') as WithdrawalStatus;
    if (status === 'paid' || status === 'rejected') {
      invalid(`This request is already ${status}.`);
    }
    partnerId = snap.get('partnerId') as string;
    amount = (snap.get('amount') as number) ?? 0;

    const next: WithdrawalStatus =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'paid';

    tx.update(reqRef, {
      status: next,
      rejectionReason: decision === 'reject' ? (reason ?? 'Withdrawal rejected.') : null,
      reviewedBy: admin.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      ...(decision === 'paid' ? { paidAt: FieldValue.serverTimestamp() } : {}),
    });

    if (decision === 'reject') {
      // The balance was debited when the request was made — give it back.
      tx.set(
        db.doc(`partner_wallets/${partnerId}`),
        {
          balance: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    if (decision === 'paid') {
      // Only now is the money genuinely gone; `withdrawn` is the paid-out total,
      // so it moves on payment and not on approval.
      tx.set(
        db.doc(`partner_wallets/${partnerId}`),
        {
          withdrawn: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  const copy: Record<string, { title: string; body: string }> = {
    approve: {
      title: 'Withdrawal approved ✅',
      body: `Your withdrawal of ${amount} PKR is approved and will be paid shortly.`,
    },
    reject: {
      title: 'Withdrawal rejected',
      body: reason ?? `Your withdrawal of ${amount} PKR was rejected and returned to your balance.`,
    },
    paid: {
      title: 'Withdrawal paid 💸',
      body: `${amount} PKR has been sent to your account.`,
    },
  };
  await notifyUser(partnerId, copy[decision].title, copy[decision].body, 'ride', {
    partnerEvent: 'withdrawal',
  });

  logger.info('Withdrawal reviewed', { actor: admin.uid, requestId, decision });
  return { ok: true };
});

const suspendSchema = z.object({
  partnerId: z.string().min(1).max(128),
  suspended: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

/** Admin-only: suspend or reactivate a partner. Suspended partners stop earning
 * (see commission.loadEdge) but keep every record. */
export const adminSuspendPartner = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = suspendSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { partnerId, suspended, reason } = parsed.data;

  await db.doc(`partners/${partnerId}`).set(
    {
      status: suspended ? 'suspended' : 'active',
      suspensionReason: suspended ? (reason ?? null) : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.collection('auditLogs').add({
    type: suspended ? 'partner.suspended' : 'partner.reactivated',
    actor: admin.uid,
    targetUid: partnerId,
    reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await notifyUser(
    partnerId,
    suspended ? 'Partner account suspended' : 'Partner account reactivated',
    suspended
      ? (reason ?? 'Your partner account has been suspended. Contact support.')
      : 'Your partner account is active again. You are earning on rides once more.',
    'ride',
  );

  return { ok: true };
});
