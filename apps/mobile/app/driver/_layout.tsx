import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { useDriverAppHeartbeat } from '../../src/hooks/appHeartbeat';

export default function DriverLayout() {
  const { user, role, initializing } = useAuth();
  // Mounted at the layout, not on Home, so every driver screen counts as being
  // present. A driver parked on Earnings is just as much "in the app" as one
  // watching the feed, and WhatsApp-ing either of them is equally pointless.
  // The hook no-ops until there is a uid, so the early returns below are safe.
  useDriverAppHeartbeat(role === 'driver' ? user?.uid : undefined);

  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  // Only verified drivers (role granted by admin approval) see this experience.
  if (role !== 'driver') return <Redirect href="/passenger/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
