import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/config';

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2500); // Display the splash screen for 2.5 seconds
    return () => clearTimeout(timer);
  }, []);

  if (initializing || showSplash) {
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

