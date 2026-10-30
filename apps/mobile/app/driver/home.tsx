import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';

// `expo-location` is native-only; never evaluate it on web (same pattern as
// src/hooks/location.ts). navigator.geolocation does NOT exist in React
// Native, so the native path must use expo-location.
const ExpoLocation =
  Platform.OS === 'web' ? null : (require('expo-location') as typeof import('expo-location'));


import { useAuth } from '../../src/auth/AuthContext';
import { registerForPushNotifications } from '../../src/lib/notifications';
import { db } from '../../src/firebase';
import { api, type ReportReason } from '../../src/api/client';
import {
  useCancellationSettings,
  useCommissionStatus,
  faceCheckInStatus,
  useDriverActiveTrip,
  useDriverPoolRides,
  useDriverProfile,
  useDriverQueue,
  useOpenRequests,
  useDailyTarget,
  useOutstanding,
  vehicleCheckStatus,
  type OpenRequest,
} from '../../src/hooks/driver';
import { CommissionLock } from '../../src/ui/CommissionLock';
import { DailyTargetTicker } from '../../src/ui/DailyTargetTicker';
import { WalletCard } from '../../src/ui/WalletCard';
import { OutstandingFees } from '../../src/ui/OutstandingFees';
import { colors } from '../../src/config';
import { offlineWarning, queueBanner } from '../../src/lib/driverQueue';
import { themed } from '../../src/theme';
import { PrimaryButton } from '../../src/ui/components';
import { MapPlaceholder } from '../../src/ui/MapPlaceholder';
import { RatingModal } from '../../src/ui/RatingModal';
import { ChatModal } from '../../src/ui/ChatModal';
import { DriverDrawer } from '../../src/ui/DriverDrawer';
import { ArrivalCountdown } from '../../src/ui/ArrivalCountdown';
import { RadarScan } from '../../src/ui/RadarScan';
import { RequestCard } from '../../src/ui/RequestCard';
import { ReportRequestModal } from '../../src/ui/ReportRequestModal';
import { DriverTabBar, DRIVER_TAB_BAR_HEIGHT } from '../../src/ui/DriverTabBar';
import { useUnreadChat } from '../../src/hooks/useUnreadChat';
import { hasCoords, openNavigation, type NavTarget } from '../../src/lib/navigate';
import { callInApp, useWarmRideLine } from '../../src/lib/inAppCall';
import { DropOffPanel } from '../../src/ui/DropOffPanel';
import { DashCam } from '../../src/ui/DashCam';
import { drainDashcamQueue, ensureDashcamPermission } from '../../src/lib/dashcam';
import { DriverPoolManifest } from '../../src/ui/DriverPoolManifest';
import { SharingRidesFeed } from '../../src/ui/SharingRidesFeed';
import { SharedRidesStrip } from '../../src/ui/SharedRidesStrip';
import { distanceMeters, formatDistance } from '../../src/lib/geo';
import { RIDE_TYPE_LABELS, type Trip, type TripStatus } from '../../src/domain/types';
import { documentsExpiringSoon } from '../../src/domain/documentExpiry';

// "Head to pickup" used to be a step of its own between accepting and arriving,
// so the button under the map read "Head to pickup" when the driver was already
// at the kerb looking for "Arrived". Going is now the GO TO CUSTOMER'S LOCATION
// button's side effect, and the server takes matched → arrived directly.
const NEXT_ACTION: Partial<Record<TripStatus, { label: string; to: 'arrived' | 'in_progress' }>> = {
  matched: { label: 'ARRIVED AT PICKUP', to: 'arrived' },
  arriving: { label: 'ARRIVED AT PICKUP', to: 'arrived' },
  arrived: { label: 'START RIDE', to: 'in_progress' },
  // 'in_progress' deliberately has no entry: ending a ride is DropOffPanel's
  // job, because a shared car ends it once per passenger, not once per trip.
};

/** Remembers that the WhatsApp-alerts offer has been made, so it is made once. */
const WHATSAPP_ASK_KEY = 'velocity.driver.whatsappAsked.v1';

/** How long the radar sweeps after the driver goes online, before the feed opens. */
const SCAN_MS = 3500;

/** Skipped/hidden request ids, persisted for an hour so they don't come back. */
const SKIP_KEY = 'driver_skipped_requests';
const SKIP_TTL = 60 * 60 * 1000;

