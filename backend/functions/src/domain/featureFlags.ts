/**
 * Feature flags — startup gating for paid features.
 *
 * The wallet top-up economy and Travel Mate subscriptions are fully built but
 * switched off for launch ("Coming Soon"): we grab users first, monetise later.
 * Flags live in `config/featureFlags` (admin-editable from the dashboard) and
 * are read live by the app, so flipping one re-enables the feature app-wide
 * with no deploy.
 *
 * Defaults are the launch posture: top-ups + subscriptions OFF, Travel Mate
 * free for everyone.
 */
import type { DocumentData } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';

export interface FeatureFlags {
  /** Gateway wallet top-ups (JazzCash/Easypaisa). Off = "Coming Soon". */
  walletTopupEnabled: boolean;
  /** Paid Travel Mate subscription plans. Off = "Coming Soon". */
  travelMateSubscriptionsEnabled: boolean;
  /** When true, Travel Mate likes are unlimited for everyone (no paywall). */
  travelMateFree: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  walletTopupEnabled: false,
  travelMateSubscriptionsEnabled: false,
  travelMateFree: true,
};

function coerce(data: DocumentData | undefined): FeatureFlags {
  if (!data) return DEFAULT_FLAGS;
  return {
    walletTopupEnabled: data.walletTopupEnabled === true,
    travelMateSubscriptionsEnabled: data.travelMateSubscriptionsEnabled === true,
    // Default true when unset so a missing doc still frees Travel Mate.
    travelMateFree: data.travelMateFree !== false,
  };
}

/** Live feature flags from config/featureFlags, with launch-posture defaults. */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const snap = await db.doc('config/featureFlags').get();
  return coerce(snap.exists ? snap.data() : undefined);
}
