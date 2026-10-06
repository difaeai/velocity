import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { distanceMeters } from '../lib/geo';
import { evaluateVehicleCheck, type VehicleCheckStatus } from '../domain/vehicleCheck';
import {
  DEFAULT_DAILY_TARGET,
  dailyTargetProgress,
  emptyDay,
  pktDayKey,
  type DailyTargetDay,
  type DailyTargetProgress,
  type DailyTargetSettings,
} from '../domain/dailyTarget';
import type { PaymentMethod, RideType, Trip } from '../domain/types';

export interface DriverProfile {
  fullName?: string;
  verificationStatus?: string;
  online?: boolean;
  rating?: number;
  tripsCount?: number;
  reviewReason?: string;
  rejectedSections?: string[];
  /** Gross fares (cash + online) not yet settled. */
  cycleGrossFare?: number;
  /** Cash-only portion of it — what commission is charged on. */
  cycleCashFare?: number;
  /**
   * The Pakistan day the `*Today` figures below belong to.
   *
   * This is what makes "nothing is owed until midnight" work without a nightly
   * job: fares stamped with today are still open, and everything else has
   * closed and is payable. See backend/functions/src/domain/commission.ts.
   */
  cycleDay?: string;
  /** The part of `cycleGrossFare` taken on `cycleDay`. */
  cycleGrossToday?: number;
  /** The part of `cycleCashFare` taken on `cycleDay`. */
  cycleCashToday?: number;
  /**
   * Unspent bonus — the commission a target day cancelled, plus anything an
   * admin granted by hand.
   *
   * It pays the driver's commission automatically and it can never be withdrawn
   * as cash — see backend/functions/src/domain/dailyTarget.ts for why that
   * boundary exists. Server-written only.
   */
  commissionCredit?: number;
  commissionCreditEarned?: number;
  commissionCreditUsed?: number;
  /**
   * WhatsApp ride alerts for when the app is closed. Server-owned: the driver
   * changes it through the `setWhatsAppAlerts` callable, never by writing here
   * (the security rules forbid it), so that consent has exactly one origin.
   */
  whatsappAlerts?: {
    optIn?: boolean;
    /** Set when Meta refused the number, or when the driver replied STOP. */
    blocked?: boolean;
    blockedReason?: string;
    /** The normalised number consent was given for. */
    number?: string;
  };
  /**
   * Which car in `drivers/{uid}/vehicles` the flat vehicle fields below are a
   * copy of. Absent on drivers who registered before multiple cars existed —
   * they are driving PRIMARY_VEHICLE_ID, which is what the security rules
   * assume too.
   */
  activeVehicleId?: string;
  /**
   * The photo that says "this is the car I am driving today". Written by the
   * confirmVehiclePhoto callable and cleared on every car switch; the security
   * rules refuse to let the driver go online without a live one.
   */
  vehicleCheck?: {
    status?: 'pending' | 'approved' | 'rejected';
    vehicleId?: string;
    plate?: string | null;
    photoUrl?: string | null;
    confirmedAt?: { seconds: number };
    reason?: string | null;
  };
  /** True while one of this driver's cars is waiting on an admin's review. */
  vehicleReviewPending?: boolean;
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

// ── The driver's cars ────────────────────────────────────────────────────────

export {
  PRIMARY_VEHICLE_ID,
  VEHICLE_CHECK_TTL_DAYS,
  type VehicleCheck,
  type VehicleCheckReason,
  type VehicleCheckStatus,
} from '../domain/vehicleCheck';

export interface DriverVehicle {
  vehicleId: string;
  vehicleType: RideType;
  make: string;
  color: string;
  plate: string;
  /** `${color} ${make}` — what every screen calls this car. */
  label: string;
  docUrl?: string | null;
  photoUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewReason?: string | null;
  createdAt?: { seconds: number };
}

/**
 * Every car on the driver's account, live.
 *
 * Read directly (the rules let a driver read their own subcollection) so a car
 * approved by an admin turns green on the driver's screen without a refresh.
 * Writes all go through callables — a client that could write here could approve
 * its own unvetted car.
 */
export function useDriverVehicles(uid?: string): DriverVehicle[] {
  const [rows, setRows] = useState<DriverVehicle[]>([]);
  useEffect(() => {
    if (!uid) { setRows([]); return; }
    return onSnapshot(
      collection(db, 'drivers', uid, 'vehicles'),
      (snap) => {
        const list = snap.docs.map((d) => ({ vehicleId: d.id, ...d.data() }) as DriverVehicle);
        // Approved cars first, then whatever is waiting, then rejected — the
        // order a driver picking a car actually wants.
        const rank = { approved: 0, pending: 1, rejected: 2 } as const;
        list.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
        setRows(list);
      },
      () => setRows([]),
    );
  }, [uid]);
  return rows;
}

/**
 * Does this driver still have to photograph their car?
 *
 * Thin wrapper over the pure rule in src/domain/vehicleCheck.ts, which evaluates
 * exactly what the security rules evaluate — same TTL, same 'primary' fallback,
 * same "rejected means no check". Keeping the two in step is what stops the app
 * from waving a driver through to a write Firestore will then bounce.
 */
export function vehicleCheckStatus(profile: DriverProfile | null): VehicleCheckStatus {
  return evaluateVehicleCheck(profile);
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
  /** Which ledger the ride settles through. */
  paymentMethod?: 'cash' | 'wallet';
  /**
   * Every method the rider offered to pay with — this is what the driver
   * decides on. Absent on requests booked by a build that predates the
   * multi-select, where `paymentMethod` alone is the whole answer.
   */
  paymentMethods?: PaymentMethod[];
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

/**
 * How long a request is worth putting in front of a driver.
 *
 * `openRequests` is a denormalised copy of a trip, deleted in the same
 * transaction that accepts or cancels one — so a request that VANISHES is
 * already handled the instant it happens: this is a realtime listener, not a
 * poll, and the row disappears as soon as Firestore pushes the delete.
 *
 * What this covers is the other failure: a request that never vanishes because
 * nothing ended it. A passenger who force-quits leaves their trip `requested`
 * for ever, and a driver was being offered half-hour-old rides — tap, drive
 * out, find nobody.
 *
 * DELIBERATELY SHORTER than the server's abandonment TTL in
 * backend/functions/src/trips/sweepStaleRequests.ts, and the asymmetry is the
 * point. Hiding a request costs a passenger nothing — their trip stays open and
 * a fresh driver coming online still sees it if it is inside the window —
 * whereas the server's TTL CANCELS the ride, so that one has to stay generous.
 * Showing is cheap to undo; cancelling is not.
 *
 * The client's must never exceed the server's, or drivers would be offered
 * rides the sweep has already cancelled.
 */
const REQUEST_TTL_MS = 10 * 60 * 1000;

/**
 * How often the surviving set is re-checked.
 *
 * inDrive and Yango poll every couple of seconds because they have to. A
 * Firestore listener already pushes removals the moment they happen, so this
 * timer exists only to retire requests that cross the age limit while the
 * driver is looking at them — nothing arrives from the server to trigger that.
 * One second, so the feed is never wrong for longer than that.
 */
const AGE_TICK_MS = 1_000;

/** Age bucket the card's "5m ago" label is drawn from — used to know when it changed. */
function ageLabelBucket(r: OpenRequest, now: number): number {
  return Math.floor(requestAgeMs(r, now) / 60_000);
}

function requestAgeMs(r: OpenRequest, now: number): number {
  const seconds = r.createdAt?.seconds;
  // No timestamp means the write is still in flight locally — treat it as new
  // rather than instantly expiring a request that has only just arrived.
  return seconds ? now - seconds * 1000 : 0;
}

export function useOpenRequests(enabled: boolean, driverLat?: number, driverLng?: number): OpenRequest[] {
  const [rows, setRows] = useState<OpenRequest[]>([]);
  // The unfiltered live feed. Ageing is applied on top of this by the ticker
  // below, so a request can drop off without Firestore sending anything.
  const liveRef = useRef<OpenRequest[]>([]);
  // Which rows, with which age labels, were last handed to the list — so the
  // ticker can tell "4m ago" becoming "5m ago" from a second passing with
  // nothing to show for it.
  const renderedSigRef = useRef<string>('');

  /**
   * Hand a set of rows to the list, and remember exactly what it drew.
   *
   * Both the snapshot and the ticker go through here. If only the snapshot
   * updated the signature the ticker would repaint once more for no reason on
   * its next beat, and if only the ticker did, every snapshot would.
   */
  const publish = useCallback((next: OpenRequest[], now: number) => {
    const signature =
      next.map((r) => r.tripId).join(',') + '|' + next.map((r) => ageLabelBucket(r, now)).join(',');
    if (signature === renderedSigRef.current) return;
    renderedSigRef.current = signature;
    setRows(next);
  }, []);

  useEffect(() => {
    if (!enabled) { liveRef.current = []; renderedSigRef.current = ''; setRows([]); return; }
    // Cap at 100 docs — geohash client-filter narrows further to ~nearby
    const q = query(collection(db, 'openRequests'), limit(100));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OpenRequest & { pickupGeohash?: string });
      if (driverLat === undefined || driverLng === undefined) {
        const now = Date.now();
        liveRef.current = all;
        publish(all.filter((r) => requestAgeMs(r, now) < REQUEST_TTL_MS), now);
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
      const now = Date.now();
      liveRef.current = withDistance;
      publish(withDistance.filter((r) => requestAgeMs(r, now) < REQUEST_TTL_MS), now);
    });
  }, [enabled, driverLat, driverLng, publish]);

