import { useEffect, useState, type ReactElement } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
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
import { useWalletLabel } from '../../src/hooks/driver';
import { claimStashedReferral } from '../../src/hooks/partner';
import { useNearbyBusinessAdCheck } from '../../src/hooks/businessAds';
import { colors } from '../../src/config';
import { otherLanguageLabel, otherLanguageTag, toggleLanguage } from '../../src/i18n';
import { getThemeMode, themed, toggleTheme } from '../../src/theme';
import { comingSoon } from '../../src/ui/components';
import { DraggableSheet } from '../../src/ui/DraggableSheet';
import { LiveMap } from '../../src/ui/LiveMap';
import { MapActivityChip } from '../../src/ui/MapActivityChip';
import { QuietAreaCard } from '../../src/ui/QuietAreaCard';
import { TravelMateCard } from '../../src/ui/TravelMateCard';
import { EarnCard } from '../../src/ui/EarnCard';
import {
  CourierIcon,
  IntercityIcon,
  MicIcon,
  SearchIcon,
  type ServiceIconProps,
} from '../../src/ui/ServiceIcons';
import { isRecognitionAvailable } from '../../src/voice/speech';

const { width } = Dimensions.get('window');

export default function PassengerHome() {
  const { user, role, signOut } = useAuth();
  const router = useRouter();
  const walletLabel = useWalletLabel('Wallet & payments');
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const driverEntry = useDriverEntry();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Live supply/demand around the rider: cars online (lime chips) and everyone
  // else with the app nearby (small red dots). Both come back from the server
  // blurred and anonymous — see getNearbyActivity.
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

  // A truly empty area is our cue to pitch the partner program. Gated on
  // `loaded` so a cold start or a failed poll never shows it: "we haven't
  // looked yet" must not be mistaken for "there is nobody here".
  const [quietDismissed, setQuietDismissed] = useState(false);
  const showQuietPitch =
    activity.loaded &&
    activity.driverCount === 0 &&
    activity.passengerCount === 0 &&
    !quietDismissed;

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
            `You're now part of ${res.partnerName}'s Velocity fleet. Your fares are unchanged — they earn from Velocity's side, never from yours.`,
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
  /**
   * Safety → police helpline 15.
   *
   * The number is shown first and the call is placed only from the explicit
   * "Call 15" button. Nothing here dials on its own: a stray tap on Safety must
   * never put an emergency call through to the police.
   */
  const openSafety = () => {
    setDrawerOpen(false);
    Alert.alert(
      'Safety — Police helpline 15',
      'Dial 15 to reach the Pakistan police emergency helpline directly.\n\nDuring a ride you can also trigger an Emergency SOS from the trip screen — our team monitors safety events in real time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call 15',
          style: 'destructive',
          onPress: () => {
            Linking.openURL('tel:15').catch(() => {
              Alert.alert('Could not start the call', 'Dial 15 from your phone app.');
            });
          },
        },
      ],
    );
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
        <LiveMap coords={coords} drivers={activity.drivers} demand={activity.passengers} />
      </View>

      {/* 2. Top Navigation Overlay */}
      <SafeAreaView style={styles.headerSafeArea} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.hamburgerButton} onPress={() => setDrawerOpen(true)}>
            <Text style={styles.hamburgerText}>☰</Text>
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

        {/* Names the two marks on the map and gives the real totals behind them.
            Only after a poll has landed — an empty chip would read as "no cars"
            when it actually means "still looking". */}
        {activity.loaded ? (
          <MapActivityChip
            driverCount={activity.driverCount}
            passengerCount={activity.passengerCount}
            waitingCount={activity.waitingCount}
          />
        ) : null}
      </SafeAreaView>

      {/* 3. Bottom Booking Sheet — drag the grabber to resize it, or tap the
             grabber to swap between this height and (near) full screen. */}
      <DraggableSheet style={styles.bottomSheet}>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.bottomSheetContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

        {/* ── Where to? — the ONE way into a city ride.
             Pool discovery ("rides going your way") used to sit here as a second
             entry point doing the same job; it now lives inside this flow, right
             after the destination is set, so there is only one path to follow. ── */}
        <Pressable style={styles.searchHero} onPress={() => router.push('/passenger/booking')}>
          <View style={styles.searchHeroIcon}>
            <SearchIcon size={20} color="#0b0d0c" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchHeroTitle}>Where to?</Text>
            <Text style={styles.searchHeroSub}>Join a pool going your way — or ride solo</Text>
          </View>
          <Text style={styles.searchHeroArrow}>→</Text>
        </Pressable>

        {/* ── Nothing moving nearby → the honest moment to pitch earning.
             Sits directly under "Where to?" so it is seen, but never on top of
             it: booking a ride stays the first thing on this screen even when
             the area is empty. ── */}
        {showQuietPitch ? (
          <QuietAreaCard
            onEarn={() => router.push('/passenger/earn')}
            onDrive={goDriverMode}
            onDismiss={() => setQuietDismissed(true)}
          />
        ) : null}

        {/* ── Speak instead of typing.
             Sits directly under "Where to?" because it is the same job by a
             different route — the one that works for riders who cannot
             comfortably read or type. Hidden on handsets with no speech
             recogniser (typically no-GMS devices), where tapping it could only
             lead to an apology. ── */}
        {voiceAvailable ? (
          <Pressable
            style={styles.voiceHero}
            onPress={() => router.push('/passenger/voice')}
            accessibilityRole="button"
            accessibilityLabel="Book a ride by speaking"
          >
            <View style={styles.voiceHeroIcon}>
              <MicIcon size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.voiceHeroTitle}>Bol kar book karein</Text>
              <Text style={styles.voiceHeroSub}>Tap and just say where you want to go</Text>
            </View>
          </Pressable>
        ) : null}

        {/* ── Services — city rides live in "Where to?", so only the two
             services that are NOT plain city rides get tiles ── */}
        <Text style={styles.sectionLabel}>Services</Text>
        <View style={styles.serviceGrid}>
          <ServiceTile
            title="City to City"
            sub="Intercity seats"
            Icon={IntercityIcon}
            onPress={() => router.push('/passenger/city-to-city')}
          />
          <ServiceTile
            title="Couriers"
            sub="Send a parcel"
            Icon={CourierIcon}
            onPress={() => router.push('/passenger/couriers')}
          />
        </View>

        {/* ── Travel Partner card ── */}
        <TravelMateCard onPress={() => router.push('/passenger/travel-mate')} />

        {/* ── Earn with Velocity card ── */}
        <EarnCard onPress={() => router.push('/passenger/earn')} />

        <View style={{ height: 20 }} />
        </ScrollView>
      </DraggableSheet>

      {/* 4. Custom Slide-out Side Drawer Menu Overlay */}
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

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/activity')}>
                    <Text style={styles.menuItemIcon}>🕒</Text>
                    <Text style={styles.menuItemText}>Request history</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/wallet')}>
                    <Text style={styles.menuItemIcon}>💳</Text>
                    <Text style={styles.menuItemText}>{walletLabel}</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/couriers')}>
                    <Text style={styles.menuItemIcon}>📦</Text>
                    <Text style={styles.menuItemText}>Couriers</Text>
                  </Pressable>

                  {/* "Business" rather than "Business delivery": the hub behind
                      it carries both deliveries and Find your Customers. */}
                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/business')}>
                    <Text style={styles.menuItemIcon}>💼</Text>
                    <Text style={styles.menuItemText}>Business</Text>
                  </Pressable>

                  {/* City to City and Notifications intentionally live only on
                      the home screen (a service tile and the header bell) —
                      duplicating them here just made the drawer longer. */}

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/saved-places')}>
                    <Text style={styles.menuItemIcon}>🔖</Text>
                    <Text style={styles.menuItemText}>Saved places</Text>
                  </Pressable>

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
                    <Text style={styles.menuItemText}>Earn with Velocity</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/travel-mate/matches')}>
                    <Text style={styles.menuItemIcon}>💬</Text>
                    <Text style={styles.menuItemText}>Matches & Groups</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={openSafety}>
                    <Text style={styles.menuItemIcon}>🛡️</Text>
                    <Text style={styles.menuItemText}>Safety</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/settings')}>
                    <Text style={styles.menuItemIcon}>⚙️</Text>
                    <Text style={styles.menuItemText}>Settings</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/support-chat')}>
                    <Text style={styles.menuItemIcon}>💬</Text>
                    <Text style={styles.menuItemText}>Support</Text>
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

