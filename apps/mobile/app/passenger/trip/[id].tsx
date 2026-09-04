import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { appLink } from '../../../src/share/links';
import { FirebaseError } from 'firebase/app';
import { collection, getDocs, query as fsQuery, where } from 'firebase/firestore';

import { db } from '../../../src/firebase';

import { api } from '../../../src/api/client';
import { useTrip } from '../../../src/hooks/useTrip';
import { useCancellationSettings } from '../../../src/hooks/driver';
import { ArrivalCountdown } from '../../../src/ui/ArrivalCountdown';
import { DraggableSheet } from '../../../src/ui/DraggableSheet';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { Badge, Card, PrimaryButton } from '../../../src/ui/components';
import { MapPlaceholder } from '../../../src/ui/MapPlaceholder';
import { LiveMap } from '../../../src/ui/LiveMap';
import { RatingModal } from '../../../src/ui/RatingModal';
import { ChatModal } from '../../../src/ui/ChatModal';
import { PoolRidersCard, sharedRidersFrom } from '../../../src/ui/PoolRidersCard';
import { RIDE_TYPE_LABELS, type TripStatus } from '../../../src/domain/types';
import { distanceMeters, formatDistance } from '../../../src/lib/geo';
import { useUnreadChat } from '../../../src/hooks/useUnreadChat';

/**
 * How long a pool stays visible to riders going the same way while it looks for
 * a driver. Mirrors POOL_JOIN_WINDOW_MS in the backend's trips/poolShare — the
 * server is the one that enforces it; this only draws the clock.
 */
const POOL_JOIN_WINDOW_MS = 10 * 60 * 1000;

