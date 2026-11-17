import { Redirect, Stack, useSegments } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';

/**
 * The two screens under `/passenger/become-driver` that are FOR a signed-out
 * person: the sign-up/sign-in choice, and the phone + OTP that follows it.
 *
 * They live under this layout only because the rest of the driver registration
 * does, and the rest of it genuinely needs a uid — the document uploads write
 * to the signed-in user's storage path. These two come before there is one.
 *
 * Reaching them signed out became possible when "Become Driver" was put on the
 * login screen (owner, 2026-11-17): a driver should be able to say they are a
 * driver on the first screen rather than sign up as a passenger first. Without
 * this allowance the guard below would bounce them straight back to the login
 * screen they just tapped, which is the loop the owner was describing.
 */
const SIGNED_OUT_DRIVER_DOOR = ['account', 'login'];

/**
 * Where "back" lands when there is nothing to go back to (owner, 2026-11-17:
 * leaving the referral-code screen dropped riders into Bikes).
 *
 * The root layout is a `<Slot />`, not a Stack, so a root-level route such as
 * `/referral-code` shares no history with anything under `/passenger`. Pressing
 * back there falls through to this group's ANCHOR — and with no `index.tsx`
 * here and no anchor declared, expo-router picked the first route in the
 * directory, which is how a rider leaving the referral screen ended up looking
 * at bike booking.
 *
 * Naming the anchor fixes it for every screen in the group at once, not just
 * the one that was reported, which is why it is here rather than in a back
 * handler. Home is the only honest answer: it is where a passenger with no
 * history belongs.
 */
export const unstable_settings = { anchor: 'home', initialRouteName: 'home' };

export default function PassengerLayout() {
  const { user, initializing } = useAuth();
  const segments = useSegments();
  if (initializing) return null;

  const atDriverDoor =
    segments.includes('become-driver') &&
    SIGNED_OUT_DRIVER_DOOR.includes(segments[segments.length - 1] ?? '');

  if (!user && !atDriverDoor) return <Redirect href="/auth/sign-in" />;
  // Drivers are welcome here too: anyone signed in can ride as a passenger.
  // (App launch still lands drivers on /driver/home via the root index; the
  // drawer's "Ride as Passenger" / "Driver mode" buttons switch between the
  // two experiences, so nobody ever gets stuck in one.)
  return <Stack screenOptions={{ headerShown: false }} />;
}