  // A request that crosses the age limit while the driver is looking at the
  // feed has to disappear on its own — nothing new arrives from Firestore to
  // trigger a re-render. The tick is every second so the feed is never showing
  // a dead request for longer than that, but it only ever calls setState when
  // the surviving set actually changed, so a quiet feed costs one array scan a
  // second and no renders at all.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const now = Date.now();
      publish(liveRef.current.filter((r) => requestAgeMs(r, now) < REQUEST_TTL_MS), now);
    }, AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, publish]);

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

export interface CommissionSettings extends DailyTargetSettings {
  /** Fraction of cash fares a day that missed the target owes (e.g. 0.05). */
  rate: number;
}

const DEFAULT_COMMISSION: CommissionSettings = {
  rate: 0.05,
  ...DEFAULT_DAILY_TARGET,
};

/** A number from the admin's text box, or the default when it is not usable. */
function setting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * Live admin-set commission settings (dashboard → Commission page). Streams so
 * an admin change — a new daily target, a changed rate, pool-only on or off —
 * applies across every open app without a restart and without a release.
 *
 * The validation ranges are the same ones `getCommissionSettings` applies on
 * the backend. They have to be: a value the backend rejects and the app accepts
 * would show the driver a target nobody is going to honour.
 */
export function useCommissionSettings(): CommissionSettings {
  const [settings, setSettings] = useState<CommissionSettings>(DEFAULT_COMMISSION);
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'commissionSettings'), (s) => {
      if (!s.exists()) return;
      const d = DEFAULT_COMMISSION;
      setSettings({
        rate: setting(s.get('rate'), d.rate, 0.001, 0.5),
        dailyTargetEnabled: s.get('dailyTargetEnabled') !== false,
        dailyTargetRides: Math.round(setting(s.get('dailyTargetRides'), d.dailyTargetRides, 1, 100)),
        dailyTargetBonus: Math.round(setting(s.get('dailyTargetBonus'), d.dailyTargetBonus, 0, 50_000)),
        dailyTargetWaivesCommission: s.get('dailyTargetWaivesCommission') !== false,
        dailyTargetPoolOnly: s.get('dailyTargetPoolOnly') !== false,
        dailyTargetMinRideFare: Math.round(
          setting(s.get('dailyTargetMinRideFare'), d.dailyTargetMinRideFare, 0, 100_000),
        ),
        dailyTargetMinRiders: Math.round(
          setting(s.get('dailyTargetMinRiders'), d.dailyTargetMinRiders, 0, 100),
        ),
        dailyTargetMinDayFare: Math.round(
          setting(s.get('dailyTargetMinDayFare'), d.dailyTargetMinDayFare, 0, 1_000_000),
        ),
      });
    }, () => undefined);
  }, []);
  return settings;
}

