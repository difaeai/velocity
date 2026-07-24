import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { distanceMeters } from '../lib/geo';
import type { RideType, Trip } from '../domain/types';

export interface DriverProfile {
  fullName?: string;
  verificationStatus?: string;
  online?: boolean;
  rating?: number;
  tripsCount?: number;
  reviewReason?: string;
  rejectedSections?: string[];
  /** Gross fares (cash + online) accumulated in the current commission cycle. */
  cycleGrossFare?: number;
  /** Cash-only portion of the cycle — what the settle amount is computed from. */
  cycleCashFare?: number;
  // ── Submitted application details — used to re-fill the onboarding forms on
  //    resubmission so a rejection only costs the driver the rejected sections.
  cnic?: string;
  vehicleType?: string;
  vehicleLabel?: string;
  plate?: string;
  email?: string;
  dob?: string;
  licenseExpiry?: string;
  cnicExpiry?: string;
  vehicleDocExpiry?: string;
  photoDocPath?: string;
  photoDocUrl?: string;
  licenseDocPath?: string;
  licenseDocUrl?: string;
  cnicDocPath?: string;
  cnicDocUrl?: string;
  cnicBackDocPath?: string;
  cnicBackDocUrl?: string;
  vehicleDocPath?: string;
  vehicleDocUrl?: string;
  vehiclePhotoDocPath?: string;
  vehiclePhotoDocUrl?: string;
  extraVehiclePhotoDocPaths?: string[];
  extraVehiclePhotoDocUrls?: string[];
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
  /** Display name only — the feed never exposes the passenger's uid or phone. */
  passengerName?: string;
  passengerRating?: number;
  passengerRatingCount?: number;
  paymentMethod?: 'cash' | 'wallet';
  preferFemaleDriver?: boolean;
  pickup?: { address?: string; lat?: number; lng?: number };
  dropoff?: { address?: string; lat?: number; lng?: number };
  createdAt?: { seconds: number };
  /**
   * Pool request: more riders can join before (and during) the ride, so the car
   * makes several pickups and several drop-offs. Solo requests are one pickup,
   * one drop-off. The driver's feed has to make that difference obvious — the
   * two are very different jobs for the same fare figure.
   */
  pool?: boolean;
  /** Riders already on the pool (the host counts as one). */
  poolRiders?: number;
  /** Seat cap for the pool — how many riders it can grow to. */
  maxPoolRiders?: number;
  /**
   * Metres from the driver to the pickup point, computed on the client from the
   * driver's live coordinates. Undefined until the driver's location is known.
   */
  distanceM?: number;
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
    // Cap at 100 docs — geohash client-filter narrows further to ~nearby
    const q = query(collection(db, 'openRequests'), limit(100));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OpenRequest & { pickupGeohash?: string });
      if (driverLat === undefined || driverLng === undefined) {
        setRows(all);
        return;
      }
      const nearby = new Set(nearbyGeohashes(driverLat, driverLng, 6));
      const withDistance = all
        .filter((r) => !r.pickupGeohash || nearby.has(r.pickupGeohash))
        .map((r) => ({
          ...r,
          distanceM:
            r.pickup?.lat !== undefined && r.pickup?.lng !== undefined
              ? distanceMeters(driverLat, driverLng, r.pickup.lat, r.pickup.lng)
              : undefined,
        }));
      // Nearest first — a request with no pickup coords sorts last rather than
      // jumping to the top of the list.
      withDistance.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
      setRows(withDistance);
    });
  }, [enabled, driverLat, driverLng]);
  return rows;
}

const ACTIVE_STATUSES = ['matched', 'arriving', 'arrived', 'in_progress'] as const;

