/**
 * Ads — AdMob banners and interstitials.
 *
 * Placements (all gated on useAdsEnabled, so paying users see none of them):
 *
 *   Banner        Travel Partner  → above the tab bar, all 5 tabs
 *                 Earn            → pinned bottom, excluding apply/withdraw
 *                 "Where to?"     → below the destination results list
 *   Interstitial  travel-partner-discover → entering the swipe deck
 *                 partner-apply-free      → after a free-tier application submits
 *
 * Everything reads its unit IDs from EXPO_PUBLIC_ADMOB_* and falls back to
 * Google's test inventory when unset — see ids.ts.
 *
 * The public surface is deliberately just these three. `ids` and `provider`
 * import the native SDK at module scope, and re-exporting them here would drag
 * it into the react-native-web graph through this barrel — which fails the web
 * bundle outright, since the SDK reaches into react-native internals that web
 * does not support. Both stay internal, reached only through AdBanner /
 * useInterstitial, each of which has a `.web` stub that renders nothing.
 */
export { AdBanner } from './AdBanner';
export { useInterstitial } from './useInterstitial';
export { useAdsEnabled } from './useAdsEnabled';
