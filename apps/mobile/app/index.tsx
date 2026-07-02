import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../src/auth/AuthContext';
import { db } from '../src/firebase';
import { colors } from '../src/config';
import { LogoMark } from '../src/ui/LogoMark';

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileComplete(false);
      setProfileChecked(true);
      return;
    }

    // Reset while async check runs — prevents stale profileComplete=false
    // from a previous null-user render causing a premature /onboarding redirect.
    setProfileChecked(false);

    async function check() {
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
        <LogoMark size={96} color="#ccff00" />

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

  if (!user) return <Redirect href="/auth/sign-in" />;
  if (!profileComplete && role !== 'driver') return <Redirect href="/onboarding" />;
  if (role === 'driver') return <Redirect href="/driver/home" />;
  return <Redirect href="/passenger/home" />;
}

const styles = StyleSheet.create({
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
});

