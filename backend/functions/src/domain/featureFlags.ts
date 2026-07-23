/**
 * Feature flags — startup gating for paid features.
 *
 * The wallet top-up economy and Travel Partner subscriptions are fully built but
 * switched off for launch ("Coming Soon"): we grab users first, monetise later.
 * Flags live in `config/featureFlags` (admin-editable from the dashboard) and
 * are read live by the app, so flipping one re-enables the feature app-wide
 * with no deploy.
 *
 * Defaults are the launch posture: top-ups + subscriptions OFF, Travel Partner
 * free for everyone.
 */
import type { DocumentData } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';

export interface FeatureFlags {
  /** Gateway wallet top-ups (JazzCash/Easypaisa). Off = "Coming Soon". */
  walletTopupEnabled: boolean;
  /**
   * Saved payment methods — a connected Easypaisa/JazzCash/bank/card instrument
   * the user tops up from with one tap. Off = "Coming Soon".
   *
   * Deliberately separate from `walletTopupEnabled`: reusing a saved instrument
   * means the gateway holds a token it will charge again on our say-so, which
   * every Pakistani gateway sells as a distinct recurring/tokenisation
   * permission on top of plain checkout. Basic top-ups are therefore expected to
   * go live first, with this following once that permission is granted.
   */
  savedPaymentMethodsEnabled: boolean;
  /** Paid Travel Partner subscription plans. Off = "Coming Soon". */
  travelMateSubscriptionsEnabled: boolean;
  /** When true, Travel Partner likes are unlimited for everyone (no paywall). */
  travelMateFree: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  walletTopupEnabled: false,
  savedPaymentMethodsEnabled: false,
  travelMateSubscriptionsEnabled: false,
  travelMateFree: true,
};

function coerce(data: DocumentData | undefined): FeatureFlags {
  if (!data) return DEFAULT_FLAGS;
  return {
    walletTopupEnabled: data.walletTopupEnabled === true,
    savedPaymentMethodsEnabled: data.savedPaymentMethodsEnabled === true,
    travelMateSubscriptionsEnabled: data.travelMateSubscriptionsEnabled === true,
    // Default true when unset so a missing doc still frees Travel Partner.
    travelMateFree: data.travelMateFree !== false,
  };
}

/** Live feature flags from config/featureFlags, with launch-posture defaults. */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const snap = await db.doc('config/featureFlags').get();
  return coerce(snap.exists ? snap.data() : undefined);
}
