import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { RideType, Trip } from '../domain/types';

export interface DriverProfile {
  fullName?: string;
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
  paymentMethod?: 'cash' | 'wallet';
  preferFemaleDriver?: boolean;
  pickup?: { address?: string; lat?: number; lng?: number };
  dropoff?: { address?: string; lat?: number; lng?: number };
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = '', bits = 0, bitCount = 0, isEven = true;
  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) | 1; minLng = mid; } else { bits = bits << 1; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; } else { bits = bits << 1; maxLat = mid; }
    }
    isEven = !isEven;
    if (++bitCount === 5) { hash += BASE32[bits]; bits = 0; bitCount = 0; }
  }
  return hash;
}

function nearbyGeohashes(lat: number, lng: number, precision = 6): string[] {
  const step = 180 / Math.pow(2, precision * 2.5);
  const hashes = new Set<string>();
  for (const dLat of [-step, 0, step]) {
    for (const dLng of [-step * 2, 0, step * 2]) {
      hashes.add(encodeGeohash(Math.max(-90, Math.min(90, lat + dLat)), ((lng + dLng + 180) % 360) - 180, precision));
    }
  }
  return [...hashes];
}

export function useOpenRequests(enabled: boolean, driverLat?: number, driverLng?: number): OpenRequest[] {
  const [rows, setRows] = useState<OpenRequest[]>([]);
  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    return onSnapshot(collection(db, 'openRequests'), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OpenRequest & { pickupGeohash?: string });
      if (driverLat !== undefined && driverLng !== undefined) {
        const nearby = new Set(nearbyGeohashes(driverLat, driverLng, 6));
        setRows(all.filter(r => !r.pickupGeohash || nearby.has(r.pickupGeohash)));
      } else {
        setRows(all);
      }
    });
  }, [enabled, driverLat, driverLng]);
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
