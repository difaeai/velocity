import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../src/auth/AuthContext';
import { db } from '../src/firebase';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { WELCOME_SEEN_KEY } from './welcome';
import { usernameDoneKey } from '../src/lib/username';

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);
  // Whether this account has claimed a username yet. Everyone needs one —
  // it is how fleet-mates add each other — so accounts made before usernames
  // existed are asked once, before anything else.
  const [hasUsername, setHasUsername] = useState(false);
  // Driver application status (drivers/{uid}.verificationStatus). A "pending"
  // applicant is sent to the submitted-status screen so they always land back
  // on it until an admin approves them.
  const [driverStatus, setDriverStatus] = useState<string | null>(null);
  // drivers/{uid}.online — read from the same doc, so it costs nothing extra.
  const [driverOnShift, setDriverOnShift] = useState(false);
  // Whether the signed-out welcome carousel has already been shown on this
  // device. false → show carousel; true → straight to sign-in.
  const [welcomeSeen, setWelcomeSeen] = useState(false);

  useEffect(() => {
    if (!user) {
      setProfileComplete(false);
      setHasUsername(false);
      setDriverStatus(null);
      setDriverOnShift(false);
      // First launch → welcome carousel; afterwards straight to sign-in.
      // A read failure just re-shows the carousel (it has a Skip button).
      AsyncStorage.getItem(WELCOME_SEEN_KEY)
        .then((v) => setWelcomeSeen(v === '1'))
        .catch(() => setWelcomeSeen(false))
        .finally(() => setProfileChecked(true));
      return;
    }

    // Reset while async check runs — prevents stale profileComplete=false
    // from a previous null-user render causing a premature /onboarding redirect.
    setProfileChecked(false);

    async function check() {
      // Driver application status — routes a pending applicant to the submitted
      // screen. Read failures fall back to null (treated as "not an applicant").
      try {
        const dsnap = await getDoc(doc(db, 'drivers', user!.uid));
        setDriverStatus(dsnap.exists() ? ((dsnap.get('verificationStatus') as string) ?? null) : null);
        setDriverOnShift(dsnap.get('online') === true);
      } catch {
        setDriverStatus(null);
        setDriverOnShift(false);
      }

      const key = `onboarding_done_${user!.uid}`;
      const unameKey = usernameDoneKey(user!.uid);

      // Fast path: once the user completed onboarding AND claimed a username
      // on this device we cache a local flag each, so Firestore read failures
      // can never re-trap them. Both have to be cached to skip the read —
      // every existing account predates usernames and needs asking once.
      const [local, localUname] = await Promise.all([
        AsyncStorage.getItem(key).catch(() => null),
        AsyncStorage.getItem(unameKey).catch(() => null),
      ]);
      if (local === '1' && localUname === '1') {
        setProfileComplete(true);
        setHasUsername(true);
        setProfileChecked(true);
        return;
      }

      // Slow path: ask Firestore. One read answers both questions.
      try {
        const snap = await getDoc(doc(db, 'users', user!.uid));
        const data = snap.data();
        const named = !!data?.username;
        setHasUsername(named);
        if (named) AsyncStorage.setItem(unameKey, '1').catch(() => {});
        // Accept as complete if any field written by the onboarding form exists.
        // profileComplete is the canonical flag. name / dob / gender (not the
        // trigger default 'unspecified') are fallbacks for older accounts.
        const done = snap.exists() && (
          data?.profileComplete === true ||
          !!data?.name ||
          !!data?.dob ||
          (!!data?.gender && data.gender !== 'unspecified')
        );
        setProfileComplete(done);
        // Persist locally so a future Firestore failure doesn't re-trigger this.
        if (done) AsyncStorage.setItem(key, '1').catch(() => {});
      } catch {
        // On any read failure don't trap the user in onboarding — or on the
        // username screen, which would be the same trap one step earlier.
        setProfileComplete(true);
        setHasUsername(true);
      }
      setProfileChecked(true);
    }

    check();
  }, [user?.uid]);

  // A bare colour, deliberately.
  //
  // The animated brand splash used to live here and painted only half the
  // screen on iOS. It is now an overlay in the root layout (src/ui/BrandSplash)
  // that sizes itself from the screen edges instead of this route's layout, so
  // this route only holds the splash colour while auth resolves underneath it.
  // Do not move the splash back into a route.
  if (initializing || !profileChecked) return <View style={styles.container} />;

  if (!user) return <Redirect href={welcomeSeen ? '/auth/sign-in' : '/welcome'} />;
  // A username is the first thing EVERY account needs — drivers included,
  // because a driver rides as a passenger too and a fleet addresses people by
  // username. It is one screen, once, and it is ahead of the driver redirect
  // on purpose: an account without one cannot be added to anybody's fleet.
  // The one exception is a driver who is ON SHIFT: an app restart mid-trip
  // must land on the trip, not on a form. They are asked next time, off shift.
  if (!hasUsername && !(role === 'driver' && driverOnShift)) return <Redirect href="/username" />;
  // Approved drivers go straight to their dashboard — they never sign in again.
  if (role === 'driver') return <Redirect href="/driver/home" />;
  // A submitted (pending) driver applicant waits on the status screen.
  if (driverStatus === 'pending') return <Redirect href="/passenger/become-driver/submitted" />;
  if (!profileComplete) return <Redirect href="/onboarding" />;
  return <Redirect href="/passenger/home" />;
}

const styles = themed(() => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Matches the native splash's backgroundColor in app.json exactly, so the
    // handover from it is invisible.
    backgroundColor: '#101211',
  },
}));

