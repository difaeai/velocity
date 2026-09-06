/**
 * The car a driver is actually driving today.
 *
 * Two jobs live here, and they answer two different questions:
 *
 *  1. WHICH CAR (`drivers/{uid}/vehicles/{vehicleId}`). A driver is not one car
 *     for life — they sell one, borrow their brother's, run a bike in the
 *     morning and a rickshaw in the evening. Every car they may drive is its
 *     own document with its own papers and its own review, and exactly one of
 *     them is active. The active one is MIRRORED back onto `drivers/{uid}`
 *     (vehicleType / vehicleLabel / plate / vehiclePhotoDoc*), because that is
 *     where the rest of the system — bids, trips, the passenger's "look for
 *     this plate" card, the admin console — has always read it from. Nothing
 *     else has to learn that a subcollection exists.
 *
 *  2. IS IT REALLY THAT CAR (`drivers/{uid}.vehicleCheck`). Papers are reviewed
 *     once, months ago. What a passenger standing on the road needs is that the
 *     car arriving matches the plate on their screen TODAY, so a driver has to
 *     photograph the car they are about to drive before they can go online — on
 *     a new car always, and on the same car every VEHICLE_CHECK_TTL_DAYS. The
 *     security rules enforce it on the way online (see firestore.rules: a driver
 *     cannot flip `online` to true without a live check), so this is not a
 *     client-side courtesy that a patched app could skip.
 *
 * Approval posture, deliberately asymmetric:
 *   · Adding a car → 'pending'. It cannot be made active until an admin has seen
 *     its registration papers. Driving an unvetted car is the actual risk.
 *   · Photographing the active car → counts immediately, reviewed afterwards.
 *     Making a driver wait on a human before every shift would cost them the
 *     shift, and the downside — one shift in a car whose photo is later
 *     rejected — is small and reversible: rejecting kicks them offline on the spot.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireRole, invalid } from '../lib/guards';
import {
  PRIMARY_VEHICLE_ID,
  VEHICLE_CHECK_TTL_DAYS,
  activeVehicleIdOf,
} from '../domain/vehicleCheck';

/** Cars one driver may keep on file. Enough for a real fleet driver, not a farm. */
const MAX_VEHICLES = 5;

const VEHICLE_TYPES = ['bike', 'auto', 'mini', 'ac', 'comfort', 'xl'] as const;

/** Trip states in which a passenger has already been told which plate to expect. */
const LIVE_TRIP_STATUSES = ['matched', 'arriving', 'arrived', 'in_progress'] as const;
const LIVE_POOL_STATUSES = ['open', 'collecting', 'full', 'boarding', 'in_progress'] as const;

interface VehicleDoc {
  vehicleId: string;
  vehicleType: (typeof VEHICLE_TYPES)[number];
  make: string;
  color: string;
  plate: string;
  label: string;
  docPath?: string | null;
  docUrl?: string | null;
  photoPath?: string | null;
  photoUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewReason?: string | null;
}

/** `${color} ${make}` — the one string every screen shows for a car. */
function vehicleLabel(color: string, make: string): string {
  return `${color} ${make}`.trim();
}

/**
 * A storage path the caller could actually have written.
 *
 * Uploads go straight to Cloud Storage (the storage rules let a driver write
 * under their own folder), so the callable has to re-check the prefix —
 * otherwise a driver could attach somebody else's document by path alone.
 */
function assertOwnPath(uid: string, path: string | undefined, what: string): void {
  if (path && !path.startsWith(`drivers/${uid}/`)) {
    invalid(`That ${what} does not belong to your account.`);
  }
}

/**
 * Keeps `vehicleReviewPending` on the driver doc true iff a car awaits review.
 *
 * Denormalised on purpose: the admin console already streams the driver
 * documents, so a flag there turns "who is waiting on me?" into a filter over
 * data the page has, instead of a collection-group query over every driver's
 * subcollection.
 */
async function syncReviewFlag(uid: string): Promise<void> {
  const pending = await db
    .collection(`drivers/${uid}/vehicles`)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  await db.doc(`drivers/${uid}`).set({ vehicleReviewPending: !pending.empty }, { merge: true });
}

function readVehicles(snap: FirebaseFirestore.QuerySnapshot): VehicleDoc[] {
  return snap.docs.map((d) => ({ vehicleId: d.id, ...(d.data() as Omit<VehicleDoc, 'vehicleId'>) }));
}

