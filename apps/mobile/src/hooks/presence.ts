/**
 * The presence beacon — what makes a red dot exist at all.
 *
 * While the passenger home is open, this writes the signed-in user's coarse
 * position to `userPresence/{uid}`. `getNearbyActivity` reads those docs back to
 * paint "somebody with the app is around here" dots for everyone else, so a user
 * appears on other people's maps exactly as long as they keep opening the app.
 *
 * WHY THE HANDSET WRITES IT DIRECTLY
 * Same reasoning as the driver's `lastLocation`: a Cloud Function invocation per
 * GPS ping is a lot of machinery for a decorative map layer. The rules pin the
 * write to the owner and to six named fields, so nothing privileged can ride
 * along. Reading the collection is owner+admin only — no client can query it.
 *
 * WHAT IT COSTS THE USER
 * One small write every few minutes at most, and only while they are looking at
 * the home screen. It is throttled on BOTH time and distance, so a phone sitting
 * on a table writes twice an hour, not twice a minute. The doc carries an
 * `expireAt` so a Firestore TTL policy deletes it if the user stops opening the
 * app — presence lapses on its own rather than leaving a permanent last-known
 * location behind.
 */
import { useEffect, useRef } from 'react';
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { encodeGeohash } from '../lib/geohash';
import type { Coords } from './location';

/** Don't write more often than this, however much the GPS chatters. */
const MIN_WRITE_INTERVAL_MS = 3 * 60 * 1000;

/** …unless the user has genuinely moved this far (degrees, ~300 m). */
const MOVE_THRESHOLD = 0.0027;

/** Cell size the server queries by. Precision 5 ≈ 5 km. */
const CELL_PRECISION = 5;

/**
 * Presence lapses on its own if the app is never opened again. Long enough that
 * an occasional user still counts as "around here", short enough that a stale
 * position can't haunt a map for weeks.
 */
const TTL_MS = 3 * 24 * 60 * 60 * 1000;

export function usePresenceBeacon(coords: Coords | null): void {
  // Where and when we last wrote. Refs, so GPS noise never re-runs the effect
  // body for a position we have already decided to ignore.
  const wroteFrom = useRef<Coords | null>(null);
  const wroteAt = useRef(0);

  useEffect(() => {
    if (!coords) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const from = wroteFrom.current;
    const moved =
      !from ||
      Math.abs(coords.lat - from.lat) > MOVE_THRESHOLD ||
      Math.abs(coords.lng - from.lng) > MOVE_THRESHOLD;
    const stale = Date.now() - wroteAt.current >= MIN_WRITE_INTERVAL_MS;
    if (!moved && !stale) return;

    wroteFrom.current = { lat: coords.lat, lng: coords.lng };
    wroteAt.current = Date.now();

    // Fire-and-forget, and silent on failure: not being on the map is not
    // something to interrupt anyone's booking over.
    setDoc(
      doc(db, 'userPresence', uid),
      {
        uid,
        lat: coords.lat,
        lng: coords.lng,
        geohash: encodeGeohash(coords.lat, coords.lng, CELL_PRECISION),
        lastSeenAt: serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + TTL_MS),
      },
      { merge: true },
    ).catch(() => {});
  }, [coords?.lat, coords?.lng]);
}
