/**
 * Franchise portal — a Pro partner filing drivers, and an admin deciding.
 * ----------------------------------------------------------------------------
 * A partner running a fleet knows their drivers before Velocity does. This lets
 * them file the driver and the vehicle from the web portal — and stops there.
 * **The submission creates nothing.** No auth account, no driver record, no
 * fleet edge exists until an admin approves it. A partner who could mint driver
 * accounts could mint an unbounded fleet of accounts they control and farm the
 * commission on staged rides between them, which is precisely what the fraud
 * engine in `partners/fraud.ts` exists to catch after the fact — better not to
 * open the door in the first place.
 *
 * On approval the driver joins the partner's **driver fleet**, so the ordinary
 * Pro rate (see `partners/config.ts`) pays out through the existing commission
 * path. No new money path is introduced here: this is a recruitment surface, not
 * a second earning scheme.
 *
 * The retro-crediting rule from `partners/referrals.ts` is preserved on purpose.
 * A driver who has already completed rides for Velocity was not recruited by
 * anybody, so they are approved as a driver but the fleet edge is refused. The
 * partner is told which happened rather than left to wonder why their counter
 * did not move.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAdmin, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { notifyUser } from '../lib/fcm';
import { normalizePhone } from '../partners/applications';
import { requirePortalOwner } from './portal';

const VEHICLE_TYPES = ['mini', 'ac', 'comfort', 'xl', 'bike', 'auto'] as const;

const submitSchema = z.object({
  portalId: z.string().trim().min(8).max(64),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(200).optional(),
  cnic: z.string().trim().min(6).max(20),
  licenseNumber: z.string().trim().max(40).optional(),
  vehicleType: z.enum(VEHICLE_TYPES),
  vehicleLabel: z.string().trim().min(2).max(80),
  plate: z.string().trim().min(3).max(16),
  vehicleYear: z.number().int().min(1980).max(2100).optional(),
  vehicleColor: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Plates are compared with spaces and dashes stripped — "LEB 4417" is "LEB-4417". */
function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const franchiseSubmitDriver = onCall(async (req) => {
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Check the driver details.');
  const data = parsed.data;

  const { uid, partner } = await requirePortalOwner(req, data.portalId);

  // Generous against any honest evening of data entry, tight enough that a
  // scripted loop cannot fill the admin queue.
  await rateLimit(uid, 'franchiseSubmitDriver', 40, 3600);

  const phone = normalizePhone(data.phone);
  const plate = normalizePlate(data.plate);

  // ── Guard: a partner may not file themselves as their own recruit ────────
  const ownMobile = partner.get('mobile') as string | undefined;
  const ownCnic = partner.get('cnicNumber') as string | undefined;
  if (ownMobile && normalizePhone(ownMobile) === phone) {
    invalid('You cannot add yourself as a driver in your own fleet.');
  }
  if (ownCnic && ownCnic.replace(/\D/g, '') === data.cnic.replace(/\D/g, '')) {
    invalid('You cannot add yourself as a driver in your own fleet.');
  }

  // ── Guard: the same person or vehicle filed twice ────────────────────────
  const [phoneClash, plateClash] = await Promise.all([
    db
      .collection('driver_submissions')
      .where('phone', '==', phone)
      .where('status', 'in', ['pending', 'approved'])
      .limit(1)
      .get(),
    db
      .collection('driver_submissions')
      .where('plateNormalized', '==', plate)
      .where('status', 'in', ['pending', 'approved'])
      .limit(1)
      .get(),
  ]);
  if (!phoneClash.empty) {
    const mine = phoneClash.docs[0].get('partnerId') === uid;
    invalid(
      mine
        ? 'You have already submitted this driver.'
        : 'This number is already registered with another fleet.',
    );
  }
  if (!plateClash.empty) {
    invalid('That number plate has already been submitted.');
  }

  const ref = db.collection('driver_submissions').doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    partnerId: uid,
    partnerName: partner.get('fullName') ?? null,
    partnerCode: partner.get('referralCode') ?? null,
    fullName: data.fullName,
    phone,
    email: data.email ?? null,
    cnic: data.cnic,
    licenseNumber: data.licenseNumber ?? null,
    vehicleType: data.vehicleType,
    vehicleLabel: data.vehicleLabel,
    plate: data.plate.toUpperCase(),
    plateNormalized: plate,
    vehicleYear: data.vehicleYear ?? null,
    vehicleColor: data.vehicleColor ?? null,
    notes: data.notes ?? null,
    status: 'pending',
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdDriverUid: null,
    fleetBound: false,
    createdAt: now,
    updatedAt: now,
  });

  logger.info('Franchise driver submitted', { partnerId: uid, submissionId: ref.id });
  return { ok: true, submissionId: ref.id, status: 'pending' };
});