export function useDriverActiveTrip(uid?: string): Trip | null {
  const [trip, setTrip] = useState<Trip | null>(null);
  useEffect(() => {
    if (!uid) return;
    // Filter active trips server-side so Firestore doesn't stream all historical trips
    const q = query(
      collection(db, 'trips'),
      where('driverId', '==', uid),
      where('status', 'in', ACTIVE_STATUSES),
      limit(1),
    );
    return onSnapshot(q, (snap) => {
      setTrip(snap.empty ? null : ({ id: snap.docs[0]!.id, ...snap.docs[0]!.data() } as Trip));
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

export interface CommissionSettings {
  /** Fraction of cash fares owed per cycle (e.g. 0.10). */
  rate: number;
  /** Gross fare (cash + online) at which the driver is locked, in PKR. */
  threshold: number;
}

/**
 * Live admin-set commission settings (dashboard → Commission page). Streams so
 * an admin change applies across the app without a restart.
 */
export function useCommissionSettings(): CommissionSettings {
  const [settings, setSettings] = useState<CommissionSettings>({ rate: 0.10, threshold: 5000 });
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'commissionSettings'), (s) => {
      if (!s.exists()) return;
      const rate = s.get('rate') as number | undefined;
      const threshold = s.get('threshold') as number | undefined;
      setSettings({
        rate: typeof rate === 'number' && rate > 0 && rate <= 0.5 ? rate : 0.10,
        threshold: typeof threshold === 'number' && threshold >= 100 ? threshold : 5000,
      });
    }, () => undefined);
  }, []);
  return settings;
}

export interface CommissionStatus extends CommissionSettings {
  cycleGrossFare: number;
  cycleCashFare: number;
  /** PKR the driver must pay Velocity to settle the current cycle. */
  due: number;
  /** True when the cycle hit the threshold and something is still owed. */
  locked: boolean;
}

/** Combines the driver profile and admin settings into one settle status. */
export function useCommissionStatus(profile: DriverProfile | null): CommissionStatus {
  const settings = useCommissionSettings();
  const cycleGrossFare = profile?.cycleGrossFare ?? 0;
  // Pre-migration drivers have no cycleCashFare — their cycles were all cash.
  const cycleCashFare = profile?.cycleCashFare ?? cycleGrossFare;
  const due = Math.round(cycleCashFare * settings.rate);
  return {
    ...settings,
    cycleGrossFare,
    cycleCashFare,
    due,
    locked: cycleGrossFare >= settings.threshold && due > 0,
  };
}

export interface FeatureFlags {
  /** Gateway wallet top-ups. Off = "Coming Soon". */
  walletTopupEnabled: boolean;
  /** Connected Easypaisa/JazzCash/bank/card instruments. Off = "Coming Soon". */
  savedPaymentMethodsEnabled: boolean;
  /** Paid Travel Partner subscriptions. Off = "Coming Soon". */
  travelMateSubscriptionsEnabled: boolean;
  /** Travel Partner likes unlimited for everyone. */
  travelMateFree: boolean;
}

/** Live launch-posture feature flags from config/featureFlags. */
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({
    walletTopupEnabled: false,
    savedPaymentMethodsEnabled: false,
    travelMateSubscriptionsEnabled: false,
    travelMateFree: true,
  });
  useEffect(() => {
    return onSnapshot(
      doc(db, 'config', 'featureFlags'),
      (s) => {
        const d = s.data() ?? {};
        setFlags({
          walletTopupEnabled: d.walletTopupEnabled === true,
          savedPaymentMethodsEnabled: d.savedPaymentMethodsEnabled === true,
          travelMateSubscriptionsEnabled: d.travelMateSubscriptionsEnabled === true,
          travelMateFree: d.travelMateFree !== false,
        });
      },
      () => undefined,
    );
  }, []);
  return flags;
}

/**
 * Whether the wallet should still present itself as "Coming soon".
 *
 * Every entry point into the wallet reads this rather than hard-coding the
 * label, so flipping `walletTopupEnabled` from the dashboard drops the
 * "(Coming soon)" everywhere at once with no deploy — the whole point of
 * keeping the feature built but switched off.
 */
export function useWalletComingSoon(): boolean {
  return !useFeatureFlags().walletTopupEnabled;
}

/** "Wallet" → "Wallet (Coming soon)" while top-ups are off. */
export function useWalletLabel(base: string): string {
  return useWalletComingSoon() ? `${base} (Coming soon)` : base;
}

/** What kind of account a saved instrument is — drives its icon and label. */
export type SavedMethodKind = 'easypaisa' | 'jazzcash' | 'card' | 'bank';

export interface SavedPaymentMethod {
  id: string;
  kind: SavedMethodKind;
  label: string;
  maskedAccount?: string | null;
  brand?: string | null;
  isDefault?: boolean;
  status?: 'active' | 'revoked' | 'expired';
}

/**
 * The user's connected payment methods, live.
 *
 * Streams the documents directly (rules allow the owner to read their own) so
 * removing or re-defaulting an instrument reflects instantly instead of waiting
 * on a callable round-trip. The chargeable token is NOT in these documents —
 * it lives in paymentMethodSecrets, which no client can read.
 */
/** Stable empty result, so the signed-out case never allocates a new array. */
const NO_METHODS: SavedPaymentMethod[] = [];

export function useSavedPaymentMethods(uid?: string): SavedPaymentMethod[] {
  const [rows, setRows] = useState<SavedPaymentMethod[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'paymentMethods'), where('uid', '==', uid)),
      (snap) => {
        const methods = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SavedPaymentMethod);
        // Default first, then everything else — matches the Active/Inactive split.
        methods.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        setRows(methods);
      },
      () => setRows([]),
    );
  }, [uid]);
  // Signed out: report empty by derivation rather than resetting state inside
  // the effect, which would cascade an extra render on every sign-out.
  return uid ? rows : NO_METHODS;
}

