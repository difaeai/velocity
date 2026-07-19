/**
 * Anchored banner ad.
 *
 * Three rules this component exists to enforce, because getting any of them
 * wrong in a placement is how ad accounts get limited:
 *
 * 1. It occupies ZERO height until an ad has actually loaded. A reserved-but-
 *    empty slot leaves a grey gap on every no-fill, and no-fill is common in
 *    Pakistan. Nothing renders until `onAdLoaded` fires, and a failed load
 *    collapses it again.
 * 2. It never renders for a paying user (see useAdsEnabled) and never renders
 *    before the SDK is initialised and consent is resolved.
 * 3. It carries its own top border and background so it reads as a distinct
 *    strip rather than as part of whatever list sits above it. Ads that look
 *    like app content produce accidental clicks, and accidental clicks are
 *    invalid traffic.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { colors } from '../config';
import { themed } from '../theme';
import { BANNER_UNIT_ID } from './ids';
import { ensureAdsReady } from './provider';
import { useAdsEnabled } from './useAdsEnabled';

interface Props {
  style?: object;
  /**
   * Hide the banner while the software keyboard is up.
   *
   * Needed on screens built around a text field — the "Where to?" sheet in
   * particular. Android edge-to-edge does not honour adjustResize here, so the
   * keyboard slides OVER the banner: the ad is billed as an impression the user
   * never actually sees, and it steals room from the destination suggestions
   * they are typing to find. Better to yield the space entirely.
   */
  hideOnKeyboard?: boolean;
}

export function AdBanner({ style, hideOnKeyboard = false }: Props) {
  const adsEnabled = useAdsEnabled();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hideOnKeyboard) return;
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [hideOnKeyboard]);

  useEffect(() => {
    if (!adsEnabled) return;
    ensureAdsReady().then((ok) => {
      if (mounted.current && ok) setReady(true);
    });
  }, [adsEnabled]);

  if (!adsEnabled || !ready) return null;

  return (
    // The wrapper stays mounted while the ad loads (BannerAd has to be in the
    // tree to request one) but contributes no height until it succeeds.
    <View style={loaded && !keyboardUp ? [s.wrap, style] : s.hidden}>
      <BannerAd
        unitId={BANNER_UNIT_ID}
        // Anchored adaptive sizes itself to the device width and is the size
        // Google recommends for a bar pinned to the bottom of the screen.
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => mounted.current && setLoaded(true)}
        onAdFailedToLoad={() => mounted.current && setLoaded(false)}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    /** Zero-height, non-interactive, but still in the tree so the request runs. */
    hidden: { height: 0, overflow: 'hidden', opacity: 0 },
  }),
);
