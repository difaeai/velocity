import { useState } from 'react';
import {
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

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { Badge } from '../../src/ui/components';

const { width } = Dimensions.get('window');

export default function PassengerHome() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <View style={styles.container}>
      {/* 1. Full-Screen Dark Map Representation */}
      <View style={styles.mapContainer}>
        {/* Abstract Map Roads */}
        <View style={[styles.road, { top: 120, left: -50, width: width + 100, transform: [{ rotate: '-15deg' }] }]} />
        <View style={[styles.road, { top: 320, left: -50, width: width + 100, transform: [{ rotate: '25deg' }] }]} />
        <View style={[styles.road, { top: 500, left: -50, width: width + 100, transform: [{ rotate: '-5deg' }] }]} />
        <View style={[styles.road, { top: 0, left: 100, width: 6, height: '100%' }]} />
        <View style={[styles.road, { top: 0, left: 280, width: 8, height: '100%', transform: [{ rotate: '10deg' }] }]} />

        {/* Mock Map Pins */}
        <View style={[styles.mapPin, { top: 150, left: 80 }]}>
          <Text style={styles.pinIcon}>📍</Text>
          <View style={styles.pulseRing} />
        </View>

        <View style={[styles.cabPin, { top: 260, left: 240 }]}>
          <Text style={styles.cabEmoji}>🚗</Text>
        </View>
        <View style={[styles.cabPin, { top: 450, left: 70 }]}>
          <Text style={styles.cabEmoji}>🏍️</Text>
        </View>

        {/* Right side floating controls from Mockup */}
        <View style={styles.rightControlsContainer}>
          <View style={styles.circleControl}>
            <Text style={styles.controlText}>−</Text>
          </View>
          <View style={styles.circleControl}>
            <Text style={styles.cabIconSmall}>🚗</Text>
          </View>
          <View style={styles.circleControl}>
            <Text style={styles.cabIconSmall}>🏍️</Text>
          </View>
        </View>
      </View>

      {/* 2. Top Navigation Overlay */}
      <SafeAreaView style={styles.headerSafeArea} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.hamburgerButton} onPress={() => setDrawerOpen(true)}>
            <Text style={styles.hamburgerText}>☰</Text>
          </Pressable>
          <View style={styles.notificationButton}>
            <Text style={styles.notificationText}>🔔</Text>
            <View style={styles.badgeDot} />
          </View>
        </View>
      </SafeAreaView>

      {/* 3. Bottom Booking Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragIndicator} />
        <Text style={styles.sheetTitle}>Where are you going?</Text>
        
        <Pressable
          style={styles.searchTrigger}
          onPress={() => router.push('/passenger/booking')}
        >
          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchPlaceholder}>Enter destination...</Text>
          </View>
          <View style={styles.mapShortcut}>
            <Text style={styles.shortcutIcon}>🗺️</Text>
          </View>
        </Pressable>

        <View style={styles.quickAddresses}>
          <Pressable style={styles.quickItem} onPress={() => router.push('/passenger/booking')}>
            <View style={styles.quickIconCircle}>
              <Text style={styles.quickEmoji}>🏢</Text>
            </View>
            <View>
              <Text style={styles.quickName}>Bahria University</Text>
              <Text style={styles.quickDesc}>E-8/1, Islamabad</Text>
            </View>
          </Pressable>
          
          <Pressable style={styles.quickItem} onPress={() => router.push('/passenger/booking')}>
            <View style={styles.quickIconCircle}>
              <Text style={styles.quickEmoji}>🏠</Text>
            </View>
            <View>
              <Text style={styles.quickName}>Saved Home</Text>
              <Text style={styles.quickDesc}>Street 13, Sector F-11</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* 4. Custom Slide-out Side Drawer Menu Overlay */}
      <Modal
        visible={drawerOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerOverlay}>
          {/* Backdrop (Tapping here closes the drawer) */}
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
          
          {/* Drawer Content */}
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
                    <Text style={styles.profileName}>Hassan</Text>
                    <View style={styles.ratingRow}>
                      <Text style={styles.stars}>★★★★★</Text>
                      <Text style={styles.ratingValue}>5.0 (11)</Text>
                    </View>
                  </View>
                  <Text style={styles.profileArrow}>➔</Text>
                </Pressable>

                {/* List Items */}
                <View style={styles.menuList}>
                  <Pressable style={[styles.menuItem, styles.menuItemActive]} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🚗</Text>
                    <Text style={[styles.menuItemText, styles.menuItemTextActive]}>City</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => { setDrawerOpen(false); router.push('/passenger/profile'); }}>
                    <Text style={styles.menuItemIcon}>🕒</Text>
                    <Text style={styles.menuItemText}>Request history</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>📦</Text>
                    <Text style={styles.menuItemText}>Couriers</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>💼</Text>
                    <Text style={styles.menuItemText}>Business delivery</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🌐</Text>
                    <Text style={styles.menuItemText}>City to City</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🔖</Text>
                    <Text style={styles.menuItemText}>Saved places</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🚚</Text>
                    <Text style={styles.menuItemText}>Freight</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🔔</Text>
                    <Text style={styles.menuItemText}>Notifications</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>🛡️</Text>
                    <Text style={styles.menuItemText}>Safety</Text>
                  </Pressable>

                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setDrawerOpen(false);
                      router.push('/passenger/profile');
                    }}
                  >
                    <Text style={styles.menuItemIcon}>⚙️</Text>
                    <Text style={styles.menuItemText}>Settings</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
                    <Text style={styles.menuItemIcon}>ℹ️</Text>
                    <Text style={styles.menuItemText}>Help</Text>
                  </Pressable>

                  <Pressable style={styles.menuItem} onPress={() => setDrawerOpen(false)}>
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
                <Pressable
                  style={styles.driverModeButton}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push('/driver/home');
                  }}
                >
                  <Text style={styles.driverModeText}>Driver mode</Text>
                </Pressable>

                {/* Social Links */}
                <View style={styles.socialsRow}>
                  <Text style={styles.socialIcon}>ⓕ</Text>
                  <Text style={styles.socialIcon}>📷</Text>
                </View>
              </View>
            </SafeAreaView>
          </View>
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
  searchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#212222',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
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
    fontSize: 15,
    fontWeight: '600',
  },
  mapShortcut: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutIcon: {
    fontSize: 14,
  },
  quickAddresses: {
    marginTop: 18,
    gap: 16,
  },
  quickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d2f2f',
  },
  quickEmoji: {
    fontSize: 16,
  },
  quickName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  quickDesc: {
    fontSize: 12,
    color: '#8a8c8c',
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