export interface CommissionStatus extends CommissionSettings {
  /** Everything unsettled, cash and online, open day included. */
  cycleGrossFare: number;
  cycleCashFare: number;
  /** Fares taken today — not payable yet, and free if the target is met. */
  todayGrossFare: number;
  todayCashFare: number;
  /** Cash from days that have already ended. This is what is being charged. */
  settleableCashFare: number;
  settleableGrossFare: number;
  /** PKR the driver must find out of pocket — net of their bonus. */
  due: number;
  /** Commission the closed days earned, before the bonus is applied. */
  grossDue: number;
  /** The part of `grossDue` the driver's bonus is covering. */
  bonusApplied: number;
  /**
   * Unspent bonus. Pays commission automatically; never withdrawable.
   *
   * The driver-facing word is **bonus** — "commission" is only ever what they
   * pay us. The stored field is `drivers/{uid}.commissionCredit`, which keeps
   * its name for the same reason `travelMate*` did through the Travel Partner
   * rename: renaming a live field buys nothing and costs a migration.
   */
  bonus: number;
  /** A day has closed owing commission that has not been cleared. */
  locked: boolean;
}

/**
 * Combines the driver profile and admin settings into one settle status.
 *
 * A MIRROR OF domain/commission.ts, and it has to stay one. Only fares from a
 * day that has already ended are charged: at 23:59 a short day owes nothing and
 * at 00:00 the same figures owe 5%, with no write in between. The day key is
 * recomputed on every render from the clock, so the screen flips at midnight on
 * its own — exactly when the backend's guard does.
 *
 * `due` is net of the bonus everywhere, exactly as on the backend, because that
 * is the only number that answers the question the driver is actually asking:
 * what do I have to pay right now? A driver sitting on a bonus that covers it
 * owes nothing and must never be shown a figure that says otherwise.
 */