/**
 * Driver: make sure the car from onboarding exists as a vehicle document.
 *
 * Idempotent, and the only migration this feature needs. Every driver approved
 * before vehicles existed has their car in flat fields on `drivers/{uid}` and an
 * empty subcollection; the first time they open the car screens this lifts that
 * car into `vehicles/primary` and marks it active. Drivers who already have
 * vehicles simply get the list back.
 */
export const ensureDriverVehicles = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const ref = db.doc(`drivers/${ctx.uid}`);
  const [snap, existing] = await Promise.all([ref.get(), ref.collection('vehicles').get()]);
  if (!snap.exists) invalid('No driver account found.');

  const plate = snap.get('plate') as string | undefined;
  if (existing.empty && plate) {
    // The label was stored as "Colour Make Model" at onboarding; split the first
    // word back out so the edit forms have something sensible to show.
    const [color = '', ...makeParts] = ((snap.get('vehicleLabel') as string | undefined) ?? '')
      .trim()
      .split(/\s+/);
    const make = makeParts.length ? makeParts.join(' ') : color;
    await ref.collection('vehicles').doc(PRIMARY_VEHICLE_ID).set({
      vehicleId:    PRIMARY_VEHICLE_ID,
      driverId:     ctx.uid,
      vehicleType:  snap.get('vehicleType') ?? 'mini',
      make,
      color:        makeParts.length ? color : (snap.get('color') ?? ''),
      plate,
      label:        snap.get('vehicleLabel') ?? make,
      docPath:      snap.get('vehicleDocPath') ?? null,
      docUrl:       snap.get('vehicleDocUrl') ?? null,
      photoPath:    snap.get('vehiclePhotoDocPath') ?? null,
      photoUrl:     snap.get('vehiclePhotoDocUrl') ?? null,
      // The papers for this car were reviewed as part of the application, so
      // approving the driver approved the car. Re-reviewing it here would
      // strand every driver already on the road.
      status:       snap.get('verificationStatus') === 'approved' ? 'approved' : 'pending',
      reviewReason: null,
      createdAt:    snap.get('submittedAt') ?? FieldValue.serverTimestamp(),
      updatedAt:    FieldValue.serverTimestamp(),
    });
  }

  const vehicles = readVehicles(await ref.collection('vehicles').get());
  let activeId = snap.get('activeVehicleId') as string | undefined;
  // No active car recorded, or one that no longer exists: fall back to the
  // seeded primary, then to any approved car, so the driver is never left
  // pointing at nothing.
  if (!activeId || !vehicles.some((v) => v.vehicleId === activeId)) {
    activeId =
      vehicles.find((v) => v.vehicleId === PRIMARY_VEHICLE_ID)?.vehicleId ??
      vehicles.find((v) => v.status === 'approved')?.vehicleId ??
      vehicles[0]?.vehicleId;
    if (activeId) await ref.set({ activeVehicleId: activeId }, { merge: true });
  }

  return { ok: true, activeVehicleId: activeId ?? null, vehicles };
});

const addVehicleSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  make:        z.string().min(2).max(60),
  color:       z.string().min(2).max(30),
  plate:       z.string().min(3).max(16),
  docPath:     z.string().min(1).max(512),
  docUrl:      z.string().url().max(2000).optional(),
  photoPath:   z.string().min(1).max(512),
  photoUrl:    z.string().url().max(2000).optional(),
});

/**
 * Driver: register another car. It starts 'pending' and cannot be driven until
 * an admin has seen its registration certificate.
 */
export const addDriverVehicle = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = addVehicleSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid vehicle details.');
  const data = parsed.data;

  assertOwnPath(ctx.uid, data.docPath, 'registration document');
  assertOwnPath(ctx.uid, data.photoPath, 'vehicle photo');

  const plate = data.plate.trim().toUpperCase();
  const col = db.collection(`drivers/${ctx.uid}/vehicles`);
  const existing = readVehicles(await col.get());
  if (existing.filter((v) => v.status !== 'rejected').length >= MAX_VEHICLES) {
    invalid(`You can keep up to ${MAX_VEHICLES} cars. Remove one before adding another.`);
  }
  if (existing.some((v) => (v.plate ?? '').toUpperCase() === plate && v.status !== 'rejected')) {
    invalid('You have already added a car with that registration plate.');
  }

  const ref = col.doc();
  await ref.set({
    vehicleId:    ref.id,
    driverId:     ctx.uid,
    vehicleType:  data.vehicleType,
    make:         data.make.trim(),
    color:        data.color.trim(),
    plate,
    label:        vehicleLabel(data.color.trim(), data.make.trim()),
    docPath:      data.docPath,
    docUrl:       data.docUrl ?? null,
    photoPath:    data.photoPath,
    photoUrl:     data.photoUrl ?? null,
    status:       'pending',
    reviewReason: null,
    createdAt:    FieldValue.serverTimestamp(),
    updatedAt:    FieldValue.serverTimestamp(),
  });
  await syncReviewFlag(ctx.uid);

  logger.info('Driver vehicle added', { uid: ctx.uid, vehicleId: ref.id });
  return { ok: true, vehicleId: ref.id, status: 'pending' };
});

