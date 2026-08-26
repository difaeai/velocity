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
  useDriverActiveTrip,
  useDriverPoolRides,
  useDriverProfile,
  useOpenRequests,
  useOutstanding,
  type OpenRequest,
} from '../../src/hooks/driver';
import { CommissionLock } from '../../src/ui/CommissionLock';
import { DriverVoiceButton } from '../../src/ui/DriverVoiceButton';
import { OutstandingFees } from '../../src/ui/OutstandingFees';
import type { DriverCommand } from '../../src/voice/commands';
import { colors } from '../../src/config';
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
import { DropOffPanel } from '../../src/ui/DropOffPanel';
import { DriverPoolManifest } from '../../src/ui/DriverPoolManifest';
import { SharingRidesFeed } from '../../src/ui/SharingRidesFeed';
import { distanceMeters, formatDistance } from '../../src/lib/geo';
import { RIDE_TYPE_LABELS, type Trip, type TripStatus } from '../../src/domain/types';

const NEXT_ACTION: Partial<Record<TripStatus, { label: string; to?: 'arriving' | 'arrived' | 'in_progress' }>> = {
  matched: { label: 'Head to pickup', to: 'arriving' },
  arriving: { label: 'Arrived at pickup', to: 'arrived' },
  arrived: { label: 'Start trip', to: 'in_progress' },
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

/** Which feed the driver last worked: solo requests or shared-ride pools. */
const RIDE_MODE_KEY = 'driver_ride_mode';

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
  const liveRequests = useOpenRequests(online && !activeTrip, driverCoords?.lat, driverCoords?.lng);
  const commission = useCommissionStatus(profile);
  const commissionLocked = commission.locked;
  // Unpaid cancellation fees — past the limit, the backend rejects new bids.
  const outstanding = useOutstanding(uid);
  const cancellation = useCancellationSettings();

  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Solo | Sharing rides — which feed the body shows while online. Solo is the
  // classic open-requests list; Sharing lays out nearby pools box by box with
  // every rider's name and fare so the driver can pick a pool on its numbers.
  const [rideMode, setRideMode] = useState<'solo' | 'sharing'>('solo');
  useEffect(() => {
    AsyncStorage.getItem(RIDE_MODE_KEY).then((v) => {
      if (v === 'sharing' || v === 'solo') setRideMode(v);
    }).catch(() => {});
  }, []);
  const switchRideMode = useCallback((m: 'solo' | 'sharing') => {
    setRideMode(m);
    AsyncStorage.setItem(RIDE_MODE_KEY, m).catch(() => {});
  }, []);
  // A push only reaches a backgrounded app. With the trip screen open —
  // which is exactly where a driver sits while the passenger is writing —
  // Android shows nothing, so the button has to carry the news itself.
  const { unread: unreadChat, markRead: markChatRead } = useUnreadChat(activeTrip?.id, uid);

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

  const visible = useMemo(
    () => liveRequests.filter((r) => !hiddenIds.has(r.tripId)),
    [liveRequests, hiddenIds],
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

  // ── Voice commands ────────────────────────────────────────────────────────

  /**
   * Run a spoken driver command against this screen's current state.
   *
   * Returns false when the command is understood but doesn't apply right now —
   * "accept" with an empty feed, "online" when already online — so the driver
   * hears why nothing happened instead of wondering whether the app heard them.
   *
   * Deliberately narrow. Everything here maps to a control already on this
   * screen; nothing touches money, and a locked account still routes through
   * openRequest()'s existing checks rather than bypassing them.
   */
  const handleVoiceCommand = useCallback(
    (command: DriverCommand): boolean => {
      switch (command) {
        case 'goOnline':
          if (online) return false;
          setOnline(true);
          return true;

        case 'goOffline':
          if (!online) return false;
          setOnline(false);
          return true;

        case 'nextRequest':
          if (!pendingCount) return false;
          showNewRequests();
          return true;

        case 'acceptRide': {
          // Opens the top request's detail screen — where the existing accept
          // flow, fare and passenger details live. Voice never books a job
          // sight-unseen.
          const top = shown[0];
          if (!top || activeTrip) return false;
          openRequest(top.tripId);
          return true;
        }

        case 'declineRide': {
          const top = shown[0];
          if (!top) return false;
          setShown((current) => current.filter((r) => r.tripId !== top.tripId));
          return true;
        }

        case 'readRequest': {
          const top = shown[0];
          if (!top) return false;
          setExpandedId(top.tripId);
          return true;
        }

        case 'endRoute':
          router.push('/driver/en-route');
          return true;

        // Both need a trip in progress, which lives on the trip screen rather
        // than this feed.
        case 'navigate':
        case 'callPassenger':
          if (!activeTrip) return false;
          router.push(`/driver/trip/${activeTrip.id}`);
          return true;

        default:
          return false;
      }
    },
    // commissionLocked and outstanding are here because openRequest() closes
    // over them for its lock checks. Without them this callback could keep an
    // openRequest() captured before the account was locked, and a spoken
    // "accept" would walk straight past a lock the buttons still enforce.
    [
      online,
      pendingCount,
      shown,
      activeTrip,
      showNewRequests,
      router,
      commissionLocked,
      outstanding,
    ],
  );

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

  // Location powers the geohash proximity filter, the distance shown on each
  // request, and the passenger-facing live driver marker.
  useEffect(() => {
    let watchId: ReturnType<typeof setInterval> | undefined;
    if (online) {
      const publish = (lat: number, lng: number) => {
        setDriverCoords({ lat, lng });
        if (uid) {
          setDoc(doc(db, 'drivers', uid), {
            lastLocation: { lat, lng },
            lastSeenAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
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
      "You're offline now, so we can't notify you in the app. We can WhatsApp you instead when a ride comes up near you — a few a day at most, never between 10pm and 7am.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Set it up', onPress: () => router.push('/driver/whatsapp-alerts') },
      ],
    );
  }

  function openRequest(tripId: string) {
    if (commissionLocked) {
      Alert.alert('Account locked', `Settle ${commission.due.toLocaleString()} PKR commission to accept rides.`);
      return;
    }
    if (outstanding.blocked) {
      Alert.alert(
        'Cancellation fees due',
        `Pay ${outstanding.amount.toLocaleString()} PKR in cancellation fees to start accepting rides again. Open your wallet to settle.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open wallet', onPress: () => router.push('/driver/wallet') },
        ],
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
        + 'It comes out of your wallet balance, and anything left over is owed to Velocity before you can accept rides again.',
      [
        { text: 'Keep the ride', style: 'cancel' },
        {
          text: `Cancel & pay PKR ${fee}`,
          style: 'destructive',
          onPress: () => run(async () => {
            const res = await api.cancelTrip({ tripId: trip.id });
            if (res.outstanding > 0) {
              Alert.alert(
                'Ride cancelled',
                `PKR ${res.outstanding} is now outstanding to Velocity. Settle it from your wallet to keep accepting rides.`,
              );
            } else if (res.fee > 0) {
              Alert.alert('Ride cancelled', `PKR ${res.fee} was charged to your wallet.`);
            }
          }),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* ── Header: menu · online toggle · settings ── */}
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
            onPress={() => setOnline(false)}
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

        <Pressable onPress={() => router.push('/passenger/settings')} hitSlop={12} style={styles.headerBtn}>
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
              fill={colors.text}
            />
          </Svg>
        </Pressable>
      </View>

      {/* ── Solo | Sharing rides ── right below Offline/Online: which kind of
          work this driver wants. Solo keeps the classic feed; Sharing shows
          whole pools (names, fares, totals) to accept or reject. */}
      <View style={styles.modeRow}>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeHalf, rideMode === 'solo' && styles.modeActive]}
            onPress={() => switchRideMode('solo')}
          >
            <Text style={[styles.modeTxt, rideMode === 'solo' && styles.modeTxtActive]}>Solo</Text>
          </Pressable>
          <Pressable
            style={[styles.modeHalf, rideMode === 'sharing' && styles.modeActive]}
            onPress={() => switchRideMode('sharing')}
          >
            <Text style={[styles.modeTxt, rideMode === 'sharing' && styles.modeTxtActive]}>Sharing rides</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Body ── */}
      {activeTrip ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {commissionLocked && (
            <View style={styles.lockBanner}>
              <Text style={styles.lockTitle}>🔒 Commission due — {commission.due.toLocaleString()} PKR</Text>
              <Text style={styles.lockBody}>
                Finish your current trip, then settle with Velocity to keep receiving rides.
              </Text>
            </View>
          )}

          <View style={styles.tripCard}>
            <Text style={styles.tripTitle}>Current trip · {RIDE_TYPE_LABELS[activeTrip.rideType]}</Text>
            {activeTrip.status === 'arrived' && (
              <ArrivalCountdown arrivedAt={activeTrip.arrivedAt} role="driver" />
            )}
            <MapPlaceholder
              pickup={activeTrip.pickup?.address}
              dropoff={activeTrip.dropoff?.address}
              tracking={activeTrip.status === 'in_progress' || activeTrip.status === 'arriving'}
              pickupCoord={activeTrip.pickup}
              dropoffCoord={activeTrip.dropoff}
            />
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
            {/* Turn-by-turn is a solved problem and this app should not pretend
                otherwise — the in-app map shows WHERE the pickup is; getting
                there is Google Maps' job. `google.navigation:` opens directly in
                navigation mode; the geo: URL is the fallback any map app can
                answer, so a driver without Google Maps still gets somewhere. */}
            {navTarget ? (
              <Pressable style={styles.navBtn} onPress={() => openNavigation(navTarget)}>
                <Text style={styles.navBtnText}>
                  🧭 {activeTrip.status === 'in_progress' ? 'Navigate to drop-off' : 'Navigate to pickup'}
                </Text>
                <Text style={styles.navBtnSub} numberOfLines={1}>{navTarget.address}</Text>
              </Pressable>
            ) : null}

            <View style={styles.contactRow}>
              {activeTrip.passengerPhone ? (
                <Pressable
                  style={styles.contactBtn}
                  onPress={() => Linking.openURL(`tel:${activeTrip.passengerPhone}`)}
                >
                  <Text style={styles.contactBtnText}>📞 Call passenger</Text>
                </Pressable>
              ) : null}
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
                refreshKey={activeTrip.poolMembers?.length ?? 1}
              />
            ) : null}

            {activeTrip.status === 'in_progress' ? (
              <DropOffPanel
                tripId={activeTrip.id}
                fallbackFare={activeTrip.fare ?? activeTrip.offeredFare}
                isPool={activeTrip.pool === true}
                paymentMethod={(activeTrip.paymentMethod ?? 'cash') as 'cash' | 'wallet'}
                driverCoords={driverCoords}
                onCompleted={() => { /* the trip subscription clears the card */ }}
                busy={busy}
                setBusy={setBusy}
              />
            ) : (() => {
              const next = NEXT_ACTION[activeTrip.status];
              if (!next?.to) return null;
              return (
                <PrimaryButton
                  label={next.label}
                  disabled={busy}
                  onPress={() => run(() => api.updateTripStatus({ tripId: activeTrip.id, to: next.to! }))}
                />
              );
            })()}
            {/* Riders on the way. Only on a cash pool with a seat still free —
                a solo booker never shares their car, and a wallet trip holds only
                the host's fare so there is no money to pay for an extra rider. */}
            {activeTrip.pool === true
              && (activeTrip.paymentMethod ?? 'cash') === 'cash'
              && (activeTrip.poolMembers?.length ?? 1) < (activeTrip.maxPoolRiders ?? 4)
              && activeTrip.status !== 'in_progress' && (
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

            <PrimaryButton
              variant="danger"
              label="🆘 SOS"
              disabled={busy}
              onPress={() => run(() => api.raiseSafetyEvent({ tripId: activeTrip.id, kind: 'sos' }))}
            />

            {/* Backing out of an accepted ride — costs a fee, so it sits below
                the SOS button and never reads as a routine action. Once the trip
                is in progress it can't be cancelled at all. */}
            {activeTrip.status !== 'in_progress' && (
              <>
                <PrimaryButton
                  variant="secondary"
                  label="Cancel ride"
                  disabled={busy}
                  onPress={() => confirmCancelTrip(activeTrip)}
                />
                <Text style={styles.cancelFeeNote}>
                  The passenger is waiting. Cancelling costs a{' '}
                  {Math.round(cancellation.driverFeeRate * 100)}% fee — PKR{' '}
                  {Math.round((activeTrip.fare ?? activeTrip.offeredFare) * cancellation.driverFeeRate)}
                  {' '}— and anything your wallet cannot cover is added to what you owe Velocity,
                  which has to be cleared before you can accept rides again.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      ) : commissionLocked ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <CommissionLock status={commission} uid={uid} requests={visible} />
          <PrimaryButton
            variant="secondary"
            label="💳 Open wallet"
            onPress={() => router.push('/driver/wallet')}
          />
        </ScrollView>
      ) : outstanding.blocked ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <OutstandingFees status={outstanding} uid={uid} role="driver" />
          <PrimaryButton
            variant="secondary"
            label="💳 Open wallet"
            onPress={() => router.push('/driver/wallet')}
          />
        </ScrollView>
      ) : !online ? (
        <View style={styles.flex}>
          <RadarScan
            scanning={false}
            title="You're offline"
            subtitle="Go online to start receiving ride requests from passengers near you."
          />
        </View>
      ) : rideMode === 'sharing' && uid ? (
        <View style={styles.flex}>
          <SharingRidesFeed uid={uid} coords={driverCoords} />
        </View>
      ) : scanning || shown.length === 0 ? (
        <View style={styles.flex}>
          <RadarScan
            scanning
            title="Searching for orders nearby..."
            subtitle={
              scanning
                ? undefined
                : 'No open requests around you right now. Stay online — new ones appear here automatically.'
            }
          />
          {/* A request landing during the sweep is still announced. */}
          {!scanning && pendingCount > 0 && (
            <NewRequestsPill count={pendingCount} onPress={showNewRequests} floating={false} />
          )}
        </View>
      ) : (
        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            data={shown}
            keyExtractor={(r) => r.tripId}
            contentContainerStyle={{ paddingBottom: DRIVER_TAB_BAR_HEIGHT }}
            ListHeaderComponent={
              <>
                {/* Not carrying anyone, but going somewhere anyway. Say where, and
                    pool riders standing on that road show up here. */}
                <Pressable style={styles.routeCta} onPress={() => router.push('/driver/en-route')}>
                  <Text style={styles.routeCtaTitle}>🏠 Heading somewhere? Earn on the way</Text>
                  <Text style={styles.routeCtaBody}>
                    Set your route and we'll show you pool riders standing on it.
                  </Text>
                </Pressable>
                {/* This feed is solo + pool trips mixed together. Passengers who
                    asked for a shared ride and named their own fare live in a
                    separate queue — surfaced here because a driver who never
                    opens the drawer would otherwise never find that work. */}
                <Pressable style={styles.poolCta} onPress={() => switchRideMode('sharing')}>
                  <Text style={styles.routeCtaTitle}>👥 Sharing rides</Text>
                  <Text style={styles.routeCtaBody}>
                    See whole pools — every rider's name and fare. Their fare is fixed: accept or reject.
                  </Text>
                </Pressable>
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

      {/* Hands-free control for a driver who is already moving. Deliberately
          limited to the actions on this screen — nothing here can touch the
          wallet, commission, or cancellations, which keep their on-screen
          two-tap paths. */}
      <DriverVoiceButton onCommand={handleVoiceCommand} />
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
    paddingVertical: 10,
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

  // ── Solo | Sharing rides selector ──
  modeRow: { alignItems: 'center', paddingBottom: 8 },
  modeToggle: {
    flexDirection: 'row',
    width: 260,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassStrong,
    padding: 3,
  },
  modeHalf: { flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modeActive: { backgroundColor: colors.glassLime, borderWidth: 1, borderColor: `${colors.primary}60` },
  modeTxt: { fontSize: 13, fontWeight: '600', color: colors.muted },
  modeTxtActive: { color: colors.primary, fontWeight: '800' },

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
  // Same shape as routeCta, tinted lime so pool work reads as its own lane
  // rather than another row of the solo feed.
  poolCta: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
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
    backgroundColor: `${colors.primary}18`,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 10,
    gap: 2,
  },
  navBtnText: { fontSize: 14, fontWeight: '900', color: colors.primary },
  navBtnSub: { fontSize: 11, fontWeight: '600', color: colors.muted },
  contactBtnUnread: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
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
