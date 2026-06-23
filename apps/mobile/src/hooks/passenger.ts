import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { Trip } from '../domain/types';

/**
 * Live list of the signed-in passenger's trips, newest first.
 *
 * The security rules allow a passenger to read trips where `passengerId == uid`,
 * so the query is filtered on that field. We sort client-side to avoid needing a
 * composite index (passengerId + createdAt).
 */
export function usePassengerTrips(uid?: string): { trips: Trip[]; loading: boolean } {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setTrips([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      query(collection(db, 'trips'), where('passengerId', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip & { createdAt?: { seconds: number } });
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setTrips(rows);
        setLoading(false);
      },
      () => {
        setTrips([]);
        setLoading(false);
      },
    );
  }, [uid]);

  return { trips, loading };
}