/** True while this driver is mid-job — a plate a passenger already has. */
async function hasLiveWork(uid: string): Promise<boolean> {
  const [trips, pools] = await Promise.all([
    db.collection('trips')
      .where('driverId', '==', uid)
      .where('status', 'in', LIVE_TRIP_STATUSES)
      .limit(1)
      .get(),
    db.collection('poolRides')
      .where('driverId', '==', uid)
      .where('status', 'in', LIVE_POOL_STATUSES)
      .limit(1)
      .get(),
  ]);
  return !trips.empty || !pools.empty;
}

const vehicleIdSchema = z.object({ vehicleId: z.string().min(1).max(128) });

/**
 * Driver: switch which car they are driving.
 *
 * Three things happen together, and all three matter:
 *   · the car's details are mirrored onto the driver doc, so every existing
 *     reader (bids, trips, the passenger's card) sees the new car;
 *   · the car photo check is CLEARED, because a check taken of the old car says
 *     nothing about this one — they photograph the new car before going online;
 *   · they are taken offline, so no request can reach them in the gap.
 */
export const setActiveVehicle = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = vehicleIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a vehicle to switch to.');
  const { vehicleId } = parsed.data;

  const ref = db.doc(`drivers/${ctx.uid}`);
  const vehicleRef = ref.collection('vehicles').doc(vehicleId);
  const vehicleSnap = await vehicleRef.get();
  if (!vehicleSnap.exists) invalid('That car is not on your account.');
  const status = vehicleSnap.get('status') as string | undefined;
  if (status === 'pending') {
    invalid('That car is still being reviewed. We will tell you as soon as it is approved.');
  }
  if (status !== 'approved') invalid('That car was not approved, so it cannot be driven.');

  // Swapping cars underneath a passenger who is watching for a plate is how
  // people end up getting into the wrong car. Finish the job first.
  if (await hasLiveWork(ctx.uid)) {
    invalid('Finish your current ride before changing your car.');
  }

  await ref.set(
    {
      activeVehicleId:     vehicleId,
      vehicleType:         vehicleSnap.get('vehicleType'),
      vehicleLabel:        vehicleSnap.get('label'),
      color:               vehicleSnap.get('color') ?? null,
      plate:               vehicleSnap.get('plate'),
      vehicleDocPath:      vehicleSnap.get('docPath') ?? null,
      vehicleDocUrl:       vehicleSnap.get('docUrl') ?? null,
      vehiclePhotoDocPath: vehicleSnap.get('photoPath') ?? null,
      vehiclePhotoDocUrl:  vehicleSnap.get('photoUrl') ?? null,
      // A different car means the confirmation on file is about a different car.
      // Deleting it (rather than marking it stale) is what the security rule
      // keys off: no check, no going online.
      vehicleCheck:        FieldValue.delete(),
      online:              false,
      updatedAt:           FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Driver switched vehicle', { uid: ctx.uid, vehicleId });
  return { ok: true, activeVehicleId: vehicleId };
});

/** Driver: take a car off the account. Never the active one, never the last one. */
export const deleteDriverVehicle = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = vehicleIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a vehicle to remove.');
  const { vehicleId } = parsed.data;

  const ref = db.doc(`drivers/${ctx.uid}`);
  const [snap, all] = await Promise.all([ref.get(), ref.collection('vehicles').get()]);
  if (!all.docs.some((d) => d.id === vehicleId)) invalid('That car is not on your account.');
  if (activeVehicleIdOf(snap) === vehicleId) {
    invalid('That is the car you are driving. Switch to another one first.');
  }
  if (all.size <= 1) invalid('You need at least one car on your account.');

  await ref.collection('vehicles').doc(vehicleId).delete();
  await syncReviewFlag(ctx.uid);

  logger.info('Driver vehicle removed', { uid: ctx.uid, vehicleId });
  return { ok: true };
});

