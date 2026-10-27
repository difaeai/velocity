/**
 * Native video ad card — the Travel Partner deck shows one every 4 profiles.
 *
 * Three rules this exists to enforce:
 *
 * 1. It is NEVER swipeable. A drag that starts on an ad asset carries the card
 *    with the finger, so Android can still read the lift as a tap on the ad —
 *    and an accidental click is invalid traffic. The deck moves on with its own
 *    "Next profile" button, outside the ad view.
 * 2. It is labelled "Ad", and the SDK's AdChoices icon stays where Google puts it
 *    (top right), so it never passes for a real person's profile.
 * 3. No fill, or a paying user, means no card at all — the deck never waits.
 */
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text as RNText, View } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaAspectRatio,
  NativeMediaView,
} from 'react-native-google-mobile-ads';

import { colors } from '../config';
import { themed } from '../theme';
import { Text } from '../ui/Text';
import { NATIVE_UNIT_ID } from './ids';
import { ensureAdsReady } from './provider';
import { useAdsEnabled } from './useAdsEnabled';

/** One preloaded native ad, and `next` to drop it and fetch another once it has been seen. */
export function useNativeAd(): { ad: NativeAd | null; next: () => void } {
  const adsEnabled = useAdsEnabled();
  const [ad, setAd] = useState<NativeAd | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const unitId = NATIVE_UNIT_ID;
    if (!adsEnabled || !unitId) return;
    let disposed = false;
    let current: NativeAd | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const load = async (retried: boolean) => {
      if (!(await ensureAdsReady()) || disposed) return;
      try {
        const loaded = await NativeAd.createForAdRequest(unitId, {
          aspectRatio: NativeMediaAspectRatio.ANY,
          startVideoMuted: true,
        });
        if (disposed) { loaded.destroy(); return; }
        current = loaded;
        setAd(loaded);
      } catch (e) {
        // No fill is common in Pakistan. One retry, then the deck simply runs
        // without ads until the next round.
        if (__DEV__) console.warn('[ads] native ad failed to load —', e);
        if (!retried && !disposed) retry = setTimeout(() => load(true), 30_000);
      }
    };
    load(false);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      current?.destroy();
      setAd(null);
    };
  }, [adsEnabled, round]);

  return { ad, next: () => setRound(r => r + 1) };
}

export function NativeAdCard({ ad, width, height }: { ad: NativeAd; width: number; height: number }) {
  return (
    <NativeAdView nativeAd={ad} style={[s.card, { width, height }]}>
      <View style={s.head}>
        <View style={s.badge}><Text style={s.badgeText}>Ad</Text></View>
        {ad.icon && (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: ad.icon.url }} style={s.icon} />
          </NativeAsset>
        )}
        <View style={{ flex: 1 }}>
          {/* Advertiser copy is shown as sent — never run through the app's translator. */}
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <RNText style={s.headline} numberOfLines={1}>{ad.headline}</RNText>
          </NativeAsset>
          {ad.advertiser ? (
            <NativeAsset assetType={NativeAssetType.ADVERTISER}>
              <RNText style={s.advertiser} numberOfLines={1}>{ad.advertiser}</RNText>
            </NativeAsset>
          ) : null}
        </View>
      </View>

      {/* Plays the video when the creative has one, otherwise its main image. */}
      <NativeMediaView style={s.media} resizeMode="contain" />

      <View style={s.foot}>
        {ad.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <RNText style={s.body} numberOfLines={2}>{ad.body}</RNText>
          </NativeAsset>
        ) : null}
        {ad.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <RNText style={s.cta}>{ad.callToAction}</RNText>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
}

const s = themed(() => StyleSheet.create({
  card:       { borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  // Right padding keeps the headline clear of the AdChoices icon.
  head:       { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingRight: 36 },
  badge:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#f59e0b' },
  badgeText:  { fontSize: 11, fontWeight: '900', color: '#000' },
  icon:       { width: 36, height: 36, borderRadius: 8 },
  headline:   { fontSize: 15, fontWeight: '800', color: colors.text },
  advertiser: { fontSize: 12, color: colors.muted, marginTop: 1 },
  media:      { flex: 1, backgroundColor: '#000' },
  foot:       { padding: 14, gap: 10 },
  body:       { fontSize: 13, color: colors.muted, lineHeight: 18 },
  cta:        { alignSelf: 'stretch', textAlign: 'center', paddingVertical: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.primary, color: '#000', fontSize: 15, fontWeight: '900' },
}));
