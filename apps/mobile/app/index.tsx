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

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);
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
      // Driver application status — routes a pending applicant to the submitted
      // screen. Read failures fall back to null (treated as "not an applicant").
      try {
        const dsnap = await getDoc(doc(db, 'drivers', user!.uid));
        setDriverStatus(dsnap.exists() ? ((dsnap.get('verificationStatus') as string) ?? null) : null);
      } catch {
        setDriverStatus(null);
      }

      const key = `onboarding_done_${user!.uid}`;

      // Fast path: once the user completed onboarding on this device we cache
      // a local flag so Firestore read failures can never re-trap them.
      const local = await AsyncStorage.getItem(key).catch(() => null);
      if (local === '1') {
        setProfileComplete(true);
        setProfileChecked(true);
        return;
      }

      // Slow path: ask Firestore.
      try {
        const snap = await getDoc(doc(db, 'users', user!.uid));
        const data = snap.data();
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
        // On any read failure don't trap the user in onboarding.
        setProfileComplete(true);
      }
      setProfileChecked(true);
    }

    check();
  }, [user?.uid]);

  // A bare colour, deliberately.
  //
  // This used to be a three-second branded splash — the spinning mark over
  // VELOCITY and a tagline. On iOS it painted only half the screen: build 4
  // rendered the left half ("VELO", "Ride smarter.", no star), build 5 the
  // right half ("CITY", "Move faster.", star). Laying the content out against
  // the full width while the surface drew half of it is a native-layer problem
  // underneath React, and two builds spent guessing at it fixed nothing.
  //
  // So there is nothing left to clip. The native splash from the
  // expo-splash-screen plugin already shows the mark on this exact colour and
  // renders correctly; this just holds that same colour for the moment between
  // it hiding and the real screen mounting. Launch is three seconds quicker for
  // it. Do not reintroduce a JS splash without testing it on a device first.
  if (initializing || !profileChecked) return <View style={styles.container} />;

  if (!user) return <Redirect href={welcomeSeen ? '/auth/sign-in' : '/welcome'} />;
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

