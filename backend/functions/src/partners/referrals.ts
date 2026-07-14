/**
 * Partner Program — binding a recruit to a fleet.
 * ----------------------------------------------------------------------------
 * This is the load-bearing integrity point of the whole program. Everything
 * downstream (commission, levels, revenue) trusts that a referral edge means a
 * real person was really recruited, so every cheap way to manufacture one is
 * refused here rather than unwound later:
 *
 *   self-referral      the fleet owner claiming their own code
 *   duplicate accounts the same CNIC / phone / device signing up again
 *   late binding       an existing user retro-attaching to a fleet
 *   device farming     one handset minting recruit after recruit
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
import { getPartnerSettings } from './config';
import { normalizeCode } from './fleets';
import { logFraud } from './fraud';
import type { FleetType } from './types';

const claimSchema = z.object({
  code: z.string().trim().min(4).max(20),
  /** Stable per-install id from the client. Used only to catch device farming. */
  deviceId: z.string().trim().min(8).max(200).optional(),
});

/** How many accounts one handset may bind into fleets before we stop trusting it. */
const MAX_CLAIMS_PER_DEVICE = 3;

export function referralPath(type: FleetType, uid: string): string {
  return type === 'driver' ? `driver_referrals/${uid}` : `passenger_referrals/${uid}`;
}

/**
 * Claim a referral code. Called once, right after the recruit's first sign-in —
 * the app stashes a code from a deep link or a manual entry and plays it here as
 * soon as an account exists.
 */
export const claimPartnerReferral = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = claimSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid referral code.');
  const code = normalizeCode(parsed.data.code);
  const deviceId = parsed.data.deviceId ?? null;

  const settings = await getPartnerSettings();

  const fleetQuery = await db
    .collection('partner_fleets')
    .where('code', '==', code)
    .limit(1)
    .get();
  if (fleetQuery.empty) invalid('That referral code does not exist.');

  const fleet = fleetQuery.docs[0];
  const fleetId = fleet.id;
  const type = fleet.get('type') as FleetType;
  const partnerId = fleet.get('partnerId') as string;

  // ── Guard: self-referral ────────────────────────────────────────────────
  if (partnerId === uid) {
    await logFraud({
      kind: 'self_referral',
      partnerId,
      subjectUid: uid,
      detail: 'Partner tried to claim their own fleet code.',
    });
    invalid('You cannot use your own referral code.');
  }

  const partnerSnap = await db.doc(`partners/${partnerId}`).get();
  if (!partnerSnap.exists || partnerSnap.get('status') !== 'active') {
    invalid('That referral code is no longer active.');
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

  // ── Guard: the referral window ──────────────────────────────────────────
  // "Referral only works during first registration." A user who has been riding
  // for weeks was not recruited by anybody, so a code they enter now would be
  // paying a partner for a customer Velocity already had.
  const createdAt = userSnap.get('createdAt') as FirebaseFirestore.Timestamp | undefined;
  const ageHours = createdAt ? (Date.now() - createdAt.toMillis()) / 3_600_000 : 0;
  if (ageHours > settings.claimWindowHours) {
    invalid('Referral codes only work on a brand-new account.');
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
    const ownerDevice = await db
      .collection('partner_referral_devices')
      .where('deviceId', '==', deviceId)
      .where('uid', '==', partnerId)
      .limit(1)
      .get();
    if (!ownerDevice.empty) {
      await logFraud({
        kind: 'device_abuse',
        partnerId,
        subjectUid: uid,
        detail: 'Recruit signed up on the fleet owner’s own device.',
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
  return { ok: true, type, fleetId, partnerName: partnerSnap.get('fullName') ?? null };
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
