import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Text } from '../src/ui/Text';
import { useAuth } from '../src/auth/AuthContext';
import { db } from '../src/firebase';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { LogoMark } from '../src/ui/LogoMark';
import { WELCOME_SEEN_KEY } from './welcome';

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
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
    // 3000ms matches the logo's decelerating 3D spin (2x → 1x → stop).
    const timer = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timer);
  }, []);

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

  if (initializing || showSplash || !profileChecked) {
    return (
      <View style={styles.container}>
        {/* Logo — no background, just the lime mark */}
        <LogoMark size={96} color="#ccff00" spin />

        {/* Brand name */}
        <Text style={styles.brandText}>VELOCITY</Text>
        <Text style={styles.brandSub}>Ride smarter. Move faster.</Text>

        {/* Small star accent */}
        <View style={styles.starContainer}>
          <Text style={styles.star}>✦</Text>
        </View>
      </View>
    );
  }

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
    backgroundColor: '#1a1c1c',
    gap: 16,
  },
  brandText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 4,
  },
  brandSub: {
    fontSize: 14,
    color: '#8a8c8c',
    letterSpacing: 0.5,
  },
  starContainer: {
    position: 'absolute',
    bottom: 44,
    right: 44,
  },
  star: {
    fontSize: 22,
    color: '#ccff00',
    opacity: 0.6,
  },
}));

