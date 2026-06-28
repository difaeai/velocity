import { useRef, useEffect } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '../config';

const DRAWER_WIDTH = Dimensions.get('window').width * 0.78;

interface Props {
  visible: boolean;
  onClose: () => void;
  driverName: string;
  driverEmail: string;
  online: boolean;
  tripsCount: number;
  rating: number;
  onSignOut: () => void;
}

interface NavItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

function NavItem({ icon, label, onPress, danger }: NavItemProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
      onPress={onPress}
    >
      <Text style={styles.navIcon}>{icon}</Text>
      <Text style={[styles.navLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function DriverDrawer({
  visible,
  onClose,
  driverName,
  driverEmail,
  online,
  tripsCount,
  rating,
  onSignOut,
}: Props) {
  const router  = useRouter();
  const slideX  = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideX,  { toValue: 0,   useNativeDriver: true, damping: 20, stiffness: 180 }),
        Animated.timing(opacity, { toValue: 1,   useNativeDriver: true, duration: 200 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX,  { toValue: -DRAWER_WIDTH, useNativeDriver: true, duration: 200 }),
        Animated.timing(opacity, { toValue: 0,              useNativeDriver: true, duration: 180 }),
      ]).start();
    }
  }, [visible, opacity, slideX]);

  function go(route: string) {
    onClose();
    setTimeout(() => router.push(route as `/${string}`), 220);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Dim overlay */}
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Slide-in panel */}
      <Animated.View style={[styles.panel, { transform: [{ translateX: slideX }] }]}>
        {/* Profile header */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {(driverName || driverEmail)[0]?.toUpperCase() ?? 'D'}
            </Text>
          </View>
          <Text style={styles.driverName} numberOfLines={1}>{driverName || driverEmail}</Text>
          <Text style={styles.driverEmail} numberOfLines={1}>{driverEmail}</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{tripsCount}</Text>
              <Text style={styles.statLabel}>Trips</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{rating.toFixed(1)}★</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: online ? colors.primary : colors.muted }]}>
                {online ? 'Online' : 'Offline'}
              </Text>
              <Text style={styles.statLabel}>Status</Text>
            </View>
          </View>
        </View>

        {/* Navigation links */}
        <View style={styles.navSection}>
          <NavItem icon="🏠" label="Home"                   onPress={() => go('/driver/home')} />
          <NavItem icon="📊" label="Earnings"               onPress={() => go('/driver/earnings')} />
          <NavItem icon="💳" label="Wallet & Payouts"       onPress={() => go('/driver/wallet')} />
          <NavItem icon="📍" label="Offer a Pool Route"     onPress={() => go('/driver/pool-ride-offer')} />
        </View>

        <View style={styles.divider} />

        <View style={styles.navSection}>
          <NavItem icon="🚪" label="Sign out" onPress={() => { onClose(); setTimeout(onSignOut, 220); }} danger />
        </View>

        {/* Branding */}
        <View style={styles.brand}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandV}>V</Text>
          </View>
          <Text style={styles.brandName}>Velocity</Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#1a1c1c',
    paddingTop: 56,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },

  profileSection: {
    padding: 20,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarLetter:  { fontSize: 34, fontWeight: '900', color: '#1a1a1a' },
  driverName:    { fontSize: 18, fontWeight: '900', color: '#fff', textAlign: 'center' },
  driverEmail:   { fontSize: 12, color: colors.muted, textAlign: 'center' },

  statsRow:      { flexDirection: 'row', marginTop: 12, gap: 0 },
  stat:          { flex: 1, alignItems: 'center', gap: 2 },
  statNum:       { fontSize: 15, fontWeight: '800', color: '#fff' },
  statLabel:     { fontSize: 10, color: colors.muted },
  statDivider:   { width: 1, backgroundColor: '#2a2a2a', marginVertical: 4 },

  navSection:    { paddingVertical: 8, paddingHorizontal: 12 },
  navItem:       {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 14,
  },
  navItemPressed:{ backgroundColor: '#2a2a2a' },
  navIcon:       { fontSize: 20, width: 28, textAlign: 'center' },
  navLabel:      { fontSize: 16, fontWeight: '700', color: '#fff' },

  divider:       { height: 1, backgroundColor: '#2a2a2a', marginHorizontal: 20, marginVertical: 4 },

  brand:         { position: 'absolute', bottom: 32, left: 20, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandBadge:    { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandV:        { fontSize: 18, fontWeight: '900', color: '#1a1a1a' },
  brandName:     { fontSize: 18, fontWeight: '900', color: '#fff' },
});
