/**
 * "Share my ride with my family" — a live tracking link anyone can open.
 *
 * WHAT WAS THERE BEFORE. The trip screen had a WhatsApp button that pasted the
 * driver's name, the plate and the two addresses into a message. It is better
 * than nothing and it is not tracking: it is a photograph of one moment, sent
 * to somebody who then has no idea whether the car moved, arrived, or stopped
 * somewhere it should not have. A mother who gets that message at 9pm learns
 * exactly as much at 11pm.
 *
 * WHAT THIS IS. A one-off secret token that resolves, for as long as the ride
 * is live, to the ride's current state — status, the car, the plate, the
 * driver's phone, their last position and how fresh it is. It opens in a
 * browser with no app and no account, because the people you most want to send
 * it to are the ones who do not have the app.
 *
 * ── WHY IT IS A CALLABLE AND NOT A FIRESTORE READ ───────────────────────────
 *
 * The obvious build is a public read rule on the trip. That would expose the
 * whole trip document: both uids, the passenger's phone, the fare breakdown,
 * the partner attribution, the pool roster. This returns a hand-built view
 * instead, so adding a field to a trip can never widen what a shared link
 * shows. Everything about the passenger except their first name is left out —
 * they are the one person the link is *about*, and the recipient already knows
 * who they are.
 *
 * ── THE SECURITY MODEL ──────────────────────────────────────────────────────
 *
 * The token is the credential, so it is 128 bits from `crypto.randomBytes` and
 * never derived from the trip id. Three things bound the damage if one leaks:
 *
 *   it dies with the ride   a completed or cancelled trip keeps answering for a
 *                           short grace window (so the family sees "she got
 *                           there") and then stops resolving at all.
 *   it can be revoked       the rider can kill a link they sent to the wrong
 *                           chat, and killing it does not kill the others.
 *   it is rate limited      per token, so a leaked link cannot be used to poll
 *                           somebody's position hundreds of times a minute.
 *
 * What it deliberately does NOT do is hide the driver's phone number. The whole
 * point of handing this to a family member is that they can act — call the
 * driver, read the plate to the police on 15 — without first having to reach
 * the passenger, who may be exactly the person who cannot answer.
 */
import { randomBytes } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import type { Timestamp as FsTimestamp } from 'firebase-admin/firestore';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';

/**
 * How long a link keeps answering after the ride ends.
 *
 * Not zero, because the most reassuring thing the page can ever say is "arrived
 * — trip complete", and a link that goes dead at the exact moment the ride ends
 * shows a worried relative an error page instead.
 */
const GRACE_AFTER_END_MS = 3 * 60 * 60 * 1000;

/** A link never outlives this, however long the ride takes. */
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Statuses where the ride has not finished yet. */
const LIVE_STATUSES = ['requested', 'matched', 'arriving', 'arrived', 'in_progress'];

/** 128 bits, url-safe. The token IS the credential — see the file header. */
function newToken(): string {
  return randomBytes(16).toString('base64url');
}

/** First name only. "Ayesha Khan" → "Ayesha". */
function firstName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

const createSchema = z.object({ tripId: docId });

/**
 * Rider (or driver) mints a live-tracking link for a ride they are on.
 *
 * Returns the same token on repeated calls for the same ride, so the button can
 * be tapped twice — or the ride shared to WhatsApp and then to a sibling — and
 * the family is not left comparing two different URLs.
 */
export const createTripWatchLink = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = createSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId } = parsed.data;

  await rateLimit(ctx.uid, 'createTripWatchLink', 20, 3600);

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Trip not found.');

  const passengerId = tripSnap.get('passengerId') as string | undefined;
  const driverId = tripSnap.get('driverId') as string | undefined;
  const poolMembers = (tripSnap.get('poolMembers') as string[] | undefined) ?? [];
  const isOnTrip =
    ctx.uid === passengerId || ctx.uid === driverId || poolMembers.includes(ctx.uid);
  if (!isOnTrip) {
    throw new HttpsError('permission-denied', 'You are not on this ride.');
  }

  const status = (tripSnap.get('status') as string | undefined) ?? 'requested';
  if (!LIVE_STATUSES.includes(status)) {
    throw new HttpsError('failed-precondition', 'This ride has already finished.');
  }

  // One live link per sharer per ride.
  const existing = await db
    .collection('tripWatchLinks')
    .where('tripId', '==', tripId)
    .where('createdBy', '==', ctx.uid)
    .where('revoked', '==', false)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { ok: true, token: existing.docs[0].id, reused: true };
  }

  const token = newToken();
  await db.doc(`tripWatchLinks/${token}`).set({
    token,
    tripId,
    createdBy: ctx.uid,
    revoked: false,
    views: 0,
    expiresAt: Timestamp.fromMillis(Date.now() + MAX_LIFETIME_MS),
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Trip watch link created', { tripId, by: ctx.uid });
  return { ok: true, token, reused: false };
});

const revokeSchema = z.object({ token: z.string().min(10).max(64) });

