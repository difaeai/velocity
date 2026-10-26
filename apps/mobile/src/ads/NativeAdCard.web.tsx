/**
 * Web stub for the native deck ad — the Google Mobile Ads SDK is native-only
 * (same pattern as AdBanner.web.tsx).
 */
export function useNativeAd(): { ad: null; next: () => void } {
  return { ad: null, next: () => {} };
}

export function NativeAdCard(_props: { ad: unknown; width: number; height: number }) {
  return null;
}
