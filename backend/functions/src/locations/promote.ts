/**
 * Turns completed trips into Velocity's own map, fifteen minutes at a time.
 * ----------------------------------------------------------------------------
 * WHAT ONE COMPLETED TRIP TEACHES US
 * Two places: where the rider got in, and where they got out. Both coordinates are
 * first-party, but they come from different devices and for different reasons.
 *
 * THE PICKUP is the rider's own fix. Booking refuses to proceed without location
 * permission and sets pickup straight from the device, and its label comes from the
 * platform's reverse geocoder through expo-location — not from Google Maps Platform
 * at all. Cleanest observation we get.
 *
 * WHERE THE DROP-OFF COORDINATE COMES FROM, AND WHY IT IS NOT THE ONE ON THE TRIP
 * A completed trip carries two obvious candidates for the drop-off and one of them
 * is a trap.
 *
 *   dropoff.lat / dropoff.lng — DO NOT USE. This is where the *geocoder* said the
 *     destination was. It came out of Places or Geocoding, so it is Google's
 *     content on a 30-day clock (lib/mapsCache.ts). Copying it into a permanent
 *     collection is precisely the breach that collection exists to avoid, and
 *     giving it a Velocity id first does not change its provenance.
 *
 *   driverLocation — USE THIS. The assigned driver's own device fix, relayed onto
 *     the trip while they drove (firestore.rules lets them write these two fields
 *     and nothing else). At completion it is where the car actually stopped. It is
 *     our measurement, taken with our own hardware, and it never expires.
 *
 * The second one is also simply better data. A geocoder returns the centroid of a
 * mall; the driver's fix returns the gate people are actually dropped at. After
 * enough trips our point for a place is the one a driver would choose, which is
 * the whole reason to own a map rather than rent one.
 *
 * ABOUT THE NAME
 * The label is seeded from the destination as the booking recorded it, which for
 * a picked prediction is a formatted address. That is a name, not a coordinate —
 * the licence's explicit permission and explicit limit are both about lat/lng —
 * and it is only a starting point: the admin desk can rename any row, and the
 * name is what an operator sees and fixes. The part that had to be unambiguously
 * ours is the coordinate, and it is.
 *
 * WHY A SWEEP AND NOT A TRIGGER
 * This codebase has no Firestore triggers; it has callables and scheduled sweeps,
 * and completing a trip is a money transaction that must not grow a new
 * side-effect. A sweep cannot interfere with it at all, and a run that fails
 * simply leaves the watermark where it was for the next one. Nothing here is
 * time-critical: a place being added to our map twelve minutes after the ride
 * rather than instantly costs nobody anything.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { readCachedPlaceId } from '../lib/mapsCache';
import { observePlace } from './registry';

/** Where the sweep left off. */
const WATERMARK_DOC = 'system/locationPromoter';

/** Trips per run. Comfortably past Pakistan-wide volume in fifteen minutes. */
const BATCH_LIMIT = 200;

/**
 * How stale the driver's last fix may be relative to the trip ending.
 *
 * The fix is relayed every 30 seconds while the driver is online, so at
 * completion it is normally seconds old. Ten minutes allows for a dropped
 * connection at the end of a ride; beyond that the car could have moved a
 * suburb, and a wrong point is worse than no point.
 */
const MAX_FIX_AGE_MS = 10 * 60 * 1000;

/**
 * First run has no watermark. Start a day back rather than at the beginning of
 * time: the point is to build the map from here on, and back-filling every trip
 * the platform has ever run would be one enormous first sweep for data that is
 * mostly superseded anyway.
 */
const COLD_START_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const promoteTripLocations = onSchedule('every 15 minutes', async () => {
  const watermarkRef = db.doc(WATERMARK_DOC);
  const watermarkSnap = await watermarkRef.get();
  const since =
    (watermarkSnap.get('lastCompletedAt') as Timestamp | undefined) ??
    Timestamp.fromMillis(Date.now() - COLD_START_LOOKBACK_MS);

  const completed = await db
    .collection('trips')
    .where('status', '==', 'completed')
    .where('completedAt', '>', since)
    .orderBy('completedAt', 'asc')
    .limit(BATCH_LIMIT)
    .get();

  if (completed.empty) return;

  let observed = 0;
  let skipped = 0;
  let newest = since;

  for (const doc of completed.docs) {
    const completedAt = doc.get('completedAt') as Timestamp | undefined;
    // Advance the watermark for every trip we look at, including the ones we
    // cannot use. A trip with no usable fix will never become usable, so leaving
    // the watermark behind it would make every future run re-read it forever.
    if (completedAt && completedAt.toMillis() > newest.toMillis()) newest = completedAt;

    let learnedFromThisTrip = 0;

    // ── The pickup ──
    // `trips.pickup` is the rider's own device fix: booking refuses to proceed
    // without location permission and sets pickup straight from it
    // (apps/mobile/app/passenger/booking.tsx). Its label comes from the platform's
    // own reverse geocoder via expo-location, not from Google Maps Platform — so
    // this observation is cleaner in provenance than the drop-off below, where the
    // label is whatever the geocoder called the place.
    const pickup = doc.get('pickup') as { lat?: number; lng?: number; address?: string } | undefined;
    const pickupName = pickup?.address?.trim();
    if (pickupName && typeof pickup?.lat === 'number' && typeof pickup?.lng === 'number') {
      // Skip the placeholder the booking screen falls back to when it has no
      // address: it is not a place, it is every rider's current position.
      if (pickupName.toLowerCase() !== 'current location') {
        const id = await observePlace({
          name: pickupName,
          lat: pickup.lat,
          lng: pickup.lng,
          source: 'trip_gps',
          placeId: await readCachedPlaceId(pickupName),
          // Suffixed so one trip can legitimately confirm two different places
          // without its pickup and drop-off deduplicating against each other.
          tripId: `${doc.id}#pickup`,
        });
        if (id) learnedFromThisTrip++;
      }
    }

    // ── The drop-off ──
    // The coordinate is the DRIVER's fix at the end of the ride, never
    // `dropoff.lat/lng` — see this file's header for why that distinction is the
    // whole point.
    const dropoff = doc.get('dropoff') as { address?: string } | undefined;
    const dropName = dropoff?.address?.trim();
    const fix = doc.get('driverLocation') as { lat?: number; lng?: number } | null | undefined;
    const fixAt = doc.get('driverLocationAt') as Timestamp | undefined;

    const fixUsable =
      typeof fix?.lat === 'number' &&
      typeof fix?.lng === 'number' &&
      !!fixAt &&
      !!completedAt &&
      Math.abs(completedAt.toMillis() - fixAt.toMillis()) <= MAX_FIX_AGE_MS;

    if (dropName && fixUsable) {
      const id = await observePlace({
        name: dropName,
        lat: fix!.lat!,
        lng: fix!.lng!,
        source: 'trip_gps',
        // The permanent join between Google's identity for this place and ours.
        // Place IDs are the one thing the Maps terms let us keep indefinitely, so
        // if we learned one for this name it is legitimately ours to carry here.
        placeId: await readCachedPlaceId(dropName),
        tripId: `${doc.id}#dropoff`,
      });
      if (id) learnedFromThisTrip++;
    }

    if (learnedFromThisTrip > 0) observed += learnedFromThisTrip;
    else skipped++;
  }

  await watermarkRef.set(
    { lastCompletedAt: newest, lastRunAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.info('promoteTripLocations: swept completed trips', {
    read: completed.size,
    observed,
    skipped,
  });
});
