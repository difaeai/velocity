/**
 * Partner Program — binding a recruit to a fleet.
 * ----------------------------------------------------------------------------
 * A recruit types one five-digit code. Which fleet they land in is decided by
 * who THEY are, not by what they typed: a driver joins the partner's driver
 * fleet, a passenger joins their passenger fleet. So the same code on the same
 * poster works for both audiences, and a partner can never hand somebody "the
 * wrong code".
 *
 * This is the load-bearing integrity point of the whole program. Everything
 * downstream (commission, levels, revenue) trusts that a referral edge means a
 * real person was really recruited, so every cheap way to manufacture one is
 * refused here rather than unwound later:
 *
 *   self-referral      the fleet owner redeeming their own code
 *   duplicate accounts the same CNIC / phone / device signing up again
 *   retro-crediting    an established rider attaching to a fleet after the fact
 *   device farming     one handset minting recruit after recruit
 *
 * The retro-crediting guard is why a code binds only to an account with NO
 * completed rides. A user who has been riding for a month was not recruited by
 * anybody — paying a partner for them would be paying for a customer Velocity
 * already had. It is deliberately NOT an account-age window: a driver may sign
 * up today, wait a week for their licence to be approved, and only then be told
 * about their fleet owner's code. They have driven nobody, so they may still
 * bind.
 *
 * A referral is permanent once bound: only an admin can move or delete the edge
 * (`adminReassignReferral`). That permanence is why the guards run BEFORE the
 * write and inside a transaction — a bad edge that gets committed will quietly
 * pay someone forever.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { normalizeCode } from './fleets';
import { logFraud } from './fraud';
import type { FleetType } from './types';

const claimSchema = z.object({
  code: z.string().trim().min(4).max(10),
  /** Stable per-install id from the client. Used only to catch device farming. */
  deviceId: z.string().trim().min(8).max(200).optional(),
});

/** How many accounts one handset may bind into fleets before we stop trusting it. */
const MAX_CLAIMS_PER_DEVICE = 3;

export function referralPath(type: FleetType, uid: string): string {
  return type === 'driver' ? `driver_referrals/${uid}` : `passenger_referrals/${uid}`;
}

/**
 * Has this user already earned money for Velocity? If so nobody recruited them
 * and a partner cannot claim credit for them now.
 */
