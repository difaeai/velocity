/**
 * Persistent bottom navigation for the driver experience:
 *
 *   Ride requests · Demand · Performance · Wallet
 *
 * The driver routes live under a Stack (not expo-router Tabs) because the
 * detail screens — request detail, pool pickup — must cover the full screen
 * with no tab bar underneath. So the bar is a component the four top-level
 * driver screens render themselves, rather than a layout wrapper.
 *
 * Switching tabs uses `replace`, so the four tabs never stack on top of each
 * other in the history — Android back from any tab leaves the driver app
 * instead of walking back through every tab visited.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../config';
import { themed } from '../theme';
import { useWalletComingSoon } from '../hooks/driver';

export type DriverTab = 'requests' | 'demand' | 'performance' | 'wallet';

/** Height of the bar itself, excluding the device's bottom safe-area inset. */
export const DRIVER_TAB_BAR_HEIGHT = 62;

type Href = Parameters<ReturnType<typeof useRouter>['replace']>[0];

const TABS: { key: DriverTab; label: string; href: Href }[] = [
  { key: 'requests',    label: 'Ride requests', href: '/driver/home' },
  { key: 'demand',      label: 'Demand',        href: '/driver/demand' },
  { key: 'performance', label: 'Performance',   href: '/driver/earnings' },
  { key: 'wallet',      label: 'Wallet',        href: '/driver/wallet' },
];

function TabIcon({ tab, color }: { tab: DriverTab; color: string }) {
  const d = ICON_PATHS[tab];
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d={d} fill={color} />
    </Svg>
  );
}

const ICON_PATHS: Record<DriverTab, string> = {
  // List — the queue of incoming requests
  requests: 'M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zM3 17h2v2H3v-2zm4 0h14v2H7v-2z',
  // Bolt — surge / demand
  demand: 'M11 21h-1l1-7H6.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C7.88 10.2 10.1 6.3 13 1h1l-1 7h4.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
  // Grid — performance dashboard
  performance: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  // Wallet
  wallet: 'M21 7.28V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2.28A2 2 0 0 0 22 15V9a2 2 0 0 0-1-1.72zM20 9v6h-7V9h7zM5 19V5h14v2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6v2H5zm11-7a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
};

export function DriverTabBar({ active }: { active: DriverTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const walletComingSoon = useWalletComingSoon();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: DRIVER_TAB_BAR_HEIGHT + insets.bottom }]}>
      {TABS.map((t) => {
        const focused = t.key === active;
        const tint = focused ? colors.text : colors.muted;
        // A tab is a quarter of the screen at 11pt — "Wallet (Coming soon)"
        // would truncate to nonsense, so the badge carries it here and the
        // full wording appears on the drawer rows and the screen itself.
        const soon = t.key === 'wallet' && walletComingSoon;
        return (
          <Pressable
            key={t.key}
            style={styles.tab}
            onPress={() => { if (!focused) router.replace(t.href); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={soon ? `${t.label} (Coming soon)` : t.label}
          >
            <View>
              <TabIcon tab={t.key} color={tint} />
              {soon ? (
                <View style={styles.soonDot}>
                  <Text style={styles.soonDotText}>soon</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color: tint }, focused && styles.labelActive]} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 9,
  },
  label:       { fontSize: 11, fontWeight: '600' },
  labelActive: { fontWeight: '800' },
  soonDot: {
    position: 'absolute',
    top: -6,
    left: 14,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  soonDotText: { fontSize: 8, fontWeight: '900', color: colors.btnText, textTransform: 'uppercase' },
}));