const listSchema = z.object({
  portalId: z.string().trim().min(8).max(64),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * The partner's own submissions. Served through a callable rather than a direct
 * Firestore read so one partner can never widen the query and enumerate another
 * fleet's drivers — the same reasoning as `getPartnerFleetMembers`.
 */
export const franchiseListDrivers = onCall(async (req) => {
  const parsed = listSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { uid } = await requirePortalOwner(req, parsed.data.portalId);

  let q: FirebaseFirestore.Query = db.collection('driver_submissions').where('partnerId', '==', uid);
  if (parsed.data.status) q = q.where('status', '==', parsed.data.status);
  const snap = await q.orderBy('createdAt', 'desc').limit(parsed.data.limit ?? 50).get();
  return {
    ok: true,
    drivers: snap.docs.map((d) => ({
      id: d.id,
      fullName: d.get('fullName'),
      phone: d.get('phone'),
      vehicleType: d.get('vehicleType'),
      vehicleLabel: d.get('vehicleLabel'),
      plate: d.get('plate'),
      status: d.get('status'),
      rejectionReason: d.get('rejectionReason') ?? null,
      fleetBound: d.get('fleetBound') ?? false,
      createdAt: d.get('createdAt') ?? null,
      reviewedAt: d.get('reviewedAt') ?? null,
    })),
  };
});

const withdrawSchema = z.object({
  portalId: z.string().trim().min(8).max(64),
  submissionId: z.string().min(1).max(128),
});

/** A partner may take back a submission the admin has not decided on yet. */
export const franchiseWithdrawSubmission = onCall(async (req) => {
  const parsed = withdrawSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { uid } = await requirePortalOwner(req, parsed.data.portalId);

  const ref = db.doc(`driver_submissions/${parsed.data.submissionId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('partnerId') !== uid) invalid('Submission not found.');
  if (snap.get('status') !== 'pending') invalid('Only a pending submission can be withdrawn.');

  await ref.delete();
  logger.info('Franchise submission withdrawn', { partnerId: uid, submissionId: ref.id });
  return { ok: true };
});

/* ── admin side ─────────────────────────────────────────────────────────── */

const adminListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const adminListDriverSubmissions = onCall(async (req) => {
  requireAdmin(req);
  const parsed = adminListSchema.safeParse(req.data ?? {});
  if (!parsed.success) invalid('Invalid request.');

  let q: FirebaseFirestore.Query = db.collection('driver_submissions');
  if (parsed.data.status) q = q.where('status', '==', parsed.data.status);
  const snap = await q.orderBy('createdAt', 'desc').limit(parsed.data.limit ?? 100).get();
  return {
    ok: true,
    submissions: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
});

const reviewSchema = z.object({
  submissionId: z.string().min(1).max(128),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Admin-only: the final approval the whole flow waits on.
 *
 * Approving does four things, in this order, because each depends on the last:
 * resolve (or create) the driver's auth account by phone number, grant the
 * driver role, write the driver record, then bind the fleet edge if the
 * recruitment rules allow it.
 *
 * The account is keyed on the **phone number**, not an email, because that is
 * how drivers actually sign in — the mobile app verifies a number natively and
 * exchanges it for a session. Creating the record ahead of the driver's first
 * launch means they install the app, verify the number the partner gave us, and
 * are already approved.
 */
export const adminReviewDriverSubmission = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid review.');
  const { submissionId, decision, reason } = parsed.data;

  if (decision === 'reject' && !reason) {
    invalid('Give the partner a reason so they know what to fix.');
  }

  const ref = db.doc(`driver_submissions/${submissionId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Submission not found.');
  if (snap.get('status') !== 'pending') invalid('This submission has already been decided.');

  const partnerId = snap.get('partnerId') as string;
  const phone = snap.get('phone') as string;
  const fullName = snap.get('fullName') as string;
  const now = FieldValue.serverTimestamp();

  if (decision === 'reject') {
    await ref.set(
      { status: 'rejected', rejectionReason: reason, reviewedBy: admin.uid, reviewedAt: now, updatedAt: now },
      { merge: true },
    );
    await db.collection('auditLogs').add({
      type: 'franchise.driver.rejected',
      actor: admin.uid,
      submissionId,
      partnerId,
      reason,
      createdAt: now,
    });
    await notifyUser(
      partnerId,
      'Driver not approved',
      `${fullName} could not be added to your fleet. ${reason}`,
      'ride',
      { franchiseEvent: 'driver_rejected', submissionId },
    );
    return { ok: true, status: 'rejected' };
  }

  // ── resolve the driver's account ────────────────────────────────────────
  let driverUid: string;
  let createdAccount = false;
  try {
    driverUid = (await auth.getUserByPhoneNumber(phone)).uid;
  } catch {
    try {
      const created = await auth.createUser({ phoneNumber: phone, displayName: fullName });
      driverUid = created.uid;
      createdAccount = true;
    } catch (e) {
      invalid(
        e instanceof Error && e.message.includes('already exists')
          ? 'That phone number is already attached to another account.'
          : 'Could not create the driver account.',
      );
    }
  }

  const partnerSnap = await db.doc(`partners/${partnerId}`).get();
  const driverFleetId = partnerSnap.get('driverFleetId') as string | undefined;
  const partnerCode = partnerSnap.get('referralCode') as string | undefined;
  const partnerActive = partnerSnap.exists && partnerSnap.get('status') === 'active';

  // ── may this driver still be credited to a fleet? ───────────────────────
  // Same two rules the app-side redemption enforces: an edge is permanent, and
  // a driver who has already completed rides was not recruited by anybody.
  const existingEdge = await db.doc(`driver_referrals/${driverUid!}`).get();
  const priorTrips = await db
    .collection('trips')
    .where('driverId', '==', driverUid!)
    .where('status', '==', 'completed')
    .limit(1)
    .get();
  const bindFleet =
    partnerActive && !!driverFleetId && !existingEdge.exists && priorTrips.empty;

  await auth.setCustomUserClaims(driverUid!, { role: 'driver' });

  const batch = db.batch();
  const driverRef = db.doc(`drivers/${driverUid!}`);
  const userRef = db.doc(`users/${driverUid!}`);
  // Both are read separately: a passenger converting to a driver already has a
  // users doc (with their own gender, photo and join date) but no drivers doc.
  // Gating the users defaults on the *driver* doc would silently reset all three.
  const [existingDriver, existingUser] = await Promise.all([driverRef.get(), userRef.get()]);

  batch.set(
    userRef,
    {
      uid: driverUid!,
      role: 'driver',
      phoneNumber: phone,
      displayName: fullName,
      updatedAt: now,
      ...(snap.get('email') ? { email: snap.get('email') } : {}),
      ...(existingUser.exists
        ? {}
        : { email: snap.get('email') ?? null, gender: 'unspecified', photoURL: null, createdAt: now }),
    },
    { merge: true },
  );

  if (!existingUser.exists) {
    batch.set(db.doc(`wallets/${driverUid!}`), {
      uid: driverUid!,
      balance: 0,
      currency: 'PKR',
      createdAt: now,
      updatedAt: now,
    });
  }

  batch.set(
    driverRef,
    {
      driverId: driverUid!,
      verificationStatus: 'approved',
      submittedByPartnerId: partnerId,
      fullName,
      phone,
      email: snap.get('email') ?? null,
      cnic: snap.get('cnic') ?? null,
      licenseNumber: snap.get('licenseNumber') ?? null,
      vehicleType: snap.get('vehicleType'),
      vehicleLabel: snap.get('vehicleLabel'),
      plate: snap.get('plate'),
      vehicleYear: snap.get('vehicleYear') ?? null,
      vehicleColor: snap.get('vehicleColor') ?? null,
      approvedBy: admin.uid,
      approvedAt: now,
      updatedAt: now,
      ...(existingDriver.exists
        ? {}
        : {
            online: false,
            rating: 5.0,
            ratingCount: 0,
            tripsCount: 0,
            cycleGrossFare: 0,
            franchiseId: null,
            createdAt: now,
          }),
    },
    { merge: true },
  );

  if (bindFleet) {
    batch.set(db.doc(`driver_referrals/${driverUid!}`), {
      uid: driverUid!,
      fleetId: driverFleetId,
      partnerId,
      type: 'driver',
      code: partnerCode ?? null,
      deviceId: null,
      source: 'franchise_portal',
      completedRides: 0,
      flaggedRides: 0,
      totalRideValue: 0,
      platformCommissionGenerated: 0,
      fleetCommissionGenerated: 0,
      lastRideAt: null,
      boundAt: now,
    });
    batch.set(
      db.doc(`partner_fleets/${driverFleetId}`),
      { members: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
    batch.set(
      db.doc(`partners/${partnerId}`),
      { totalDrivers: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
  }

  batch.set(
    ref,
    {
      status: 'approved',
      rejectionReason: null,
      reviewedBy: admin.uid,
      reviewedAt: now,
      createdDriverUid: driverUid!,
      accountCreated: createdAccount,
      fleetBound: bindFleet,
      updatedAt: now,
    },
    { merge: true },
  );

  batch.set(db.collection('auditLogs').doc(), {
    type: 'franchise.driver.approved',
    actor: admin.uid,
    submissionId,
    partnerId,
    targetUid: driverUid!,
    fleetBound: bindFleet,
    createdAt: now,
  });

  await batch.commit();

  await notifyUser(
    partnerId,
    'Driver approved 🚗',
    bindFleet
      ? `${fullName} is approved and has joined your driver fleet.`
      : `${fullName} is approved as a driver, but could not be credited to your fleet — they already drive for Velocity.`,
    'ride',
    { franchiseEvent: 'driver_approved', submissionId },
  );

  logger.info('Franchise driver approved', {
    actor: admin.uid,
    submissionId,
    partnerId,
    driverUid: driverUid!,
    bindFleet,
  });
  return { ok: true, status: 'approved', driverUid: driverUid!, fleetBound: bindFleet };
});