export function useCommissionStatus(profile: DriverProfile | null): CommissionStatus {
  const settings = useCommissionSettings();
  // Re-read at the Pakistan midnight without the app being restarted. The same
  // one-minute tick `useDailyTarget` uses, for the same reason.
  const [today, setToday] = useState(() => pktDayKey());
  useEffect(() => {
    const id = setInterval(() => {
      const now = pktDayKey();
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const cycleGrossFare = Math.max(0, profile?.cycleGrossFare ?? 0);
  // Pre-migration drivers have no cycleCashFare — their cycles were all cash.
  const cycleCashFare = Math.min(cycleGrossFare, profile?.cycleCashFare ?? cycleGrossFare);

  // A cycle with no day stamped on it is read as entirely open: that is the
  // one-day grace for drivers who were mid-cycle when this shipped.
  const cycleDay = profile?.cycleDay ?? null;
  const isOpen = cycleDay === null || cycleDay === today;
  const todayGrossFare = isOpen
    ? Math.min(cycleGrossFare, Math.max(0, profile?.cycleGrossToday ?? cycleGrossFare))
    : 0;
  const todayCashFare = isOpen
    ? Math.min(cycleCashFare, Math.max(0, profile?.cycleCashToday ?? cycleCashFare))
    : 0;

  const settleableGrossFare = Math.max(0, cycleGrossFare - todayGrossFare);
  const settleableCashFare = Math.max(0, cycleCashFare - todayCashFare);

  const bonus = Math.max(0, Math.round(profile?.commissionCredit ?? 0));
  const grossDue = Math.round(settleableCashFare * settings.rate);
  const bonusApplied = Math.min(bonus, grossDue);
  const due = grossDue - bonusApplied;
  return {
    ...settings,
    cycleGrossFare,
    cycleCashFare,
    todayGrossFare,
    todayCashFare,
    settleableGrossFare,
    settleableCashFare,
    grossDue,
    bonusApplied,
    bonus,
    due,
    locked: due > 0,
  };
}

/**
 * Today's daily-target progress, straight from the document the settlement
 * transaction writes.
 *
 * Streamed rather than fetched through a callable: the whole value of this card
 * is that the counter moves the moment the driver ends a ride, and a function
 * invocation per ride per driver is a lot of money to spend on a number that is
 * already sitting in a document the driver is allowed to read.
 *
 * The day key is Pakistan-local, so a driver working past midnight sees the new
 * day start at midnight their time rather than at 5am.
 */
export function useDailyTarget(uid: string | undefined): {
  progress: DailyTargetProgress;
  day: DailyTargetDay;
  settings: CommissionSettings;
} {
  const settings = useCommissionSettings();
  const [dayKey, setDayKey] = useState(() => pktDayKey());

  // The loaded day is stored WITH the key it belongs to, and read back only
  // when the two match. That is what makes the fallback a derived value rather
  // than a setState in the effect body — and it also means a driver crossing
  // midnight never sees yesterday's count on today's card for a frame.
  const [loaded, setLoaded] = useState<{ key: string; day: DailyTargetDay } | null>(null);

  // Roll over at the Pakistan midnight without needing the app restarted. One
  // cheap tick a minute; the subscription below re-points when the key changes.
  useEffect(() => {
    const id = setInterval(() => {
      const next = pktDayKey();
      setDayKey((current) => (current === next ? current : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, 'drivers', uid, 'dailyTargets', dayKey),
      (s) => {
        if (!s.exists()) {
          setLoaded({ key: dayKey, day: emptyDay(dayKey) });
          return;
        }
        const ids = s.get('riderIds');
        const bonusGranted = (s.get('bonusGranted') as number | undefined) ?? 0;
        setLoaded({
          key: dayKey,
          day: {
            day: dayKey,
            rides: (s.get('rides') as number | undefined) ?? 0,
            poolRides: (s.get('poolRides') as number | undefined) ?? 0,
            qualifyingRides: (s.get('qualifyingRides') as number | undefined) ?? 0,
            grossFare: (s.get('grossFare') as number | undefined) ?? 0,
            cashFare: (s.get('cashFare') as number | undefined) ?? 0,
            riderIds: Array.isArray(ids) ? (ids as string[]) : [],
            // Days written before `granted` existed are recognised by their bonus.
            granted: s.get('granted') === true || bonusGranted > 0,
            bonusGranted,
            waiverGranted: (s.get('waiverGranted') as number | undefined) ?? 0,
          },
        });
      },
      () => undefined,
    );
  }, [uid, dayKey]);

  const day = loaded && loaded.key === dayKey ? loaded.day : emptyDay(dayKey);
  return { progress: dailyTargetProgress(day, settings), day, settings };
}

/**
 * The driver's credit statement — every target bonus earned and every rupee of
 * it spent on a commission cycle, newest first.
 */
export function useCommissionCredits(uid: string | undefined, max = 30): CreditRow[] {
  // Keyed by uid for the same reason as `useDailyTarget` above: signing out, or
  // switching account, must not leave another driver's statement on screen, and
  // deriving that beats clearing it from inside the effect.
  const [loaded, setLoaded] = useState<{ uid: string; rows: CreditRow[] } | null>(null);
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'drivers', uid, 'commissionCredits'),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    return onSnapshot(
      q,
      (snap) => {
        setLoaded({
          uid,
          rows: snap.docs.map((d) => ({
            id: d.id,
            type: (d.get('type') as CreditRow['type'] | undefined) ?? 'daily_target',
            amount: (d.get('amount') as number | undefined) ?? 0,
            day: (d.get('day') as string | undefined) ?? null,
            reason: (d.get('reason') as string | undefined) ?? null,
            createdAt: (d.get('createdAt') as { seconds: number } | null | undefined) ?? null,
          })),
        });
      },
      () => undefined,
    );
  }, [uid, max]);
  return loaded && loaded.uid === uid ? loaded.rows : EMPTY_CREDITS;
}

/** Stable empty array — a fresh `[]` would re-render every consumer. */
const EMPTY_CREDITS: CreditRow[] = [];

export interface CreditRow {
  id: string;
  type: 'daily_target' | 'spent' | 'admin_grant' | 'admin_clawback';
  /** Positive = credit earned. Negative = credit spent on commission. */
  amount: number;
  day: string | null;
  reason: string | null;
  createdAt: { seconds: number } | null;
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

/** A wallet balance split by whether it may be withdrawn as cash. All PKR. */
export interface WalletFunds {
  balance: number;
  /** Ride earnings — the only money a payout can draw on. */
  withdrawable: number;
  /** Money added by top-up. Spendable on Velocity's charges, never cashed out. */
  ringFenced: number;
}

/**
 * The withdrawable split, mirroring `domain/walletFunds.ts` on the backend.
 *
 * Duplicated deliberately rather than fetched: the wallet doc is already
 * streaming, the rule is three lines, and a driver typing an amount needs the
 * cap in front of them, not a round trip. The backend stays the authority — it
 * re-derives this from the same fields inside the payout transaction, so a
 * client that got it wrong is refused rather than obeyed.
 */
export function useWalletFunds(uid?: string): WalletFunds {
  const [funds, setFunds] = useState<WalletFunds>({ balance: 0, withdrawable: 0, ringFenced: 0 });
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'wallets', uid), (s) => {
      const data = s.data();
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const balance = Math.max(0, num(data?.balance));
      const toppedUpTotal = Math.max(0, num(data?.toppedUpTotal));
      // A wallet that never took gateway money is holding none, so all of it is
      // withdrawable whatever `earned` says.
      const earned = toppedUpTotal > 0 ? num(data?.earned) : balance;
      const withdrawable = Math.max(0, Math.min(balance, earned));
      setFunds({ balance, withdrawable, ringFenced: balance - withdrawable });
    });
  }, [uid]);
  return funds;
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
