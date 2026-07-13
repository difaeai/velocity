/**
 * Driver reports a suspicious / fake ride request from the open-requests feed.
 *
 * This is deliberately NOT `createDispute`: a dispute is about a trip both
 * parties actually took, whereas a driver flags a request while it is still
 * open and unmatched — they were never a participant, so the dispute guard
 * would reject them. Reports land in `requestReports`, which only admins read.
 *
 * The report also hides the request for the reporting driver (client-side skip
 * list) — it is NOT removed from other drivers' feeds, since one report is not
 * proof. Admins act on the aggregate from the dashboard.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';

const REASONS = [
  'sexual_content',
  'advertisement',
  'drugs',
  'suspicious_activity',
  'too_low_price',
  'too_long_distance',
  'other',
] as const;

const reportSchema = z.object({
  tripId: z.string().min(1).max(128),
  // The mobile Firebase SDK encodes absent optional fields as null on the wire,
  // so every optional here must be nullish rather than optional.
  reasons: z.array(z.enum(REASONS)).min(1).max(REASONS.length),
  description: z.string().max(1000).nullish(),
});

/** A driver flags an open ride request as fake / abusive. */
export const reportOpenRequest = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'reportOpenRequest', 20, 300);

  const parsed = reportSchema.safeParse(req.data);
  if (!parsed.success) invalid('Pick at least one reason for the report.');
  const { tripId, reasons, description } = parsed.data;

  // Snapshot what was reported. The request may already be gone (matched or
  // cancelled) — still worth recording, so a missing doc is not an error.
  const [tripSnap, openSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.doc(`openRequests/${tripId}`).get(),
  ]);
  if (!tripSnap.exists) invalid('This request no longer exists.');

  const passengerId = (tripSnap.get('passengerId') as string | undefined) ?? null;

  // One open report per driver per request — repeat taps must not spam admins.
  const existing = await db
    .collection('requestReports')
    .where('tripId', '==', tripId)
    .where('reportedBy', '==', ctx.uid)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { ok: true, reportId: existing.docs[0]!.id, alreadyReported: true };
  }

  const ref = db.collection('requestReports').doc();
  await ref.set({
    id: ref.id,
    tripId,
    reportedBy: ctx.uid,
    passengerId,
    reasons,
    description: description ?? null,
    status: 'open',
    // Snapshot of the request as the driver saw it — the feed doc is deleted
    // the moment the trip is matched or cancelled.
    snapshot: {
      offeredFare: openSnap.get('offeredFare') ?? tripSnap.get('offeredFare') ?? null,
      rideType: openSnap.get('rideType') ?? tripSnap.get('rideType') ?? null,
      pickup: openSnap.get('pickup') ?? tripSnap.get('pickup') ?? null,
      dropoff: openSnap.get('dropoff') ?? tripSnap.get('dropoff') ?? null,
      passengerName: openSnap.get('passengerName') ?? null,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  // Running tally on the passenger so admins can spot repeat offenders.
  if (passengerId) {
    await db.doc(`users/${passengerId}`).set(
      { requestReportCount: FieldValue.increment(1) },
      { merge: true },
    );
  }

  logger.warn('Open request reported', { tripId, by: ctx.uid, reasons });
  return { ok: true, reportId: ref.id, alreadyReported: false };
});
