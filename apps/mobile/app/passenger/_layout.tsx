import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

export default function PassengerLayout() {
  const { user, role, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  if (role === 'driver') return <Redirect href="/driver/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
