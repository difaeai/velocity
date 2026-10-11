/**
 * Reading a zone's live peak factor. One implementation, three callers.
 * ----------------------------------------------------------------------------
 * `surge/{cityId}_{zone}` is written by the tick in `engine.ts` and read on
 * every path that prices a ride. Three of them wanted it — `getZoneSurge` in
 * fare/fareFunctions.ts, `liveMultiplier` in pricing/functions.ts, and now
 * `sharedRideFare` — and the first two had already drifted into separate
 * private copies with slightly different guards.
 *
 * That drift is the bug worth preventing: each copy has to re-implement the
 * expiry check, the ceiling clamp and the disabled check, and a copy that
 * forgets the expiry serves a stale multiplier for ever while the one next to
 * it does not.
 *
 * WHAT EVERY READ MUST DO, AND WHY IT IS HERE AND NOT AT THE CALL SITE
 * -------------------------------------------------------------------
 *  · HONOUR THE EXPIRY. The tick stamps `expiresAt`. Past it the answer is 1.0,
 *    because if the tick has died the alternative is pinning every fare in the
 *    zone to whatever multiplier it last managed to write. A pricing engine
 *    that fails must fail to 1.0.
 *  · CLAMP TO THE CEILING. Even reading our own document. A hand-edited or
 *    half-written `surge/*` doc must not be able to raise a fare past
 *    `peak.maxMultiplier`.
 *  · NEVER THROW. A zone whose document cannot be read is a zone at 1.0, not a
 *    ride that cannot be priced.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { fareCityIdsFor } from '../fare/cityConfig';
import { SURGE_COLLECTION, loadPricingConfig, zoneKey } from './config';

export interface ZoneFactor {
  /** What to multiply a fare by. Exactly 1 whenever anything is unknown. */
  multiplier: number;
  /** `{cityId}_{zone}`, or null when no zone could be resolved. */
  zoneKey: string | null;
  reason: 'disabled' | 'no_zone' | 'no_document' | 'expired' | 'live' | 'unreadable';
}

const NEUTRAL = (reason: ZoneFactor['reason'], zoneKey: string | null = null): ZoneFactor => ({
  multiplier: 1,
  zoneKey,
  reason,
});

/**
 * The factor for an already-resolved city and geohash.
 *
 * `geohash` may be any precision at or above the zone's — it is sliced down to
 * `peak.zonePrecision`, which is how a client-supplied 6- or 10-character hash
 * and the tick's 5-character zone end up addressing the same document.
 */
export async function peakFactorForZone(
  cityId: string,
  geohash: string | undefined,
  now: number = Date.now(),
): Promise<ZoneFactor> {
  const config = await loadPricingConfig();
  if (!config.peak.enabled) return NEUTRAL('disabled');

  const precision = Math.max(1, Math.trunc(config.peak.zonePrecision));
  if (!cityId || !geohash || geohash.length < precision) return NEUTRAL('no_zone');

  const key = zoneKey(cityId, geohash.slice(0, precision));

  try {
    const snap = await db.doc(`${SURGE_COLLECTION}/${key}`).get();
    if (!snap.exists) return NEUTRAL('no_document', key);

    const expiresAt = Number(snap.get('expiresAt'));
    if (Number.isFinite(expiresAt) && expiresAt < now) return NEUTRAL('expired', key);

    const raw = Number(snap.get('multiplier'));
    if (!Number.isFinite(raw) || raw <= 0) return NEUTRAL('no_document', key);

    return {
      multiplier: Math.min(
        Math.max(raw, config.peak.minMultiplier),
        config.peak.maxMultiplier,
      ),
      zoneKey: key,
      reason: 'live',
    };
  } catch {
    return NEUTRAL('unreadable', key);
  }
}

/**
 * The factor for a pickup coordinate — the city is resolved the same way every
 * fare table is, so the zone a ride is priced in and the city it is priced
 * from can never disagree.
 */
export async function peakFactorForPoint(
  pickup: { lat: number; lng: number } | null | undefined,
  now: number = Date.now(),
): Promise<ZoneFactor> {
  if (
    !pickup ||
    !Number.isFinite(pickup.lat) ||
    !Number.isFinite(pickup.lng)
  ) {
    return NEUTRAL('no_zone');
  }
  const config = await loadPricingConfig();
  const precision = Math.max(1, Math.trunc(config.peak.zonePrecision));
  const cityId = fareCityIdsFor(pickup)[0]!;
  return peakFactorForZone(cityId, encodeGeohash(pickup.lat, pickup.lng, precision), now);
}
