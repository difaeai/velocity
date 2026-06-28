/**
 * Velocity – Travel Mate – requestTravelMateSubscription (callable, v2)
 * ----------------------------------------------------------------------------
 * A user requests a subscription to an active plan. Creates a PENDING
 * travelMateSubscriptions doc. It does NOT grant likes — that only happens on
 * admin approval (approveTravelMateSubscription), which writes the daily
 * allowance into travelMateQuota/{uid}.
 *
 * Payment:
 *  - 'wallet'  — charged at APPROVAL time (so a rejected request never costs
 *                money, and we never hold funds in escrow). Just records intent.
 *  - manual    — user uploads proof (Storage path) for the admin to verify.
 *
 * Identity wall: writes only travelMateSubscriptions; reads only the plan.
 * Never touches users/trips/drivers.
 *
 * Wire-up: export { requestTravelMateSubscription } from './travelMate/requestSubscription';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

const Input = z.object({
  planId: z.string().min(1).max(128),
  paymentMethod: z.enum(['wallet', 'easypaisa', 'jazzcash', 'bank']),
  // Storage path/URL of the uploaded payment screenshot (manual methods).
  paymentProofURL: z.string().url().max(2000).optional(),
});

export const requestTravelMateSubscription = onCall(
  { region: REGION },
  async (req: CallableRequest) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;

    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
    const { planId, paymentMethod, paymentProofURL } = parsed.data;

    // Manual payment methods require a proof upload.
    if (paymentMethod !== 'wallet' && !paymentProofURL) {
      throw new HttpsError('invalid-argument', 'Please upload your payment proof.');
    }

    // Validate the plan exists and is active; snapshot it onto the request.
    const planSnap = await db.doc(`travelMatePlans/${planId}`).get();
    if (!planSnap.exists || planSnap.data()!.active === false) {
      throw new HttpsError('failed-precondition', 'This plan is no longer available.');
    }
    const plan = planSnap.data()!;

    // Reject duplicate in-flight requests (one pending request at a time).
    const pendingDup = await db.collection('travelMateSubscriptions')
      .where('uid', '==', uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingDup.empty) {
      throw new HttpsError('already-exists', 'You already have a subscription request awaiting approval.');
    }

    const ref = db.collection('travelMateSubscriptions').doc();
    await ref.set({
      uid,
      planId,
      planSnapshot: {
        name: plan.name,
        billingPeriod: plan.billingPeriod,        // 'weekly' | 'yearly'
        pricePKR: plan.pricePKR,
        dailyLikeAllowance: plan.dailyLikeAllowance,
      },
      status: 'pending',
      paymentMethod,
      paymentProofURL: paymentProofURL ?? null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      startAt: null,
      endAt: null,
    });

    return { subscriptionId: ref.id, status: 'pending' };
  },
);
