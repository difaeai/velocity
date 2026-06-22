import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

export default function AuthLayout() {
  const { user, initializing } = useAuth();
  // Already signed in → bounce to the role router.
  if (!initializing && user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
