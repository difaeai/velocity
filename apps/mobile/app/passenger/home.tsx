import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { HOME_SUGGESTED_RADIUS_KM, useSuggestedRides } from '../../src/hooks/suggestedRides';
import { colors } from '../../src/config';
import { otherLanguageLabel, otherLanguageTag, toggleLanguage } from '../../src/i18n';
import { getThemeMode, themed, toggleTheme } from '../../src/theme';
import { DEFAULT_SNAP_POINTS, DraggableSheet } from '../../src/ui/DraggableSheet';
import { LiveMap } from '../../src/ui/LiveMap';
import { NewsTicker } from '../../src/ui/NewsTicker';
import {
  ShareGenderPill,
  ShareGenderSheet,
  useNeedsShareGender,
} from '../../src/ui/ShareGenderSelector';
import { RouteTimePill, RouteTimeSheet } from '../../src/ui/RouteTimeSelector';
import { TravelAreasPill, TravelAreasSheet } from '../../src/ui/TravelAreas';
import { PassengerDrawer } from '../../src/ui/PassengerDrawer';
import { MONTHLY_CEILING, grouped } from '../../src/ui/EarnCard';
import { ArrowIcon, MicIcon, SearchIcon } from '../../src/ui/ServiceIcons';
import {
  CityCarIcon,
  EarnIcon,
  PartnerIcon,
  SharedRideIcon,
  type DrawerIconProps,
} from '../../src/ui/DrawerIcons';
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

  // The rider's regular trips (pickup, drop-off, optional time) for the
  // "Location & time" pill on the map and the sheet it opens. 'add' is the
  // pill's + button, which opens straight on a new route.
  const routes = useDailyRoutes(user?.uid);
  const [routeSheet, setRouteSheet] = useState<'list' | 'add' | null>(null);
  // "Locations people are traveling to": everyone's saved routes, as areas.
  const [areasOpen, setAreasOpen] = useState(false);

  // One entrance for the four ride tiles: their illustrations arrive on it
  // (the wheels roll in, the coin lands), the same way the menu's rows do.
  const tilesIn = useRef(new Animated.Value(0)).current;
  const tilesMotion = useMemo(() => tilesIn.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }), [tilesIn]);
  useEffect(() => {
    Animated.timing(tilesIn, { toValue: 1, duration: 760, delay: 250, useNativeDriver: true }).start();
  }, [tilesIn]);

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
  // subsystem merged into one count. This is the number behind the Suggested
  // Rides row below "Where to?": it is the difference between "tap to find out"
  // and "three cars are going your way right now", and only the second one is
  // worth a tap.
  const suggested = useSuggestedRides(coords);

  // "♀ 2 women's · ♂ 1 men's · 3 open" — only the groups that exist, so the
  // line never pads itself out with zeroes.
  const suggestedSplit = (() => {
    const { female, male, mixed, open } = suggested.byAudience;
    const parts: string[] = [];
    if (female) parts.push(`♀ ${female} women’s`);
    if (male) parts.push(`♂ ${male} men’s`);
    if (mixed) parts.push(`♂♀ ${mixed} mixed`);
    if (open) parts.push(`${open} open`);
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  // The one lime line on the shared-rides tile: who is in those cars if we know,
  // otherwise the cheapest seat going. Never both — the tile is half a screen
  // wide and a second line of detail is what makes it a wall of text.
  const suggestedAccent =
    suggestedSplit ?? (suggested.cheapestFare ? `From PKR ${suggested.cheapestFare}` : null);

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

        {/* One scrolling line, directly under the header: anyone — not only
            drivers — can bring people onto Velocity and earn from their rides.
            A strip instead of a card so it can't take space away from the
            booking controls or hide anything in the sheet. */}
        <NewsTicker onPress={() => router.push('/passenger/earn')} />

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

        {/* Under the ticker (and a live ride, if any) the map splits in two:
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

            {/* Where and when this rider usually travels. Saved routes are what
                the backend matches every new shared ride against, so this is
                how a shared ride finds the rider instead of the other way
                round. See src/ui/RouteTimeSelector.tsx. */}
            <RouteTimePill
              routes={routes}
              onOpen={() => setRouteSheet('list')}
              onAdd={() => setRouteSheet('add')}
            />
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

             "Where to?" takes every pixel the voice tile does not, because it
             is the primary action; the voice side is a fixed-width mic with its
             name under it, which is all it needs to be recognised and tapped.
             When there is no speech recogniser (typically no-GMS handsets) it
             is not rendered at all and "Where to?" fills the row on its own. ── */}
        <View style={styles.heroRow}>
          <Pressable
            style={({ pressed }) => [styles.searchHero, pressed && { opacity: 0.8 }]}
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
              style={({ pressed }) => [styles.voiceHero, pressed && { opacity: 0.8 }]}
              onPress={() => router.push('/passenger/voice')}
              accessibilityRole="button"
              accessibilityLabel="Book a ride by speaking"
            >
              <View style={styles.voiceHeroIcon}>
                <MicIcon size={20} color={colors.primary} />
              </View>
              {/* Two lines allowed: at this width the label wraps rather than
                  ellipsing away the word that says what the button does. */}
              <Text style={styles.voiceHeroTitle} numberOfLines={2}>
                Bol kar book karein
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── The two ways to ride ──────────────────────────────
             Share a car, or have it to yourself. Side by side because that is
             the actual choice in front of a rider, and it belongs here rather
             than three taps deep inside the booking sheet.

             City to City used to hold the right-hand tile. It is a journey
             planned for another day, not one hailed off the map in front of
             you, so it has moved to the drawer under Corporate / Students and this
             row asks the one question home should be asking.

             Who you will share WITH is asked on the map now, not under these
             tiles — see ShareGenderPill. ── */}
        <Text style={styles.sectionLabel}>How will you ride?</Text>

        {/* Four tiles, two rows, one short line each. They used to be two
            tiles and three full-width cards, each with a paragraph — the sheet
            read as a wall of text. "Who goes my way every day" is no longer a
            card here: it is the map's "Locations people are traveling to". */}
        <View style={styles.rideTiles}>
          {/* Shared cars near this rider that still have a seat, whichever way
              they were created — a shared ride somebody booked, riders clubbing
              together, or a driver selling seats on a route they are already
              driving. Full cars never appear (the server drops them), so the
              count is seats that can actually be taken.

              Tapping it with the sharing preference unanswered opens the
              chooser first and comes back here — see goSharing. */}
          <HomeTile
            Icon={SharedRideIcon}
            motion={tilesMotion}
            lime
            title="Shared rides"
            sub={
              !suggested.loaded
                ? 'Looking for seats…'
                : suggested.count === 0
                  ? `None within ${HOME_SUGGESTED_RADIUS_KM} km yet`
                  : suggested.nearestDestination
                    ? `To ${suggested.nearestDestination}`
                    : 'Seats free near you'
            }
            // Who is in those cars — the women's, the men's, the mixed ones —
            // or failing a tally the cheapest seat. A rider's first question
            // about a shared seat is who else is in it.
            accent={suggestedAccent ?? (suggested.loaded && suggested.count === 0 ? 'Tap to search wider' : null)}
            count={suggested.count}
            onPress={() => goSharing('/passenger/suggested-rides')}
            a11y="Shared rides — cars near you with a seat free"
          />

          {/* The whole car, to yourself. Straight into the booking flow with
              Solo already chosen (`mode=solo`), because a rider who tapped
              "Ride Solo" has already answered the only question the ride sheet
              would have asked them about sharing. No lime: that edge means
              "shared, near you, right now". */}
          <HomeTile
            Icon={CityCarIcon}
            motion={tilesMotion}
            title="Ride Solo"
            sub="The whole car to yourself"
            accent="Name your own fare"
            onPress={() => router.push('/passenger/booking?mode=solo')}
            a11y="Ride Solo — the whole car to yourself"
          />
        </View>

        <View style={styles.rideTiles}>
          <HomeTile
            Icon={PartnerIcon}
            motion={tilesMotion}
            title="Travel Partner"
            sub="Swipe, match, ride together"
            onPress={() => router.push('/passenger/travel-mate')}
            a11y="Travel Partner — people near you heading your way"
          />
          {/* The partner programme's ceiling, said as a ceiling: "up to". */}
          <HomeTile
            Icon={EarnIcon}
            motion={tilesMotion}
            title="Earn with us"
            sub={`Up to PKR ${grouped(MONTHLY_CEILING)} a month`}
            onPress={() => router.push('/passenger/earn')}
            a11y="Earn with Velocity Rides — run your own fleet"
          />
        </View>

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

      {/* "Location & time": the rider's saved routes, or the editor for one.
          A new route starts from where they are standing. */}
      <RouteTimeSheet
        open={routeSheet !== null}
        startWith={routeSheet ?? 'list'}
        routes={routes}
        uid={user?.uid}
        here={coords && currentAddress ? { lat: coords.lat, lng: coords.lng, address: currentAddress } : null}
        onClose={() => setRouteSheet(null)}
      />

      {/* "Locations people are traveling to". Its "Add your route" hands over
          to the Location & time editor once this sheet is off the screen:
          two Modals swapping in one frame leaves the first one behind on iOS. */}
      <TravelAreasSheet
        open={areasOpen}
        coords={coords}
        onClose={() => setAreasOpen(false)}
        onAdd={() => {
          setAreasOpen(false);
          setTimeout(() => setRouteSheet('add'), 250);
        }}
      />

    </View>
  );
}

