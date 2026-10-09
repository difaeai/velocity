import { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
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
import { OutstandingFees } from '../../src/ui/OutstandingFees';
import { claimStashedReferral } from '../../src/hooks/partner';
import { useNearbyBusinessAdCheck } from '../../src/hooks/businessAds';
import { useMessagesUnreadTotal } from '../../src/hooks/messages';
import { useSupportUnread } from '../../src/hooks/support';
import { HOME_SUGGESTED_RADIUS_KM, useSuggestedRides } from '../../src/hooks/suggestedRides';
import { colors } from '../../src/config';
import { otherLanguageLabel, otherLanguageTag, toggleLanguage } from '../../src/i18n';
import { getThemeMode, themed, toggleTheme } from '../../src/theme';
import { comingSoon } from '../../src/ui/components';
import { DEFAULT_SNAP_POINTS, DraggableSheet } from '../../src/ui/DraggableSheet';
import { LiveMap } from '../../src/ui/LiveMap';
import { MapActivityChip } from '../../src/ui/MapActivityChip';
import { NewsTicker } from '../../src/ui/NewsTicker';
import { SharedRideGenderStrip } from '../../src/ui/SharedRideGenderStrip';
import { TravelMateCard } from '../../src/ui/TravelMateCard';
import { EarnCard } from '../../src/ui/EarnCard';
import {
  IntercityIcon,
  MicIcon,
  SearchIcon,
} from '../../src/ui/ServiceIcons';
import { PoolIcon } from '../../src/ui/RideIcons';
import { isRecognitionAvailable } from '../../src/voice/speech';

const { width } = Dimensions.get('window');

/**
 * Which DEFAULT_SNAP_POINTS height the booking sheet opens at. Named here because
 * the map's bottom inset has to agree with it on the very first frame — if the two
 * disagree the green dot opens behind the sheet, which is the bug this fixes.
 */
const SHEET_INITIAL_INDEX = 1;

/** What the live ride is doing, in the rider's words rather than the schema's. */
const ACTIVE_TRIP_LABEL: Record<string, string> = {
  requested:   'Finding you a driver',
  matched:     'Driver assigned',
  arriving:    'Driver is on the way',
  arrived:     'Your driver has arrived',
  in_progress: 'On your way',
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

  const navTo = (path: string) => {
    setDrawerOpen(false);
    router.push(path);
  };
  const soon = (feature: string) => {
    setDrawerOpen(false);
    comingSoon(feature);
  };
  const goDriverMode = () => {
    setDrawerOpen(false);
    // Already signed in — becoming a driver never re-asks for a number/OTP.
    // useDriverEntry decides: registration steps, application status, or the
    // driver home if an admin has already approved them.
    driverEntry.go();
  };

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

        {/* Names the two marks on the map and gives the real totals behind them.
            Only after a poll has landed — an empty chip would read as "no cars"
            when it actually means "still looking". */}
        {activity.loaded ? (
          <MapActivityChip
            driverCount={activity.driverCount}
            bikeCount={activity.bikeCount}
            carCount={activity.carCount}
            passengerCount={activity.passengerCount}
            waitingCount={activity.waitingCount}
          />
        ) : null}
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
        ) : null}

        {/* ── The ride already in progress, if there is one.
             Above "Where to?" because it outranks it: a rider with a driver on
             the way is not looking to book, they are looking for the ride they
             lost. Booking is blocked while this is live anyway (the backend
             refuses a second active trip), so this is also the only honest
             thing to show them. ── */}
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
                {ACTIVE_TRIP_LABEL[activeTrip.status] ?? 'Ride in progress'}
              </Text>
              <Text style={styles.activeTripDest} numberOfLines={1}>
                {activeTrip.dropoffAddress ?? 'Your ride is still running'}
              </Text>
              <Text style={styles.activeTripMeta} numberOfLines={1}>
                {activeTrip.pool ? 'Shared ride' : 'Solo'}
                {activeTrip.fare != null ? ` · PKR ${activeTrip.fare}` : ''} · tap to track
              </Text>
            </View>
            <Text style={styles.activeTripGo}>→</Text>
          </Pressable>
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

        {/* ── Ride sharing ──────────────────────────────────────
             Two ways to take a seat in a car that is going anyway, side by side
             because they are the same offer at two distances: shared rides
             around this rider now, and the intercity board for another day.

             City to City used to be a tile in a "Services" grid next to
             Couriers — which put a bus journey and a parcel in the same breath.
             Couriers has moved to the drawer (it is not a ride), so the two
             journeys share a row and the section says what they are.

             Boxes rather than two full-width rows: the pair costs the sheet one
             tile's height instead of two, which is what keeps Travel Partner
             and Earn on the first screen. ── */}
        <Text style={styles.sectionLabel}>Ride sharing</Text>

        <View style={styles.rideTiles}>
          {/* Shared cars near this rider that still have a seat, whichever way
              they were created — a shared ride somebody booked, riders clubbing
              together, or a driver selling seats on a route they are already
              driving. Full cars never appear (the server drops them), so the
              count is seats that can actually be taken. */}
          <Pressable
            style={({ pressed }) => [styles.rideTile, styles.rideTileLime, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/passenger/suggested-rides')}
            accessibilityRole="button"
            accessibilityLabel="Shared rides — cars near you with a seat free"
          >
            <View style={styles.rideTileTop}>
              <View style={styles.rideTileIconLime}>
                <PoolIcon size={19} color="#ccff00" accent="#ccff00" />
              </View>
              {suggested.count > 0 ? (
                <View style={styles.suggestedCount}>
                  <Text style={styles.suggestedCountTxt}>{suggested.count}</Text>
                </View>
              ) : (
                <Text style={styles.suggestedArrow}>→</Text>
              )}
            </View>
            <Text style={styles.rideTileTitle} numberOfLines={1}>Shared rides</Text>
            <Text style={styles.rideTileSub} numberOfLines={2}>
              {!suggested.loaded
                ? 'Looking for seats near you…'
                : suggested.count === 0
                  ? `None within ${HOME_SUGGESTED_RADIUS_KM} km — tap to search wider`
                  : suggested.nearestDestination
                    ? `${suggested.count} going your way · ${suggested.nearestDestination}`
                    : `${suggested.count} seat${suggested.count === 1 ? '' : 's'} free near you`}
            </Text>
            {/* Which of those cars are the women's, the men's and the mixed
                ones — or, failing a tally, the cheapest seat. A rider's first
                question about a shared seat is who else is in it, and making
                them open the list to find out is making them open it for
                nothing. */}
            {suggestedAccent ? (
              <Text style={styles.rideTileAccent} numberOfLines={1}>{suggestedAccent}</Text>
            ) : null}
          </Pressable>

          {/* The same offer over a longer distance. Keeps the tile geometry and
              drops the lime: that edge means "near you, right now", and an
              intercity seat is neither. */}
          <Pressable
            style={({ pressed }) => [styles.rideTile, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/passenger/city-to-city')}
            accessibilityRole="button"
            accessibilityLabel="City to City — intercity seats between Pakistani cities"
          >
            <View style={styles.rideTileTop}>
              <View style={styles.rideTileIcon}>
                <IntercityIcon size={19} color="#ffffff" />
              </View>
              <Text style={styles.suggestedArrow}>→</Text>
            </View>
            <Text style={styles.rideTileTitle} numberOfLines={1}>City to City</Text>
            <Text style={styles.rideTileSub} numberOfLines={2}>
              Intercity seats — pick a city and a day
            </Text>
          </Pressable>
        </View>

        {/* ── Who will you share with? ────────────────────────────
             Under the tiles it governs, not in the way of "Where to?": the
             answer decides which shared cars the app shows and which joins the
             server accepts, and it has no bearing at all on a solo ride. A
             rider who always travels alone can ignore it forever. ── */}
        <SharedRideGenderStrip />

        {/* ── Travel Partner card ── */}
        <TravelMateCard onPress={() => router.push('/passenger/travel-mate')} />

        {/* ── Earn with Velocity card ── */}
        <EarnCard onPress={() => router.push('/passenger/earn')} />

        <View style={{ height: 20 }} />
        </ScrollView>
      </DraggableSheet>

      {/* 5. Custom Slide-out Side Drawer Menu Overlay */}
      <Modal
        visible={drawerOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerOverlay}>
          {/* Drawer Content — rendered first so it sits on the LEFT */}
          <View style={styles.drawerContent}>
            <SafeAreaView style={styles.drawerSafeArea}>
              <ScrollView contentContainerStyle={styles.drawerScroll}>
                {/* User Header Profile */}
                <Pressable
                  style={styles.profileHeader}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push('/passenger/profile');
                  }}
                >
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarSmile}>☺</Text>
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName} numberOfLines={1}>
                      {user?.displayName ?? user?.email ?? 'Your account'}
                    </Text>
                    {user?.email ? (
                      <Text style={styles.profileEmail} numberOfLines={1}>{user.email}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.profileArrow}>➔</Text>
                </Pressable>

                {/* List Items */}
                <View style={styles.menuList}>
                  <Pressable style={[styles.menuItem, styles.menuItemActive]} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🚗</Text>
                    <Text style={[styles.menuItemText, styles.menuItemTextActive]}>City</Text>
                  </Pressable>

                  {/* Hidden until the wallet economy officially launches — until
                      then the app presents itself as cash-only. */}
                  {walletHidden ? null : (
                    <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/wallet')}>
                      <Text style={styles.menuItemIcon}>💳</Text>
                      <Text style={styles.menuItemText}>{walletLabel}</Text>
                    </Pressable>
                  )}

                  {/* Straight to the advertising screen — no hub in between. The
                      business-delivery quote form that used to share this entry
                      was removed (2026-09-15). */}
                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/business-ads')}>
                    <Text style={styles.menuItemIcon}>📣</Text>
                    <Text style={styles.menuItemText}>Find my Customers</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/special-rides')}>
                    <Text style={styles.menuItemIcon}>🚗</Text>
                    <Text style={styles.menuItemText}>Special Rides</Text>
                  </Pressable>

                  {/* Sending a parcel is not booking a ride, and on the home
                      screen it was a tile of equal weight beside the intercity
                      board — the one errand in a list of journeys. It lives
                      here now; home is rides only. */}
                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/couriers')}>
                    <Text style={styles.menuItemIcon}>📦</Text>
                    <Text style={styles.menuItemText}>Couriers — send a parcel</Text>
                  </Pressable>

                  {/* City to City and Notifications intentionally live only on
                      the home screen (a row under Suggested Rides and the
                      header bell) — duplicating them here just made the drawer
                      longer. */}

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/daily-routes')}>
                    <Text style={styles.menuItemIcon}>🛣️</Text>
                    <Text style={styles.menuItemText}>My routes</Text>
                  </Pressable>

                  {/* Gender-aware pool discovery. The booking flow finds pools on
                      the route you just typed; this browses every shared ride
                      nearby and honours the mixed-gender seating rules, so it
                      needs its own way in. */}
                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/pool-request/nearby')}>
                    <Text style={styles.menuItemIcon}>👥</Text>
                    <Text style={styles.menuItemText}>Nearby sharing rides</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/travel-mate')}>
                    <Text style={styles.menuItemIcon}>🤝</Text>
                    <Text style={styles.menuItemText}>Travel Partner</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/earn')}>
                    <Text style={styles.menuItemIcon}>💸</Text>
                    <Text style={styles.menuItemText}>Earn with Velocity Rides</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/travel-mate/matches')}>
                    <Text style={styles.menuItemIcon}>💬</Text>
                    <Text style={styles.menuItemText}>Matches & Groups</Text>
                  </Pressable>

                  {/* Every conversation in the app: Travel Partner, the driver
                      of a ride, and the businesses whose offers this rider
                      asked about. Replaces the old "My questions" row, which
                      was one of those three and pretended to be all of them. */}
                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/messages')}>
                    <Text style={styles.menuItemIcon}>✉️</Text>
                    <Text style={[styles.menuItemText, styles.menuItemTextGrow]}>Messages</Text>
                    {messagesUnread > 0 ? (
                      <View style={styles.menuBadge}>
                        <Text style={styles.menuBadgeText}>
                          {messagesUnread > 9 ? '9+' : messagesUnread}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/safety')}>
                    <Text style={styles.menuItemIcon}>🛡️</Text>
                    <Text style={styles.menuItemText}>Safety Centre</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/settings')}>
                    <Text style={styles.menuItemIcon}>⚙️</Text>
                    <Text style={styles.menuItemText}>Settings</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/support')}>
                    <Text style={styles.menuItemIcon}>⚡</Text>
                    <Text style={[styles.menuItemText, styles.menuItemTextGrow]}>Help & complaints</Text>
                    {supportUnread > 0 ? (
                      <View style={styles.menuBadge}>
                        <Text style={styles.menuBadgeText}>
                          {supportUnread > 9 ? '9+' : supportUnread}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => { setDrawerOpen(false); signOut(); }}>
                    <Text style={styles.menuItemIcon}>🚪</Text>
                    <Text style={[styles.menuItemText, { color: colors.danger }]}>Sign out</Text>
                  </Pressable>
                </View>
              </ScrollView>

              {/* Bottom Driver Mode Trigger */}
              <View style={styles.drawerFooter}>
                <Pressable style={styles.driverModeButton} onPress={goDriverMode}>
                  <Text style={styles.driverModeText}>{role === 'driver' ? 'Driver mode' : 'Become a driver'}</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
          {/* Backdrop on the RIGHT — tapping closes the drawer */}
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
        </View>
      </Modal>

    </View>
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
  /* ── Live-ride banner: outranks everything else on the sheet ── */
  activeTripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.glassLime,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  activeTripPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  activeTripLabel: {
    fontSize: 10.5,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  activeTripDest: {
    fontSize: 14.5,
    fontWeight: '900',
    color: colors.text,
    marginTop: 2,
  },
  activeTripMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 1,
  },
  activeTripGo: {
    fontSize: 19,
    fontWeight: '900',
    color: colors.primary,
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
  /* ── The two ride-sharing tiles, one row ──
     Lime as a literal, not colors.primary: this sheet is dark in BOTH themes,
     and in light mode colors.primary darkens to olive — which on a dark sheet
     is a dim smudge where the brand accent should be.
     `stretch` (the row default) is doing real work: the shared-rides tile
     carries up to three lines of live text and City to City two, and without
     equal heights the pair would sit on a ragged baseline. flex:1 each rather
     than a computed half-width, so the gutter is exact on every handset. */
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
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
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
  rideTileIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  rideTileIconLime: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(204,255,0,0.12)',
  },
  rideTileTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  rideTileSub: { color: '#9aa2a0', fontSize: 11, fontWeight: '600', lineHeight: 14.5 },
  /* The gender breakdown (or the cheapest seat), one line under the summary.
     Lime rather than grey: it answers a different question from the line above
     it and should not read as a continuation of it. */
  rideTileAccent: { color: '#ccff00', fontSize: 10.5, fontWeight: '800', marginTop: 2 },
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
  suggestedArrow: { color: '#7d8482', fontSize: 16, fontWeight: '800' },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawerBackdrop: {
    flex: 1,
  },
  drawerContent: {
    width: width * 0.78,
    height: '100%',
    backgroundColor: 'rgba(16,18,17,0.94)',
    borderRightWidth: 1,
    borderRightColor: colors.glassStrong,
  },
  drawerSafeArea: {
    flex: 1,
  },
  drawerScroll: {
    paddingBottom: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassStrong,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarSmile: {
    fontSize: 28,
    color: '#ffffff',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 12,
    color: '#8a8c8c',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stars: {
    color: '#ffc107',
    fontSize: 10,
  },
  ratingValue: {
    fontSize: 11,
    color: '#8a8c8c',
  },
  profileArrow: {
    color: '#8a8c8c',
    fontSize: 14,
  },
  menuList: {
    paddingVertical: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 14,
  },
  menuItemActive: {
    backgroundColor: colors.glassStrong,
  },
  menuItemIcon: {
    fontSize: 18,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d1d5db',
  },
  /** Only rows carrying a trailing badge need the label to take the slack. */
  menuItemTextGrow: {
    flex: 1,
  },
  menuBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
  },
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
  menuItemTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  drawerFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.glassStrong,
    gap: 16,
  },
  driverModeButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverModeText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
}));

