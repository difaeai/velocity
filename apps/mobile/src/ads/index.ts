/**
 * Ads — AdMob banners and interstitials.
 *
 * Placements (all gated on useAdsEnabled, so paying users see none of them):
 *
 *   Banner        Travel Partner  → above the tab bar on Feed, Groups and Profile
 *                                   (not Home, which carries the native card),
 *                                   and pinned to the bottom of Matches
 *                 Earn            → pinned bottom, excluding apply/withdraw
 *                 "Where to?"     → below the destination results list
 *   Native        Travel Partner deck → one video card every 4 profiles
 *   Interstitial  travel-partner-discover → refreshing the swipe deck once it runs dry
 *                 partner-apply-free      → after a free-tier application submits
 *
 * Everything reads its unit IDs from EXPO_PUBLIC_ADMOB_* and falls back to
 * Google's test inventory when unset — see ids.ts.
 *
 * The public surface is deliberately just these. `ids` and `provider`
 * import the native SDK at module scope, and re-exporting them here would drag
 * it into the react-native-web graph through this barrel — which fails the web
 * bundle outright, since the SDK reaches into react-native internals that web
 * does not support. Both stay internal, reached only through AdBanner /
 * useInterstitial / NativeAdCard, each of which has a `.web` stub that renders nothing.
 */
export { AdBanner } from './AdBanner';
export { useInterstitial } from './useInterstitial';
export { NativeAdCard, useNativeAd } from './NativeAdCard';
export { useAdsEnabled } from './useAdsEnabled';
