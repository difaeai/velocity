import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { GlassSheen } from '../../src/ui/Glass';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { registerForPushNotifications } from '../../src/lib/notifications';
import { useCurrentLocation } from '../../src/hooks/location';
import { useNearbyActivity } from '../../src/hooks/nearbyActivity';
import { usePresenceBeacon } from '../../src/hooks/presence';
import { useDriverEntry } from '../../src/hooks/useDriverEntry';
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
import { useOutstanding, useWalletComingSoon, useWalletLabel } from '../../src/hooks/driver';
import { FeeOnNextRide, OutstandingFees } from '../../src/ui/OutstandingFees';
import { claimStashedReferral } from '../../src/hooks/partner';
import { useNearbyBusinessAdCheck } from '../../src/hooks/businessAds';
import { useMessagesUnreadTotal } from '../../src/hooks/messages';
import { useSupportUnread } from '../../src/hooks/support';
import { useDailyRoutes, useMyProfile } from '../../src/hooks/passenger';
import { useSuggestedRides } from '../../src/hooks/suggestedRides';
import { colors } from '../../src/config';
import { otherLanguageLabel, otherLanguageTag, toggleLanguage } from '../../src/i18n';
import { getThemeMode, themed, toggleTheme } from '../../src/theme';
import { DEFAULT_SNAP_POINTS, DraggableSheet } from '../../src/ui/DraggableSheet';
import { LiveMap } from '../../src/ui/LiveMap';
import {
  ShareGenderPill,
  ShareGenderSheet,
  useNeedsShareGender,
} from '../../src/ui/ShareGenderSelector';
import { TravelAreasPill, TravelAreasSheet } from '../../src/ui/TravelAreas';
import { PassengerDrawer } from '../../src/ui/PassengerDrawer';
import { TravelMateCard } from '../../src/ui/TravelMateCard';
import { EarnCard } from '../../src/ui/EarnCard';
import { ArrowIcon, MicIcon, SearchIcon } from '../../src/ui/ServiceIcons';
import { MotoIcon, PoolIcon } from '../../src/ui/RideIcons';
import { isRecognitionAvailable } from '../../src/voice/speech';

/**
 * Which DEFAULT_SNAP_POINTS height the booking sheet opens at. Named here because
 * the map's bottom inset has to agree with it on the very first frame — if the two
 * disagree the green dot opens behind the sheet, which is the bug this fixes.
 */
const SHEET_INITIAL_INDEX = 1;

/** What the live ride is doing, in the rider's words rather than the schema's. */
const ACTIVE_TRIP_LABEL: Record<string, string> = {
  requested:   'Still finding you a driver',
  matched:     'Your driver is on the way',
  arriving:    'Your driver is on the way',
  arrived:     'Your driver has arrived',
  in_progress: 'You are already in a ride',
};

