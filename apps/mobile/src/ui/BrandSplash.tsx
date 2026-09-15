/**
 * The animated brand splash: the V turning twice over VELOCITY RIDES, then a
 * fade into the app.
 *
 * HOW IT BROKE ON iOS, AND WHY THIS ONE CANNOT
 * --------------------------------------------
 * The old version was the entry route itself (app/index.tsx) and painted only
 * half the screen on iOS — one build the left half, the next the right. Two
 * things in it depended on the first layout pass being right: the route's
 * container sized itself from the window (flex in one build, a measured
 * `width` in the next), and the mark turned with a real 3D transform
 * (perspective + rotateY), which iOS composites in depth. It was removed on
 * 2026-09-11 rather than guessed at a third time.
 *
 * This one depends on neither:
 *   - It is an overlay in the ROOT layout, pinned to all four edges of the root
 *     view. No width is read, measured or passed; the screen's own edges are
 *     the size. Routes mount and redirect underneath it as normal.
 *   - The turn is a 2D horizontal scale (see LogoMark's `spin`), which has no
 *     depth to be clipped in.
 *   - Nothing inside it lays out against a number: the wordmark is one line
 *     that shrinks to fit rather than a fixed width that might not.
 *
 * It mounts in the same render that hides the native splash, on the same
 * colour, so the handover is the native still V giving way to this one turning.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';

import { themed } from '../theme';
import { LogoMark } from './LogoMark';
import { Text } from './Text';

/** Matches the expo-splash-screen backgroundColor in app.json exactly. */
const SPLASH_BG = '#101211';
/** How long the mark turns — LogoMark's spin runs for the same 3 s. */
const SPIN_MS = 3000;
const FADE_MS = 350;

export function BrandSplash() {
  const [gone, setGone] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => setGone(true));
    }, SPIN_MS);
    return () => clearTimeout(t);
  }, [opacity]);

  if (gone) return null;

  return (
    <Animated.View
      // Pinned to the edges, never sized — see the header.
      style={[styles.overlay, { opacity }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.center}>
        <LogoMark size={96} color="#ccff00" spin />
        {/* react-native's Text: the brand is never translated. */}
        <RNText style={styles.brand} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          VELOCITY RIDES
        </RNText>
        <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit>
          Ride smarter. Move faster.
        </Text>
      </View>
      <RNText style={styles.star}>✦</RNText>
    </Animated.View>
  );
}

// Fixed splash colours in both themes (the native splash is dark in both), but
// still built through themed() like every other sheet in the app.
const styles = themed(() => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: SPLASH_BG,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  brand: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 3,
  },
  tagline: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 14,
    color: '#8a8c8c',
    letterSpacing: 0.5,
  },
  star: {
    position: 'absolute',
    bottom: 44,
    right: 44,
    fontSize: 22,
    color: '#ccff00',
    opacity: 0.6,
  },
}));
