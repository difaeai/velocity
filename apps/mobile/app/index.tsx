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
  // Whether this account has claimed a username yet — how fleet-mates add each
  // other. Asked on the same screen as the profile, right after sign-up.
  const [hasUsername, setHasUsername] = useState(false);
  // Driver application status (drivers/{uid}.verificationStatus). A "pending"
  // applicant is sent to the submitted-status screen so they always land back
  // on it until an admin approves them.
  const [driverStatus, setDriverStatus] = useState<string | null>(null);
  // Whether the signed-out welcome carousel has already been shown on this
  // device. false → show carousel; true → straight to sign-in.
  const [welcomeSeen, setWelcomeSeen] = useState(false);

  useEffect(() => {
    if (!user) {
      setProfileComplete(false);
      setHasUsername(false);
      setDriverStatus(null);
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
      const key = `onboarding_done_${user!.uid}`;
      const unameKey = usernameDoneKey(user!.uid);

      /**
       * Everything this route needs, asked for at once.
       *
       * These used to run one after another — the driver document, then the two
       * local flags, then (usually) the user document — so a cold launch spent
       * two serial Firestore round trips behind a blank splash-coloured screen
       * before it could decide which route to send anyone to. They do not
       * depend on each other, so they go together and the launch costs one
       * round trip instead of two (owner, 2026-11-17: the app loads slowly).
       *
       * Each read swallows its own failure, so one of them being refused or
       * timing out can never reject the whole thing and strand the user on the
       * blank screen.
       */
      const [dsnap, usnap, local, localUname] = await Promise.all([
        getDoc(doc(db, 'drivers', user!.uid)).catch(() => null),
        getDoc(doc(db, 'users', user!.uid)).catch(() => null),
        AsyncStorage.getItem(key).catch(() => null),
        AsyncStorage.getItem(unameKey).catch(() => null),
      ]);

      // Driver application status — routes a pending applicant to the submitted
      // screen. A failed read falls back to null (treated as "not an applicant").
      const isDriverAccount = !!dsnap?.exists();
      setDriverStatus(
        dsnap?.exists() ? ((dsnap.get('verificationStatus') as string) ?? null) : null,
      );

      /**
       * A driver is never sent through passenger onboarding (owner, 2026-11-17).
       *
       * Somebody who signed up on "Become Driver" has already given us their
       * name, their date of birth, their photograph and their CNIC — asking for
       * all of it again on a rider form, under a heading welcoming them to the
       * app, is the loop the owner called confusing. It bit hardest on the
       * applicant waiting for approval: with no passenger profile yet, every
       * app launch landed them on the rider onboarding form instead of on their
       * own application status.
       *
       * Having a driver document at all is the test, not being approved — the
       * details arrive with the application, long before the verdict. The
       * passenger side asks for what it actually needs at the point it needs it
       * (the shared-ride flow asks about riding with other genders when a
       * shared seat is first booked), which is a better place to ask than a
       * form in front of someone who came here to drive.
       */
      if (isDriverAccount) {
        setProfileComplete(true);
        setHasUsername(true);
        setProfileChecked(true);
        return;
      }

      // Once the user completed onboarding AND claimed a username on this
      // device we cache a local flag each, so Firestore read failures can never
      // re-trap them. Both have to be cached to trust them — every existing
      // account predates usernames and needs asking once.
      if (local === '1' && localUname === '1') {
        setProfileComplete(true);
        setHasUsername(true);
        setProfileChecked(true);
        return;
      }

      // The user document, already in hand. A read that failed outright must
      // not trap anyone in onboarding — or on the username screen, which would
      // be the same trap one step earlier — so it is treated as "nothing left
      // to ask".
      if (!usnap) {
        setProfileComplete(true);
        setHasUsername(true);
        setProfileChecked(true);
        return;
      }

      const data = usnap.data();
      const named = !!data?.username;
      setHasUsername(named);
      if (named) AsyncStorage.setItem(unameKey, '1').catch(() => {});
      // Accept as complete if any field written by the onboarding form exists.
      // profileComplete is the canonical flag. name / dob / gender (not the
      // trigger default 'unspecified') are fallbacks for older accounts.
      const done = usnap.exists() && (
        data?.profileComplete === true ||
        !!data?.name ||
        !!data?.dob ||
        (!!data?.gender && data.gender !== 'unspecified')
      );
      setProfileComplete(done);
      // Persist locally so a future Firestore failure doesn't re-trigger this.
      if (done) AsyncStorage.setItem(key, '1').catch(() => {});
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
  // Approved drivers go straight to their dashboard — they never sign in again,
  // and nothing (a username included) stands between a driver and their work.
  // Every account signed up as a rider first, on the screen below.
  if (role === 'driver') return <Redirect href="/driver/home" />;
  // Straight after sign-up: username, photo, name, gender and date of birth on
  // ONE screen. An older account is only asked for whichever part it lacks.
  if (!hasUsername || !profileComplete) {
    return (
      <Redirect
        href={{
          pathname: '/onboarding',
          params: { username: hasUsername ? '0' : '1', profile: profileComplete ? '0' : '1' },
        }}
      />
    );
  }
  // A submitted (pending) driver applicant waits on the status screen.
  if (driverStatus === 'pending') return <Redirect href="/passenger/become-driver/submitted" />;
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