/** "7:12" from milliseconds. */
function mmss(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<TripStatus, string> = {
  requested:   'Finding you a driver…',
  matched:     'Driver assigned',
  arriving:    'Driver is on the way',
  arrived:     'Driver has arrived at your pickup!',
  in_progress: 'On the way to your destination',
  completed:   'Trip complete',
  cancelled:   'Trip cancelled',
  merged:      'You joined a shared ride',
};

const BUBBLE_COLORS = ['#3b82f6', '#ef4444', '#10b981'];

// Older Android architectures need LayoutAnimation switched on explicitly.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function TripScreen() {
  const params = useLocalSearchParams<{ id: string; shareNow?: string }>();
  const tripId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router  = useRouter();
  const { user } = useAuth();
  const { trip, bids, loading } = useTrip(tripId);
  const cancellation = useCancellationSettings();
  const [busy,         setBusy]        = useState(false);
  const [timeLeft,     setTimeLeft]     = useState(54);
  const [nowMs,        setNowMs]        = useState(() => Date.now());
  const [adjustedFare, setAdjustedFare] = useState(0);
  const [showRating,   setShowRating]   = useState(false);
  const [chatOpen,     setChatOpen]     = useState(false);
  // Same reason as the driver side: a push is invisible to an app already in
  // the foreground, and the rider is usually watching this very screen.
  const { unread: unreadChat, markRead: markChatRead } = useUnreadChat(tripId, user?.uid);
  const [reportOpen,   setReportOpen]   = useState(false);
  const sharePromptShown = useRef(false);

  // Initialize adjustedFare when trip loads
  useEffect(() => {
    if (trip && adjustedFare === 0) setAdjustedFare(trip.offeredFare);
  }, [trip]);

  // Show rating prompt when trip completes (if not already rated)
  useEffect(() => {
    if (trip?.status === 'completed' && !trip.passengerRated) setShowRating(true);
  }, [trip?.status, trip?.passengerRated]);

  // Countdown timer. The same beat drives the pool joining window, so a rider
  // watching their shared ride fill up sees the clock move rather than a
  // number that only refreshes when something else happens to re-render.
  useEffect(() => {
    if (!trip || trip.status !== 'requested') return;
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 59));
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [trip?.status]);

  // Driver offers pop in with a spring instead of just appearing.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [bids.length]);

  // Pool rides land here from booking with ?shareNow=1 — open the invite
  // share sheet once so the host can bring riders in right away.
  useEffect(() => {
    if (sharePromptShown.current) return;
    if (params.shareNow === '1' && trip?.pool && trip.shareCode) {
      sharePromptShown.current = true;
      sharePoolInvite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.pool, trip?.shareCode]);

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

  async function handleRate(stars: number, comment: string) {
    if (!tripId) return;
    await api.submitRating({ tripId, stars, comment: comment || undefined, targetRole: 'driver' });
    setShowRating(false);
  }

  /**
   * Cancelling while we're still finding a driver is free. Once a driver has
   * accepted and is on their way it costs a share of the agreed fare — say so
   * plainly before charging it, and never on the back of a mis-tap.
   */
  function confirmCancel() {
    if (!trip) return;

    const freeToCancel = trip.status === 'requested';
    if (freeToCancel) {
      Alert.alert(
        'Cancel request?',
        'No driver has accepted yet, so this is free. We\'ll stop looking for drivers.',
        [
          { text: 'Keep looking', style: 'cancel' },
          {
            text: 'Cancel request',
            style: 'destructive',
            onPress: () => run(() => api.cancelTrip({ tripId: trip.id })),
          },
        ],
      );
      return;
    }

    const fare = trip.fare ?? trip.offeredFare;
    const fee = Math.round(fare * cancellation.passengerFeeRate);
    Alert.alert(
      `Cancel this ride? It costs PKR ${fee}`,
      `Your driver accepted this ride at PKR ${fare} and is on the way. Cancelling now charges a `
        + `${Math.round(cancellation.passengerFeeRate * 100)}% fee — PKR ${fee}.\n\n`
        + 'It comes out of your wallet balance, and anything left over is owed to Velocity before you can book again.',
      [
        { text: 'Keep my ride', style: 'cancel' },
        {
          text: `Cancel & pay PKR ${fee}`,
          style: 'destructive',
          onPress: () => run(async () => {
            const res = await api.cancelTrip({ tripId: trip.id });
            if (res.outstanding > 0) {
              Alert.alert(
                'Ride cancelled',
                `PKR ${res.outstanding} is now outstanding to Velocity. Settle it from your wallet to keep booking rides.`,
              );
            } else if (res.fee > 0) {
              Alert.alert('Ride cancelled', `PKR ${res.fee} was charged to your wallet.`);
            }
          }),
        },
      ],
    );
  }

  // Pool invite: anyone with the link can join (the backend enforces seats,
  // status and visibility). Private rides are reachable only through this link.
  async function sharePoolInvite() {
    if (!trip?.shareCode) return;
    // Name the host so riders see who invited them, not a generic app name.
    const hostName = user?.displayName?.trim() || 'A friend';
    const link = appLink(`/passenger/pool-join/${trip.shareCode}`);
    try {
      await Share.share({
        message:
          `🔀 ${hostName} invited you to share their Velocity ride!\n\n` +
          `From: ${trip.pickup?.address ?? 'pickup'}\nTo: ${trip.dropoff?.address ?? 'destination'}\n\n` +
          `We split the fare — everyone pays less as more riders join.\n` +
          `Invite code: ${trip.shareCode}\n\nTap to join:\n${link}`,
        title: 'Invite riders to your shared ride',
      });
    } catch { /* user dismissed the share sheet */ }
  }

  function togglePoolVisibility() {
    if (!trip) return;
    const next = trip.poolVisibility === 'private' ? 'public' : 'private';
    run(() => api.setPoolVisibility({ tripId: trip.id, visibility: next }));
  }

  // Travel Partner ride link: only travel partners (matched mates / group members)
  // can book the same ride from this link — the backend enforces the gate.
  async function shareWithTravelMates() {
    if (!trip || !user) return;
    try {
      // If the user is in a commute group, the ride card is also posted to the
      // group chat so every member can book and split the fare afterwards.
      let groupId: string | undefined;
      try {
        const snap = await getDocs(
          fsQuery(collection(db, 'travelMateGroups'), where('members', 'array-contains', user.uid)),
        );
        groupId = snap.docs[0]?.id;
      } catch { /* no group — plain link share */ }

      const { shareId } = await api.shareTravelMateRide({ tripId: trip.id, groupId });
      const link = appLink(`/passenger/travel-mate/shared-ride/${shareId}`);
      const myName = user.displayName?.trim() || 'A friend';
      await Share.share({
        message:
          `🚗 ${myName} wants to ride together on Velocity!\n\n` +
          `From: ${trip.pickup?.address ?? 'pickup'}\nTo: ${trip.dropoff?.address ?? 'destination'}\n\n` +
          `Travel partners can book the same ride here:\n${link}`,
        title: 'Share ride with Travel Partners',
      });
    } catch (e: unknown) {
      const reason = (e as { details?: { reason?: string } })?.details?.reason;
      if (e instanceof FirebaseError && reason === 'no_profile') {
        Alert.alert(
          'Travel Partners only',
          'Ride links are a Travel Partner feature. Set up your Travel Partner profile to share rides with travel partners.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Set up', onPress: () => router.push('/passenger/travel-mate/setup' as Parameters<typeof router.push>[0]) },
          ],
        );
      } else {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not share the ride.');
      }
    }
  }

  if (loading || !trip) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const goHome = () => router.replace('/passenger/home');
  const pendingBids = bids.filter((b) => b.status === 'pending');

  /**
   * "4 min away · 1.2 km" — or nothing at all.
   *
   * The distance is straight-line and the time is derived from it at a blunt
   * city average, so this is deliberately phrased as an estimate. Showing a
   * confident "3 min" that a real road turns into eleven is worse than showing
   * a range, and far worse than the silence this replaces.
   *
   * Nothing is shown before a driver exists, or once the trip is under way and
   * the question has changed from "where are they" to "when do I arrive".
   */
  const etaLine = (() => {
    if (!trip?.driverId) return null;
    const loc = trip.driverLocation;
    if (!loc) return null;
    const heading = trip.status === 'in_progress' ? trip.dropoff : trip.pickup;
    if (!heading || heading.lat == null || heading.lng == null) return null;

    const metres = distanceMeters(loc.lat, loc.lng, heading.lat, heading.lng);
    // 18 km/h — a deliberately pessimistic city average that accounts for
    // traffic and the fact that this is a straight line, not a road.
    const minutes = Math.max(1, Math.round((metres / 1000) / 18 * 60));
    const arriving = trip.status === 'in_progress';

    // A fix that stopped updating is not an ETA any more; say so rather than
    // counting down from a position the car left ten minutes ago.
    const fixAge = trip.driverLocationAt?.seconds
      ? Date.now() - trip.driverLocationAt.seconds * 1000
      : 0;
    if (fixAge > 3 * 60 * 1000) {
      return {
        headline: arriving ? 'On the way to your destination' : 'Your driver is on the way',
        detail: 'Waiting for a fresh location from your driver…',
      };
    }

    return {
      headline: arriving
        ? `About ${minutes} min to your destination`
        : `Your driver is about ${minutes} min away`,
      detail: `${formatDistance(metres)} away${arriving ? '' : ' · they are coming to you now'}`,
    };
  })();
  // Pool joiners ride along but only the host picks the driver, raises the
  // fare or cancels — the backend rejects anyone else, so hide those controls.
  const isHost = trip.passengerId === user?.uid;
  const poolRiderCount = trip.poolMembers?.length ?? 1;
  const poolSeatsFree = Math.max(0, (trip.maxPoolRiders ?? 4) - poolRiderCount);

  // The ten minutes a pool spends visible to riders going the same way. It runs
  // from the moment the ride is booked, alongside the search for a driver — the
  // ride is being offered to drivers and to co-riders at the same time, which
  // is the whole reason a pool ever fills up.
  const poolWindowEndsAt =
    trip.pool && trip.status === 'requested' && trip.createdAt?.seconds
      ? trip.createdAt.seconds * 1000 + POOL_JOIN_WINDOW_MS
      : null;
  const poolWindowLeft = poolWindowEndsAt != null
    ? Math.max(0, poolWindowEndsAt - nowMs)
    : null;

  if (trip.status === 'requested') {
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const driverPins = pendingBids
      .filter((b) => b.driverLocation)
      .map((b) => ({ id: b.id, lat: b.driverLocation!.lat, lng: b.driverLocation!.lng }));

    return (
      <View style={styles.safeDark}>
        {/* 1. Full-screen live map — real route + drivers who sent offers */}
        <View style={styles.mapContainerFull}>
          <LiveMap
            coords={trip.pickup ? { lat: trip.pickup.lat, lng: trip.pickup.lng } : null}
            pickup={trip.pickup ? { lat: trip.pickup.lat, lng: trip.pickup.lng } : null}
            dropoff={trip.dropoff ? { lat: trip.dropoff.lat, lng: trip.dropoff.lng } : null}
            drivers={driverPins}
          />
        </View>

        {/* 2. Top floating status */}
        <SafeAreaView style={styles.floatingTopArea} pointerEvents="box-none">
          {trip.pool && (
            <View style={styles.poolRideBanner}>
              <Text style={styles.poolRideBannerText}>
                🔀 Shared · {poolRiderCount}/{trip.maxPoolRiders ?? 4} riders · PKR {trip.poolPerSeatFare ?? trip.offeredFare} each
              </Text>
              {/* Nobody could tell whether "shared" meant anything was actually
                  happening. It does: for these ten minutes the ride is on other
                  riders' screens, and each one who gets in cuts everybody's
                  fare. Saying so is the difference between waiting and being
                  ignored. */}
              {poolWindowLeft != null ? (
                <Text style={styles.poolRideBannerSub}>
                  {poolWindowLeft > 0
                    ? `Riders going your way can join for ${mmss(poolWindowLeft)} — each one who does cuts everyone's fare`
                    : 'Still looking for a driver — the joining window has closed'}
                </Text>
              ) : null}
            </View>
          )}
          <View style={styles.viewersBanner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.viewersText}>
                {pendingBids.length > 0
                  ? `${pendingBids.length} driver${pendingBids.length > 1 ? 's' : ''} offered — pick below`
                  : 'Contacting nearby drivers…'}
              </Text>
            </View>
            {pendingBids.length > 0 ? (
              <View style={styles.avatarBubbles}>
                {pendingBids.slice(0, 3).map((b, i) => (
                  <View
                    key={b.id}
                    style={[
                      styles.avatarBubble,
                      {
                        backgroundColor: BUBBLE_COLORS[i % BUBBLE_COLORS.length],
                        marginLeft: i === 0 ? 0 : -8,
                      },
                    ]}
                  >
                    <Text style={styles.avatarBubbleText}>
                      {(b.driverInfo.displayName?.[0] ?? 'D').toUpperCase()}
                    </Text>
                  </View>
                ))}
                {pendingBids.length > 3 ? (
                  <View style={[styles.avatarBubble, { backgroundColor: '#4b5563', marginLeft: -8 }]}>
                    <Text style={styles.avatarBubbleText}>+{pendingBids.length - 3}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </SafeAreaView>

        {/* 3. Bottom sheet — offers first, everything else below. Drag the
             grabber to trade map for offers, or tap it to fill the screen. */}
        <DraggableSheet style={styles.bottomBiddingSheet}>
          <View style={styles.priorityBanner}>
            <Text style={styles.priorityText}>
              {pendingBids.length > 0 ? 'Driver offers' : 'Finding you a driver…'}
            </Text>
            <Text style={styles.countdownText}>{formatTime(timeLeft)}</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${(timeLeft / 60) * 100}%` }]} />
          </View>

          <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
            {/* Driver offers pop in here as they arrive */}
            {pendingBids.length === 0 ? (
              // One line, not a panel. This is the state the rider spends the
              // most time in and it says the least — the countdown above it is
              // already saying "we are looking", so a tall card repeating that
              // was pushing the actual content off the screen.
              <Text style={styles.waitingLine}>
                Your offer of PKR {trip.offeredFare} is live — driver offers appear here.
              </Text>
            ) : (
              <View style={styles.driverBidsSection}>
                {pendingBids.map((b) => (
                  <View key={b.id} style={styles.driverBidCard}>
                    <View style={styles.bidMetaRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bidDriverName}>{b.driverInfo.displayName}</Text>
                        <Text style={styles.bidDriverVehicle}>
                          {b.driverInfo.vehicleLabel} · {b.driverInfo.plate} · {b.driverInfo.rating}★
                        </Text>
                      </View>
                      <Text style={styles.bidFarePKR}>{b.fare} PKR</Text>
                    </View>
                    {isHost ? (
                      // Two answers, not one. A driver who counter-offers above
                      // what the rider will pay used to have to be waited out —
                      // the card sat there until the timer expired. Declining
                      // clears just that offer; every other driver's still stands.
                      <View style={styles.bidActionRow}>
                        <Pressable
                          style={({ pressed }) => [styles.rejectBidBtn, pressed && { opacity: 0.7 }]}
                          disabled={busy}
                          onPress={() => run(() => api.declineBid({ tripId: trip.id, bidId: b.id }))}
                          accessibilityRole="button"
                          accessibilityLabel={`Reject ${b.driverInfo.displayName}'s offer of ${b.fare} rupees`}
                        >
                          <Text style={styles.rejectBidBtnText}>Reject</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [styles.acceptBidBtn, pressed && { opacity: 0.85 }]}
                          disabled={busy}
                          onPress={() => run(() => api.acceptBid({ tripId: trip.id, bidId: b.id }))}
                          accessibilityRole="button"
                          accessibilityLabel={`Accept ${b.driverInfo.displayName}'s offer of ${b.fare} rupees`}
                        >
                          <Text style={styles.acceptBidBtnText}>Accept Offer</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.joinerNote}>The pool host picks the driver</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Route */}
            <View style={styles.routePillCard}>
              <View style={styles.routePillPoint}>
                <Text style={styles.routeDotBlue}>👤</Text>
                <Text style={styles.routePillText} numberOfLines={1}>{trip.pickup?.address || 'Pickup'}</Text>
              </View>
              <View style={styles.routePillDivider} />
              <View style={styles.routePillPoint}>
                <Text style={styles.routeDotGreen}>🏁</Text>
                <Text style={styles.routePillText} numberOfLines={1}>{trip.dropoff?.address || 'Drop-off'}</Text>
              </View>
            </View>

            {/* Raise the offer to attract drivers (backend only accepts raises) */}
            {isHost && (
            <View style={styles.raiseCard}>
              <View style={[styles.fareAdjusterRow, { paddingHorizontal: 0 }]}>
                <Pressable
                  style={styles.adjustBtn}
                  onPress={() => setAdjustedFare((f) => Math.max(trip.offeredFare, f - 25))}
                >
                  <Text style={styles.adjustBtnText}>− 25</Text>
                </Pressable>
                <Text style={styles.biddingFareValue}>PKR {adjustedFare}</Text>
                <Pressable style={styles.adjustBtn} onPress={() => setAdjustedFare((f) => f + 25)}>
                  <Text style={styles.adjustBtnText}>+ 25</Text>
                </Pressable>
              </View>
              <Pressable
                style={[
                  styles.raiseFareBtn,
                  { marginHorizontal: 0 },
                  adjustedFare <= trip.offeredFare && styles.raiseFareBtnDisabled,
                ]}
                disabled={adjustedFare <= trip.offeredFare || busy}
                onPress={() => run(() => api.raiseTripFare({ tripId: trip.id, fare: adjustedFare }))}
              >
                <Text style={[styles.raiseFareBtnText, adjustedFare <= trip.offeredFare && { color: '#8a8c8c' }]}>
                  Raise fare to attract drivers
                </Text>
              </Pressable>
              <View style={styles.cashBadgeRow}>
                <Text style={{ fontSize: 16 }}>💵</Text>
                <Text style={styles.cashBadgeText}>
                  {trip.pool
                    ? `PKR ${trip.poolPerSeatFare ?? trip.offeredFare} per rider · cash`
                    : `PKR ${trip.offeredFare} cash`}
                </Text>
              </View>
            </View>
            )}

            {/* Non-pool rides keep the Travel Partner share entry */}
            {!trip.pool && (
              <Pressable
                style={({ pressed }) => [styles.travelMateShareBtn, pressed && { opacity: 0.85 }]}
                onPress={shareWithTravelMates}
              >
                <Text style={styles.travelMateShareBtnText}>🤝 Ride together — share with Travel Partners</Text>
              </Pressable>
            )}
            {/* Pool: invite riders. Deliberately LAST — while drivers are
                 bidding, picking one is the job; inviting riders is the thing
                 you do once that's settled. It used to sit directly under the
                 offers and take more height than they did. Now it is one row
                 plus a button, and the visibility hint lives on the chip. */}
            {trip.pool && trip.shareCode ? (
              <View style={styles.poolShareCard}>
                <View style={styles.poolShareTopRow}>
                  <Text style={{ fontSize: 17 }}>🔗</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.poolShareTitle} numberOfLines={1}>
                      Invite riders — everyone pays less
                    </Text>
                    <Text style={styles.poolShareCodeTxt} numberOfLines={1}>
                      Code {trip.shareCode} · {trip.poolVisibility === 'private' ? 'private' : 'public'}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.poolVisChip}
                    onPress={togglePoolVisibility}
                    disabled={busy || !isHost}
                  >
                    <Text style={styles.poolVisChipTxt}>
                      {trip.poolVisibility === 'private' ? '🔒' : '🌍'}
                    </Text>
                    {isHost && <Text style={styles.poolVisChipSub}>switch</Text>}
                  </Pressable>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.poolShareBtn, pressed && { opacity: 0.85 }]}
                  onPress={sharePoolInvite}
                >
                  <Text style={styles.poolShareBtnTxt}>📤 Share invite link</Text>
                </Pressable>
                {/* Sharing the link now is fine, but joining it is not yet, so
                    say so rather than letting the host wonder why nobody came.
                    Riders can only take a seat once a driver has agreed the
                    fare — before that the price is still moving and the ride
                    could still be cancelled under them. */}
                <Text style={styles.poolShareHint}>
                  Send it now — riders can join the moment your driver is confirmed. Every rider who
                  joins brings everyone&apos;s fare down.
                </Text>
              </View>
            ) : null}

            {/* Cancel Request (host only — the backend rejects others).
                Free at this stage: no driver has committed to the ride yet.

                INSIDE the scroll on purpose. It used to sit after it, as a
                direct child of the sheet — and the sheet is as tall as its
                tallest snap point and slides DOWN to shrink, so at the height
                this screen actually opens at, this button was below the bottom
                edge of the display with no way to reach it. Same defect that
                hid the Book button on the booking screen. */}
            {isHost ? (
              <Pressable
                style={({ pressed }) => [styles.cancelRequestBtn, pressed && { opacity: 0.85 }]}
                onPress={confirmCancel}
                disabled={busy}
              >
                <Text style={styles.cancelRequestBtnText}>Cancel request</Text>
                <Text style={styles.cancelRequestBtnSub}>Free — no driver has accepted yet</Text>
              </Pressable>
            ) : (
              <Text style={styles.joinerFooterNote}>
                You've joined this shared ride — you'll ride along once the host picks a driver.
              </Text>
            )}
          </ScrollView>
        </DraggableSheet>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.status}>{STATUS_LABEL[trip.status]}</Text>
          <Badge label={RIDE_TYPE_LABELS[trip.rideType]} />
        </View>

        {/* The first thing a rider needs to know about this ride, said once and
            said plainly. A shared ride looks exactly like a solo one from here
            otherwise — same map, same driver card — and people were getting
            into cars with strangers having never been told the ride was
            shared at all. */}
        {trip.pool && (
          <View style={styles.sharedBanner}>
            <Text style={styles.sharedBannerTitle}>
              🔀 This is a shared ride
            </Text>
            <Text style={styles.sharedBannerBody}>
              {poolRiderCount > 1
                ? `${poolRiderCount} passengers in this car${poolSeatsFree > 0 ? ` · ${poolSeatsFree} seat${poolSeatsFree === 1 ? '' : 's'} still free` : ' · full'}. `
                : `Just you so far — ${poolSeatsFree} seat${poolSeatsFree === 1 ? '' : 's'} free, and your fare drops if somebody joins. `}
              You pay PKR {trip.poolPerSeatFare ?? trip.fare ?? trip.offeredFare}, not the whole fare.
            </Text>
          </View>
        )}

        {/* The two things a rider actually wants once a driver is assigned:
            how far away the car is, and how long until it is here. Both come
            from the driver's own position, relayed onto the trip — before this
            the screen said "Driver is on the way" and nothing else, which is
            indistinguishable from nothing happening. */}
        {etaLine ? (
          <View style={styles.etaCard}>
            <Text style={styles.etaBig}>{etaLine.headline}</Text>
            <Text style={styles.etaSub}>{etaLine.detail}</Text>
          </View>
        ) : null}

        <MapPlaceholder
          pickup={trip.pickup?.address}
          dropoff={trip.dropoff?.address}
          tracking={trip.status === 'in_progress' || trip.status === 'arriving'}
          pickupCoord={trip.pickup}
          dropoffCoord={trip.dropoff}
          driverId={trip.driverId ?? undefined}
        />



        {/* ── Active trip: driver info + contact ── */}
        {['matched', 'arriving', 'arrived', 'in_progress'].includes(trip.status) && trip.driverInfo && (
          <Card>
            <Text style={styles.cardTitle}>{trip.driverInfo.displayName}</Text>
            <Text style={styles.muted}>
              {trip.driverInfo.vehicleLabel} · {trip.driverInfo.plate} · {trip.driverInfo.rating}★
            </Text>
            {/* On a pool this must be the rider's OWN share, not the whole-car
                fare the driver locked — a rider shown "550 PKR" who owes 330 is
                being told the wrong number about their own money. */}
            <Text style={[styles.fare, { marginTop: 6 }]}>
              {trip.pool
                ? `Your fare: ${trip.poolPerSeatFare ?? trip.fare} PKR${poolRiderCount > 1 ? ` · shared ${poolRiderCount} ways` : ''}`
                : `Fare: ${trip.fare} PKR`}
            </Text>

            {/* Driver arrived — 5-min boarding countdown */}
            {trip.status === 'arrived' && (
              <ArrivalCountdown arrivedAt={trip.arrivedAt} role="passenger" />
            )}

            {/* Contact + share buttons */}
            <View style={styles.contactRow}>
              {trip.driverPhone ? (
                <Pressable
                  style={styles.contactBtn}
                  onPress={() => Linking.openURL(`tel:${trip.driverPhone}`)}
                >
                  <Text style={styles.contactBtnText}>📞 Call driver</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[
                  styles.contactBtn,
                  { backgroundColor: colors.primary + '18' },
                  unreadChat > 0 && { borderColor: colors.primary, borderWidth: 1.5 },
                ]}
                onPress={() => { markChatRead(); setChatOpen(true); }}
              >
                <Text style={styles.contactBtnText}>
                  💬 {unreadChat > 0 ? `Message (${unreadChat > 9 ? '9+' : unreadChat})` : 'Message'}
                </Text>
              </Pressable>
            </View>

            {/* Share trip via WhatsApp */}
            <Pressable
              style={styles.whatsappBtn}
              onPress={() => {
                const plate   = trip.driverInfo?.plate ?? 'N/A';
                const vehicle = trip.driverInfo?.vehicleLabel ?? 'Vehicle';
                const driver  = trip.driverInfo?.displayName ?? 'Driver';
                const pickup  = trip.pickup?.address ?? 'pickup';
                const dropoff = trip.dropoff?.address ?? 'destination';
                const msg = encodeURIComponent(
                  `🚗 I'm on a Velocity ride!\n\nDriver: ${driver}\nVehicle: ${vehicle}\nPlate: ${plate}\n\nFrom: ${pickup}\nTo: ${dropoff}\n\nTrack my trip for safety.`
                );
                Linking.openURL(`whatsapp://send?text=${msg}`).catch(() =>
                  Linking.openURL(`https://wa.me/?text=${msg}`)
                );
              }}
            >
              <Text style={styles.whatsappBtnText}>📤 Share trip via WhatsApp</Text>
            </Pressable>

            {/* Travel Partner ride link — partners can book onto this ride */}
            <Pressable style={styles.travelMateShareBtn} onPress={shareWithTravelMates}>
              <Text style={styles.travelMateShareBtnText}>🤝 Share ride link with Travel Partners</Text>
            </Pressable>
          </Card>
        )}

        {/* Who else is in the car. Appears the moment anybody joins — whether
            they were picked up along the route or joined the pool from the
            booking screen — so the passenger hears it from us, not from the
            back seat. It used to read `trip.poolRiders`, which only an en-route
            trip ever has, so on an ordinary shared booking it never rendered
            at all and nobody was told they were sharing. */}
        {['matched', 'arriving', 'arrived', 'in_progress'].includes(trip.status)
          && trip.pool && (
          <PoolRidersCard
            riders={sharedRidersFrom(trip, user?.uid)}
            youUid={user?.uid}
            driverPhone={trip.driverPhone}
            seatsLeft={Math.max(
              0,
              (trip.maxPoolRiders ?? 4) - (trip.poolMembers?.length ?? 1),
            )}
          />
        )}

        {['matched', 'arriving', 'arrived', 'in_progress'].includes(trip.status) && (
          <>
            <PrimaryButton
              variant="danger"
              label="🆘 Emergency SOS"
              disabled={busy}
              onPress={() => run(() => api.raiseSafetyEvent({ tripId: trip.id, kind: 'sos' }))}
            />
            {trip.status !== 'in_progress' && isHost && (
              <>
                <PrimaryButton
                  variant="secondary"
                  label="Cancel trip"
                  disabled={busy}
                  onPress={confirmCancel}
                />
                <Text style={styles.cancelFeeNote}>
                  Your driver is on the way. Cancelling now costs a{' '}
                  {Math.round(cancellation.passengerFeeRate * 100)}% fee — PKR{' '}
                  {Math.round((trip.fare ?? trip.offeredFare) * cancellation.passengerFeeRate)}.
                </Text>
              </>
            )}
          </>
        )}

        {/* ── Invoice (shown after rating is dismissed) ── */}
        {trip.status === 'completed' && !showRating && (
          <Card>
            <Text style={styles.cardTitle}>Trip complete — thank you!</Text>
            <Row label="Ride"       value={RIDE_TYPE_LABELS[trip.rideType]} />
            <Row label="Seats"      value={`${trip.settlement?.seats ?? trip.seats}`} />
            <Row label="Total fare" value={`${trip.settlement?.grossFare ?? trip.fare ?? 0} PKR`} />
            <Row label="Your share" value={`${trip.settlement?.passengerShare ?? 0} PKR`} bold />
            <View style={{ height: 10 }} />
            <PrimaryButton label="Done" onPress={goHome} />
            <Pressable style={styles.reportLink} onPress={() => setReportOpen(true)}>
              <Text style={styles.reportLinkTxt}>⚠️  Report an issue with this trip</Text>
            </Pressable>
          </Card>
        )}

        {trip.status === 'cancelled' && (
          <Card>
            <Text style={styles.muted}>This trip was cancelled.</Text>
            <View style={{ height: 10 }} />
            <PrimaryButton label="Back to home" onPress={goHome} />
            <Pressable style={styles.reportLink} onPress={() => setReportOpen(true)}>
              <Text style={styles.reportLinkTxt}>⚠️  Report an issue with this trip</Text>
            </Pressable>
          </Card>
        )}

        {/* A driver going the same way picked this request up onto their pool, so
            the ride now lives on their trip. This document is only the stub left
            behind — send the rider to the ride they are actually on. */}
        {trip.status === 'merged' && (
          <Card>
            <Text style={styles.cardTitle}>You're on a shared ride</Text>
            <Text style={styles.muted}>
              A driver heading your way picked you up onto their pool. Your ride is tracked there.
            </Text>
            <View style={{ height: 10 }} />
            <PrimaryButton
              label="Open my ride"
              onPress={() =>
                trip.mergedIntoTripId
                  ? router.replace(`/passenger/trip/${trip.mergedIntoTripId}`)
                  : goHome()
              }
            />
          </Card>
        )}
      </ScrollView>

      {/* Dispute / issue report */}
      <ReportIssueModal
        visible={reportOpen}
        tripId={trip.id}
        onClose={() => setReportOpen(false)}
      />

      {/* Rating overlay — appears when trip completes */}
      <RatingModal
        visible={showRating}
        targetLabel="Rate your driver"
        targetName={trip.driverInfo?.displayName ?? 'Driver'}
        onSubmit={handleRate}
        onSkip={() => setShowRating(false)}
      />

      {/* In-ride chat */}
      <ChatModal
        visible={chatOpen}
        roomId={trip.id}
        myUid={user?.uid ?? ''}
        myName={user?.displayName ?? 'Passenger'}
        otherName={trip.driverInfo?.displayName ?? 'Driver'}
        onClose={() => { markChatRead(); setChatOpen(false); }}
      />
    </SafeAreaView>
  );
}