export interface CommissionSettlement {
  id: string;
  status: 'verifying' | 'approved' | 'rejected' | 'pending_review';
  amountDue?: number;
  rejectionReason?: string | null;
  createdAt?: { seconds: number };
}

/** The driver's most recent commission settlement attempt (for status UI). */
export function useLatestCommissionSettlement(uid?: string): CommissionSettlement | null {
  const [row, setRow] = useState<CommissionSettlement | null>(null);
  useEffect(() => {
    if (!uid) { setRow(null); return; }
    // Equality-only query (no composite index needed); newest picked client-side.
    return onSnapshot(
      query(collection(db, 'commissionSettlements'), where('driverId', '==', uid)),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CommissionSettlement & { createdAt?: { seconds: number } });
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setRow(docs[0] ?? null);
      },
      () => setRow(null),
    );
  }, [uid]);
  return row;
}

export interface SettlementAccounts {
  easypaisaNumber?: string;
  jazzcashNumber?: string;
  bankName?: string;
  bankIban?: string;
  accountTitle?: string;
}

/** Velocity's official receiving accounts (admin-maintained). */
export function useSettlementAccounts(): SettlementAccounts | null {
  const [accounts, setAccounts] = useState<SettlementAccounts | null>(null);
  useEffect(() => {
    return onSnapshot(
      doc(db, 'config', 'settlementAccounts'),
      (s) => setAccounts(s.exists() ? (s.data() as SettlementAccounts) : null),
      () => setAccounts(null),
    );
  }, []);
  return accounts;
}

export function useWalletBalance(uid?: string): number {
  const [balance, setBalance] = useState(0);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'wallets', uid), (s) => setBalance((s.data()?.balance as number) ?? 0));
  }, [uid]);
  return balance;
}

export interface CancellationSettings {
  /** Fraction of the fare a passenger pays for cancelling a confirmed ride. */
  passengerFeeRate: number;
  /** Fraction of the fare a driver pays for cancelling a ride they accepted. */
  driverFeeRate: number;
  /** Outstanding debt (PKR) at which the account can no longer book or bid. */
  outstandingLimit: number;
}

/**
 * Live admin-set cancellation rules (dashboard → Cancellation fees). Streams so
 * the fee the app warns about is always the one the backend will actually charge.
 * Defaults mirror DEFAULT_CANCELLATION on the backend.
 */
export function useCancellationSettings(): CancellationSettings {
  const [settings, setSettings] = useState<CancellationSettings>({
    passengerFeeRate: 0.05,
    driverFeeRate: 0.08,
    outstandingLimit: 300,
  });
  useEffect(() => {
    return onSnapshot(
      doc(db, 'config', 'cancellationSettings'),
      (s) => {
        if (!s.exists()) return;
        const rate = (v: unknown, fallback: number) =>
          typeof v === 'number' && v >= 0 && v <= 0.5 ? v : fallback;
        const limit = s.get('outstandingLimit') as number | undefined;
        setSettings({
          passengerFeeRate: rate(s.get('passengerFeeRate'), 0.05),
          driverFeeRate: rate(s.get('driverFeeRate'), 0.08),
          outstandingLimit: typeof limit === 'number' && limit >= 0 ? limit : 300,
        });
      },
      () => undefined,
    );
  }, []);
  return settings;
}

export interface OutstandingStatus {
  /** Unpaid cancellation fees owed to Velocity, in PKR. */
  amount: number;
  /** True once the debt is big enough to stop the account booking or bidding. */
  blocked: boolean;
  limit: number;
}

/** What this user owes Velocity in cancellation fees, and whether it blocks them. */
export function useOutstanding(uid?: string): OutstandingStatus {
  const { outstandingLimit } = useCancellationSettings();
  const [amount, setAmount] = useState(0);
  useEffect(() => {
    if (!uid) { setAmount(0); return; }
    return onSnapshot(
      doc(db, 'wallets', uid),
      (s) => {
        const value = s.data()?.outstanding as number | undefined;
        setAmount(typeof value === 'number' && value > 0 ? Math.round(value) : 0);
      },
      () => setAmount(0),
    );
  }, [uid]);
  return {
    amount,
    blocked: outstandingLimit > 0 && amount >= outstandingLimit,
    limit: outstandingLimit,
  };
}

/** The user's most recent cancellation-fee settlement attempt (for status UI). */
export function useLatestFeeSettlement(uid?: string): CommissionSettlement | null {
  const [row, setRow] = useState<CommissionSettlement | null>(null);
  useEffect(() => {
    if (!uid) { setRow(null); return; }
    // Equality-only query (no composite index needed); newest picked client-side.
    return onSnapshot(
      query(
        collection(db, 'commissionSettlements'),
        where('userId', '==', uid),
        where('kind', '==', 'cancellation_fee'),
      ),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CommissionSettlement);
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setRow(docs[0] ?? null);
      },
      () => setRow(null),
    );
  }, [uid]);
  return row;
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
