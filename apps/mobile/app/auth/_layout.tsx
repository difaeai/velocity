import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

/**
 * Named rather than inferred, for the same reason as the passenger and driver
 * groups: with no `index.tsx` here the anchor would be whatever sorts first,
 * which is only sign-in today by luck of the alphabet. Adding a second screen
 * to this group should not quietly change where a fallback lands.
 */
export const unstable_settings = { anchor: 'sign-in', initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const { user, initializing } = useAuth();
  // Already signed in → bounce to the role router.
  if (!initializing && user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
