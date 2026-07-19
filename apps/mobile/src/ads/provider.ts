/**
 * Google Mobile Ads SDK bootstrap.
 *
 * Called once, lazily, the first time any placement actually wants an ad —
 * not at app start. Most sessions never open Travel Partner, Earn, or the
 * booking sheet, and initialising the ad SDK on the splash screen costs those
 * users startup time and battery for nothing.
 *
 * Order matters and is not negotiable: consent must be gathered BEFORE the SDK
 * is initialised, and ads may only be requested once `canRequestAds` is true.
 * Requesting a personalised ad from an EEA/UK user who has not consented is a
 * GDPR problem, not just a policy one, so the gate here fails closed — any error
 * anywhere in the chain leaves ads off rather than falling through to "show it
 * anyway".
 */
import mobileAds, { AdsConsent, MaxAdContentRating } from 'react-native-google-mobile-ads';

let bootstrap: Promise<boolean> | null = null;

async function run(): Promise<boolean> {
  try {
    // Presents the consent form when one is required (EEA/UK); resolves
    // immediately everywhere else, which is the common case for Pakistan.
    await AdsConsent.gatherConsent();
  } catch (e) {
    // A consent failure is not fatal on its own — `canRequestAds` below is the
    // real gate, and outside the EEA it stays true. Log and continue.
    console.warn('[ads] consent gathering failed', e);
  }

  try {
    const { canRequestAds } = await AdsConsent.getConsentInfo();
    if (!canRequestAds) return false;

    await mobileAds().setRequestConfiguration({
      // Velocity is a general-audience ride app used by families; anything above
      // a PG rating does not belong next to a booking form.
      maxAdContentRating: MaxAdContentRating.PG,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });

    await mobileAds().initialize();
    return true;
  } catch (e) {
    console.warn('[ads] SDK initialisation failed', e);
    return false;
  }
}

/**
 * Resolves true when the SDK is initialised and ads may be requested.
 *
 * Memoised on the promise rather than the result, so concurrent callers (three
 * banners mounting at once) share a single initialisation instead of racing.
 * A failed run is retried on the next call — a user who was offline when they
 * first opened Travel Partner should still get ads later in the session.
 */
export function ensureAdsReady(): Promise<boolean> {
  if (!bootstrap) {
    bootstrap = run().then((ok) => {
      if (!ok) bootstrap = null;
      return ok;
    });
  }
  return bootstrap;
}