async function hasCompletedRides(uid: string, type: FleetType): Promise<boolean> {
  const field = type === 'driver' ? 'driverId' : 'passengerId';
  const snap = await db
    .collection('trips')
    .where(field, '==', uid)
    .where('status', '==', 'completed')
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Redeem a referral code. Called from the passenger's settings screen or the
 * driver's drawer, whenever the recruit gets around to it.
 */
export const claimPartnerReferral = onCall(async (req) => {
  const ctx = requireAuth(req);
  const { uid, role } = ctx;
  const parsed = claimSchema.safeParse(req.data);
  if (!parsed.success) invalid('Enter the 5-digit referral code.');
  const code = normalizeCode(parsed.data.code);
  const deviceId = parsed.data.deviceId ?? null;

  // The recruit's own role picks the fleet. Everything else follows from this.
  //
  // Note that one person can end up in BOTH of a partner's fleets, and that is
  // correct rather than a leak. Every Velocity driver starts life as a passenger
  // (see the become-driver flow), so somebody who redeems a code on day one binds
  // their PASSENGER edge; if they later get approved to drive and redeem the same
  // code from the driver drawer, they bind their DRIVER edge too. The edges live
  // in separate collections keyed by uid, so the "already linked" guard below only
  // ever blocks a second edge OF THE SAME TYPE. The partner recruited both the
  // rider and the driver — they are paid for both.
  const type: FleetType = role === 'driver' ? 'driver' : 'passenger';

  const partnerQuery = await db
    .collection('partners')
    .where('referralCode', '==', code)
    .limit(1)
    .get();
  if (partnerQuery.empty) invalid('That referral code does not exist.');

  const partnerSnap = partnerQuery.docs[0];
  const partnerId = partnerSnap.id;

  if (partnerSnap.get('status') !== 'active') {
    invalid('That referral code is no longer active.');
  }

  const fleetId = partnerSnap.get(
    type === 'driver' ? 'driverFleetId' : 'passengerFleetId',
  ) as string | undefined;
  if (!fleetId) invalid('That partner has no fleet for you to join yet.');

  // ── Guard: self-referral ────────────────────────────────────────────────
  if (partnerId === uid) {
    await logFraud({
      kind: 'self_referral',
      partnerId,
      subjectUid: uid,
      detail: 'Partner tried to redeem their own referral code.',
    });
    invalid('You cannot use your own referral code.');
  }

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) invalid('Your account is not ready yet. Try again in a moment.');

  // ── Guard: duplicate account behind the same CNIC or phone ──────────────
  // The partner's own identity documents signing up as their own recruit is the
  // same fraud as a self-referral, just wearing a second account.
  const partnerCnic = partnerSnap.get('cnicNumber') as string | undefined;
  const partnerMobile = partnerSnap.get('mobile') as string | undefined;
  const userCnic = (userSnap.get('cnicVerification') as { cnicNumber?: string } | undefined)
    ?.cnicNumber;
  const userPhone = userSnap.get('phoneNumber') as string | undefined;
  if (
    (partnerCnic && userCnic && partnerCnic === userCnic) ||
    (partnerMobile && userPhone && partnerMobile === userPhone)
  ) {
    await logFraud({
      kind: 'duplicate_account',
      partnerId,
      subjectUid: uid,
      detail: 'Recruit shares the CNIC or phone number of the fleet owner.',
    });
    invalid('You cannot use your own referral code.');
  }

  // ── Guard: no retro-crediting an established user ───────────────────────
  if (await hasCompletedRides(uid, type)) {
    invalid(
      type === 'driver'
        ? 'Referral codes only work before your first completed ride.'
        : 'Referral codes only work before your first completed trip.',
    );
  }

  // ── Guard: device farming ───────────────────────────────────────────────
  if (deviceId) {
    const priorClaims = await db
      .collection('partner_referral_devices')
      .where('deviceId', '==', deviceId)
      .get();
    const otherUsers = priorClaims.docs.filter((d) => d.get('uid') !== uid);
    if (otherUsers.length >= MAX_CLAIMS_PER_DEVICE) {
      await logFraud({
        kind: 'device_abuse',
        partnerId,
        subjectUid: uid,
        detail: `Device ${deviceId} has already bound ${otherUsers.length} accounts to fleets.`,
      });
      invalid('This device has already been used for too many referrals.');
    }
    // The fleet owner's own handset enrolling "recruits" is device-assisted
    // self-referral — the accounts differ, the person does not.
    const ownerDevice = priorClaims.docs.some((d) => d.get('uid') === partnerId);
    if (ownerDevice) {
      await logFraud({
        kind: 'device_abuse',
        partnerId,
        subjectUid: uid,
        detail: 'Recruit redeemed the code on the fleet owner’s own device.',
      });
      invalid('You cannot use your own referral code.');
    }
  }

  const refRef = db.doc(referralPath(type, uid));
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(refRef);
    // ── Guard: permanence. An edge, once bound, never silently moves.
    if (existing.exists) {
      invalid('Your account is already linked to a fleet.');
    }

    tx.set(refRef, {
      uid,
      fleetId,
      partnerId,
      type,
      code,
      deviceId,
      completedRides: 0,
      flaggedRides: 0,
      totalRideValue: 0,
      platformCommissionGenerated: 0,
      fleetCommissionGenerated: 0,
      lastRideAt: null,
      boundAt: now,
    });
    tx.set(
      db.doc(`partner_fleets/${fleetId}`),
      { members: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
    tx.set(
      db.doc(`partners/${partnerId}`),
      {
        [type === 'driver' ? 'totalDrivers' : 'totalPassengers']: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true },
    );
    if (deviceId) {
      tx.set(db.collection('partner_referral_devices').doc(`${deviceId}_${uid}`), {
        deviceId,
        uid,
        partnerId,
        fleetId,
        createdAt: now,
      });
    }
  });

  const who = (userSnap.get('displayName') as string) ?? 'Someone';
  await notifyUser(
    partnerId,
    type === 'driver' ? 'New driver joined your fleet 🚗' : 'New passenger joined your fleet 👤',
    `${who} joined using your code ${code}. You earn on every genuine completed ride they take.`,
    'ride',
    { partnerEvent: 'member_joined', fleetId },
  );

  logger.info('Partner referral bound', { uid, partnerId, fleetId, type });
  return {
    ok: true,
    type,
    fleetId,
    partnerName: (partnerSnap.get('fullName') as string) ?? null,
  };
});