/** Rider kills a link they shared. Other links for the same ride keep working. */
export const revokeTripWatchLink = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = revokeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the link token.');

  const ref = db.doc(`tripWatchLinks/${parsed.data.token}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (snap.get('createdBy') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your link.');
  }
  await ref.set({ revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

const watchSchema = z.object({ token: z.string().min(10).max(64) });

/** What a shared link resolves to. Hand-built — see the file header. */
export interface TripWatchView {
  status: string;
  live: boolean;
  rider: string | null;
  pickup: { address: string | null; lat: number | null; lng: number | null };
  dropoff: { address: string | null; lat: number | null; lng: number | null };
  driver: {
    name: string | null;
    phone: string | null;
    vehicleLabel: string | null;
    plate: string | null;
    rating: number | null;
  } | null;
  /** The driver's last reported position, and how old it is in seconds. */
  location: { lat: number; lng: number; ageSec: number } | null;
  fare: number | null;
  pool: boolean;
  /** Riders aboard, first names only. */
  riders: string[];
  startedAt: number | null;
  completedAt: number | null;
  /** True while a safety alert raised on this ride is still open. */
  safetyAlert: boolean;
  updatedAt: number;
}

/**
 * Resolve a shared link. **Deliberately unauthenticated** — the recipient is a
 * family member with a WhatsApp message, not a user of the app.
 *
 * Refuses with `not-found` for an unknown, revoked or expired token, and says
 * the same thing for all three: a different message for "revoked" would tell a
 * stranger probing tokens that they had guessed a real one.
 */
export const getTripWatch = onCall(async (req) => {
  const parsed = watchSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the link token.');
  const { token } = parsed.data;

  // Keyed on the token, not the caller: the caller is anonymous. This is what
  // stops a leaked link from becoming a position feed.
  await rateLimit(`watch_${token}`, 'getTripWatch', 120, 600);

  const linkRef = db.doc(`tripWatchLinks/${token}`);
  const link = await linkRef.get();
  const gone = new HttpsError('not-found', 'This tracking link is no longer active.');
  if (!link.exists || link.get('revoked') === true) throw gone;

  const expiresAt = link.get('expiresAt') as FsTimestamp | undefined;
  if (expiresAt && expiresAt.toMillis() < Date.now()) throw gone;

  const tripId = link.get('tripId') as string;
  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) throw gone;

  const status = (tripSnap.get('status') as string | undefined) ?? 'requested';
  const live = LIVE_STATUSES.includes(status);

  // A finished ride answers for the grace window and then stops for good.
  const endedAt =
    (tripSnap.get('completedAt') as FsTimestamp | undefined) ??
    (tripSnap.get('cancelledAt') as FsTimestamp | undefined);
  if (!live && endedAt && Date.now() - endedAt.toMillis() > GRACE_AFTER_END_MS) throw gone;

  const driverId = tripSnap.get('driverId') as string | undefined;
  const info = tripSnap.get('driverInfo') as
    | { displayName?: string; vehicleLabel?: string; plate?: string; rating?: number }
    | undefined;

  // `driverPhone` is already denormalised onto the trip at bid acceptance, so
  // the number the family is given is the same one the rider is looking at.
  const driverPhone = (tripSnap.get('driverPhone') as string | null | undefined) ?? null;
  const passengerUser = await db.doc(`users/${tripSnap.get('passengerId')}`).get();

  const loc = tripSnap.get('driverLocation') as { lat?: number; lng?: number } | null | undefined;
  const locAt = tripSnap.get('driverLocationAt') as FsTimestamp | undefined;

  const poolRoster = (tripSnap.get('poolRoster') as
    | Array<{ firstName?: string; name?: string }>
    | undefined) ?? [];

  const view: TripWatchView = {
    status,
    live,
    rider: firstName(passengerUser.get('displayName') as string | undefined),
    pickup: {
      address: (tripSnap.get('pickup.address') as string | undefined) ?? null,
      lat: (tripSnap.get('pickup.lat') as number | undefined) ?? null,
      lng: (tripSnap.get('pickup.lng') as number | undefined) ?? null,
    },
    dropoff: {
      address: (tripSnap.get('dropoff.address') as string | undefined) ?? null,
      lat: (tripSnap.get('dropoff.lat') as number | undefined) ?? null,
      lng: (tripSnap.get('dropoff.lng') as number | undefined) ?? null,
    },
    driver: driverId
      ? {
          name: (info?.displayName as string | undefined) ?? null,
          phone: driverPhone,
          vehicleLabel: info?.vehicleLabel ?? null,
          plate: info?.plate ?? null,
          rating: typeof info?.rating === 'number' ? info.rating : null,
        }
      : null,
    location:
      typeof loc?.lat === 'number' && typeof loc?.lng === 'number'
        ? {
            lat: loc.lat,
            lng: loc.lng,
            ageSec: locAt ? Math.max(0, Math.round((Date.now() - locAt.toMillis()) / 1000)) : -1,
          }
        : null,
    fare: (tripSnap.get('fare') as number | undefined) ?? null,
    pool: tripSnap.get('pool') === true,
    riders: poolRoster
      .map((r) => firstName(r.firstName ?? r.name))
      .filter((n): n is string => !!n),
    startedAt: (tripSnap.get('startedAt') as FsTimestamp | undefined)?.toMillis() ?? null,
    completedAt: endedAt?.toMillis() ?? null,
    safetyAlert: !!tripSnap.get('activeSafetyEventId'),
    updatedAt: Date.now(),
  };

  // Fire-and-forget: the view count is for the rider ("3 people are watching"),
  // never a reason to fail the page.
  linkRef
    .set({ views: FieldValue.increment(1), lastViewedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => undefined);

  return { ok: true, trip: view };
});
