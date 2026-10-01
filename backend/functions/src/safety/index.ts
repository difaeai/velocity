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
import { docId, invalid, requireAdmin, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';

/**
 * What kind of trouble this is.
 *
 * `police_called` is the important addition and it is not an alert the user
 * raises for help — it is the app telling us that the person on the ride has
 * just dialled 15. We would otherwise find out days later, from a police
 * enquiry, that one of our rides ended with a 999-equivalent call: the trip,
 * the driver, the car and the last known position all still need to be in front
 * of a human within seconds of that happening, whether or not anybody also
 * pressed SOS.
 */
const EVENT_KINDS = [
  'sos',
  'route_deviation',
  'police_called',
  'harassment',
  'accident',
  'unsafe_driving',
  'scam',
] as const;

/** Kinds that mean somebody may be in immediate physical danger. */
const CRITICAL_KINDS: ReadonlySet<string> = new Set(['sos', 'police_called', 'harassment', 'accident']);

const sosSchema = z.object({
  tripId: docId,
  kind: z.enum(EVENT_KINDS).default('sos'),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  note: z.string().max(500).optional(),
});

/** A trip participant raises an SOS, reports an incident, or dials the police. */
export const raiseSafetyEvent = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'raiseSafetyEvent', 10, 60);
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

  // The driver's last known position, so the desk is not left asking the person
  // in trouble where they are. On a `police_called` event this is the single
  // most useful field in the document.
  const lastFix =
    (location as { lat: number; lng: number } | undefined) ??
    (tripSnap.get('driverLocation') as { lat: number; lng: number } | null | undefined) ??
    null;

  const ref = db.collection('safetyEvents').doc();
  await ref.set({
    id: ref.id,
    kind,
    critical: CRITICAL_KINDS.has(kind),
    tripId,
    reportedBy: ctx.uid,
    reportedByRole: ctx.uid === driverId ? 'driver' : 'passenger',
    passengerId,
    driverId: driverId ?? null,
    location: lastFix,
    // Who and what, denormalised: the desk needs the plate and the two phone
    // numbers in the first second, not after three more document reads.
    driverInfo: (tripSnap.get('driverInfo') as Record<string, unknown> | undefined) ?? null,
    driverPhone: (tripSnap.get('driverPhone') as string | null | undefined) ?? null,
    passengerPhone: (tripSnap.get('passengerPhone') as string | null | undefined) ?? null,
    pickup: (tripSnap.get('pickup') as Record<string, unknown> | undefined) ?? null,
    dropoff: (tripSnap.get('dropoff') as Record<string, unknown> | undefined) ?? null,
    tripStatus: (tripSnap.get('status') as string | undefined) ?? null,
    note: note ?? null,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.doc(`trips/${tripId}`).set(
    { activeSafetyEventId: ref.id, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Push the admins. An alert that waits for somebody to be looking at the
  // dashboard is not an alert.
  if (CRITICAL_KINDS.has(kind)) {
    try {
      const admins = await db.collection('users').where('role', '==', 'admin').limit(25).get();
      const title = kind === 'police_called' ? '🚔 Police called on a ride' : '🆘 Safety alert';
      await Promise.all(
        admins.docs.map((a) =>
          sendToUser(
            a.id,
            title,
            `Trip ${tripId} — open the Safety desk now.`,
            { tripId, safetyEventId: ref.id },
          ),
        ),
      );
    } catch (e) {
      logger.error('Safety alert push failed', { tripId, error: (e as Error).message });
    }
  }

  logger.warn('Safety event raised', { tripId, kind, by: ctx.uid });
  return { ok: true, eventId: ref.id };
});

const resolveSchema = z.object({
  eventId: docId,
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
