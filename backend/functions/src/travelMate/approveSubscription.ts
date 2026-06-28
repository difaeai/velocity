/**
 * Velocity – Travel Mate – approve / reject Subscription (callable, v2, admin-only)
 * ----------------------------------------------------------------------------
 * approveTravelMateSubscription is the money + quota handshake. In ONE
 * transaction it:
 *   1) (wallet payments) debits pricePKR from the user's wallet, rolling back
 *      the whole approval if the balance is insufficient;
 *   2) activates the subscription with startAt/endAt;
 *   3) writes the daily like allowance into the SAME travelMateQuota/{uid} doc
 *      that swipe.ts reads — this is what flips the user from free 4/month to
 *      N/day. If these field names drift from swipe.ts, paid users silently stay
 *      on the free tier, so they are kept identical here.
 *
 * Re-approval extends endAt from max(now, currentEndAt).
 *
 * Wallet integration matches this project's wallet exactly:
 *   - Path:             wallets/{uid}
 *   - Balance field:    balance (number, PKR)
 *   - Ledger path:      wallets/{uid}/transactions/{auto}
 *   - Ledger fields:    type, amount, createdAt (+ extra context fields)
 *
 * Wire-up: export { approveTravelMateSubscription, rejectTravelMateSubscription }
 *          from './travelMate/approveSubscription';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';
const TZ = 'Asia/Karachi';

function requireAdmin(req: CallableRequest) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (req.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  return req.auth.uid;
}

function todayKeyKarachi(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // YYYY-MM-DD
}

function addDays(base: number, days: number): number {
  return base + days * 24 * 3600 * 1000;
}

const ApproveInput = z.object({ subscriptionId: z.string().min(1).max(128) });
const RejectInput = z.object({
  subscriptionId: z.string().min(1).max(128),
  reason: z.string().max(300).optional(),
});

export const approveTravelMateSubscription = onCall(
  { region: REGION },
  async (req: CallableRequest) => {
    const adminUid = requireAdmin(req);
    const parsed = ApproveInput.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
    const { subscriptionId } = parsed.data;

    const subRef = db.doc(`travelMateSubscriptions/${subscriptionId}`);

    const result = await db.runTransaction(async (tx) => {
      // ---- READS ----
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) throw new HttpsError('not-found', 'Subscription not found.');
      const sub = subSnap.data()!;
      if (sub.status !== 'pending') {
        throw new HttpsError('failed-precondition', `Subscription is already ${sub.status}.`);
      }

      const uid: string = sub.uid;
      const plan = sub.planSnapshot || {};
      const price: number = plan.pricePKR ?? 0;
      const dailyAllowance: number = plan.dailyLikeAllowance ?? 0;
      const period: string = plan.billingPeriod ?? 'weekly';

      const quotaRef = db.doc(`travelMateQuota/${uid}`);
      const quotaSnap = await tx.get(quotaRef);
      const existingEnd: admin.firestore.Timestamp | null =
        quotaSnap.exists ? (quotaSnap.data()!.subscriptionEndAt ?? null) : null;

      let walletRef: FirebaseFirestore.DocumentReference | null = null;
      let walletBalance = 0;
      if (sub.paymentMethod === 'wallet') {
        walletRef = db.doc(`wallets/${uid}`);
        const walletSnap = await tx.get(walletRef);
        walletBalance = walletSnap.exists ? (walletSnap.data()!.balance ?? 0) : 0;
        if (walletBalance < price) {
          throw new HttpsError('failed-precondition', 'Insufficient wallet balance.');
        }
      }

      // ---- COMPUTE dates ----
      const now = Date.now();
      const base = existingEnd && existingEnd.toMillis() > now ? existingEnd.toMillis() : now;
      const days = period === 'yearly' ? 365 : 7;
      const startAt = admin.firestore.Timestamp.fromMillis(now);
      const endAt = admin.firestore.Timestamp.fromMillis(addDays(base, days));

      // ---- WRITES ----
      // 1) Wallet debit (append-only ledger entry), if applicable.
      if (walletRef) {
        tx.update(walletRef, { balance: walletBalance - price });
        const txnRef = walletRef.collection('transactions').doc();
        tx.set(txnRef, {
          type: 'debit',
          amount: price,
          currency: 'PKR',
          reason: 'travelMate_subscription',
          subscriptionId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 2) Activate the subscription.
      tx.update(subRef, {
        status: 'active',
        startAt,
        endAt,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: adminUid,
      });

      // 3) THE HANDSHAKE — write the daily allowance into the quota doc that
      //    swipe.ts reads. Field names MUST match swipe.ts exactly.
      tx.set(quotaRef, {
        uid,
        tier: 'subscribed',
        dailyAllowance,
        dailyUsed: 0,
        dailyKey: todayKeyKarachi(),
        subscriptionId,
        subscriptionEndAt: endAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 4) Audit log (matches existing admin action log).
      const auditRef = db.collection('auditLogs').doc();
      tx.set(auditRef, {
        action: 'travelMate.subscription.approved',
        subscriptionId,
        targetUid: uid,
        by: adminUid,
        pricePKR: price,
        dailyAllowance,
        endAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { uid, endAt: endAt.toDate().toISOString(), dailyAllowance };
    });

    return { status: 'active', ...result };
  },
);

export const rejectTravelMateSubscription = onCall(
  { region: REGION },
  async (req: CallableRequest) => {
    const adminUid = requireAdmin(req);
    const parsed = RejectInput.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
    const { subscriptionId, reason } = parsed.data;

    const subRef = db.doc(`travelMateSubscriptions/${subscriptionId}`);
    await db.runTransaction(async (tx) => {
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) throw new HttpsError('not-found', 'Subscription not found.');
      if (subSnap.data()!.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Only pending requests can be rejected.');
      }
      tx.update(subRef, {
        status: 'rejected',
        rejectionReason: reason ?? null,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: adminUid,
      });
      const auditRef = db.collection('auditLogs').doc();
      tx.set(auditRef, {
        action: 'travelMate.subscription.rejected',
        subscriptionId,
        targetUid: subSnap.data()!.uid,
        by: adminUid,
        reason: reason ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { status: 'rejected' };
  },
);
