import { useEffect } from 'react';
import { Redirect, Stack, usePathname, useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { useDriverAppHeartbeat } from '../../src/hooks/appHeartbeat';
import { faceCheckInStatus, useDriverActiveTrip, useDriverProfile } from '../../src/hooks/driver';

const FACE_CHECK_ROUTE = '/driver/face-check-in';

export default function DriverLayout() {
  const { user, role, initializing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Mounted at the layout, not on Home, so every driver screen counts as being
  // present. A driver parked on Earnings is just as much "in the app" as one
  // watching the feed, and WhatsApp-ing either of them is equally pointless.
  // The hook no-ops until there is a uid, so the early returns below are safe.
  useDriverAppHeartbeat(role === 'driver' ? user?.uid : undefined);

  const profile = useDriverProfile(role === 'driver' ? user?.uid : undefined);
  const faceCheck = faceCheckInStatus(profile);
  // A passenger is in the car. Nothing below may interrupt that.
  const activeTrip = useDriverActiveTrip(role === 'driver' ? user?.uid : undefined);

  /**
   * The first thing a driver sees each day: are you the driver on this account?
   *
   * Here rather than on Home because every driver screen is an entry point —
   * a push notification about a ride opens the request screen directly, and a
   * check that can be walked around by tapping a notification is not a check.
   *
   * `blocking` is deliberately narrower than `due`: it means the server is
   * ENFORCING the check for this driver (the flag is carried on their own
   * document, see src/domain/faceCheckIn.ts). While it is off nobody is sent
   * anywhere, which is what keeps an app build that has the screen from
   * nagging drivers the business has not switched it on for yet.
   *
   * A redirect rather than a <Redirect>: the destination lives inside this
   * layout, so refusing to render children would refuse to render the very
   * screen the driver is being sent to. `profile` being null means the first
   * snapshot has not landed — never a reason to send anybody anywhere.
   */
  useEffect(() => {
    if (!profile || !faceCheck.blocking) return;
    if (pathname === FACE_CHECK_ROUTE) return;
    // Never mid-trip. A day can roll over at midnight with a passenger in the
    // car, and pulling the driver's screen away from the trip they are driving
    // would be far worse than one unverified morning — the server agrees: the
    // guards gate taking NEW work, never finishing the ride in progress.
    if (activeTrip) return;
    router.replace(FACE_CHECK_ROUTE);
  }, [profile, faceCheck.blocking, activeTrip, pathname, router]);

  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  // Only verified drivers (role granted by admin approval) see this experience.
  if (role !== 'driver') return <Redirect href="/passenger/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
