import { Stack } from 'expo-router';

import { colors } from '../../../src/config';

/**
 * Earn with Velocity — the Partner Program.
 *
 * A plain stack rather than tabs: the dashboard is the hub and every section
 * pushes onto it, so the back gesture always means "up one level" instead of
 * fighting a tab bar the landing and application screens have no use for.
 */
export default function EarnLayout() {
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