const reassignSchema = z.object({
  uid: z.string().min(1).max(128),
  type: z.enum(['driver', 'passenger']),
  /** Omit to detach the recruit from every fleet. */
  fleetId: z.string().min(1).max(128).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Admin-only: move or cut a referral edge. The one exception to permanence,
 * for when support has to correct a mis-bind or strip a fraudulent one.
 */
export const adminReassignReferral = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reassignSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid reassignment.');
  const { uid, type, fleetId, reason } = parsed.data;

  const refRef = db.doc(referralPath(type, uid));
  const now = FieldValue.serverTimestamp();

  let target: FirebaseFirestore.DocumentSnapshot | null = null;
  if (fleetId) {
    target = await db.doc(`partner_fleets/${fleetId}`).get();
    if (!target.exists) invalid('Target fleet not found.');
    if (target.get('type') !== type) invalid(`That fleet is not a ${type} fleet.`);
    if (target.get('partnerId') === uid) invalid('A partner cannot be their own recruit.');
  }

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(refRef);

    // Decrement the fleet the recruit is leaving, so member counts stay true.
    if (existing.exists) {
      const oldFleetId = existing.get('fleetId') as string;
      const oldPartnerId = existing.get('partnerId') as string;
      tx.set(
        db.doc(`partner_fleets/${oldFleetId}`),
        { members: FieldValue.increment(-1), updatedAt: now },
        { merge: true },
      );
      tx.set(
        db.doc(`partners/${oldPartnerId}`),
        {
          [type === 'driver' ? 'totalDrivers' : 'totalPassengers']: FieldValue.increment(-1),
          updatedAt: now,
        },
        { merge: true },
      );
    }

    if (!fleetId || !target) {
      tx.delete(refRef);
      return;
    }

    const newPartnerId = target.get('partnerId') as string;
    tx.set(
      refRef,
      {
        uid,
        fleetId,
        partnerId: newPartnerId,
        type,
        code: target.get('code'),
        // Counters follow the recruit, not the fleet: history already earned by
        // the old partner is not retroactively re-credited to the new one.
        completedRides: existing.get('completedRides') ?? 0,
        flaggedRides: existing.get('flaggedRides') ?? 0,
        totalRideValue: existing.get('totalRideValue') ?? 0,
        platformCommissionGenerated: existing.get('platformCommissionGenerated') ?? 0,
        fleetCommissionGenerated: 0,
        lastRideAt: existing.get('lastRideAt') ?? null,
        boundAt: existing.get('boundAt') ?? now,
        reassignedAt: now,
        reassignedBy: admin.uid,
      },
      { merge: true },
    );
    tx.set(
      db.doc(`partner_fleets/${fleetId}`),
      { members: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
    tx.set(
      db.doc(`partners/${newPartnerId}`),
      {
        [type === 'driver' ? 'totalDrivers' : 'totalPassengers']: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await db.collection('auditLogs').add({
    type: 'partner.referral.reassigned',
    actor: admin.uid,
    targetUid: uid,
    fleetId: fleetId ?? null,
    reason: reason ?? null,
    createdAt: now,
  });

  logger.info('Referral reassigned', { actor: admin.uid, uid, type, fleetId });
  return { ok: true };
});

/** What fleet am I in, if any? Drives the referral-code screens in the app. */
export const getMyReferral = onCall(async (req) => {
  const { uid, role } = requireAuth(req);
  const type: FleetType = role === 'driver' ? 'driver' : 'passenger';

  const snap = await db.doc(referralPath(type, uid)).get();
  if (!snap.exists) return { ok: true, bound: false, type };

  const partner = await db.doc(`partners/${snap.get('partnerId')}`).get();
  return {
    ok: true,
    bound: true,
    type,
    code: snap.get('code') as string,
    partnerName: (partner.get('fullName') as string) ?? 'Your fleet owner',
    completedRides: (snap.get('completedRides') as number) ?? 0,
    boundAt:
      (snap.get('boundAt') as FirebaseFirestore.Timestamp | null)?.toMillis() ?? null,
  };
});
