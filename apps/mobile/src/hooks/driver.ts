import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { RideType, Trip } from '../domain/types';

export interface DriverProfile {
  verificationStatus?: string;
  online?: boolean;
  rating?: number;
  tripsCount?: number;
}

export function useDriverProfile(uid?: string): DriverProfile | null {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'drivers', uid), (s) =>
      setProfile(s.exists() ? (s.data() as DriverProfile) : null),
    );
  }, [uid]);
  return profile;
}

export interface OpenRequest {
  id: string;
  tripId: string;
  rideType: RideType;
  offeredFare: number;
  seats: number;
  passengerGender: string;
  pickup?: { address?: string };
  dropoff?: { address?: string };
}

export function useOpenRequests(enabled: boolean): OpenRequest[] {
  const [rows, setRows] = useState<OpenRequest[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    return onSnapshot(collection(db, 'openRequests'), (snap) =>
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OpenRequest)),
    );
  }, [enabled]);
  return rows;
}

const ACTIVE = new Set<Trip['status']>(['matched', 'arriving', 'arrived', 'in_progress']);

export function useDriverActiveTrip(uid?: string): Trip | null {
  const [trip, setTrip] = useState<Trip | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(query(collection(db, 'trips'), where('driverId', '==', uid)), (snap) => {
      const active = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Trip)
        .find((t) => ACTIVE.has(t.status));
      setTrip(active ?? null);
    });
  }, [uid]);
  return trip;
}

export function useWalletBalance(uid?: string): number {
  const [balance, setBalance] = useState(0);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'wallets', uid), (s) => setBalance((s.data()?.balance as number) ?? 0));
  }, [uid]);
  return balance;
}
