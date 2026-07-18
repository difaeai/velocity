/**
 * Partner-tiers cache.
 *
 * The "Choose your plan" step used to fire `getPartnerTiers` only when the
 * apply screen mounted, so the user stared at a skeleton for however long the
 * callable (often a cold start) took. The fix is to fetch once, keep the result
 * in module scope, and prefetch from the Earn landing page — by the time anyone
 * taps "Apply for Partner Program" the tiers are already here and the plan
 * cards render on the first frame. The apply screen still refreshes in the
 * background so an admin price change is picked up on the next visit.
 */
import { api } from '../api/client';
import type { PartnerTiers } from '../api/client';

let cached: PartnerTiers | null = null;
let inflight: Promise<PartnerTiers> | null = null;

/** Whatever the last successful fetch returned — instant, may be null. */
export function getCachedPartnerTiers(): PartnerTiers | null {
  return cached;
}

/** Fetch (deduplicated) and remember. */
export function fetchPartnerTiers(): Promise<PartnerTiers> {
  if (!inflight) {
    inflight = api
      .getPartnerTiers({})
      .then((t) => {
        cached = t;
        return t;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Fire-and-forget warm-up for screens that lead to the apply flow. */
export function prefetchPartnerTiers(): void {
  fetchPartnerTiers().catch(() => {});
}