export default function PassengerHome() {
  const { user, role, signOut } = useAuth();
  // A ride the rider is already on. Backing out of the trip screen or killing
  // the app used to lose it entirely — the driver was still coming, the map
  // just wasn't reachable any more.
  const { active: activeTrip } = useActiveTrip(user?.uid);
  const router = useRouter();
  const walletLabel = useWalletLabel('Wallet & payments');
  const walletHidden = useWalletComingSoon();
  // Unpaid cancellation fees block booking, and the card that clears
  // them used to be reachable only from the wallet. See the render below.
  const outstanding = useOutstanding(user?.uid);
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const driverEntry = useDriverEntry();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The name and picture the rider gave at onboarding — Auth has neither for a
  // phone sign-in. Feeds the card at the top of the menu.
  const me = useMyProfile(user?.uid);

  // The rider's regular trips — the places saved on the Corporate / daily
  // screen, counted on its tile.
  const routes = useDailyRoutes(user?.uid);
  // "Locations people are traveling to": everyone's saved routes, as areas.
  const [areasOpen, setAreasOpen] = useState(false);

  // One entrance for everything under "Where to?": the ride tiles, Travel
  // Partner and Earn rise into place one after another (see Rise). "Where to?"
  // itself never waits on it — it is the primary action.
  const sheetIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(sheetIn, {
      toValue: 1,
      duration: 1000,
      delay: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetIn]);

  // Unread across all three message sections — Travel Partner, drivers and
  // brands. It badges the drawer row, and puts a dot on the hamburger itself:
  // a badge nobody can see until they open the drawer is not a notification.
  const messagesUnread = useMessagesUnreadTotal();
  // Unread replies on this rider's open complaints, so the drawer carries the
  // same badge the Messages row does — a Rapid Response answer nobody notices
  // is a resolution that never happened.
  const supportUnread = useSupportUnread(user?.uid);

  // The booking sheet covers the bottom of a full-screen map, so the map has to be
  // told how much of itself is hidden — otherwise it centres the user's green dot
  // in the middle of the full rect, which is *behind* the sheet. Tracking the snap
  // index (rather than assuming the opening one) keeps the dot centred in the
  // visible band as the sheet is dragged.
  const { height: screenHeight } = useWindowDimensions();
  const [sheetIndex, setSheetIndex] = useState(SHEET_INITIAL_INDEX);
  const sheetInset = screenHeight * (DEFAULT_SNAP_POINTS[sheetIndex] ?? DEFAULT_SNAP_POINTS[1]!);

  // Live supply/demand around the passenger: bikes and cars online (lime chips)
  // and everyone else with the app nearby (small red dots). Both come back from
  // the server blurred and anonymous — see getNearbyActivity.
  const activity = useNearbyActivity(coords);

  // …and the other half of that: this handset tells the server it is here, so
  // this rider is one of the dots on everybody else's map. Nothing renders from
  // it. Written at most every few minutes, and it lapses on its own if the app
  // stops being opened.
  usePresenceBeacon(coords);

  // Paid business offers around the rider. This is the whole receiving side of
  // "Find your Customers": it asks the server whether this position has earned an
  // offer notification, throttled by distance moved and by time, and the server
  // enforces the real limits (once per offer per 12 hours, capped per day).
  // Nothing renders from it — the offer arrives as a push.
  useNearbyBusinessAdCheck(coords);

  // Shared cars around this rider that still have a seat — every pooling
  // subsystem merged into one count, badged on the Corporate / daily tile.
  const suggested = useSuggestedRides(coords);

  // Checked once on mount rather than per render: the answer is a property of
  // the handset and cannot change while the app is open.
  const [voiceAvailable] = useState(() => isRecognitionAvailable());

  // Register FCM push token on first load
  useEffect(() => {
    if (user) registerForPushNotifications().catch(() => {});
  }, [user?.uid]);

  // A referral code can arrive before the account does — someone taps a partner's
  // WhatsApp link while signed out, and only then registers. The code is parked
  // at that moment and played here, on the first home render after sign-in, which
  // is the earliest point at which a user exists for it to bind to.
  useEffect(() => {
    if (!user) return;
    claimStashedReferral()
      .then((res) => {
        if (res.ok && res.partnerName) {
          Alert.alert(
            'You joined a fleet 🎉',
            `You're now part of ${res.partnerName}'s Velocity Rides fleet. Your fares are unchanged — they earn from Velocity Rides' side, never from yours.`,
          );
        }
      })
      .catch(() => {});
  }, [user?.uid]);

  const pickupLabel = currentAddress ?? (coords ? 'Current location' : 'Set pickup location');

  const navTo = useCallback((path: string) => {
    setDrawerOpen(false);
    // The drawer is a Modal: pushing a route out from under one that is still
    // on screen leaves the overlay behind on Android. Let it close first.
    setTimeout(() => router.push(path as Parameters<typeof router.push>[0]), 200);
  }, [router]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const goProfile = useCallback(() => navTo('/passenger/profile'), [navTo]);
  const goDriverMode = useCallback(() => {
    setDrawerOpen(false);
    // Already signed in — becoming a driver never re-asks for a number/OTP.
    // useDriverEntry decides: registration steps, application status, or the
    // driver home if an admin has already approved them.
    driverEntry.go();
  }, [driverEntry]);
  const doSignOut = useCallback(() => {
    setDrawerOpen(false);
    signOut();
  }, [signOut]);

  /* ── The sharing-preference gate ─────────────────────────────────
     Every way into a shared seat passes through here. With the question
     unanswered the tap opens the chooser instead of the screen, and the screen
     follows the moment an answer is saved — so the rider is interrupted once,
     ever, and lands exactly where they were going. A rider who only ever
     travels alone never meets it. See src/ui/ShareGenderSelector.tsx. ── */
  const needsShareGender = useNeedsShareGender();
  const [genderSheet, setGenderSheet] = useState<{ next: (() => void) | null } | null>(null);
  const goSharing = useCallback((path: string) => {
    const open = () => router.push(path as Parameters<typeof router.push>[0]);
    if (needsShareGender) setGenderSheet({ next: open });
    else open();
  }, [needsShareGender, router]);

  return (
    <View style={styles.container}>
      {/* 1. Full-screen live map (real Google map in the dev build) */}
      <View style={styles.mapContainer}>
        <LiveMap
          coords={coords}
          drivers={activity.drivers}
          demand={activity.passengers}
          bottomInset={sheetInset}
        />
      </View>

      {/* 2. Top Navigation Overlay */}
      <SafeAreaView style={styles.headerSafeArea} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable
            style={styles.hamburgerButton}
            onPress={() => setDrawerOpen(true)}
            accessibilityLabel={
              messagesUnread > 0 ? `Menu, ${messagesUnread} unread messages` : 'Menu'
            }
          >
            <Text style={styles.hamburgerText}>☰</Text>
            {messagesUnread > 0 ? <View style={styles.hamburgerDot} /> : null}
          </Pressable>
          
          {/* Floating Pickup Pill on Map (from Image 5) */}
          <Pressable
            style={styles.pickupPillFloating}
            onPress={() => (coords ? router.push('/passenger/booking') : requestLocation())}
          >
            <View style={styles.pickupMeta}>
              <Text style={styles.pickupPillTitle}>Pickup point</Text>
              <Text style={styles.pickupPillValue} numberOfLines={1}>{pickupLabel}</Text>
            </View>
            <Text style={styles.pickupArrow}>➔</Text>
          </Pressable>

          <View style={styles.topRightGroup}>
            {/* Mode selector — flips dark/light live, no reload */}
            <Pressable
              style={styles.headerIconButton}
              onPress={() => {
                toggleTheme().catch(() => {});
              }}
              accessibilityLabel={getThemeMode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Text style={styles.headerIconText}>{getThemeMode() === 'dark' ? '☀️' : '🌙'}</Text>
            </Pressable>

            {/* Language switch — one tap flips English ⇄ اردو live. The pill
                names the language you'd GET, not the one you're in, so nobody
                has to open a picker to find out what the button does. */}
            <Pressable
              style={styles.headerIconButton}
              onPress={() => {
                toggleLanguage().catch(() => {});
              }}
              accessibilityLabel={`Switch to ${otherLanguageLabel()}`}
            >
              <Text style={styles.headerIconText}>🌐</Text>
              <RNText style={styles.headerIconTag}>{otherLanguageTag()}</RNText>
            </Pressable>

            <Pressable style={styles.notificationButton} onPress={() => router.push('/passenger/notifications')}>
              <Text style={styles.notificationText}>🔔</Text>
              <View style={styles.badgeDot} />
            </Pressable>
          </View>
        </View>

        {/* ── The ride already in progress, if there is one.
             Pinned over the map, not in the sheet: the first thing a rider
             sees when they come back to the app — after Back, after a call,
             after the app was killed — must be the ride they lost. It sat
             inside the sheet once and riders reopening the app thought their
             ride had ended. Booking is blocked while it is live anyway (the
             backend refuses a second active trip). ── */}
        {activeTrip ? (
          <Pressable
            style={({ pressed }) => [styles.activeTripCard, pressed && { opacity: 0.9 }]}
            onPress={() => router.push(`/passenger/trip/${activeTrip.id}` as Parameters<typeof router.push>[0])}
            accessibilityRole="button"
            accessibilityLabel="Return to your ride in progress"
          >
            <View style={styles.activeTripPulse} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activeTripLabel}>
                {ACTIVE_TRIP_LABEL[activeTrip.status] ?? 'You are already in a ride'}
              </Text>
              <Text style={styles.activeTripDest} numberOfLines={1}>
                Tap here to open your ride
              </Text>
              <Text style={styles.activeTripMeta} numberOfLines={1}>
                {activeTrip.pool ? 'Shared ride' : 'Solo ride'}
                {activeTrip.fare != null ? ` · PKR ${activeTrip.fare}` : ''}
                {activeTrip.dropoffAddress ? ` · to ${activeTrip.dropoffAddress}` : ''}
              </Text>
            </View>
            <ArrowIcon size={22} color="#0b1a00" />
          </Pressable>
        ) : null}

        {/* Under the header (and a live ride, if any) the map splits in two:
            the rider's own settings down the left, and what everyone else is
            doing down the right. Both sides are box-none, so the map between
            them still pans. */}
        <View style={styles.mapControls} pointerEvents="box-none">
          <View style={styles.mapControlsLeft} pointerEvents="box-none">
            {/* Who this rider will share a car with — the question that used to
                sit in a card at the bottom of the sheet, where it was below the
                fold on a small handset and cost the ride tiles a block of
                height. On the map it costs the sheet nothing, it is visible the
                moment the app opens, and it is where a shared-ride tap is sent
                when it has not been answered. */}
            <ShareGenderPill onPress={() => setGenderSheet({ next: null })} />
          </View>

          {/* Where people around here travel: every saved route as a pickup
              area, a drop-off area, an average time and its men and women. It
              took the cars / bikes / passengers legend's place — the map's own
              chips and dots still show what is moving. */}
          <TravelAreasPill onPress={() => setAreasOpen(true)} />
        </View>
      </SafeAreaView>

      {/* 3. Bottom Booking Sheet — drag the grabber to resize it, or tap the
             grabber to swap between this height and (near) full screen. */}
      <DraggableSheet
        style={styles.bottomSheet}
        initialIndex={SHEET_INITIAL_INDEX}
        onSnap={setSheetIndex}
      >
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.bottomSheetContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

        {/* ── An unpaid cancellation fee that has grown past the limit.
             Top of the sheet because the backend refuses createTrip while it
             stands: without this the passenger taps "Where to?", is told no,
             and has nowhere to go. It used to be reachable only from the wallet
             screen, which is hidden until the wallet economy launches. The card
             is self-contained — Velocity's accounts, the screenshot upload and
             the AI verdict — exactly as the driver home screen uses it. ── */}
        {outstanding.blocked ? (
          <OutstandingFees status={outstanding} uid={user?.uid} role="passenger" />
        ) : outstanding.amount > 0 ? (
          <FeeOnNextRide amount={outstanding.amount} />
        ) : null}

        {/* ── Start a ride ─────────────────────────────────────────────────
             The destination, and the same job by voice for riders who cannot
             comfortably read or type. Nothing else: this card is the way into a
             ride of ANY kind, and a rider heading somewhere alone must be able
             to go from here to a driver without answering a question about
             sharing. (The sharing preference used to be welded to the bottom of
             this card. It governs shared seats only, so it now lives with them,
             below.)

             THE MIC LIVES INSIDE "WHERE TO?" (owner, 2026-11-17)
             It used to be a tile of its own beside the card, which read as a
             separate feature rather than as the other way to do the same thing.
             Speaking a destination IS "where to?", so the mic now sits in the
             card, directly after the words — the rider's eye reaches "Where
             to?" and the two ways to answer it are both right there. Two
             Pressables side by side in one card rather than one nested in the
             other: nesting makes which one got the tap a matter of responder
             order, and this is a 46px target next to a full-width one.

             When there is no speech recogniser (typically no-GMS handsets) the
             mic is not rendered at all and the words take the width back.

             The tile the mic vacated is now My Routes — the rider's own saved
             trips, which is the other thing they come to this sheet to do. ── */}
        <View style={styles.heroRow}>
          <View style={styles.searchHero}>
            <GlassSheen radius={22} />
            <Pressable
              style={({ pressed }) => [styles.searchHeroTap, pressed && { opacity: 0.8 }]}
              onPress={() => router.push('/passenger/booking')}
              accessibilityRole="button"
              accessibilityLabel="Where to? Set your destination"
            >
              <View style={styles.searchHeroIcon}>
                <SearchIcon size={22} color="#0b0d0c" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.searchHeroTitle}>Where to?</Text>
                {/* "Ride sharing", never "pool": this line is read by someone who
                    has not chosen yet, and "pool" is not the word they use. */}
                <Text style={styles.searchHeroSub} numberOfLines={1}>
                  Solo or ride sharing
                </Text>
              </View>
            </Pressable>

            {voiceAvailable ? (
              <Pressable
                style={({ pressed }) => [styles.searchHeroMic, pressed && styles.searchHeroMicOn]}
                onPress={() => router.push('/passenger/voice')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Bol kar book karein — book a ride by speaking"
              >
                <MicIcon size={20} color={colors.primary} />
                <Text style={styles.searchHeroMicTxt} numberOfLines={1}>
                  Bol kar
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* My Routes is the WHOLE app's, not the corporate/students
              section's (owner, 2026-11-17). It opens the Routes tab, where a
              route is saved whatever kind of ride the rider books — and the
              reminder before each one arrives the same way for a rider who
              only ever travels alone. It used to open the ride-sharing screen,
              which quietly made it a sharing feature; it also no longer goes
              through goSharing, because saving your own route asks nothing
              about who you would share a car with. */}
          <MyRoutesTile
            count={routes?.length ?? 0}
            onPress={() => router.push('/passenger/daily-routes?tab=routes')}
          />
        </View>

        {/* ── The two ways to ride ──────────────────────────────
             The daily trip shared with people going the same way (office,
             campus, anywhere regular), or a bike — for the rider or for their
             parcel. A solo car is still "Where to?" above.

             Who you will share WITH is asked on the map, not under these
             tiles — see ShareGenderPill; the booking sheet asks it again before
             a first shared seat. ── */}
        <Rise progress={sheetIn} index={0}>
          <Text style={styles.sectionLabel}>How will you ride?</Text>
        </Rise>

        <Rise progress={sheetIn} index={1}>
          <View style={styles.rideTiles}>
            {/* Where the rider works, studies or usually goes, and a shared
                ride there with anyone making the same trip — see
                app/passenger/daily-travel.tsx. The badge is the shared cars
                near them with a seat free right now. Through goSharing, like
                every way into a shared seat. */}
            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => goSharing('/passenger/daily-travel')}
              accessibilityRole="button"
              accessibilityLabel="Corporate, Students or daily go-to — share your regular ride"
            >
              <TileGlow id="tileCorporate" />
              <GlassSheen radius={18} />
              <View style={styles.tileHead}>
                <View style={styles.tileIcon}>
                  <PoolIcon size={20} color="#0b0d0c" accent="#0b0d0c" />
                </View>
                {suggested.count > 0 ? (
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveBadgeTxt}>{suggested.count} live</Text>
                  </View>
                ) : (
                  <ArrowIcon size={16} color="#ccff00" />
                )}
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>Corporate & Students</Text>
              <Text style={styles.tileSub} numberOfLines={1}>or your daily go-to</Text>
            </Pressable>

            {/* A bike ride, or a parcel on one — app/passenger/bike.tsx. */}
            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => router.push('/passenger/bike')}
              accessibilityRole="button"
              accessibilityLabel="Bike — book a bike ride or send a parcel"
            >
              <TileGlow id="tileBike" />
              <GlassSheen radius={18} />
              <View style={styles.tileHead}>
                <View style={styles.tileIcon}>
                  <MotoIcon size={22} color="#0b0d0c" accent="#0b0d0c" />
                </View>
                <ArrowIcon size={16} color="#ccff00" />
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>Bike</Text>
              <Text style={styles.tileSub} numberOfLines={1}>Ride or send a parcel</Text>
            </Pressable>
          </View>
        </Rise>

        <Rise progress={sheetIn} index={2}>
          <TravelMateCard onPress={() => router.push('/passenger/travel-mate')} />
        </Rise>

        <Rise progress={sheetIn} index={3}>
          <EarnCard onPress={() => router.push('/passenger/earn')} />
        </Rise>

        <View style={{ height: 20 }} />
        </ScrollView>
      </DraggableSheet>

      {/* 5. The menu — every feature in the app, drawn and animated.
             It was ~180 lines of inline Modal here; it is its own component now
             because it has real behaviour (a staggered entrance, press
             feedback, pulsing unread badges) that has no business living in the
             middle of the home screen. See src/ui/PassengerDrawer.tsx. */}
      <PassengerDrawer
        visible={drawerOpen}
        onClose={closeDrawer}
        name={me?.name ?? user?.displayName ?? null}
        handle={
          me?.username
            ? `@${me.username}`
            : me?.phone ?? user?.phoneNumber ?? user?.email ?? null
        }
        photoURL={me?.photoURL ?? user?.photoURL ?? null}
        isDriver={role === 'driver'}
        walletHidden={walletHidden}
        walletLabel={walletLabel}
        messagesUnread={messagesUnread}
        supportUnread={supportUnread}
        onNavigate={navTo}
        onProfile={goProfile}
        onDriverMode={goDriverMode}
        onSignOut={doSignOut}
      />

      {/* The sharing-preference chooser. Opened by the map pill, and by any
          shared-ride tap made before the question has been answered — in which
          case `next` carries that tap on to where it was going. */}
      <ShareGenderSheet
        open={genderSheet !== null}
        onClose={() => setGenderSheet(null)}
        onChosen={genderSheet?.next ?? undefined}
        reason={
          genderSheet?.next
            ? 'One question before your first shared seat. It decides which shared cars we show you and who can sit beside you — riding solo is never affected.'
            : null
        }
      />

      {/* "Locations people are traveling to". Its "Add your route" opens the
          Corporate / daily screen once this sheet is off the screen. */}
      <TravelAreasSheet
        open={areasOpen}
        coords={coords}
        onClose={() => setAreasOpen(false)}
        onAdd={() => {
          setAreasOpen(false);
          setTimeout(() => goSharing('/passenger/daily-travel'), 250);
        }}
      />

    </View>
  );
}

