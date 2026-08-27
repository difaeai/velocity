import { useRef, useEffect } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { useRouter } from 'expo-router';

import { colors } from '../config';
import { useWalletLabel } from '../hooks/driver';
import { otherLanguageLabel, toggleLanguage } from '../i18n';
import { getThemeMode, toggleTheme, themed } from '../theme';

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
  /** Render the label verbatim — for labels that are already in the language
   *  they name, like the English ⇄ اردو switch. */
  rawLabel?: boolean;
}

function NavItem({ icon, label, onPress, danger, rawLabel }: NavItemProps) {
  const labelStyle = [styles.navLabel, danger && { color: colors.danger }];
  return (
    <Pressable
      style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
      onPress={onPress}
    >
      <Text style={styles.navIcon}>{icon}</Text>
      {rawLabel ? (
        <RNText style={labelStyle}>{label}</RNText>
      ) : (
        <Text style={labelStyle}>{label}</Text>
      )}
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
  const insets  = useSafeAreaInsets();
  const slideX  = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const walletLabel = useWalletLabel('Wallet & Payouts');

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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, 24) + 4,
              paddingBottom: Math.max(insets.bottom, 20) + 16,
            },
          ]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
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
            <NavItem icon="💳" label={walletLabel}            onPress={() => go('/driver/wallet')} />
            {/* Pool work, kept apart from the solo feed on the home tab. Passengers
                asking for a shared ride are a different job — several pickups and
                drop-offs, a fare to accept or counter — so they get their own
                screen rather than being mixed into the incoming solo requests. */}
            <NavItem icon="👥" label="Sharing ride requests"  onPress={() => go('/driver/pool-requests')} />
            <NavItem icon="📍" label="Offer a Pool Route"     onPress={() => go('/driver/pool-ride-offer')} />
            {/* The only channel that reaches a driver with the app closed — which
                is exactly when they are missing fares and have no idea. Its own
                drawer entry because a driver who never opens Settings would
                otherwise never find it, and a number nobody corrects is a number
                the alerts bounce off. */}
            <NavItem icon="💬" label="WhatsApp ride alerts"   onPress={() => go('/driver/whatsapp-alerts')} />
            {/* Where a driver recruited by a Velocity partner enters their code. */}
            <NavItem icon="🎁" label="Referral code"          onPress={() => go('/referral-code')} />
          </View>

          <View style={styles.divider} />

          <View style={styles.navSection}>
            <NavItem icon="🧍" label="Ride as Passenger"      onPress={() => go('/passenger/home')} />
            <NavItem
              icon={getThemeMode() === 'dark' ? '☀️' : '🌙'}
              label={getThemeMode() === 'dark' ? 'Light Mode' : 'Dark Mode'}
              onPress={async () => {
                onClose();
                const reloaded = await toggleTheme();
                if (!reloaded) {
                  Alert.alert('Theme saved ✅', 'Close and reopen Velocity to apply the new theme everywhere.');
                }
              }}
            />
            {/* Drivers who never open the passenger home still need a way to
                reach Urdu — the passenger-side switch lives in that header. */}
            <NavItem
              icon="🌐"
              label={otherLanguageLabel()}
              rawLabel
              onPress={() => {
                onClose();
                toggleLanguage().catch(() => {});
              }}
            />
            <NavItem icon="🚪" label="Sign out" onPress={() => { onClose(); setTimeout(onSignOut, 220); }} danger />
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
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
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },

  profileSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassChip,
    alignItems: 'center',
    gap: 3,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarLetter:  { fontSize: 24, fontWeight: '900', color: '#1a1a1a' },
  driverName:    { fontSize: 15, fontWeight: '800', color: '#fff', textAlign: 'center' },
  driverEmail:   { fontSize: 11, color: colors.muted, textAlign: 'center' },

  statsRow:      { flexDirection: 'row', marginTop: 8, gap: 0 },
  stat:          { flex: 1, alignItems: 'center', gap: 1 },
  statNum:       { fontSize: 13, fontWeight: '800', color: '#fff' },
  statLabel:     { fontSize: 9, color: colors.muted },
  statDivider:   { width: 1, backgroundColor: colors.glassChip, marginVertical: 2 },

  navSection:    { paddingVertical: 4, paddingHorizontal: 10 },
  navItem:       {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 12,
    gap: 12,
  },
  navItemPressed:{ backgroundColor: colors.glassChip },
  navIcon:       { fontSize: 18, width: 26, textAlign: 'center' },
  navLabel:      { fontSize: 15, fontWeight: '700', color: '#fff' },

  divider:       { height: 1, backgroundColor: colors.glassChip, marginHorizontal: 16, marginVertical: 2 },
}));
