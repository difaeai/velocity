/**
 * Full-screen (video / interstitial) ads, with the frequency caps that keep the
 * placement inside AdMob policy.
 *
 * The rules encoded here, and why:
 *
 *  • NEVER shown on screen entry. Google's interstitial guidance is explicit
 *    that ads must not appear while a user is entering a screen or partway
 *    through a task; they belong at a natural stopping point. So the two
 *    triggers are "opened the swipe deck" and "finished submitting an
 *    application" — moments where the user has just completed something.
 *  • NEVER blocks the user. `maybeShow` resolves immediately if no ad is
 *    preloaded. A user who finished an application waits for nothing.
 *  • Capped. Once per placement per session, plus a hard global gap between any
 *    two interstitials, persisted so it survives a relaunch. Without the
 *    persisted gap, force-quitting and reopening the app would serve an ad
 *    every single time.
 */
import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';

import { INTERSTITIAL_UNIT_ID } from './ids';
import { ensureAdsReady } from './provider';
import { useAdsEnabled } from './useAdsEnabled';

/** Minimum wall-clock gap between any two interstitials, across all placements. */
const MIN_GAP_MS = 4 * 60 * 1000;

const LAST_SHOWN_KEY = 'velocity_ads_last_interstitial_at';

/** Placements that have already fired this session — reset only by a cold start. */
const shownThisSession = new Set<string>();

async function withinCooldown(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SHOWN_KEY);
    if (!raw) return false;
    const last = Number(raw);
    return Number.isFinite(last) && Date.now() - last < MIN_GAP_MS;
  } catch {
    // Storage failure must not turn into "show ads with no cap at all".
    return true;
  }
}

/**
 * Preloads one interstitial for `placement` and returns a trigger for it.
 *
 * @param placement stable key used for the once-per-session cap
 */
export function useInterstitial(placement: string) {
  const adRef = useRef<InterstitialAd | null>(null);
  const loaded = useRef(false);
  const adsEnabled = useAdsEnabled();

  useEffect(() => {
    // A paying user never loads one in the first place — no wasted request, and
    // no chance of a stale preloaded ad firing after they upgrade mid-session.
    if (!adsEnabled || shownThisSession.has(placement)) return;

    let disposed = false;
    const cleanups: (() => void)[] = [];

    (async () => {
      const ok = await ensureAdsReady();
      if (!ok || disposed || (await withinCooldown())) return;

      const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID);
      adRef.current = ad;

      cleanups.push(
        ad.addAdEventListener(AdEventType.LOADED, () => {
          loaded.current = true;
        }),
        ad.addAdEventListener(AdEventType.ERROR, () => {
          loaded.current = false;
        }),
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          // One per placement per session: do not reload after a dismissal.
          loaded.current = false;
        }),
      );

      if (!disposed) ad.load();
    })();

    return () => {
      disposed = true;
      cleanups.forEach((c) => c());
      adRef.current = null;
      loaded.current = false;
    };
  }, [adsEnabled, placement]);

  /**
   * Shows the preloaded ad if — and only if — every gate passes. Always
   * resolves; never throws; never makes the caller wait on a network request.
   */
  const maybeShow = useCallback(async () => {
    if (!adsEnabled) return;
    if (shownThisSession.has(placement)) return;
    if (!loaded.current || !adRef.current) return;
    if (await withinCooldown()) return;

    // Marked BEFORE showing: if show() throws halfway we still must not retry
    // in a loop and hammer the user with ads.
    shownThisSession.add(placement);
    try {
      await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      await adRef.current.show();
    } catch (e) {
      console.warn('[ads] interstitial failed to show', e);
    } finally {
      loaded.current = false;
    }
  }, [adsEnabled, placement]);

  return maybeShow;
}