export default function DriverHome() {
  const { user, signOut } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const profile = useDriverProfile(uid);
  const activeTrip = useDriverActiveTrip(uid);
  const poolRides = useDriverPoolRides(uid);
  const online = profile?.online ?? false;

  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Read by the location publisher, which is built once when the driver goes
  // online and would otherwise capture whatever trip existed at that moment.
  const activeTripRef = useRef<string | null>(null);
  // Where this driver stands in the queue for the area they are sitting in, and
  // the feed ordered by it: whoever came online first gets first refusal, and
  // the longest-waiting request comes first within what they may take. Both are
  // advisory here — `placeBid` enforces the same rule server-side.
  const queue = useDriverQueue(online && !activeTrip, driverCoords?.lat, driverCoords?.lng);
  // The hook keeps its last answer after going offline, so only trust it while it is polling.
  const queueText = online && !activeTrip ? queueBanner(queue) : null;
  const queueLine = queueText && `${queueText} — staying online keeps your place`;
  const liveRequests = useOpenRequests(
    online && !activeTrip,
    driverCoords?.lat,
    driverCoords?.lng,
    queue,
  );
  const commission = useCommissionStatus(profile);
  const commissionLocked = commission.locked;
  // Today's ride count against the admin-set target, straight off the day
  // document the settlement writes — so the card moves as rides land.
  const dailyTarget = useDailyTarget(uid);
  // Unpaid cancellation fees — past the limit, the backend rejects new bids.
  // The bonus pays them first, so only what it cannot cover counts.
  const outstanding = useOutstanding(uid, commission.bonus - commission.bonusApplied);
  const cancellation = useCancellationSettings();
  // Has this driver photographed the car they are about to drive? The security
  // rules refuse the `online` write without it, so the toggle has to know too —
  // otherwise the button would just fail with nothing on screen to explain it.
  const carCheck = vehicleCheckStatus(profile);
  // …and is the person holding the phone the driver on the account? Asked once
  // a day, enforced by the rules and the trip guards, so the toggle has to know
  // about it for exactly the same reason as the car photo above.
  const faceCheck = faceCheckInStatus(profile);
  // Papers running out within the month — the only countdown a driver is shown.
  const expiring = documentsExpiringSoon(profile);

  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // There used to be a Solo | Sharing switch here, and a shared ride booked from
  // the rider app landed under "Solo" — the feed it actually lives in — so the
  // driver saw a shared ride filed as solo. Every ride is in one list now, each
  // boxed by kind. A driver who last left the switch on Solo is still skipped
  // by the shared-ride offer ladder (poolRideRequests/dispatch.ts) until the
  // field says otherwise, so put them back in it.
  useEffect(() => {
    if (uid && profile?.rideMode === 'solo') {
      setDoc(doc(db, 'drivers', uid), { rideMode: 'sharing' }, { merge: true }).catch(() => {});
    }
  }, [uid, profile?.rideMode]);
  // A push only reaches a backgrounded app. With the trip screen open —
  // which is exactly where a driver sits while the passenger is writing —
  // Android shows nothing, so the button has to carry the news itself.
  const { unread: unreadChat, markRead: markChatRead } = useUnreadChat(activeTrip?.id, uid);
  useWarmRideLine(online || !!activeTrip, 'driver');

  // "Arrived" shows — timer running — the moment it is tapped. The server
  // takes seconds to answer, and a button that does nothing for that long
  // reads as a button that does not work.
  const [arrivedLocally, setArrivedLocally] = useState<{ tripId: string; at: number } | null>(null);
  const awaitingArrival =
    !!activeTrip
    && arrivedLocally?.tripId === activeTrip.id
    && (activeTrip.status === 'matched' || activeTrip.status === 'arriving');
  const tripStatus: TripStatus | undefined = awaitingArrival ? 'arrived' : activeTrip?.status;
  const arrivedAt = activeTrip?.arrivedAt
    ?? (awaitingArrival ? { seconds: Math.floor(arrivedLocally!.at / 1000), nanoseconds: 0 } : null);

  // Before the passenger is aboard the driver is going to the pickup; after,
  // to the drop-off. One button, pointed at whichever is actually next.
  // Keep the location publisher pointed at the trip that is actually live.
  useEffect(() => {
    activeTripRef.current = activeTrip?.id ?? null;
  }, [activeTrip?.id]);

  // Straight-line distance to the pickup. Not a route length and not sold as
  // one — it answers "are they around the corner or across town", which is the
  // question a driver on the way actually has.
  const pickupAwayM = (() => {
    if (!activeTrip || !driverCoords || !hasCoords(activeTrip.pickup)) return null;
    return distanceMeters(driverCoords.lat, driverCoords.lng, activeTrip.pickup.lat, activeTrip.pickup.lng);
  })();

  const navTarget: NavTarget | null = (() => {
    if (!activeTrip) return null;
    const leg = activeTrip.status === 'in_progress' ? activeTrip.dropoff : activeTrip.pickup;
    if (!hasCoords(leg)) return null;
    return { lat: leg.lat, lng: leg.lng, address: activeTrip.status === 'in_progress'
      ? activeTrip.dropoff?.address ?? null
      : activeTrip.pickup?.address ?? null };
  })();
  const [ratingTrip, setRatingTrip] = useState<Trip | null>(null);
  const prevTripRef = useRef<Trip | null>(null);

  // ── Radar → feed ─────────────────────────────────────────────────────────
  // The sweep runs for a few seconds after the driver taps "Go online", so the
  // app visibly looks for work before the list appears. It is keyed off the tap
  // (not off `online`) so returning to this tab with the feed already loaded
  // drops the driver straight back into the list.
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!scanning) return;
    const t = setTimeout(() => setScanning(false), SCAN_MS);
    return () => clearTimeout(t);
  }, [scanning]);
  // Going offline (or picking up a trip) cancels an in-flight sweep.
  useEffect(() => {
    if (!online || activeTrip) setScanning(false);
  }, [online, activeTrip]);
  // …and a driver who went online somewhere else — the car photo screen finishes
  // the job when they were sent there by the toggle — still gets the sweep, so
  // the two routes into "online" look identical from here. `null` until the
  // first snapshot lands, so reopening the app already online doesn't sweep.
  const prevOnlineRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!profile) return;
    if (prevOnlineRef.current === false && online) setScanning(true);
    prevOnlineRef.current = online;
  }, [profile, online]);

  // ── Hidden requests ──────────────────────────────────────────────────────
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(SKIP_KEY).then((raw) => {
      if (!raw) return;
      try {
        const entries: { id: string; at: number }[] = JSON.parse(raw);
        const now = Date.now();
        const valid = entries.filter((e) => now - e.at < SKIP_TTL);
        setHiddenIds(new Set(valid.map((e) => e.id)));
        if (valid.length !== entries.length) AsyncStorage.setItem(SKIP_KEY, JSON.stringify(valid));
      } catch { /* corrupted data — start fresh */ }
    });
  }, []);

  const hideRequest = useCallback((tripId: string) => {
    setHiddenIds((prev) => new Set([...prev, tripId]));
    AsyncStorage.getItem(SKIP_KEY).then((raw) => {
      const existing: { id: string; at: number }[] = raw ? JSON.parse(raw) : [];
      const updated = [...existing.filter((e) => e.id !== tripId), { id: tripId, at: Date.now() }];
      AsyncStorage.setItem(SKIP_KEY, JSON.stringify(updated));
    }).catch(() => {});
  }, []);

  // "Corporate & Students" (the default) shows every ride, corporate ones boxed
  // in yellow; "Regular" leaves the corporate ones out.
  const regularOnly = profile?.rideMode === 'regular';
  const visible = useMemo(
    () => liveRequests.filter((r) => !hiddenIds.has(r.tripId) && !(regularOnly && r.commute)),
    [liveRequests, hiddenIds, regularOnly],
  );

  // ── "Show new requests" ──────────────────────────────────────────────────
  // The rendered list is a frozen snapshot. Requests arriving while the driver
  // reads the feed do NOT reflow it under their thumb — they queue up behind a
  // pill, and the driver decides when to pull them in.
  const [shown, setShown] = useState<OpenRequest[]>([]);
  const listRef = useRef<FlatList<OpenRequest>>(null);

  useEffect(() => {
    setShown((prev) => {
      // Nothing on screen yet (first load, or everything got taken/hidden) →
      // adopt the live feed immediately; there is no scroll position to protect.
      if (prev.length === 0) return visible;

      const live = new Map(visible.map((r) => [r.tripId, r]));
      // Drop requests another driver has taken, and refresh the ones still open
      // (the passenger may have raised the fare while we were looking at it).
      return prev.flatMap((r) => {
        const fresh = live.get(r.tripId);
        return fresh ? [fresh] : [];
      });
    });
  }, [visible]);

  const shownIds = useMemo(() => new Set(shown.map((r) => r.tripId)), [shown]);
  const pendingCount = useMemo(
    () => visible.filter((r) => !shownIds.has(r.tripId)).length,
    [visible, shownIds],
  );

  const showNewRequests = useCallback(() => {
    setShown(visible);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [visible]);

  // ── Swipe actions + report ───────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportTripId, setReportTripId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function submitReport(reasons: ReportReason[], description: string) {
    if (!reportTripId) return;
    setReporting(true);
    setReportError(null);
    try {
      const res = await api.reportOpenRequest({
        tripId: reportTripId,
        reasons,
        ...(description ? { description } : {}),
      });
      // Reporting also takes it out of this driver's feed — they have said their
      // piece and should not have to look at it again.
      hideRequest(reportTripId);
      setReportTripId(null);
      Alert.alert(
        res.alreadyReported ? 'Already reported' : 'Report sent',
        res.alreadyReported
          ? 'You have already reported this request. Our team is reviewing it.'
          : 'Thank you. Our team will review this request.',
      );
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not send the report. Please try again.');
    } finally {
      setReporting(false);
    }
  }

  // ── Push + location ──────────────────────────────────────────────────────
  useEffect(() => {
    if (user) registerForPushNotifications().catch(() => {});
  }, [user?.uid]);

  // Dash cam clips still waiting from a ride that ended in a dead zone, or that
  // the app was closed during. The camera box drains them too, but it is only
  // mounted mid-ride.
  useEffect(() => {
    void drainDashcamQueue();
  }, []);

  /**
   * Every ride is recorded, so the camera is the one thing a ride cannot start
   * without — asked for here, at the tap that needs it. Sound is asked for too
   * but is not required.
   */
  async function startTrip(tripId: string) {
    if (!(await canStartRide())) return;
    await api.updateTripStatus({ tripId, to: 'in_progress' });
  }

  /** The dash cam permission a ride cannot start without — shared with per-rider starts. */
  async function canStartRide(): Promise<boolean> {
    if (await ensureDashcamPermission()) return true;
    Alert.alert(
      'Allow the camera to start the ride',
      'Every Velocity Rides ride is recorded by the dash cam, for your safety and your passengers’. Allow camera access, then tap Start ride again.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ],
    );
    return false;
  }

  /** Google Maps, outside the app — the in-app map is not a paid navigation call. */
  function goToCustomer(trip: Trip, target: NavTarget) {
    openNavigation(target);
    // Telling the passenger the car is coming; the drive itself is the point.
    if (trip.status === 'matched') {
      api.updateTripStatus({ tripId: trip.id, to: 'arriving' }).catch(() => {});
    }
  }

  async function markArrived(trip: Trip) {
    setArrivedLocally({ tripId: trip.id, at: Date.now() });
    try {
      await api.updateTripStatus({ tripId: trip.id, to: 'arrived' });
    } catch (e) {
      setArrivedLocally(null);
      Alert.alert('Could not mark arrival', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  // Location powers the geohash proximity filter, the distance shown on each
  // request, and the passenger-facing live driver marker.
  useEffect(() => {
    let watchId: ReturnType<typeof setInterval> | undefined;
    if (online) {
      /** Stamped once per shift, not per ping — see `stampDriverCell`. */
      let cellStamped = false;
      const publish = (lat: number, lng: number) => {
        setDriverCoords({ lat, lng });
        if (uid) {
          setDoc(doc(db, 'drivers', uid), {
            lastLocation: { lat, lng },
            lastSeenAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
          /**
           * The map cell the ride broadcast queries on. A sweep stamps it once
           * a minute, which leaves a driver who has JUST gone online invisible
           * for up to 60 seconds — the worst minute to be invisible, since a
           * shared ride only has ten of them to find a car. So we ask the
           * server to stamp it now, once, on the first fix of the shift.
           *
           * Server-side on purpose: the cell must be in geofire's format at
           * full precision, and a second implementation on the phone drifting
           * from that one would make drivers invisible rather than stale.
           * Best-effort — the sweep is still the backstop.
           */
          if (!cellStamped) {
            cellStamped = true;
            api.stampDriverCell({ lat, lng }).catch(() => { cellStamped = false; });
          }
        }
        // Relay the same fix onto the live trip. The passenger cannot read
        // drivers/{uid} — that document is the driver's own — so this copy is
        // the only way their screen can say how far away the car is. The rules
        // let the assigned driver write these two fields and nothing else.
        const liveTripId = activeTripRef.current;
        if (liveTripId) {
          setDoc(doc(db, 'trips', liveTripId), {
            driverLocation: { lat, lng },
            driverLocationAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
        }
      };
      const updateLocation = () => {
        if (ExpoLocation) {
          ExpoLocation.requestForegroundPermissionsAsync()
            .then(({ status }) => {
              if (status !== 'granted') return null;
              return ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
            })
            .then((pos) => { if (pos) publish(pos.coords.latitude, pos.coords.longitude); })
            .catch(() => {});
        } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => publish(pos.coords.latitude, pos.coords.longitude),
            () => {},
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
          );
        }
      };
      updateLocation();
      watchId = setInterval(updateLocation, 30000);
    }
    return () => { if (watchId) clearInterval(watchId); };
  }, [online, uid]);

  // Trip just ended → offer the driver a chance to rate the passenger.
  useEffect(() => {
    if (prevTripRef.current && !activeTrip) {
      if (prevTripRef.current.status === 'in_progress' && !prevTripRef.current.driverRated) {
        setRatingTrip(prevTripRef.current);
      }
    }
    prevTripRef.current = activeTrip;
  }, [activeTrip]);

  async function handleRate(stars: number, comment: string) {
    if (!ratingTrip) return;
    await api.submitRating({
      tripId: ratingTrip.id,
      stars,
      comment: comment || undefined,
      targetRole: 'passenger',
    });
    setRatingTrip(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function setOnline(next: boolean) {
    if (!uid || next === online) return;
    // No live photo of the car? The Firestore rules will bounce this write, so
    // send the driver to the camera rather than letting the toggle die quietly.
    // `intent=online` tells that screen to finish the job they actually asked
    // for — going online — the moment the photo is accepted.
    if (next && carCheck.needsPhoto) {
      router.push('/driver/car-verification?intent=online');
      return;
    }
    // Same courtesy for today's face check: the rules refuse the write without
    // it, so send them to the camera rather than letting the toggle die quietly.
    if (next && faceCheck.blocking) {
      router.push('/driver/face-check-in');
      return;
    }
    // Sweep the radar on the way online — never on the way offline.
    if (next) setScanning(true);
    run(() => setDoc(doc(db, 'drivers', uid), { online: next, lastSeenAt: serverTimestamp() }, { merge: true }));
    // Going offline is the exact moment the offer means something: from here on
    // there are no notifications, because the app will be closed. Asked once,
    // ever — a second prompt would be nagging, and the switch lives in Settings
    // for anyone who says no now and changes their mind later.
    if (!next) offerWhatsAppAlerts();
  }

  /**
   * Going offline costs the driver their place in the queue, so say so first.
   *
   * This is the rule drivers will resent most if they meet it by accident —
   * stepping away for ten minutes and coming back to the bottom of the list.
   * Warning before the fact turns it from something done to them into a choice
   * they made, and the grace window means a short break genuinely is free.
   *
   * Only prompts when they actually hold a place worth losing; otherwise it
   * goes straight through, because a confirm dialog on every toggle would be
   * the kind of friction drivers rightly complain about.
   */
  function confirmGoOffline() {
    const warning = offlineWarning(queue);
    if (!warning) {
      setOnline(false);
      return;
    }
    Alert.alert('Go offline?', warning, [
      { text: 'Stay online', style: 'cancel' },
      { text: 'Go offline', style: 'destructive', onPress: () => setOnline(false) },
    ]);
  }

  /**
   * One-time pointer to WhatsApp ride alerts.
   *
   * It offers, it does not switch anything on. Consent for a WhatsApp message
   * has to be given knowingly and against the right number — a driver's
   * WhatsApp is very often a different SIM from the one they drive on — so the
   * "Set it up" path goes to the screen that states what will arrive and lets
   * them correct the number, rather than silently enabling alerts to whatever
   * onboarding happened to capture.
   *
   * Shown once ever, and never to a driver who has already opted in.
   */
  async function offerWhatsAppAlerts() {
    if (profile?.whatsappAlerts?.optIn === true) return;
    try {
      if (await AsyncStorage.getItem(WHATSAPP_ASK_KEY)) return;
      await AsyncStorage.setItem(WHATSAPP_ASK_KEY, '1');
    } catch {
      // Storage is unavailable — better to skip the prompt than to risk showing
      // it on every single toggle.
      return;
    }
    Alert.alert(
      'Get rides on WhatsApp?',
      "Once you close the app we can't notify you at all. We can WhatsApp you instead when a ride comes up near you — only while the app is fully closed, a few a day at most, and never between 10pm and 7am.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Set it up', onPress: () => router.push('/driver/whatsapp-alerts') },
      ],
    );
  }

  function openRequest(tripId: string) {
    if (commissionLocked) {
      Alert.alert(
        'Account locked',
        `A day ended short of the target, so ${commission.due.toLocaleString()} PKR of commission is due. Clear it to start taking rides again.`,
      );
      return;
    }
    if (outstanding.blocked) {
      // No "open the wallet" button: the home screen already replaces the
      // request list with the OutstandingFees card whenever this is true, so
      // the way to settle is behind them, not on a screen that is hidden until
      // the wallet economy launches.
      Alert.alert(
        'Cancellation fees due',
        `Pay ${outstanding.amount.toLocaleString()} PKR in cancellation fees to start accepting rides again. Go back to settle.`,
      );
      return;
    }
    router.push(`/driver/request-detail/${tripId}` as Parameters<typeof router.push>[0]);
  }

  /**
   * Dropping a ride the driver already accepted leaves a passenger stranded, so
   * it costs a share of the agreed fare. State the number before charging it.
   */
  function confirmCancelTrip(trip: Trip) {
    const fare = trip.fare ?? trip.offeredFare;
    const fee = Math.round(fare * cancellation.driverFeeRate);
    Alert.alert(
      `Cancel this ride? It costs PKR ${fee}`,
      `You accepted this ride at PKR ${fare} and the passenger is waiting for you. Cancelling now `
        + `charges a ${Math.round(cancellation.driverFeeRate * 100)}% fee — PKR ${fee}.\n\n`
        + 'It comes off your wallet credits first, and anything they cannot cover is owed to Velocity Rides before you can accept rides again.',
      [
        { text: 'Keep the ride', style: 'cancel' },
        {
          text: `Cancel & pay PKR ${fee}`,
          style: 'destructive',
          onPress: () => {
            setCancelling(true);
            run(async () => {
              const res = await api.cancelTrip({ tripId: trip.id });
              if (res.outstanding > 0) {
                Alert.alert(
                  'Ride cancelled',
                  `PKR ${res.outstanding} is now outstanding to Velocity Rides. Settle it to keep accepting rides.`,
                );
              } else if ((res.paidFromCredit ?? 0) > 0) {
                Alert.alert('Ride cancelled', `PKR ${res.fee} was taken from your wallet credits.`);
              } else if (res.fee > 0) {
                Alert.alert('Ride cancelled', `PKR ${res.fee} was charged to your wallet.`);
              }
            }).finally(() => setCancelling(false));
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* ── Wallet ── The very first thing, above Offline/Online: the credits
          given for a mobile holder, and what they do. Hidden mid-trip, like the
          banners below — the trip owns the screen until drop-off. */}
      {!activeTrip && (commission.bonus > 0 || (profile?.commissionCreditEarned ?? 0) > 0 || outstanding.amount > 0) ? (
        <WalletCard
          credits={commission.bonus}
          used={Math.max(0, Math.round(profile?.commissionCreditUsed ?? 0))}
          owed={outstanding.amount}
          onPress={() => router.push('/driver/earnings')}
        />
      ) : null}

      {/* ── Header: menu · online toggle · settings & language ── */}
      <View style={styles.header}>
        <Pressable onPress={() => setDrawerOpen(true)} hitSlop={12} style={styles.headerBtn}>
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill={colors.text} />
          </Svg>
        </Pressable>

        <View style={styles.toggle}>
          <Pressable
            style={[styles.toggleHalf, !online && styles.toggleOffActive]}
            disabled={busy}
            onPress={confirmGoOffline}
          >
            <Text style={[styles.toggleTxt, !online && styles.toggleOffTxt]}>Offline</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleHalf, online && styles.toggleOnActive]}
            disabled={busy}
            onPress={() => setOnline(true)}
          >
            <Text style={[styles.toggleTxt, online && styles.toggleOnTxt]}>Online</Text>
          </Pressable>
        </View>

          <Pressable onPress={() => router.push('/passenger/settings')} hitSlop={8} style={styles.headerBtn}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
                fill={colors.text}
              />
            </Svg>
          </Pressable>
      </View>

      {/* ── Which rides: Corporate & Students (every ride, the corporate ones in
          yellow) or Regular (shared and solo only). Hidden mid-trip. ── */}
      {!activeTrip ? (
        <View style={[styles.toggle, styles.modeToggle]}>
          <Pressable
            style={[styles.toggleHalf, !regularOnly && styles.modeCorporateActive]}
            onPress={() => uid && setDoc(doc(db, 'drivers', uid), { rideMode: 'corporate' }, { merge: true }).catch(() => {})}
            accessibilityRole="radio"
            accessibilityState={{ selected: !regularOnly }}
          >
            <Text style={[styles.modeTxt, !regularOnly && styles.toggleOnTxt]} numberOfLines={1}>Corporate & Students</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleHalf, regularOnly && styles.toggleOnActive]}
            onPress={() => uid && setDoc(doc(db, 'drivers', uid), { rideMode: 'regular' }, { merge: true }).catch(() => {})}
            accessibilityRole="radio"
            accessibilityState={{ selected: regularOnly }}
          >
            <Text style={[styles.modeTxt, regularOnly && styles.toggleOnTxt]} numberOfLines={1}>Regular</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Car not confirmed ── The one thing standing between this driver and
          work, said before they press Online rather than after. Hidden mid-trip:
          they are plainly in the car, and there is nothing useful to do about it
          until they drop off. */}
      {profile && carCheck.needsPhoto && !activeTrip ? (
        <Pressable
          style={styles.carBanner}
          onPress={() => router.push('/driver/car-verification')}
        >
          <Text style={styles.carBannerIcon}>📸</Text>
          <View style={styles.carBannerBody}>
            <Text style={styles.carBannerTitle}>
              {carCheck.reason === 'rejected'
                ? 'Your car photo was not accepted'
                : carCheck.reason === 'car_changed'
                ? 'Confirm the car you switched to'
                : carCheck.reason === 'expired'
                ? 'Time for a fresh photo of your car'
                : 'Confirm your car to start getting requests'}
            </Text>
            <Text style={styles.carBannerBody2}>
              Take a quick photo of {profile?.vehicleLabel ?? 'your car'}
              {profile?.plate ? ` (${profile.plate})` : ''} — it takes a few seconds.
            </Text>
          </View>
          <Text style={styles.carBannerChevron}>›</Text>
        </Pressable>
      ) : null}

      {/* ── Today's face check ── The driver layout already sends them to the
          camera on the first open of the day; this is for the one who came back
          out of it, or whose check did not pass. Hidden mid-trip for the same
          reason as the car banner: they are plainly driving, and there is
          nothing useful to do about it until they drop off. */}
      {profile && faceCheck.blocking && !activeTrip ? (
        <Pressable style={styles.carBanner} onPress={() => router.push('/driver/face-check-in')}>
          <Text style={styles.carBannerIcon}>🙂</Text>
          <View style={styles.carBannerBody}>
            <Text style={styles.carBannerTitle}>
              {faceCheck.reason === 'failed'
                ? 'That face check did not go through'
                : 'Quick face check to start today'}
            </Text>
            <Text style={styles.carBannerBody2}>
              A few seconds on camera so we know it is you driving — then you can go online.
            </Text>
          </View>
          <Text style={styles.carBannerChevron}>›</Text>
        </Pressable>
      ) : null}

      {/* ── Papers running out ── Shown only inside the last 30 days, the same
          days the server pushes its warnings: once a paper lapses the driver is
          stopped until the renewed one is checked. Not a button — there is no
          renewal flow in the app to send them to. */}
      {expiring[0] && !activeTrip ? (
        <View style={styles.carBanner}>
          <Text style={styles.carBannerIcon}>📄</Text>
          <View style={styles.carBannerBody}>
            {expiring.map((doc) => (
              <Text key={doc.key} style={styles.carBannerTitle}>
                Your {doc.label} expires{' '}
                {doc.daysLeft === 0 ? 'today' : doc.daysLeft === 1 ? 'tomorrow' : `in ${doc.daysLeft} days`}
              </Text>
            ))}
            <Text style={styles.carBannerBody2}>
              Renew it before then. Once it lapses you cannot take rides until the new one is checked.
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── Today's target ── Above the body rather than inside one of its five
          branches: the count has to be there whether the driver is offline,
          waiting on the radar, or scrolling a full feed, because it is what
          they are deciding against. Hidden mid-trip (nothing to decide) and
          while a settle screen owns the view. One line, so the requests below
          it start near the top of the screen; the full card is on Earnings.
          Its first phrase is the driver's place in the queue here — that was
          a strip of its own above the feed. */}
      {!activeTrip && !commissionLocked && !outstanding.blocked && (dailyTarget.progress.enabled || queueLine) ? (
        <View style={styles.targetWrap}>
          <DailyTargetTicker
            lead={queueLine}
            progress={dailyTarget.progress}
            bonusBalance={commission.bonus}
            // The whole day's cash: rides the bonus already paid for are no
            // longer in the cycle, but reaching the target refunds them too.
            todayCashFare={Math.max(commission.todayCashFare, dailyTarget.day.cashFare)}
            rate={commission.rate}
            onPress={() => router.push('/driver/earnings')}
          />
        </View>
      ) : null}

      {/* ── Body ── */}
      {activeTrip ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {commissionLocked && (
            <View style={styles.lockBanner}>
              <Text style={styles.lockTitle}>🔒 Commission due — {commission.due.toLocaleString()} PKR</Text>
              <Text style={styles.lockBody}>
                Finish your current trip, then clear this with Velocity Rides to start taking
                rides again.
              </Text>
            </View>
          )}

          <View style={styles.tripCard}>
            <Text style={styles.tripTitle}>Current trip · {RIDE_TYPE_LABELS[activeTrip.rideType]}</Text>
            {tripStatus === 'arrived' && (
              <ArrivalCountdown arrivedAt={arrivedAt} role="driver" />
            )}
            <MapPlaceholder
              pickup={activeTrip.pickup?.address}
              dropoff={activeTrip.dropoff?.address}
              tracking={activeTrip.status === 'in_progress' || activeTrip.status === 'arriving'}
              pickupCoord={activeTrip.pickup}
              dropoffCoord={activeTrip.dropoff}
            />
            {/* Turn-by-turn is Google Maps' job, in Google Maps — the app opens
                it rather than paying for routes of its own. `google.navigation:`
                opens straight into navigation; the geo: URL is the fallback any
                map app can answer. Big and right under the map, because it is
                the first thing a driver needs after accepting and after boarding. */}
            {navTarget ? (
              <Pressable
                style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.85 }]}
                onPress={() => goToCustomer(activeTrip, navTarget)}
                accessibilityRole="button"
              >
                <Text style={styles.navBtnText}>
                  {activeTrip.status === 'in_progress' ? "🏁 CUSTOMER DROP LOCATION" : "📍 GO TO CUSTOMER'S LOCATION"}
                </Text>
                <Text style={styles.navBtnSub} numberOfLines={1}>
                  Opens Google Maps · {navTarget.address ?? 'pinned on the map'}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.fareRow}>
              {/* On a shared ride the locked fare is what ONE seat was priced
                  at, not what the drive is worth — the manifest below adds up
                  what is actually being collected. */}
              <Text style={styles.tripFare}>
                {activeTrip.pool === true
                  ? `Shared ride · PKR ${activeTrip.poolPerSeatFare ?? activeTrip.fare} per seat`
                  : `Fare: ${activeTrip.fare} PKR`}
              </Text>
              {pickupAwayM != null && activeTrip.status !== 'in_progress' ? (
                <Text style={styles.awayPill}>
                  Passenger {formatDistance(pickupAwayM)} away
                </Text>
              ) : null}
            </View>

            {/* The one next step, right under the map: Arrived → Start ride →
                End ride. A shared car starts and ends each passenger on their
                own, so from the pickup on that is DropOffPanel's list. */}
            {activeTrip.status === 'in_progress' || (activeTrip.pool === true && activeTrip.status === 'arrived') ? (
              <DropOffPanel
                tripId={activeTrip.id}
                tripStatus={activeTrip.status}
                fallbackFare={activeTrip.fare ?? activeTrip.offeredFare}
                isPool={activeTrip.pool === true}
                paymentMethod={(activeTrip.paymentMethod ?? 'cash') as 'cash' | 'wallet'}
                driverCoords={driverCoords}
                onCompleted={() => { /* the trip subscription clears the card */ }}
                canStart={canStartRide}
                onStartTrip={() => run(() => startTrip(activeTrip.id))}
                refreshKey={activeTrip.poolMembers?.length ?? 1}
                busy={busy}
                setBusy={setBusy}
              />
            ) : activeTrip.sharedPoolId && !activeTrip.poolStartedAt ? (
              // A shared car starts when its driver sets off to collect everyone
              // (or by itself, sharedPools AUTO_START_MS); its riders then confirm.
              <>
                <PrimaryButton
                  label="START PICKUPS"
                  disabled={busy}
                  onPress={() => run(() => api.startSharedRide({ tripId: activeTrip.id }))}
                />
                <Text style={styles.cancelFeeNote}>
                  Each passenger is asked to confirm, and their stop appears below as they do. If you
                  have not started, it starts by itself 10 minutes after the car went out.
                </Text>
              </>
            ) : awaitingArrival ? (
              // Arrived is shown already; Start waits for the server to agree.
              <PrimaryButton label="START RIDE" loading onPress={() => {}} />
            ) : (() => {
              const next = NEXT_ACTION[activeTrip.status];
              if (!next) return null;
              return (
                <PrimaryButton
                  label={next.label}
                  disabled={busy}
                  onPress={() =>
                    next.to === 'in_progress'
                      ? run(() => startTrip(activeTrip.id))
                      : void markArrived(activeTrip)
                  }
                />
              );
            })()}

            <View style={styles.contactRow}>
              {/* A free in-app call; the number is only the fallback if it cannot connect. */}
              <Pressable
                style={styles.contactBtn}
                onPress={() =>
                  callInApp({
                    rideKind: 'trip',
                    rideId: activeTrip.id,
                    calleeId: activeTrip.passengerId,
                    phone: activeTrip.passengerPhone,
                  })
                }
              >
                <Text style={styles.contactBtnText}>📞 Call passenger</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.contactBtn,
                  { backgroundColor: `${colors.primary}18` },
                  unreadChat > 0 && styles.contactBtnUnread,
                ]}
                onPress={() => { markChatRead(); setChatOpen(true); }}
              >
                <Text style={styles.contactBtnText}>
                  💬 {unreadChat > 0 ? `Message (${unreadChat > 9 ? '9+' : unreadChat})` : 'Message'}
                </Text>
              </Pressable>
            </View>
            {/* A driver is as likely to be the one in trouble as the passenger —
                an abusive rider, a threat, an accident — and until now the only
                safety route they had was the drawer, three taps away on a
                screen they are not looking at. Police 15 and Rescue 1122 are
                behind this, with the trip attached so the desk knows which
                ride it is. */}
            <Pressable
              style={styles.safetyBtn}
              onPress={() => router.push(`/safety?tripId=${activeTrip.id}`)}
            >
              <Text style={styles.safetyBtnText}>
                🛡️ Safety Centre — call police 15, report a problem
              </Text>
            </Pressable>
            {/* Who the driver is actually picking up. Before this the card said
                "passenger" in the singular however many people were in the
                pool, so a driver could not tell how many to wait for, who they
                were, or what each of them owed. Once the ride is running the
                drop-off panel takes over the same job. */}
            {activeTrip.pool === true && activeTrip.status !== 'in_progress' ? (
              <DriverPoolManifest
                tripId={activeTrip.id}
                paymentMethod={(activeTrip.paymentMethod ?? 'cash') as 'cash' | 'wallet'}
                seatsFree={Math.max(
                  0,
                  (activeTrip.maxPoolRiders ?? 4) - (activeTrip.poolMembers?.length ?? 1),
                )}
                // Re-read as riders join, leave or confirm they are coming.
                refreshKey={`${activeTrip.poolMembers?.length ?? 1}|${
                  Object.values(activeTrip.poolConfirm ?? {}).filter((c) => c === 'confirmed').length
                }`}
                // At the pickup the start list above already names everyone.
                requestsOnly={activeTrip.status === 'arrived'}
              />
            ) : null}

            {/* The dash cam, live — below the map and the drop-off list, so the
                driver still sees where everybody is going and scrolls down to
                see the camera. Mounted for the whole ride; see src/ui/DashCam. */}
            {activeTrip.status === 'in_progress' && uid && Platform.OS !== 'web' ? (
              <DashCam tripId={activeTrip.id} uid={uid} />
            ) : null}
            {/* Riders on the way. Only on a cash pool with a seat still free —
                a solo booker never shares their car, and a wallet trip holds only
                the host's fare so there is no money to pay for an extra rider.
                Shown during the ride as well: picking up somebody standing on
                the road ahead is the whole point of the feature, and the backend
                refuses anyone the car has already driven past. */}
            {activeTrip.pool === true
              && (activeTrip.paymentMethod ?? 'cash') === 'cash'
              && (activeTrip.poolMembers?.length ?? 1) < (activeTrip.maxPoolRiders ?? 4) && (
              <Pressable
                style={styles.enRouteCta}
                onPress={() => router.push('/driver/en-route')}
              >
                <Text style={styles.enRouteCtaTitle}>🔀 Pick up riders on your way</Text>
                <Text style={styles.enRouteCtaBody}>
                  {(activeTrip.maxPoolRiders ?? 4) - (activeTrip.poolMembers?.length ?? 1)} seat
                  {(activeTrip.maxPoolRiders ?? 4) - (activeTrip.poolMembers?.length ?? 1) === 1 ? '' : 's'} free ·
                  {' '}earn more without leaving your route
                </Text>
              </Pressable>
            )}

            {/* Opens the Safety Centre's SOS sheet with this ride attached:
                police 15, the driver's own WhatsApp to their emergency
                contacts, and our desk alerted in the background. A driver
                alone on an intercity road at 3am needs the first two far more
                than they need us. */}
            <PrimaryButton
              variant="danger"
              label="🆘 SOS"
              disabled={busy}
              onPress={() => router.push(`/safety?tripId=${activeTrip.id}&sos=1`)}
            />

            {/* Backing out of an accepted ride — costs a fee, so it sits below
                the SOS button and never reads as a routine action. Once the trip
                is in progress it can't be cancelled at all. */}
            {activeTrip.status !== 'in_progress' && (
              <>
                <PrimaryButton
                  variant="secondary"
                  label="Cancel ride"
                  loading={cancelling}
                  disabled={busy}
                  onPress={() => confirmCancelTrip(activeTrip)}
                />
                <Text style={styles.cancelFeeNote}>
                  The passenger is waiting. Cancelling costs a{' '}
                  {Math.round(cancellation.driverFeeRate * 100)}% fee — PKR{' '}
                  {Math.round((activeTrip.fare ?? activeTrip.offeredFare) * cancellation.driverFeeRate)}
                  {' '}— taken from your wallet credits first. Anything they cannot cover is added to
                  what you owe Velocity Rides, which has to be cleared before you can accept rides again.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      ) : commissionLocked ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* CommissionLock carries the whole settle flow — Velocity's accounts,
              the screenshot upload and the AI verdict — so there is nothing on
              the wallet screen a locked driver needs. The button that used to
              send them there is gone with the rest of the wallet UI. */}
          <CommissionLock status={commission} uid={uid} requests={visible} />
        </ScrollView>
      ) : outstanding.blocked ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <OutstandingFees status={outstanding} uid={uid} role="driver" />
        </ScrollView>
      ) : !online ? (
        <View style={styles.flex}>
          <RadarScan
            scanning={false}
            title="You're offline"
            subtitle="Go online to start receiving ride requests from passengers near you."
          />
        </View>
      ) : (
        // Every ride in one list: the rider-booked rides (solo and shared, one
        // feed on the server) as rows, the passenger-posted shared-ride pools in
        // the header. Each is boxed by kind — blue shared, pink solo.
        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            data={scanning ? [] : shown}
            keyExtractor={(r) => r.tripId}
            contentContainerStyle={{ paddingBottom: DRIVER_TAB_BAR_HEIGHT }}
            ListEmptyComponent={
              <RadarScan
                scanning
                title="Searching for orders nearby..."
                subtitle={
                  scanning
                    ? undefined
                    : 'No open requests around you right now. Stay online — new ones appear here automatically.'
                }
              />
            }
            ListHeaderComponent={
              <>
                {/* Not carrying anyone, but going somewhere anyway. The screen
                    behind it opens on where passengers around here travel —
                    their pickup and drop-off areas — and then finds riders
                    standing on the driver's own route. (Where this driver is in
                    the queue moved into the ticker above.) */}
                <Pressable style={styles.routeCta} onPress={() => router.push('/driver/en-route')}>
                  <Text style={styles.routeCtaTitle}>📍 Heading somewhere? See where passengers are</Text>
                  <Text style={styles.routeCtaBody}>
                    Tap to see which areas have the most passengers, and pick up riders on your way.
                  </Text>
                </Pressable>
                {/* Shared-ride pools passengers posted themselves — a separate
                    queue on the server, shown here so no ride lives behind a
                    tab the driver never opens. Renders nothing when quiet. */}
                {/* Corporate & Students: the shared rides booked near here, with
                    how many people are going on each. */}
                {!regularOnly ? <SharedRidesStrip coords={driverCoords} /> : null}
                {uid ? <SharingRidesFeed uid={uid} coords={driverCoords} /> : null}
                {poolRides.length > 0 ? <PoolRoutesHeader rides={poolRides} /> : null}
              </>
            }
            renderItem={({ item }) => (
              <RequestCard
                request={item}
                expanded={expandedId === item.tripId}
                locked={commissionLocked}
                onToggleActions={() =>
                  setExpandedId((cur) => (cur === item.tripId ? null : item.tripId))
                }
                onOpen={() => openRequest(item.tripId)}
                onComplain={() => {
                  setExpandedId(null);
                  setReportError(null);
                  setReportTripId(item.tripId);
                }}
                onHide={() => {
                  setExpandedId(null);
                  hideRequest(item.tripId);
                }}
                onChooseOnMap={() => {
                  setExpandedId(null);
                  openRequest(item.tripId);
                }}
              />
            )}
          />
          {pendingCount > 0 && <NewRequestsPill count={pendingCount} onPress={showNewRequests} floating />}
        </View>
      )}

      <DriverTabBar active="requests" />

      <RatingModal
        visible={ratingTrip !== null}
        targetLabel="Rate your passenger"
        targetName="Passenger"
        onSubmit={handleRate}
        onSkip={() => setRatingTrip(null)}
      />

      <ReportRequestModal
        visible={reportTripId !== null}
        submitting={reporting}
        error={reportError}
        onClose={() => { setReportTripId(null); setReportError(null); }}
        onSubmit={submitReport}
      />

      {activeTrip && (
        <ChatModal
          visible={chatOpen}
          roomId={activeTrip.id}
          myUid={user?.uid ?? ''}
          myName={user?.displayName ?? 'Driver'}
          otherName="Passenger"
          onClose={() => { markChatRead(); setChatOpen(false); }}
        />
      )}

      <DriverDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        driverName={profile?.fullName ?? user?.displayName ?? ''}
        driverEmail={user?.email ?? ''}
        online={online}
        tripsCount={profile?.tripsCount ?? 0}
        rating={profile?.rating ?? 5}
        onSignOut={signOut}
      />

    </SafeAreaView>
  );
}