/**
 * One of the four ride tiles: a drawn illustration, a title, one short line,
 * and an accent line only when there is something worth saying. A number in
 * the corner when there is one, otherwise an arrow. Lime edge = shared, near
 * you, right now.
 */
function HomeTile({
  Icon,
  motion,
  title,
  sub,
  accent,
  count = 0,
  lime = false,
  onPress,
  a11y,
}: {
  Icon: (props: DrawerIconProps) => React.JSX.Element;
  motion: DrawerIconProps['motion'];
  title: string;
  sub: string;
  accent?: string | null;
  count?: number;
  lime?: boolean;
  onPress: () => void;
  a11y: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.rideTile, lime && styles.rideTileLime, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <View style={styles.rideTileTop}>
        <View style={[styles.rideTileIcon, lime && styles.rideTileIconLime]}>
          <Icon size={28} accent="#ccff00" motion={motion} />
        </View>
        {count > 0 ? (
          <View style={styles.suggestedCount}>
            <Text style={styles.suggestedCountTxt}>{count}</Text>
          </View>
        ) : (
          <ArrowIcon size={16} color={lime ? '#ccff00' : '#7d8482'} />
        )}
      </View>
      <Text style={styles.rideTileTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.rideTileSub} numberOfLines={1}>{sub}</Text>
      {accent ? (
        <Text style={lime ? styles.rideTileAccent : styles.rideTileAccentMuted} numberOfLines={1}>
          {accent}
        </Text>
      ) : null}
    </Pressable>
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

  /* ── "Where to?" + "Bol kar book karein", one row ──
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
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    /* 15 + a 46px icon + 15 puts this card at 76px — deliberately just under
       the voice tile's ~85px, so all of this extra size is slack the row was
       already carrying. The row is as tall as its tallest child, so growing
       this card costs the features below it nothing until it passes the tile. */
    paddingVertical: 15,
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
  /* ── "Bol kar book karein" — the voice route into the same booking flow ──
     A mic with its name under it, and nothing else. Fixed width rather than a
     flex share: this tile has one job — be recognisable and be tappable — and
     it needs the same small amount of room to do it on every handset. Letting
     it grow with the screen would only pad the space around the icon while
     taking that width off "Where to?", which can use it.

     88 is the floor that keeps the label readable: the longest line it has to
     hold is "book karein", which fits the 72px inside the padding at 11px. Go
     much narrower and the label breaks to three lines and the tile gets TALLER
     than the card beside it, which is what this row exists to avoid. */
  voiceHero: {
    width: 88,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(204,255,0,0.10)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.35)',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  voiceHeroIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(204,255,0,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHeroTitle: {
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
  /* ── The ride tiles, two to a row ──
     Lime as a literal, not colors.primary: this sheet is dark in BOTH themes,
     and in light mode colors.primary darkens to olive — which on a dark sheet
     is a dim smudge where the brand accent should be.
     `stretch` (the row default) is doing real work: a tile with an accent line
     is a line taller than one without, and without equal heights the pair
     would sit on a ragged baseline. flex:1 each rather than a computed
     half-width, so the gutter is exact on every handset. */
  rideTiles: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  rideTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  /* Lime means "near you, right now" — which is exactly what the shared-rides
     tile is, and exactly what the intercity one is not. */
  rideTileLime: {
    backgroundColor: 'rgba(204,255,0,0.07)',
    borderColor: 'rgba(204,255,0,0.35)',
  },
  /* Icon left, count or arrow right, on one line above the text: at half the
     sheet's width there is no room for the icon-beside-text layout these two
     used as full rows. */
  rideTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  /* 42px tile for a 28px illustration — the menu's proportions, so the same
     drawings read the same in both places. */
  rideTileIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  rideTileIconLime: { backgroundColor: 'rgba(204,255,0,0.12)' },
  rideTileTitle: { color: '#ffffff', fontSize: 14.5, fontWeight: '900' },
  rideTileSub: { color: '#9aa2a0', fontSize: 11.5, fontWeight: '600', lineHeight: 15 },
  /* The gender breakdown (or the cheapest seat), one line under the summary.
     Lime rather than grey: it answers a different question from the line above
     it and should not read as a continuation of it. */
  rideTileAccent: { color: '#ccff00', fontSize: 10.5, fontWeight: '800', marginTop: 2 },
  /* The same line on the non-lime tile. Grey rather than lime for the same
     reason that tile has no lime edge: Solo is not the "right now, near you"
     offer, and painting its footnote brand-colour would say it was. */
  rideTileAccentMuted: { color: '#7d8482', fontSize: 10.5, fontWeight: '800', marginTop: 2 },
  suggestedCount: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 7,
    borderRadius: 13,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedCountTxt: { color: '#0b0d0c', fontSize: 12.5, fontWeight: '900' },
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

