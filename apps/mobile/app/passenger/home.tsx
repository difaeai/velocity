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
import { registerForPushNotifications } from '../../src/lib/notifications';
import { useCurrentLocation } from '../../src/hooks/location';
import { useRecentDestinations } from '../../src/hooks/passenger';
import { colors } from '../../src/config';
import { comingSoon } from '../../src/ui/components';
import { LiveMap } from '../../src/ui/LiveMap';
import { TravelMateCard } from '../../src/ui/TravelMateCard';
import { CarIllustration, MotoIllustration } from '../../src/ui/VehicleIllustrations';

const { width } = Dimensions.get('window');

export default function PassengerHome() {
  const { user, role, signOut } = useAuth();
  const router = useRouter();
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
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

      {/* 3. Bottom Booking Sheet */}
      <ScrollView
        style={styles.bottomSheet}
        contentContainerStyle={styles.bottomSheetContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.dragIndicator} />

        {/* ── Service category grid (inDrive style) ── */}
        <View style={styles.serviceGrid}>
          {/* Left: big City Rides card */}
          <Pressable
            style={styles.cityRidesCard}
            onPress={() => router.push('/passenger/booking')}
          >
            <Text style={styles.cityRidesTitle}>City Rides</Text>
            <View style={styles.cityRidesIllustration}>
              <CarIllustration width={100} height={52} />
              <MotoIllustration width={64} height={52} />
            </View>
          </Pressable>

          {/* Right: stacked smaller cards */}
          <View style={styles.serviceRightCol}>
            <Pressable
              style={styles.serviceCardLg}
              onPress={() => router.push('/passenger/city-to-city')}
            >
              <Text style={styles.serviceCardTitle}>City to City</Text>
              <Text style={styles.serviceCardIcon}>🚗💼</Text>
            </Pressable>

            <View style={styles.serviceBottomRow}>
              <Pressable
                style={styles.serviceCardSm}
                onPress={() => router.push('/passenger/couriers')}
              >
                <Text style={styles.serviceCardTitle}>Couriers</Text>
                <Text style={styles.serviceCardIconSm}>📦</Text>
              </Pressable>
              <Pressable
                style={styles.serviceCardSm}
                onPress={() => router.push('/passenger/business-delivery')}
              >
                <Text style={styles.serviceCardTitle}>Freight</Text>
                <Text style={styles.serviceCardIconSm}>🚛</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Main search / booking bar ── */}
        <Pressable
          style={styles.searchBar}
          onPress={() => router.push('/passenger/booking')}
        >
          <Text style={styles.searchBarIcon}>🔍</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchBarTitle}>Where to &amp; for how much?</Text>
          </View>
          <Text style={styles.searchBarArrow}>→</Text>
        </Pressable>

        {/* Recent destinations */}
        {recents.length > 0 && (
          <View style={styles.historyList}>
            {recents.slice(0, 3).map((r) => (
              <Pressable
                key={r.address}
                style={styles.historyItem}
                onPress={() => router.push('/passenger/booking')}
              >
                <View style={styles.historyIconCircle}>
                  <Text style={styles.historyIcon}>🕒</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName} numberOfLines={1}>{r.address}</Text>
                  <Text style={styles.historyAddress} numberOfLines={1}>{r.address}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── Travel Mate card ── */}
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
                    <Text style={styles.menuItemText}>Travel Mate</Text>
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
    height: '55%',
    backgroundColor: '#151616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#2d2f2f',
  },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 10,
    gap: 14,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3e4040',
    alignSelf: 'center',
    marginBottom: 4,
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
  /* ── Service card grid ── */
  serviceGrid: {
    flexDirection: 'row',
    gap: 10,
    height: 160,
  },
  cityRidesCard: {
    flex: 0.9,
    backgroundColor: '#1a2210',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2e4010',
    padding: 14,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cityRidesTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  cityRidesIllustration: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 6,
    marginBottom: -2,
  },
  serviceRightCol: {
    flex: 1,
    gap: 10,
  },
  serviceCardLg: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 12,
    justifyContent: 'space-between',
  },
  serviceBottomRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  serviceCardSm: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 10,
    justifyContent: 'space-between',
  },
  serviceCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  serviceCardIcon:   { fontSize: 22, textAlign: 'right' },
  serviceCardIconSm: { fontSize: 18, textAlign: 'right' },

  /* ── Search bar ── */
  searchBar: {
    backgroundColor: '#212222',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchBarIcon:  { fontSize: 18, color: '#8a8c8c' },
  searchBarTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  searchBarArrow: { fontSize: 16, color: '#8a8c8c' },

  /* ── Recent destinations ── */
  historyList: {
    marginTop: 4,
    gap: 0,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1f1f',
    gap: 12,
  },
  historyIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIcon: {
    fontSize: 16,
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

