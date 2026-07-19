import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { AdBanner } from '../../../src/ads';

/**
 * Screens within Earn that must stay ad-free.
 *
 * `apply` is a document-upload form and `withdraw` moves real money — the two
 * places where a stray tap costs the user the most and where an ad next to the
 * submit button reads as untrustworthy. Everything else (landing, dashboard,
 * revenue, analytics, fleet, referral) is browsing, which is where a banner
 * belongs.
 */
const AD_FREE = ['/passenger/earn/apply', '/passenger/earn/withdraw'];

/**
 * Earn with Velocity — the Partner Program.
 *
 * A plain stack rather than tabs: the dashboard is the hub and every section
 * pushes onto it, so the back gesture always means "up one level" instead of
 * fighting a tab bar the landing and application screens have no use for.
 */
export default function EarnLayout() {
  const pathname = usePathname();
  const showAd = !AD_FREE.includes(pathname);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        <EarnStack />
      </View>
      {/* Pinned below the stack, so it sits under the content on every Earn
          screen instead of being re-added inside each one. The safe-area edge
          keeps it clear of the Android gesture bar. */}
      {showAd && (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.background }}>
          <AdBanner />
        </SafeAreaView>
      )}
    </View>
  );
}

function EarnStack() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="apply" options={{ title: 'Partner application' }} />
      <Stack.Screen name="dashboard" options={{ headerShown: false }} />
      <Stack.Screen name="fleet" options={{ title: 'Fleet' }} />
      <Stack.Screen name="member/[uid]" options={{ title: 'Member' }} />
      <Stack.Screen name="revenue" options={{ title: 'Revenue' }} />
      <Stack.Screen name="wallet" options={{ title: 'Partner wallet' }} />
      <Stack.Screen name="withdraw" options={{ title: 'Withdraw' }} />
      <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
      <Stack.Screen name="referral" options={{ title: 'Referral centre' }} />
      <Stack.Screen name="join/[code]" options={{ title: 'Join a fleet' }} />
    </Stack>
  );
}