/**
 * One service in the home grid. All four tiles are the same size — the old
 * layout gave City Rides a double-width card and squeezed the rest, which is
 * what made the grid look lopsided. The lead service is marked by a lime tint
 * instead, so the hierarchy reads without breaking the geometry.
 */
function ServiceTile({
  title,
  sub,
  Icon,
  featured = false,
  onPress,
}: {
  title: string;
  sub: string;
  Icon: (props: ServiceIconProps) => ReactElement;
  featured?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.serviceTile,
        featured && styles.serviceTileFeatured,
        pressed && styles.serviceTilePressed,
      ]}
      onPress={onPress}
    >
      <View style={[styles.serviceIconWrap, featured && styles.serviceIconWrapFeatured]}>
        <Icon size={26} color={featured ? colors.primary : '#ffffff'} />
      </View>
      <Text style={styles.serviceTitle}>{title}</Text>
      <Text style={styles.serviceSub} numberOfLines={1}>{sub}</Text>
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
    paddingTop: 4,
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
  /* ── "Where to?" hero — the sheet's primary action ── */
  searchHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  searchHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHeroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.2,
  },
  /* ── "Bol kar book karein" — the voice route into the same booking flow ── */
  voiceHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(204,255,0,0.10)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 10,
  },
  voiceHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(204,255,0,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHeroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.2,
  },
  voiceHeroSub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  searchHeroSub: {
    fontSize: 12,
    color: '#8f9694',
    marginTop: 2,
  },
  searchHeroArrow: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '800',
  },

  /* ── Services ── */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7d8482',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  serviceTile: {
    // Two per row: half the sheet's content width, minus half the 10px gutter.
    width: (width - 40 - 10) / 2,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 14,
    gap: 2,
  },
  serviceTileFeatured: {
    backgroundColor: 'rgba(204,255,0,0.08)',
    borderColor: 'rgba(204,255,0,0.30)',
  },
  serviceTilePressed: { opacity: 0.65 },
  serviceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  serviceIconWrapFeatured: { backgroundColor: 'rgba(204,255,0,0.12)' },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  serviceSub: {
    fontSize: 11,
    color: '#8f9694',
  },
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