const ISSUE_CATEGORIES: { key: 'fare' | 'behaviour' | 'safety' | 'lost_item' | 'other'; label: string; icon: string }[] = [
  { key: 'fare',      label: 'Fare issue',   icon: '💰' },
  { key: 'behaviour', label: 'Behaviour',    icon: '😠' },
  { key: 'safety',    label: 'Safety',       icon: '🛡️' },
  { key: 'lost_item', label: 'Lost item',    icon: '🎒' },
  { key: 'other',     label: 'Other',        icon: '📝' },
];

function ReportIssueModal({ visible, tripId, onClose }: { visible: boolean; tripId: string; onClose: () => void }) {
  const [category, setCategory]       = useState<typeof ISSUE_CATEGORIES[number]['key']>('other');
  const [description, setDescription] = useState('');
  const [sending, setSending]         = useState(false);

  async function submit() {
    if (description.trim().length < 5) {
      Alert.alert('Too short', 'Please describe the issue in a few words.');
      return;
    }
    setSending(true);
    try {
      await api.createDispute({ tripId, category, description: description.trim() });
      setDescription('');
      onClose();
      Alert.alert('Report Submitted ✅', 'Our team will review your report and get back to you. You can also reach us via Support chat.');
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to submit report.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable style={reportStyles.overlay} onPress={onClose} />
        <View style={reportStyles.sheet}>
          <View style={reportStyles.handle} />
          <Text style={reportStyles.title}>Report an Issue</Text>
          <Text style={reportStyles.sub}>Tell us what went wrong on this trip. An admin will review it.</Text>

          <View style={reportStyles.chipRow}>
            {ISSUE_CATEGORIES.map(c => (
              <Pressable
                key={c.key}
                style={[reportStyles.chip, category === c.key && reportStyles.chipActive]}
                onPress={() => setCategory(c.key)}
              >
                <Text style={reportStyles.chipIcon}>{c.icon}</Text>
                <Text style={[reportStyles.chipTxt, category === c.key && { color: colors.primary }]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            style={reportStyles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />

          <Pressable
            style={[reportStyles.submitBtn, (sending || description.trim().length < 5) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={sending || description.trim().length < 5}
          >
            {sending
              ? <ActivityIndicator color="#000" />
              : <Text style={reportStyles.submitTxt}>Submit Report</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const reportStyles = themed(() => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center' },
  title:  { fontSize: 18, fontWeight: '800', color: colors.text },
  sub:    { fontSize: 13, color: colors.muted, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  chipIcon:   { fontSize: 14 },
  chipTxt:    { fontSize: 12, fontWeight: '700', color: colors.text },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 14,
    color: colors.text,
    height: 110,
  },
  submitBtn: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitTxt: { fontSize: 15, fontWeight: '900', color: '#000' },
}));

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.invoiceRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.invoiceVal, bold && { fontWeight: '900', color: colors.primary }]}>{value}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 18, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status:    { fontSize: 20, fontWeight: '900', color: colors.text, flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  muted:     { fontSize: 13, color: colors.muted },
  reportLink:    { paddingTop: 12, alignItems: 'center' },
  reportLinkTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },
  fare:      { fontSize: 18, fontWeight: '900', color: colors.primary },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  invoiceVal: { fontSize: 14, fontWeight: '700', color: colors.text },
  arrivedBanner: {
    backgroundColor: colors.primary + '18',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
  },
  arrivedText: { fontSize: 14, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
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
  whatsappBtn: {
    marginTop: 10,
    backgroundColor: '#25D36620',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#25D36640',
    paddingVertical: 12,
    alignItems: 'center',
  },
  whatsappBtnText: { fontSize: 13, fontWeight: '800', color: '#25D366' },

  travelMateShareBtn: {
    marginTop: 10,
    backgroundColor: `${colors.primary}18`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    paddingVertical: 12,
    alignItems: 'center',
  },
  travelMateShareBtnText: { fontSize: 13, fontWeight: '800', color: colors.primary },

  // Custom dark-mode requested screen styles (Image 2 & 3)
  safeDark: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapContainerFull: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: '44%', // upper portion of the screen
    backgroundColor: '#151b22',
  },
  roadLine: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#262f3c',
  },
  pulsePin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGlow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  floatingTopArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  poolRideBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.glassLime,
    borderWidth: 1.5,
    borderColor: '#4caf50',
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  poolRideBannerText: {
    color: '#4caf50',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  poolRideBannerSub: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 2,
  },
  // The live-ride version of the banner above: a full card rather than a pill,
  // because by this point it has to carry the rider count, the free seats and
  // what this rider personally owes — not just the word "shared".
  sharedBanner: {
    backgroundColor: colors.glassLime,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  poolShareHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  sharedBannerTitle: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  sharedBannerBody: { color: colors.text, fontSize: 12.5, lineHeight: 18 },
  viewersBanner: {
    marginHorizontal: 16,
    marginTop: 6,
    backgroundColor: 'rgba(16,18,17,0.94)',
    borderWidth: 1,
    borderColor: colors.glassStrong,
    borderRadius: 99,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 4,
  },
  viewersText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  avatarBubbles: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(16,18,17,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBubbleText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  /* Height is the rider's, via DraggableSheet — this only skins the surface. */
  bottomBiddingSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderColor: colors.glassStrong,
  },
  priorityBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  priorityText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  countdownText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'Courier',
  },
  progressBarBg: {
    height: 3,
    backgroundColor: colors.glassStrong,
    width: '100%',
    marginTop: 6,
    marginBottom: 14,
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#ffffff',
  },
  fareAdjusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 20,
  },
  adjustBtn: {
    width: 80,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustBtnDisabled: {
    opacity: 0.5,
  },
  adjustBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  biddingFareValue: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    minWidth: 110,
    textAlign: 'center',
  },
  raiseFareBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  raiseFareBtnDisabled: {
    backgroundColor: 'rgba(16,18,17,0.94)',
    borderColor: colors.glassStrong,
  },
  raiseFareBtnText: {
    color: '#ccff00',
    fontSize: 15,
    fontWeight: '800',
  },
  cashBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 10,
  },

  // Waiting-for-offers empty state
  waitingSub:   { color: '#8a8c8c', fontSize: 12, textAlign: 'center', lineHeight: 17 },

  // Pool invite card
  poolShareCard: {
    backgroundColor: colors.glassLime,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${colors.primary}60`,
    padding: 14,
    gap: 12,
    marginBottom: 12,
  },
  poolShareTitle:   { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  poolShareCodeTxt: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 2, letterSpacing: 1 },
  poolVisChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,18,17,0.7)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  poolVisChipTxt: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  poolVisChipSub: { color: '#8a8c8c', fontSize: 8, fontWeight: '700', marginTop: 1 },
  poolShareTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  poolShareBtn: {
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolShareBtnTxt: { color: '#000', fontSize: 14, fontWeight: '900' },

  joinerNote: {
    color: '#8a8c8c',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 6,
  },
  joinerFooterNote: {
    color: '#8a8c8c',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    lineHeight: 17,
  },

  // Raise-fare card
  raiseCard: {
    backgroundColor: colors.glassChip,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 14,
    marginTop: 12,
    gap: 4,
  },
  cashBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetScroll: {
    flex: 1,
    paddingHorizontal: 20,
    marginVertical: 10,
  },
  routePillCard: {
    backgroundColor: colors.glassChip,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 10,
    gap: 6,
  },
  routePillPoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeDotBlue: {
    color: '#3b82f6',
    fontSize: 14,
  },
  routeDotGreen: {
    color: '#ccff00',
    fontSize: 14,
  },
  routePillText: {
    color: '#8a8c8c',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  routePillDivider: {
    height: 1,
    backgroundColor: colors.glassStrong,
    marginLeft: 22,
  },
  etaCard: {
    backgroundColor: `${colors.primary}14`,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 3,
    marginBottom: 12,
  },
  etaBig: {
    color: colors.text,
    fontSize: 16.5,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  etaSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  waitingLine: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  driverBidsSection: {
    marginTop: 16,
    gap: 10,
  },
  driverBidsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  driverBidCard: {
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  bidMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bidDriverName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  bidDriverVehicle: {
    color: '#8a8c8c',
    fontSize: 11,
    marginTop: 2,
  },
  bidFarePKR: {
    color: '#ccff00',
    fontSize: 16,
    fontWeight: '900',
  },
  // Accept carries the weight; Reject is present and pressable but never
  // competes with it — this is a choice with an obvious default.
  bidActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rejectBidBtn: {
    width: 96,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBidBtnText: {
    color: '#c9cfcc',
    fontSize: 13,
    fontWeight: '800',
  },
  acceptBidBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBidBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelRequestBtn: {
    marginHorizontal: 20,
    marginBottom: 20,
    minHeight: 48,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelRequestBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelRequestBtnSub: {
    color: '#8a8c8c',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  cancelFeeNote: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: -4,
  },
}));
