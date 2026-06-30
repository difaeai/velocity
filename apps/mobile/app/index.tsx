import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '../src/auth/AuthContext';
import { db } from '../src/firebase';
import { colors } from '../src/config';

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
    if (!user) { setProfileChecked(true); return; }
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.data();
      // Accept as complete if ANY onboarding field exists on the doc.
      // profileComplete is set by the current onboarding save.
      // name / age / gender / dob are fallbacks for accounts onboarded before
      // the profileComplete flag was introduced.
      // If the doc doesn't exist yet (trigger race) we also let them through
      // so users aren't trapped on the onboarding screen.
      const done =
        !snap.exists() ||
        data?.profileComplete === true ||
        !!data?.name ||
        !!data?.age ||
        !!data?.gender ||
        !!data?.dob;
      setProfileComplete(done);
      setProfileChecked(true);
    }).catch(() => {
      // On any read failure treat as complete — don't trap the user.
      setProfileComplete(true);
      setProfileChecked(true);
    });
  }, [user?.uid]); // depend on uid only — user object ref changes on token refresh

  if (initializing || showSplash || !profileChecked) {
    return (
      <View style={styles.container}>
        {/* Logo badge */}
        <View style={styles.logoBadge}>
          <Text style={styles.logoV}>V</Text>
        </View>

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
  logoBadge: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoV: {
    fontSize: 62,
    fontWeight: '900',
    color: '#1a1c1c',
    lineHeight: 70,
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

