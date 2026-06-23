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
        <View style={styles.logoRow}>
          {/* Stylized lime green car-shaped 'V' logo */}
          <View style={styles.logoGraphic}>
            {/* Rear bumper/arch */}
            <View style={styles.rearArch} />
            {/* The bold V symbol in the middle */}
            <View style={styles.vContainer}>
              <View style={styles.vLeft} />
              <View style={styles.vRight} />
            </View>
            {/* Front bumper/arch */}
            <View style={styles.frontArch} />
            {/* Left wheel cutout */}
            <View style={styles.wheelCutoutLeft} />
            {/* Right wheel cutout */}
            <View style={styles.wheelCutoutRight} />
          </View>

          {/* Velocity brand text */}
          <Text style={styles.brandText}>VELOCITY</Text>
        </View>

        {/* Small 4-pointed star at the bottom right */}
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
    backgroundColor: '#2e3030', // Custom dark grey from mockup
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  logoGraphic: {
    width: 90,
    height: 40,
    position: 'relative',
    justifyContent: 'center',
  },
  rearArch: {
    position: 'absolute',
    left: 2,
    top: 15,
    width: 24,
    height: 12,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 4,
    borderWidth: 3,
    borderColor: '#ccff00',
    borderBottomWidth: 0,
    borderRightWidth: 0,
  },
  vContainer: {
    position: 'absolute',
    left: 20,
    top: 5,
    width: 32,
    height: 32,
  },
  vLeft: {
    position: 'absolute',
    left: 8,
    top: 0,
    bottom: 2,
    width: 5,
    backgroundColor: '#ccff00',
    transform: [{ rotate: '20deg' }],
    borderRadius: 2,
  },
  vRight: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 2,
    width: 5,
    backgroundColor: '#ccff00',
    transform: [{ rotate: '-20deg' }],
    borderRadius: 2,
  },
  frontArch: {
    position: 'absolute',
    right: 2,
    top: 15,
    width: 28,
    height: 12,
    borderTopRightRadius: 10,
    borderTopLeftRadius: 4,
    borderWidth: 3,
    borderColor: '#ccff00',
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  wheelCutoutLeft: {
    position: 'absolute',
    bottom: -6,
    left: 12,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2e3030',
  },
  wheelCutoutRight: {
    position: 'absolute',
    bottom: -6,
    right: 14,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2e3030',
  },
  brandText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  starContainer: {
    position: 'absolute',
    bottom: 40,
    right: 40,
  },
  star: {
    fontSize: 26,
    color: '#8a8c8c',
    opacity: 0.8,
  },
});

