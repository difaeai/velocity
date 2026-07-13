import { useEffect, useState, type ReactElement } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { registerForPushNotifications } from '../../src/lib/notifications';
import { useCurrentLocation } from '../../src/hooks/location';
import { useDriverEntry } from '../../src/hooks/useDriverEntry';
import { useRecentDestinations } from '../../src/hooks/passenger';
import { colors } from '../../src/config';
import { comingSoon } from '../../src/ui/components';
import { LiveMap } from '../../src/ui/LiveMap';
import { TravelMateCard } from '../../src/ui/TravelMateCard';
import {
  CityRideIcon,
  ClockIcon,
  CourierIcon,
  FreightIcon,
  IntercityIcon,
  SearchIcon,
  type ServiceIconProps,
} from '../../src/ui/ServiceIcons';

const { width } = Dimensions.get('window');

export default function PassengerHome() {
  const { user, role, signOut } = useAuth();
  const router = useRouter();
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const driverEntry = useDriverEntry();
  const recents = useRecentDestinations(user?.uid);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [poolFromPrice, setPoolFromPrice] = useState<number | null>(null);

  // Register FCM push token on first load
  useEffect(() => {
    if (user) registerForPushNotifications().catch(() => {});
  }, [user?.uid]);

  // Fetch admin-configured Mini fare to show accurate "From X PKR/seat" on hero card
  useEffect(() => {
    getDoc(doc(db, 'config', 'rideFares'))
      .then((snap) => {
        const data = snap.data();
        const mini = data?.mini;
        if (mini?.baseFare && mini?.perKm) {
          // Example: 5 km average city trip, 4 riders (best pool scenario)
          const soloFare   = mini.baseFare + mini.perKm * 5;
          const factor     = (48 + (4 - 1) * (4 + 6)) / 48;
          const perSeat    = Math.ceil((soloFare * factor) / 4);
          setPoolFromPrice(perSeat);
        }
      })
      .catch(() => {});
  }, []);

  const pickupLabel = currentAddress ?? (coords ? 'Current location' : 'Set pickup location');

  const navTo = (path: string) => {
    setDrawerOpen(false);
    router.push(path);
  };
  const soon = (feature: string) => {
    setDrawerOpen(false);
    comingSoon(feature);
  };
  const openSafety = () => {
    setDrawerOpen(false);
    Alert.alert(
      'Safety',
      'During a ride you can trigger an Emergency SOS from the trip screen. Our team monitors safety events in real time.',
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
        <LiveMap coords={coords} />
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
            <Pressable style={styles.notificationButton} onPress={() => router.push('/passenger/notifications')}>
              <Text style={styles.notificationText}>🔔</Text>
              <View style={styles.badgeDot} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {/* 3. Bottom Booking Sheet */}
      <ScrollView
        style={styles.bottomSheet}
        contentContainerStyle={styles.bottomSheetContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.dragIndicator} />

        {/* ── Where to? — the primary action, so it leads the sheet ── */}
        <Pressable style={styles.searchHero} onPress={() => router.push('/passenger/booking')}>
          <View style={styles.searchHeroIcon}>
            <SearchIcon size={20} color="#0b0d0c" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchHeroTitle}>Where to?</Text>
            <Text style={styles.searchHeroSub}>Name your fare · drivers bid · pay cash</Text>
          </View>
          <Text style={styles.searchHeroArrow}>→</Text>
        </Pressable>

        {/* Recent destinations — tap to rebook the same drop-off */}
        {recents.length > 0 && (
          <View style={styles.historyList}>
            {recents.slice(0, 2).map((r) => (
              <Pressable
                key={r.address}
                style={styles.historyItem}
                onPress={() => router.push('/passenger/booking')}
              >
                <View style={styles.historyIconCircle}>
                  <ClockIcon size={15} color={colors.muted} />
                </View>
                <Text style={styles.historyName} numberOfLines={1}>{r.address}</Text>
                <Text style={styles.historyGo}>→</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── Services ── */}
        <Text style={styles.sectionLabel}>Services</Text>
        <View style={styles.serviceGrid}>
          <ServiceTile
            title="City Rides"
            sub={poolFromPrice ? `Pool from PKR ${poolFromPrice}/seat` : 'Car & bike, in your city'}
            Icon={CityRideIcon}
            featured
            onPress={() => router.push('/passenger/booking')}
          />
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
          <ServiceTile
            title="Freight"
            sub="Bulk & business"
            Icon={FreightIcon}
            onPress={() => router.push('/passenger/business-delivery')}
          />
        </View>

        {/* ── Travel Partner card ── */}
        <TravelMateCard onPress={() => router.push('/passenger/travel-mate')} />

        <View style={{ height: 20 }} />
      </ScrollView>

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
                    <Text style={styles.menuItemText}>Wallet &amp; payments</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/couriers')}>
                    <Text style={styles.menuItemIcon}>📦</Text>
                    <Text style={styles.menuItemText}>Couriers</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/business-delivery')}>
                    <Text style={styles.menuItemIcon}>💼</Text>
                    <Text style={styles.menuItemText}>Business delivery</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/city-to-city')}>
                    <Text style={styles.menuItemIcon}>🌐</Text>
                    <Text style={styles.menuItemText}>City to City</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/saved-places')}>
                    <Text style={styles.menuItemIcon}>🔖</Text>
                    <Text style={styles.menuItemText}>Saved places</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/notifications')}>
                    <Text style={styles.menuItemIcon}>🔔</Text>
                    <Text style={styles.menuItemText}>Notifications</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => navTo('/passenger/travel-mate')}>
                    <Text style={styles.menuItemIcon}>🤝</Text>
                    <Text style={styles.menuItemText}>Travel Partner</Text>
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

                {/* Social Links */}
                <View style={styles.socialsRow}>
                  <Text style={styles.socialIcon}>ⓕ</Text>
                  <Text style={styles.socialIcon}>📷</Text>
                </View>
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

const styles = StyleSheet.create({
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
    gap: 8,
  },
  notificationButton: {
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
  notificationText: {
    fontSize: 18,
  },
  badgeDot: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '58%',
    backgroundColor: 'rgba(11,13,12,0.96)',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 8,
    gap: 12,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 6,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 16,
  },
  pickupPillFloating: {
    position: 'absolute',
    left: 74,
    right: 74,
    top: 2,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 8,
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
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 1,
  },
  pickupArrow: {
    fontSize: 13,
    color: colors.primary,
    marginLeft: 8,
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

  /* ── Recent destinations ── */
  historyList: { gap: 2 },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    gap: 12,
  },
  historyIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#d8dcda',
  },
  historyGo: { fontSize: 13, color: '#5f6664' },

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
  socialsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  socialIcon: {
    color: '#8a8c8c',
    fontSize: 22,
  },
});

