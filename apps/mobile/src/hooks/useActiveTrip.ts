import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';
import type { TripStatus } from '../domain/types';

/**
 * The statuses that mean "this ride is still happening".
 *
 * Mirrors ACTIVE_STATUSES in backend/functions/src/trips/index.ts, which is what
 * actually clears `activeTripId`. If the two ever disagree the rider is the one
 * who pays for it — either stranded without a way back to a live ride, or
 * dragged back into one that already ended.
 */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set<TripStatus>([
  'requested',
  'matched',
  'arriving',
  'arrived',
  'in_progress',
]);

export interface ActiveTrip {
  readonly id: string;
  readonly status: TripStatus;
  readonly pool: boolean;
  readonly fare: number | null;
  readonly dropoffAddress: string | null;
}

/**
 * The rider's live ride, if they have one.
 *
 * The backend has always kept `users/{uid}.activeTripId` current — it is what
 * stops a second booking while one is running — but nothing in the app ever
 * read it. So a rider who pressed Back out of the trip screen, or whose app was
 * killed, had a driver on the way and no route back to the map: the ride was
 * still live, just invisible.
 *
 * Two hops on purpose. `activeTripId` alone can be stale — it is cleared by the
 * same transaction that ends a trip, but a crash between the two leaves a
 * pointer to a finished ride — so the trip doc is read too and the status
 * checked before anything is shown. A pointer to a completed or cancelled trip
 * resolves to null rather than sending the rider back to a ride that is over.
 */
/**
 * Everything the hook knows, tagged with the uid it was read for.
 *
 * The tag is what makes signing out — or switching accounts — safe without
 * clearing state from inside an effect: state belonging to a different uid is
 * simply not surfaced, so one rider's live ride can never flash on another
 * rider's home screen while the new subscription is still opening.
 */
interface State {
  readonly uid: string | null;
  readonly tripId: string | null;
  readonly active: ActiveTrip | null;
  readonly resolved: boolean;
}

const EMPTY: State = { uid: null, tripId: null, active: null, resolved: true };

export function useActiveTrip(uid?: string): { active: ActiveTrip | null; loading: boolean } {
  const [state, setState] = useState<State>(EMPTY);
  const owner = uid ?? null;

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const id = snap.exists() ? (snap.get('activeTripId') as string | undefined) : undefined;
        // No pointer is a final answer; a pointer still needs the trip read below.
        setState((prev) => ({
          uid,
          tripId: id ?? null,
          active: id ? (prev.uid === uid ? prev.active : null) : null,
          resolved: !id,
        }));
      },
      () => setState({ uid, tripId: null, active: null, resolved: true }),
    );
    return unsub;
  }, [uid]);

  const tripId = state.uid === owner ? state.tripId : null;

  useEffect(() => {
    if (!uid || !tripId) return;
    const unsub = onSnapshot(
      doc(db, 'trips', tripId),
      (snap) => {
        const status = snap.exists() ? (snap.get('status') as TripStatus) : null;
        const live: ActiveTrip | null =
          status && ACTIVE_STATUSES.has(status)
            ? {
                id: snap.id,
                status,
                pool: !!snap.get('pool'),
                fare:
                  (snap.get('fare') as number | undefined) ??
                  (snap.get('offeredFare') as number | undefined) ??
                  null,
                dropoffAddress: (snap.get('dropoff')?.address as string | undefined) ?? null,
              }
            : null;
        setState({ uid, tripId, active: live, resolved: true });
      },
      () => setState({ uid, tripId, active: null, resolved: true }),
    );
    return unsub;
  }, [uid, tripId]);

  // Anything read for a different uid — or before the first snapshot lands —
  // reads as "no active ride" rather than as somebody else's.
  if (state.uid !== owner) return { active: null, loading: !!uid };
  return { active: state.active, loading: !state.resolved };
}
