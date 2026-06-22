import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';
import type { Bid, Trip } from '../domain/types';

/**
 * Live subscription to a trip document and its bids subcollection.
 * Security rules restrict reads to the trip's participants.
 */
export function useTrip(tripId?: string): { trip: Trip | null; bids: Bid[]; loading: boolean } {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) return;
    setLoading(true);
    const unsubTrip = onSnapshot(doc(db, 'trips', tripId), (snap) => {
      setTrip(snap.exists() ? ({ id: snap.id, ...snap.data() } as Trip) : null);
      setLoading(false);
    });
    const unsubBids = onSnapshot(collection(db, 'trips', tripId, 'bids'), (snap) => {
      setBids(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Bid));
    });
    return () => {
      unsubTrip();
      unsubBids();
    };
  }, [tripId]);

  return { trip, bids, loading };
}