/**
 * One block of the sheet rising into place: its own slice of the shared
 * entrance, later blocks starting later, all on one native-driven value.
 */
function Rise({
  progress,
  index,
  children,
}: {
  progress: Animated.Value;
  index: number;
  children: React.ReactNode;
}) {
  const start = index * 0.15;
  const p = progress.interpolate({
    inputRange: [start, start + 0.55],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View
      style={{
        opacity: p,
        transform: [
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
          // A touch of overshoot: reads as weight landing, not as a bounce.
          { scale: p.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0.96, 1.01, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * My Routes — the rider's own saved trips, in the slot the voice tile had.
 *
 * Same 88px width as the mic tile it replaced (owner, 2026-11-17), so the row's
 * proportions are untouched and "Where to?" keeps every pixel it had.
 *
 * The drawing is the point: a route is two ends and a line between them, so the
 * tile draws exactly that — a pickup ring at the top, a destination square at
 * the bottom, and a lime dot that travels down the line and starts again. That
 * loop is the whole animation. One Animated.Value, native-driven, and the dot
 * is the only thing that moves: a tile on the home sheet must cost nothing to
 * leave running while someone reads the rest of the screen.
 *
 * The count is the badge. A rider with no routes saved still sees the tile —
 * "My Routes" with "Save yours" under it is an invitation; hiding it until they
 * already have one is how a feature stays undiscovered.
 */
function MyRoutesTile({ count, onPress }: { count: number; onPress: () => void }) {
  const travel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(travel, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        // A beat at the destination, so it reads as arriving rather than as a
        // dot sliding on a loop.
        Animated.delay(550),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [travel]);

  return (
    <Pressable
      style={({ pressed }) => [styles.routesHero, pressed && { opacity: 0.8 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? `My Routes, ${count} saved — your daily trips`
          : 'My Routes — save the trip you make every day'
      }
    >
      <GlassSheen radius={18} />

      <View style={styles.routesTrack}>
        <View style={styles.routesPin} />
        <View style={styles.routesLine} />
        <View style={styles.routesEnd} />
        <Animated.View
          style={[
            styles.routesDot,
            {
              opacity: travel.interpolate({
                inputRange: [0, 0.12, 0.88, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  // Pin to destination: both ends are 8px, so the dot covers
                  // one and lands exactly on the other across the 34px track.
                  translateY: travel.interpolate({ inputRange: [0, 1], outputRange: [0, 26] }),
                },
                // A touch bigger mid-journey, so the eye catches the motion on
                // a tile this small without the dot ever being loud.
                {
                  scale: travel.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0.85, 1.15, 0.85],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <Text style={styles.routesTitle} numberOfLines={2}>
        My Routes
      </Text>
      <Text style={styles.routesSub} numberOfLines={1}>
        {count > 0 ? `${count} saved` : 'Save yours'}
      </Text>
    </Pressable>
  );
}

/** A tile's soft lime glow, fading out from the top-left corner. */
function TileGlow({ id }: { id: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ccff00" stopOpacity={0.14} />
          <Stop offset="1" stopColor="#ccff00" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = themed(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  mapContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#151b22', // Dark blue-grey map base
  },
  road: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#262f3c', // Map roads
  },
  mapPin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    fontSize: 28,
    zIndex: 2,
  },
  pulseRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(204, 255, 0, 0.4)',
    bottom: -2,
  },
  cabPin: {
    position: 'absolute',
    backgroundColor: colors.glassChip,
    padding: 6,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#ccff00',
  },
  cabEmoji: {
    fontSize: 16,
  },
  rightControlsContainer: {
    position: 'absolute',
    right: 16,
    top: 250,
    gap: 12,
  },
  circleControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '600',
  },
  cabIconSmall: {
    fontSize: 16,
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  /* Pills left, live legend right. flex:1 on the left lets a long pill shrink
     rather than run under the legend on a narrow handset. */
  mapControls: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mapControlsLeft: { flex: 1, alignItems: 'flex-start' },
  hamburgerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(18,21,20,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  hamburgerText: {
    color: '#ffffff',
    fontSize: 22,
  },
  topRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /* Three controls now share the right edge (mode, language, bell), so each is
     38px instead of 46 — the row stays inside the width the pill gives up. */
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(18,21,20,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  headerIconText: {
    fontSize: 16,
  },
  /* "EN" / "اردو" under the globe, so the current language is readable at a
     glance instead of needing the sheet opened to find out. */
  headerIconTag: {
    fontSize: 7,
    fontWeight: '800',
    color: colors.primary,
    marginTop: -1,
  },
  notificationButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(18,21,20,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  notificationText: {
    fontSize: 16,
  },
  badgeDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ef4444',
  },
  /* Height now comes from DraggableSheet (the user's drag decides it) — this
     only skins the surface. */
  bottomSheet: {
    backgroundColor: 'rgba(11,13,12,0.96)',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  sheetScroll: { flex: 1 },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    // Just enough headroom for the part of the mascot's tooltip that rises
    // above the first card — a ScrollView clips its content, so without this it
    // would be sliced off at the sheet's top edge. Kept tight: everything spent
    // here is a row of features pushed off the bottom of a small screen.
    paddingTop: 14,
    gap: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 16,
  },
  /* Shrunk from left:74/right:74 — the right edge now clears three 38px
     controls (16 padding + 3×38 + 2×6 gap + 8 breathing room = 150). */
  pickupPillFloating: {
    position: 'absolute',
    left: 70,
    right: 150,
    top: 4,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 11,
    paddingRight: 8,
    paddingVertical: 7,
    justifyContent: 'space-between',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  pickupMeta: {
    flex: 1,
  },
  pickupPillTitle: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pickupPillValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 1,
  },
  pickupArrow: {
    fontSize: 12,
    color: colors.primary,
    marginLeft: 6,
    fontWeight: '800',
  },
  /* ── Live-ride banner: pinned over the map, outranks everything ──
     Solid brand fill with dark ink in both themes — it sits on a map, where a
     glass card disappears into the streets underneath. */
  activeTripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // The dark-theme lime in both themes: light's olive `primary` would sink the dark ink.
    backgroundColor: '#ccff00',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginTop: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  activeTripPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0b1a00',
  },
  activeTripLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0b1a00',
  },
  activeTripDest: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0b1a00',
    marginTop: 1,
  },
  activeTripMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(11,26,0,0.72)',
    marginTop: 1,
  },

  /* ── "Where to?" (with the mic in it) + My Routes, one row ──
     `stretch` is the point of the row: the two sides have different content
     heights (one is icon-beside-text, the other icon-above-text) and without it
     the shorter one would float with a ragged bottom edge next to the taller. */
  heroRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  /* ── "Where to?" hero — the sheet's primary action ──
     Takes every pixel the voice tile does not. The two are not split by ratio:
     the voice side is a fixed-width icon tile (see below), so this grows with
     the screen instead of being pegged to a share of it — the wider the
     handset, the more of it goes to the thing people came to tap. */
  searchHero: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    /* 15 + a 46px icon + 15 puts this card at 76px — deliberately just under
       the My Routes tile's ~85px, so all of this extra size is slack the row
       was already carrying. The row is as tall as its tallest child, so growing
       this card costs the features below it nothing until it passes the tile. */
    paddingVertical: 15,
  },
  /* The destination half of the card: everything except the mic. It carries the
     row layout the card itself used to, so the icon and the words are unmoved. */
  searchHeroTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  /* ── The mic, inside the card and after the words (owner, 2026-11-17) ──
     A lime pill rather than a bare icon: at 46px it has to read as a button to
     someone who has never pressed it, and the word under the mic is what tells
     a rider who cannot comfortably read English that it listens. "Bol kar" on
     one line — the full "Bol kar book karein" is the accessibility label and
     the voice screen's own heading, which is where there is room for it. */
  searchHeroMic: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.35)',
    backgroundColor: 'rgba(204,255,0,0.10)',
    paddingVertical: 6,
  },
  searchHeroMicOn: {
    backgroundColor: 'rgba(204,255,0,0.22)',
  },
  searchHeroMicTxt: {
    fontSize: 9.5,
    lineHeight: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  searchHeroIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHeroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.2,
  },
  /* ── My Routes — the rider's own saved trips ──
     Fixed width rather than a flex share, exactly as the voice tile it replaced
     was: this tile has one job — be recognisable and be tappable — and it needs
     the same small amount of room to do it on every handset. Letting it grow
     with the screen would only pad the space around the drawing while taking
     that width off "Where to?", which can use it.

     88, unchanged (owner, 2026-11-17: "utna he banana jitna bol kr book krein
     hai"). The row's proportions are the ones that were already tuned. */
  routesHero: {
    width: 88,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(204,255,0,0.10)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.35)',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  /* The route itself: 34px of line with an end on each tip. `relative` because
     the travelling dot is positioned against it. */
  routesTrack: {
    width: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  routesPin: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  /* Sits behind both ends, so the line appears to run between them. */
  routesLine: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(204,255,0,0.30)',
  },
  routesEnd: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  /* The dot that travels. Absolute so its translateY is measured from the top
     of the track and nothing else in the tile moves with it. */
  /* The dark rim is what separates it from the line it travels along — without
     it a lime dot on a lime line is invisible for most of the journey. */
  routesDot: {
    position: 'absolute',
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: '#121212',
  },
  routesTitle: {
    fontSize: 11,
    /* Pinned, not left to the font: the label wraps to two lines and the
       default line height would make the tile taller than the card it sits
       beside. */
    lineHeight: 13,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  routesSub: {
    fontSize: 9.5,
    lineHeight: 11,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  searchHeroSub: {
    fontSize: 13,
    color: '#8f9694',
    marginTop: 2,
  },

  /* ── Section heading, e.g. "Rides already going" ── */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7d8482',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: -2,
  },
  /* ── The two ride tiles, one row ──
     Lime as a literal, not colors.primary: this sheet is dark in BOTH themes,
     and in light mode colors.primary darkens to olive — which on a dark sheet
     is a dim smudge where the brand accent should be.
     `stretch` (the row default) is doing real work: the shared-rides tile
     carries up to three lines of live text and Solo two, and without equal
     heights the pair would sit on a ragged baseline. flex:1 each rather than a computed
     half-width, so the gutter is exact on every handset. */
  rideTiles: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  // Half-width tiles in the Travel Partner card's colours (dark olive, lime
  // edge and accents), with a soft lime glow from the top corner (TileGlow).
  tile: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#ccff0040',
    backgroundColor: '#1e1a00',
    paddingHorizontal: 12,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  tilePressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ccff00',
  },
  tileTitle: { color: '#ffffff', fontSize: 14.5, fontWeight: '900', lineHeight: 18 },
  tileSub: { color: '#ccff00', fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(204,255,0,0.16)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ccff00' },
  liveBadgeTxt: { color: '#ccff00', fontSize: 10.5, fontWeight: '900' },
  hamburgerDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
    borderWidth: 2,
    // Matches the button's own fill, not a theme token: that fill is a fixed
    // rgba because the button floats over the map in both themes.
    borderColor: 'rgba(18,21,20,0.95)',
  },
}));

