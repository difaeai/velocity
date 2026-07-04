import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

export default function PassengerLayout() {
  const { user, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  // Drivers are welcome here too: anyone signed in can ride as a passenger.
  // (App launch still lands drivers on /driver/home via the root index; the
  // drawer's "Ride as Passenger" / "Driver mode" buttons switch between the
  // two experiences, so nobody ever gets stuck in one.)
  return <Stack screenOptions={{ headerShown: false }} />;
}
