import { useEffect, useState } from 'react';
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
import { useCurrentLocation } from '../../src/hooks/location';
import { useRecentDestinations } from '../../src/hooks/passenger';
import { colors } from '../../src/config';
import { comingSoon } from '../../src/ui/components';
import { LiveMap } from '../../src/ui/LiveMap';

const { width } = Dimensions.get('window');

export default function PassengerHome() {
  const { user, role, signOut } = useAuth();
  const router = useRouter();
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const recents = useRecentDestinations(user?.uid);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [poolFromPrice, setPoolFromPrice] = useState<number | null>(null);

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
    router.push(role === 'driver' ? '/driver/home' : '/passenger/become-driver');
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

          <Pressable style={styles.notificationButton} onPress={() => router.push('/passenger/notifications')}>
            <Text style={styles.notificationText}>🔔</Text>
            <View style={styles.badgeDot} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* 3. Bottom Booking Sheet (Image 5 grid layout) */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragIndicator} />
        
        {/* ── HERO: Ride Sharing ── */}
        <Pressable style={styles.poolHero} onPress={() => router.push('/passenger/pool-ride')}>
          <View style={styles.poolHeroBody}>
            <View style={styles.poolHeroTopRow}>
              <Text style={styles.poolHeroTitle}>Ride Sharing</Text>
              <View style={styles.poolPillBadge}>
                <Text style={styles.poolPillBadgeText}>POOL</Text>
              </View>
            </View>
            <Text style={styles.poolHeroSub}>Share · Save up to 65% · Travel smart</Text>
            <View style={styles.poolGenderTag}>
              <Text style={styles.poolGenderTagText}>🔒 Same gender by default</Text>
            </View>
            <View style={styles.poolSeatsRow}>
              <Text style={styles.poolSeatIcon}>💺</Text>
              <Text style={styles.poolSeatIcon}>💺</Text>
              <Text style={styles.poolSeatIcon}>💺</Text>
              <Text style={styles.poolSeatIcon}>💺</Text>
              <Text style={styles.poolSeatsLabel}>Up to 4 riders</Text>
            </View>
          </View>
          <View style={styles.poolHeroPriceCol}>
            <Text style={styles.poolHeroPriceFrom}>From</Text>
            <Text style={styles.poolHeroPriceAmt}>{poolFromPrice ?? '—'}</Text>
            <Text style={styles.poolHeroPriceSub}>PKR/seat</Text>
            <Text style={styles.poolHeroArrow}>→</Text>
          </View>
        </Pressable>

        {/* ── Secondary Services ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 14 }}
          contentContainerStyle={styles.chipsRow}
        >
          {[
            { icon: '🚕', label: 'City Rides',   route: '/passenger/booking' },
            { icon: '🚌', label: 'City to City',  route: '/passenger/city-to-city' },
            { icon: '📦', label: 'Couriers',      route: '/passenger/couriers' },
            { icon: '💼', label: 'Business',      route: '/passenger/business-delivery' },
          ].map((s) => (
            <Pressable
              key={s.label}
              style={styles.chip}
              onPress={() => router.push(s.route as Parameters<typeof router.push>[0])}
            >
              <Text style={styles.chipEmoji}>{s.icon}</Text>
              <Text style={styles.chipLabel}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Search trigger bar */}
        <Pressable
          style={styles.searchTrigger}
          onPress={() => router.push('/passenger/booking')}
        >
          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchPlaceholder}>Where to & for how much?</Text>
          </View>
        </Pressable>

        {/* Recent destinations from the rider's own trips (real data) */}
        {recents.length > 0 ? (
          <View style={styles.historyList}>
            {recents.slice(0, 4).map((r) => (
              <Pressable
                key={r.address}
                style={styles.historyItem}
                onPress={() => router.push('/passenger/booking')}
              >
                <Text style={styles.historyIcon}>🕒</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName} numberOfLines={1}>{r.address}</Text>
                  <Text style={styles.historyAddress}>Recent destination</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

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
    backgroundColor: '#212222',
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
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
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
    backgroundColor: '#212222',
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
  notificationButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#212222',
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
    backgroundColor: '#151616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: '#2d2f2f',
  },
  dragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3e4040',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 16,
  },
  pickupPillFloating: {
    position: 'absolute',
    left: 80,
    right: 80,
    top: 4,
    backgroundColor: '#1e1f1f',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    justifyContent: 'space-between',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  pickupMeta: {
    flex: 1,
  },
  pickupPillTitle: {
    fontSize: 9,
    color: '#8a8c8c',
    fontWeight: '700',
  },
  pickupPillValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  pickupArrow: {
    fontSize: 10,
    color: '#8a8c8c',
    marginLeft: 6,
  },
  /* ── Pool hero card ── */
  poolHero: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 120,
  },
  poolHeroBody: { flex: 1, gap: 5 },
  poolHeroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  poolHeroTitle: { fontSize: 20, fontWeight: '900', color: '#000' },
  poolPillBadge: {
    backgroundColor: '#000',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  poolPillBadgeText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  poolHeroSub: { fontSize: 12, color: '#1c1c1c', fontWeight: '600' },
  poolGenderTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00000015',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  poolGenderTagText: { fontSize: 11, color: '#000', fontWeight: '700' },
  poolSeatsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  poolSeatIcon: { fontSize: 13 },
  poolSeatsLabel: { fontSize: 11, color: '#333', fontWeight: '700', marginLeft: 3 },
  poolHeroPriceCol: { alignItems: 'center', paddingLeft: 14, gap: 1 },
  poolHeroPriceFrom: { fontSize: 10, color: '#444', fontWeight: '600' },
  poolHeroPriceAmt: { fontSize: 28, fontWeight: '900', color: '#000', lineHeight: 30 },
  poolHeroPriceSub: { fontSize: 10, color: '#444', fontWeight: '600' },
  poolHeroArrow: { fontSize: 22, color: '#000', fontWeight: '900', marginTop: 4 },

  /* ── Secondary service chips ── */
  chipsRow: { gap: 10, paddingRight: 4 },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    minWidth: 82,
  },
  chipEmoji: { fontSize: 22 },
  chipLabel: { fontSize: 11, fontWeight: '800', color: colors.text },
  searchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#212222',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: '#2d2f2f',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchPlaceholder: {
    color: '#8a8c8c',
    fontSize: 14,
    fontWeight: '600',
  },
  historyList: {
    marginTop: 14,
    gap: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 12,
  },
  historyIcon: {
    fontSize: 16,
    color: '#8a8c8c',
  },
  historyName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  historyAddress: {
    fontSize: 11,
    color: '#8a8c8c',
    marginTop: 1,
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
    backgroundColor: '#1c1b1b',
    borderRightWidth: 1,
    borderRightColor: '#2d2f2f',
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
    borderBottomColor: '#2d2f2f',
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2e3030',
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
    backgroundColor: '#2d2f2f',
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
    borderTopColor: '#2d2f2f',
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