const confirmPhotoSchema = z.object({
  photoPath: z.string().min(1).max(512),
  photoUrl:  z.string().url().max(2000).optional(),
});

/**
 * Driver: "this is the car I am driving right now."
 *
 * Counts from the moment it is submitted — the driver goes online off the back
 * of this call, and an admin judges the picture afterwards.
 */
export const confirmVehiclePhoto = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = confirmPhotoSchema.safeParse(req.data);
  if (!parsed.success) invalid('Take a photo of your car to confirm it.');
  const data = parsed.data;
  assertOwnPath(ctx.uid, data.photoPath, 'photo');

  const ref = db.doc(`drivers/${ctx.uid}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('No driver account found.');
  if (snap.get('verificationStatus') !== 'approved') {
    invalid('Your account is not approved yet.');
  }

  const vehicleId = activeVehicleIdOf(snap);
  const vehicleSnap = await ref.collection('vehicles').doc(vehicleId).get();
  // A driver whose subcollection was never seeded still has their onboarding car
  // in the flat fields — a real, already-approved car — so let the check stand
  // against the primary id rather than refusing to let them work.
  if (vehicleSnap.exists && vehicleSnap.get('status') !== 'approved') {
    invalid('The car you selected has not been approved yet.');
  }

  await ref.set(
    {
      vehicleCheck: {
        status:      'pending',
        vehicleId,
        plate:       vehicleSnap.get('plate') ?? snap.get('plate') ?? null,
        photoPath:   data.photoPath,
        photoUrl:    data.photoUrl ?? null,
        confirmedAt: FieldValue.serverTimestamp(),
        reviewedAt:  null,
        reviewedBy:  null,
        reason:      null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Vehicle photo confirmed', { uid: ctx.uid, vehicleId });
  return { ok: true, vehicleId, validForDays: VEHICLE_CHECK_TTL_DAYS };
});

const reviewVehicleSchema = z.object({
  driverId:  z.string().min(1).max(128),
  vehicleId: z.string().min(1).max(128),
  approve:   z.boolean(),
  reason:    z.string().max(500).optional(),
});

/** Admin: approve or reject a car a driver added. */
export const adminReviewDriverVehicle = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewVehicleSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a driver and a vehicle.');
  const { driverId, vehicleId, approve, reason } = parsed.data;

  const vehicleRef = db.doc(`drivers/${driverId}/vehicles/${vehicleId}`);
  if (!(await vehicleRef.get()).exists) invalid('Unknown vehicle.');

  await vehicleRef.set(
    {
      status:       approve ? 'approved' : 'rejected',
      reviewReason: reason ?? null,
      reviewedBy:   admin.uid,
      reviewedAt:   FieldValue.serverTimestamp(),
      updatedAt:    FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await syncReviewFlag(driverId);

  await db.collection('auditLogs').add({
    type:      approve ? 'driver.vehicle.approved' : 'driver.vehicle.rejected',
    actor:     admin.uid,
    targetUid: driverId,
    vehicleId,
    reason:    reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver vehicle reviewed', { actor: admin.uid, driverId, vehicleId, approve });
  return { ok: true };
});

const reviewCheckSchema = z.object({
  driverId: z.string().min(1).max(128),
  approve:  z.boolean(),
  reason:   z.string().max(500).optional(),
});

/**
 * Admin: judge the car photo a driver submitted.
 *
 * Rejecting is the teeth of the whole feature: it marks the check rejected —
 * which the security rule reads as "no live check" — and takes the driver
 * offline immediately, so a car that is not the car stops working within seconds
 * rather than at the end of the shift.
 */
export const adminReviewVehiclePhoto = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewCheckSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a driver.');
  const { driverId, approve, reason } = parsed.data;

  const ref = db.doc(`drivers/${driverId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Unknown driver.');
  if (!snap.get('vehicleCheck')) invalid('This driver has not submitted a car photo.');

  await ref.set(
    {
      vehicleCheck: {
        status:     approve ? 'approved' : 'rejected',
        reviewedBy: admin.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        reason:     reason ?? null,
      },
      ...(approve ? {} : { online: false }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection('auditLogs').add({
    type:      approve ? 'driver.carPhoto.approved' : 'driver.carPhoto.rejected',
    actor:     admin.uid,
    targetUid: driverId,
    reason:    reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Vehicle photo reviewed', { actor: admin.uid, driverId, approve });
  return { ok: true };
});
