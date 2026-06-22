/**
 * Safety: SOS alerts and route-deviation reports.
 *
 * Events are written server-side into `safetyEvents`, which only the reporter
 * and admins can read. The admin panel subscribes to open events.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireAdmin, invalid } from '../lib/guards';

const sosSchema = z.object({
  tripId: z.string().min(1).max(128),
  kind: z.enum(['sos', 'route_deviation']).default('sos'),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  note: z.string().max(500).optional(),
});

/** A trip participant raises an SOS or route-deviation alert. */
export const raiseSafetyEvent = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = sosSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId, kind, location, note } = parsed.data;

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Trip not found.');
  const passengerId = tripSnap.get('passengerId');
  const driverId = tripSnap.get('driverId');
  if (ctx.uid !== passengerId && ctx.uid !== driverId) {
    throw new HttpsError('permission-denied', 'You are not on this trip.');
  }

  const ref = db.collection('safetyEvents').doc();
  await ref.set({
    id: ref.id,
    kind,
    tripId,
    reportedBy: ctx.uid,
    passengerId,
    driverId: driverId ?? null,
    location: location ?? null,
    note: note ?? null,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.doc(`trips/${tripId}`).set(
    { activeSafetyEventId: ref.id, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.warn('Safety event raised', { tripId, kind, by: ctx.uid });
  return { ok: true, eventId: ref.id };
});

const resolveSchema = z.object({
  eventId: z.string().min(1).max(128),
  resolution: z.string().max(500).optional(),
});

/** Admin-only: mark a safety event resolved. */
export const resolveSafetyEvent = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = resolveSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid eventId.');
  const { eventId, resolution } = parsed.data;

  const ref = db.doc(`safetyEvents/${eventId}`);
  if (!(await ref.get()).exists) invalid('Event not found.');
  await ref.set(
    {
      status: 'resolved',
      resolvedBy: admin.uid,
      resolution: resolution ?? null,
      resolvedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Safety event resolved', { eventId, by: admin.uid });
  return { ok: true };
});