/** Floating "new requests arrived" pill — the feed only reflows when tapped. */
function NewRequestsPill({
  count,
  onPress,
  floating,
}: {
  count: number;
  onPress: () => void;
  floating: boolean;
}) {
  return (
    <View style={[styles.pillWrap, floating && styles.pillFloating]} pointerEvents="box-none">
      <Pressable style={styles.pill} onPress={onPress}>
        <Text style={styles.pillTxt}>
          ↑  Show new request{count === 1 ? '' : 's'}
          {count > 1 ? `  (${count})` : ''}
        </Text>
      </Pressable>
    </View>
  );
}

/** The driver's own posted pool routes, above the incoming feed. */
function PoolRoutesHeader({ rides }: { rides: ReturnType<typeof useDriverPoolRides> }) {
  const router = useRouter();
  return (
    <View style={styles.poolHeader}>
      <Text style={styles.poolHeaderTitle}>Your pool routes</Text>
      {rides.map((pr) => (
        <View key={pr.id} style={{ gap: 8 }}>
          <Pressable style={styles.poolRideCard} onPress={() => router.push(`/driver/pool-pickup/${pr.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.poolRideRoute} numberOfLines={1}>
                {pr.pickup?.address ?? 'Pickup'} → {pr.dropoff?.address ?? 'Dropoff'}
              </Text>
              <Text style={styles.poolRideMeta}>
                {pr.takenSeats}/{pr.maxSeats} seats · {pr.perSeatFare} PKR/seat
              </Text>
            </View>
            <View style={styles.poolRideStatusBadge}>
              <Text style={styles.poolRideStatusText}>
                {pr.status === 'open' ? '🟡 Open'
                  : pr.status === 'collecting' ? '🟢 Collecting'
                  : pr.status === 'full' ? '🔵 Full'
                  : pr.status === 'boarding' ? '🚗 Boarding'
                  : pr.status === 'in_progress' ? '🏁 En route'
                  : pr.status}
              </Text>
            </View>
          </Pressable>
          {['open', 'collecting'].includes(pr.status) && <PoolBatchRequests rideId={pr.id} />}
        </View>
      ))}
    </View>
  );
}

/**
 * Queued join requests on a mixed (1M+1F) pool ride. A batch only becomes
 * visible once TWO riders of the same gender are waiting — single requests
 * are hidden from the driver by design, so the back row never has to mix a
 * female with an unrelated male.
 */
function PoolBatchRequests({ rideId }: { rideId: string }) {
  const [counts, setCounts] = useState<{ gender: 'male' | 'female'; count: number }[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'poolRides', rideId, 'joinRequests'), where('status', '==', 'queued'));
    return onSnapshot(
      q,
      (snap) => {
        const tally: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const g = (d.get('userGender') as string) ?? 'unspecified';
          tally[g] = (tally[g] ?? 0) + 1;
        });
        setCounts(
          (['male', 'female'] as const)
            .filter((g) => (tally[g] ?? 0) > 0)
            .map((g) => ({ gender: g, count: tally[g]! })),
        );
      },
      () => setCounts([]),
    );
  }, [rideId]);

  // The rule: 1 waiting rider → invisible. 2+ of the same gender → show batch.
  const batches = counts.filter((c) => c.count >= 2);
  if (batches.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      {batches.map((b) => (
        <View key={b.gender} style={styles.batchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.batchTitle}>
              {b.gender === 'female' ? '♀' : '♂'} {b.count} {b.gender} riders waiting to join
            </Text>
            <Text style={styles.batchSub}>Accepted as a pair — back row stays same-gender</Text>
          </View>
          <Pressable
            style={[styles.batchBtn, accepting !== null && { opacity: 0.6 }]}
            disabled={accepting !== null}
            onPress={async () => {
              setAccepting(b.gender);
              try {
                await api.driverAcceptPoolBatch({ rideId, gender: b.gender });
              } catch (e) {
                Alert.alert('Could not accept', e instanceof Error ? e.message : 'Please try again.');
              } finally {
                setAccepting(null);
              }
            }}
          >
            <Text style={styles.batchBtnTxt}>{accepting === b.gender ? 'Accepting…' : 'Accept Pair'}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: 18, gap: 14, paddingBottom: DRIVER_TAB_BAR_HEIGHT + 18 },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  headerBtn: { padding: 4 },
  toggle: {
    flex: 1,
    maxWidth: 260,
    flexDirection: 'row',
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassStrong,
    padding: 3,
  },
  toggleHalf: { flex: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  toggleOffActive: { backgroundColor: '#ff8a8a' },
  toggleOnActive: { backgroundColor: colors.primary },
  toggleTxt: { fontSize: 15, fontWeight: '600', color: colors.muted },
  toggleOffTxt: { color: '#1a1a1a', fontWeight: '700' },
  toggleOnTxt: { color: '#1a1a1a', fontWeight: '700' },
  modeToggle: { flex: 0, alignSelf: 'center', width: 300, maxWidth: 300, height: 38, marginBottom: 6 },
  modeCorporateActive: { backgroundColor: '#facc15' },
  modeTxt: { fontSize: 13, fontWeight: '600', color: colors.muted },

  // ── Solo | Sharing rides selector ──
  // Amber, not red: nothing is broken and nothing is lost — there is simply one
  // short thing to do before requests can arrive.
  carBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  carBannerIcon: { fontSize: 20 },
  carBannerBody: { flex: 1, gap: 2 },
  carBannerTitle: { fontSize: 14, fontWeight: '800', color: '#f59e0b' },
  carBannerBody2: { fontSize: 12, lineHeight: 17, color: colors.muted },
  carBannerChevron: { fontSize: 22, color: '#f59e0b', fontWeight: '700' },

  targetWrap: { paddingHorizontal: 16, paddingBottom: 2 },

  // ── "Show new requests" pill ──
  pillWrap: { alignItems: 'center', paddingVertical: 10 },
  pillFloating: { position: 'absolute', top: 8, left: 0, right: 0, paddingVertical: 0 },
  pill: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 13,
    // Lifts the pill off the list rows behind it.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  pillTxt: { fontSize: 15, fontWeight: '700', color: '#111' },

  // ── Active trip ──
  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  enRouteCta: {
    backgroundColor: `${colors.primary}14`,
    borderWidth: 1,
    borderColor: `${colors.primary}55`,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  enRouteCtaTitle: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  enRouteCtaBody: { color: colors.muted, fontSize: 12, marginTop: 3 },
  routeCta: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    margin: 16,
    marginBottom: 4,
  },
  routeCtaTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  routeCtaBody: { color: colors.muted, fontSize: 12, marginTop: 3 },
  tripTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 8 },
  tripFare: { fontSize: 18, fontWeight: '900', color: colors.primary, marginVertical: 8 },
  cancelFeeNote: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 2,
  },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  awayPill: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.primary,
    backgroundColor: `${colors.primary}18`,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  contactRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  navBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    minHeight: 68,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  navBtnText: { fontSize: 18, fontWeight: '900', color: '#0b0d0c', letterSpacing: 0.3 },
  navBtnSub: { fontSize: 11.5, fontWeight: '700', color: '#0b0d0cb0' },
  contactBtnUnread: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  safetyBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  safetyBtnText: { fontSize: 12.5, fontWeight: '800', color: colors.text },
  contactBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },

  lockBanner: {
    backgroundColor: '#2a0a0a',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.danger,
    padding: 16,
    gap: 8,
    alignItems: 'center',
  },
  lockTitle: { fontSize: 16, fontWeight: '900', color: colors.danger, textAlign: 'center' },
  lockBody: { fontSize: 13, color: '#ffaaaa', textAlign: 'center', lineHeight: 20 },

  // ── Pool routes header ──
  poolHeader: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  poolHeaderTitle: { fontSize: 13, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  poolRideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
  },
  poolRideRoute: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 3 },
  poolRideMeta: { fontSize: 11, color: colors.muted },
  poolRideStatusBadge: { backgroundColor: colors.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  poolRideStatusText: { fontSize: 11, fontWeight: '700', color: colors.text },

  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.glassLime,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: `${colors.primary}50`,
    padding: 12,
  },
  batchTitle: { fontSize: 13, fontWeight: '800', color: colors.primary },
  batchSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  batchBtn: {
    height: 40,
    paddingHorizontal: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchBtnTxt: { fontSize: 12, fontWeight: '900', color: '#000' },
}));
