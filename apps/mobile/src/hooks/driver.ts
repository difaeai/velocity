import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { RideType, Trip } from '../domain/types';

export interface DriverProfile {
  verificationStatus?: string;
  online?: boolean;
  rating?: number;
  tripsCount?: number;
  reviewReason?: string;
  rejectedSections?: string[];
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

export interface DriverPoolRide {
  id: string;
  status: string;
  pickup:       { address: string; lat: number; lng: number };
  dropoff:      { address: string; lat: number; lng: number };
  takenSeats:   number;
  maxSeats:     number;
  perSeatFare:  number;
  rideCategory?: string;
  pickupOrder?:        string[];
  currentPickupIndex?: number;
}

const ACTIVE_POOL_STATUSES = new Set(['open', 'collecting', 'full', 'boarding', 'in_progress']);

export function useDriverPoolRides(uid?: string): DriverPoolRide[] {
  const [rides, setRides] = useState<DriverPoolRide[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'poolRides'), where('driverId', '==', uid)),
      (snap) => {
        const active = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as DriverPoolRide)
          .filter((r) => ACTIVE_POOL_STATUSES.has(r.status));
        setRides(active);
      },
      () => setRides([]),
    );
  }, [uid]);
  return rides;
}

export function useWalletBalance(uid?: string): number {
  const [balance, setBalance] = useState(0);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'wallets', uid), (s) => setBalance((s.data()?.balance as number) ?? 0));
  }, [uid]);
  return balance;
}

export interface WalletTxn {
  id: string;
  type: string;
  amount: number;
}

export function useWalletTransactions(uid?: string): WalletTxn[] {
  const [rows, setRows] = useState<WalletTxn[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'wallets', uid, 'transactions'), orderBy('createdAt', 'desc')),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WalletTxn)),
      () => setRows([]),
    );
  }, [uid]);
  return rows;
}
