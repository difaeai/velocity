import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

export default function DriverLayout() {
  const { user, role, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  // Only verified drivers (role granted by admin approval) see this experience.
  if (role !== 'driver') return <Redirect href="/passenger/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
