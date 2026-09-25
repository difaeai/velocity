/**
 * Velocity's own map — a place registry we own outright.
 * ----------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * lib/mapsCache.ts makes Google cheaper. It can never make Google optional,
 * because the coordinates in it are rented: the Maps Platform terms give us 30
 * days and then require deletion. Renting forever is still renting.
 *
 * This collection is the other half of the plan — the half we keep. Every row is
 * a place in Pakistan with a Velocity id, a name we wrote, and a coordinate that
 * came from OUR OWN devices. None of it is Google's content, so none of it
 * expires, and a lookup that hits here costs nothing and always will.
 *
 * THE ONE RULE, AND WHY RELABELLING IS NOT ENOUGH
 * A tempting shortcut is to take the coordinate Google returned, give it a
 * Velocity id, and call the result ours. It is not. The 30-day obligation
 * attaches to the *content* — the lat/lng value the API produced — not to the key
 * it is filed under or the name of the collection holding it. If minting our own
 * id were sufficient, the clause would mean nothing, because everyone would add
 * an id column and carry on. Asked where a coordinate came from, there would
 * still be exactly one true answer.
 *
 * What IS permitted, expressly, is the place ID: "You can therefore store place
 * ID values indefinitely." So `placeId` lives here as the permanent join between
 * their identity for a place and ours. That is the legitimate version of the
 * same idea, and it is already valuable — it is what lets an expired lookup be
 * re-resolved for $5 per 1,000 instead of $32.
 *
 * So the coordinate has to come from somewhere else, and we have somewhere
 * better: the phones of the people who actually went there. When a trip
 * completes, the driver's and rider's GPS say where the car really stopped. That
 * measurement is ours, it never expires, and after enough trips it is more
 * accurate than a geocoder for exactly the places that matter to us — a geocoder
 * does not know which gate of Giga Mall people mean, or where "PWD ke saamne"
 * is. Google bootstraps a name we have never seen; our own traffic then owns it.
 *
 * WHAT MUST NEVER HAPPEN HERE
 * A coordinate obtained from Geocoding, Places or Routes must never be written to
 * this collection. `coordSource` records the provenance of every point precisely
 * so that this is auditable rather than a matter of trust, and
 * `assertFirstParty` refuses anything else. If a future caller needs a Google
 * coordinate, it belongs in mapsCache with its expiry, not here.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { normalizeQuery } from '../lib/mapsCache';

export const LOCATIONS_COLLECTION = 'velocityLocations';

/**
 * Where a stored coordinate came from. There is no Google option, by design.
 *
 * `trip_gps`   a device fix from a completed trip — the default and the good one.
 * `admin_pin`  a human dropped the pin in the admin desk, taking responsibility.
 */
export type CoordSource = 'trip_gps' | 'admin_pin';

export type LocationStatus = 'pending' | 'verified' | 'rejected';

/**
 * Confirmations needed before the app will serve a place from our own map.
 *
 * One trip is an anecdote: a rider could have been dropped at the wrong gate, or
 * a GPS fix could have been taken indoors. Three independent trips agreeing
 * within the radius below is a measurement. Until then the row is visible in the
 * admin desk but the resolver ignores it and keeps asking Google, so a bad point
 * can never send anyone anywhere.
 */
export const VERIFY_AFTER_CONFIRMATIONS = 3;

/**
 * How far a new fix may sit from the running centroid and still count.
 *
 * Wide enough to absorb ordinary GPS scatter and the length of a mall frontage,
 * narrow enough that a fix from the next neighbourhood cannot drag the point off
 * the map. A fix outside this radius is not an error and is not discarded — it
 * simply does not move the centroid, because the honest reading is that it is a
 * different place that happens to share a name.
 */
const CENTROID_RADIUS_M = 150;

/** Major cities, for grouping rows in the admin desk. Nearest within range wins. */
const CITIES: readonly { name: string; code: string; lat: number; lng: number }[] = [
  { name: 'Islamabad', code: 'ISB', lat: 33.6844, lng: 73.0479 },
  { name: 'Rawalpindi', code: 'RWP', lat: 33.5651, lng: 73.0169 },
  { name: 'Lahore', code: 'LHE', lat: 31.5204, lng: 74.3587 },
  { name: 'Karachi', code: 'KHI', lat: 24.8607, lng: 67.0011 },
  { name: 'Peshawar', code: 'PEW', lat: 34.0151, lng: 71.5249 },
  { name: 'Quetta', code: 'UET', lat: 30.1798, lng: 66.9750 },
  { name: 'Faisalabad', code: 'LYP', lat: 31.4187, lng: 73.0791 },
  { name: 'Multan', code: 'MUX', lat: 30.1575, lng: 71.5249 },
  { name: 'Sialkot', code: 'SKT', lat: 32.4945, lng: 74.5229 },
  { name: 'Gujranwala', code: 'GUJ', lat: 32.1877, lng: 74.1945 },
  { name: 'Abbottabad', code: 'ATD', lat: 34.1463, lng: 73.2117 },
  { name: 'Murree', code: 'MRE', lat: 33.9070, lng: 73.3943 },
];

/** A city centre this far away is not this place's city. */
const CITY_RADIUS_KM = 60;

export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** The nearest major city, or null when the point is out in the country. */
export function cityFor(coord: { lat: number; lng: number }): { name: string; code: string } | null {
  let best: { name: string; code: string } | null = null;
  let bestM = CITY_RADIUS_KM * 1000;
  for (const c of CITIES) {
    const d = metresBetween(coord, c);
    if (d < bestM) {
      bestM = d;
      best = { name: c.name, code: c.code };
    }
  }
  return best;
}

/**
 * The Velocity id for a place, and its document id.
 *
 * Derived from the normalised name rather than a counter, which makes an upsert
 * idempotent with no transaction: the same place always lands on the same
 * document, so a promoter that runs twice over the same trip cannot create a
 * duplicate. Readable on purpose — this id turns up in the admin desk and in
 * support conversations, so `VL-ISB-7F3A2C` beats an opaque hash.
 */
export function velocityLocationId(name: string, cityCode: string | null): string {
  const normalized = normalizeQuery(name);
  // A short FNV-1a over the normalised name. Not cryptographic — it only has to
  // spread a few tens of thousands of Pakistani place names without collisions.
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const suffix = h.toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  return `VL-${cityCode ?? 'PAK'}-${suffix}`;
}

export interface VelocityLocation {
  velocityId: string;
  /** The display name. Admin-editable; seeded from what the rider typed or said. */
  name: string;
  normalizedName: string;
  city: string | null;
  /** Other spellings that should resolve here. Admin-editable. */
  aliases: string[];
  /** Google's permanent identifier for the same place, when we know it. */
  placeId: string | null;
  lat: number;
  lng: number;
  coordSource: CoordSource;
  geohash: string;
  confirmations: number;
  status: LocationStatus;
}

/**
 * Refuse to store a coordinate we are not allowed to keep.
 *
 * Deliberately a hard throw rather than a log: the whole value of this
 * collection is that everything in it is ours, and a single Google coordinate
 * written here would quietly turn a compliant registry into a licence breach
 * that no test would notice. Provenance is checked at the door.
 */
function assertFirstParty(source: CoordSource): void {
  if (source !== 'trip_gps' && source !== 'admin_pin') {
    throw new Error(
      `velocityLocations: refusing a coordinate with provenance "${String(source)}". ` +
        'Only first-party fixes may be stored here — see lib/mapsCache.ts for the rented kind.',
    );
  }
}

export interface ObservedPlace {
  /** What the rider called it. */
  name: string;
  /** A first-party fix: the device GPS at pickup or drop-off. */
  lat: number;
  lng: number;
  source: CoordSource;
  /** Google's id for the same place, if the booking happened to carry one. */
  placeId?: string | null;
  /** The trip this observation came from, so a re-run cannot double-count it. */
  tripId?: string;
}

/**
 * Record that somebody really went to a named place, and move our idea of where
 * it is a little closer to the truth.
 *
 * Returns the document id, or null when the observation was not usable. Never
 * throws for a bad observation — this runs inside a sweep over completed trips
 * and one malformed row must not stop the rest.
 */
export async function observePlace(obs: ObservedPlace): Promise<string | null> {
  const name = obs.name.trim();
  if (name.length < 3) return null;
  if (!Number.isFinite(obs.lat) || !Number.isFinite(obs.lng)) return null;
  // Pakistan, loosely. A fix outside it is a bug somewhere upstream, and letting
  // it in would put a pin in the sea.
  if (obs.lat < 23 || obs.lat > 38 || obs.lng < 60 || obs.lng > 78) return null;

  assertFirstParty(obs.source);

  const city = cityFor({ lat: obs.lat, lng: obs.lng });
  const id = velocityLocationId(name, city?.code ?? null);
  const ref = db.collection(LOCATIONS_COLLECTION).doc(id);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists) {
        tx.set(ref, {
          velocityId: id,
          name,
          normalizedName: normalizeQuery(name),
          city: city?.name ?? null,
          aliases: [],
          placeId: obs.placeId ?? null,
          lat: obs.lat,
          lng: obs.lng,
          coordSource: obs.source,
          geohash: encodeGeohash(obs.lat, obs.lng, 6),
          confirmations: 1,
          status: 'pending' as LocationStatus,
          contributingTrips: obs.tripId ? [obs.tripId] : [],
          createdAt: FieldValue.serverTimestamp(),
          lastConfirmedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      // Idempotence: a sweep that overlaps its own window must not let one trip
      // confirm the same place twice. The list is capped so a busy place does not
      // grow an unbounded array — past the cap we stop deduplicating, by which
      // point the location is long since verified and another confirmation
      // changes nothing.
      const trips = (snap.get('contributingTrips') as string[] | undefined) ?? [];
      if (obs.tripId && trips.includes(obs.tripId)) return;

      const current = {
        lat: snap.get('lat') as number,
        lng: snap.get('lng') as number,
      };
      const confirmations = (snap.get('confirmations') as number | undefined) ?? 0;
      const withinRadius = metresBetween(current, { lat: obs.lat, lng: obs.lng }) <= CENTROID_RADIUS_M;

      // Running mean, but only over fixes that agree with where we already think
      // this place is. A fix from somewhere else still counts as a visit; it just
      // does not get a vote on the coordinate.
      const next = withinRadius
        ? {
            lat: (current.lat * confirmations + obs.lat) / (confirmations + 1),
            lng: (current.lng * confirmations + obs.lng) / (confirmations + 1),
          }
        : current;

      const nextConfirmations = confirmations + 1;
      const status = snap.get('status') as LocationStatus | undefined;

      tx.set(
        ref,
        {
          lat: next.lat,
          lng: next.lng,
          geohash: encodeGeohash(next.lat, next.lng, 6),
          confirmations: nextConfirmations,
          // A place an admin rejected stays rejected however many cars go there —
          // the rejection is a judgement about the name, not the traffic.
          ...(status === 'rejected'
            ? {}
            : {
                status:
                  nextConfirmations >= VERIFY_AFTER_CONFIRMATIONS
                    ? ('verified' as LocationStatus)
                    : ('pending' as LocationStatus),
              }),
          // Never overwrite a known place id with null: a booking that arrived
          // without one tells us nothing about the one we already had.
          ...(obs.placeId ? { placeId: obs.placeId } : {}),
          ...(obs.tripId && trips.length < 50
            ? { contributingTrips: FieldValue.arrayUnion(obs.tripId) }
            : {}),
          lastConfirmedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    return id;
  } catch (e) {
    logger.warn('velocityLocations: could not record an observation', { name, e });
    return null;
  }
}

export interface ResolvedOwnPlace {
  lat: number;
  lng: number;
  address: string;
  velocityId: string;
}

/**
 * Look a name up in our own map. The cheapest possible answer: no Google call,
 * no expiry, no bill.
 *
 * Only `verified` rows are served. A pending row is a guess with one or two trips
 * behind it, and sending a passenger to a guess to save a $0.005 call would be a
 * bad trade. Matches the normalised name or any admin-added alias.
 */
export async function lookupOwnPlace(query: string): Promise<ResolvedOwnPlace | null> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 3) return null;

  try {
    const byName = await db
      .collection(LOCATIONS_COLLECTION)
      .where('normalizedName', '==', normalized)
      .where('status', '==', 'verified')
      .limit(1)
      .get();

    const hit =
      byName.docs[0] ??
      (
        await db
          .collection(LOCATIONS_COLLECTION)
          .where('aliases', 'array-contains', normalized)
          .where('status', '==', 'verified')
          .limit(1)
          .get()
      ).docs[0];

    if (!hit) return null;

    const lat = hit.get('lat') as number | undefined;
    const lng = hit.get('lng') as number | undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    return {
      lat,
      lng,
      address: (hit.get('name') as string | undefined) ?? query,
      velocityId: (hit.get('velocityId') as string | undefined) ?? hit.id,
    };
  } catch (e) {
    // A registry problem must degrade to "ask Google", never to a failed booking.
    logger.warn('velocityLocations: lookup failed, falling through to Google', e);
    return null;
  }
}

export interface OwnPlaceSuggestion {
  velocityId: string;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
}

/**
 * Suggestions for a partial name, from our own map. Free, and free permanently.
 *
 * This is the autocomplete half of the same idea as `lookupOwnPlace`. Every
 * keystroke a rider types is a billed Google autocomplete request, and the
 * destinations Pakistanis actually pick are a small, repeating set — so once a
 * place is on our map there is no reason to pay to suggest it ever again.
 *
 * ONLY VERIFIED ROWS, for two separate reasons. The obvious one is accuracy: a
 * pending row is a guess with one or two trips behind it, and putting a guess at
 * the top of a suggestion list is how somebody ends up at the wrong gate. The
 * second is provenance. A row is seeded with whatever the booking recorded, which
 * for a tapped Google prediction is Google's own formatted address; verification
 * is the point at which an operator has looked at the row and can rename it, so
 * verified names are ones we stand behind rather than ones we are repeating.
 *
 * Firestore has no substring search, so this is a prefix range on the normalised
 * name plus an exact alias match. "giga" finds "Giga Mall"; "mall" does not, and
 * that is the honest limit of a query this cheap — Google is still there for the
 * rest, which is why callers merge rather than replace.
 */
export async function searchOwnPlaces(
  query: string,
  limit = 5,
): Promise<OwnPlaceSuggestion[]> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 3) return [];

  const toSuggestion = (
    d: FirebaseFirestore.QueryDocumentSnapshot,
  ): OwnPlaceSuggestion | null => {
    const lat = d.get('lat') as number | undefined;
    const lng = d.get('lng') as number | undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return {
      velocityId: (d.get('velocityId') as string | undefined) ?? d.id,
      name: (d.get('name') as string | undefined) ?? '',
      city: (d.get('city') as string | null | undefined) ?? null,
      lat,
      lng,
    };
  };

  try {
    const [byPrefix, byAlias] = await Promise.all([
      db
        .collection(LOCATIONS_COLLECTION)
        .where('status', '==', 'verified')
        .orderBy('normalizedName')
        .startAt(normalized)
        .endAt(`${normalized}`)
        .limit(limit)
        .get(),
      db
        .collection(LOCATIONS_COLLECTION)
        .where('aliases', 'array-contains', normalized)
        .where('status', '==', 'verified')
        .limit(limit)
        .get(),
    ]);

    const seen = new Set<string>();
    const out: OwnPlaceSuggestion[] = [];
    // Prefix hits first: an alias match is an operator's shortcut, and a name the
    // rider is actually typing is the better thing to show at the top.
    for (const doc of [...byPrefix.docs, ...byAlias.docs]) {
      const s = toSuggestion(doc);
      if (!s || seen.has(s.velocityId)) continue;
      seen.add(s.velocityId);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    // A registry problem must degrade to "ask Google", never to an empty list the
    // rider reads as "no such place". Callers treat an empty result as "nothing of
    // ours matched" and go on to query Google, which is exactly right here.
    logger.warn('velocityLocations: suggestion search failed, falling through', e);
    return [];
  }
}

/** Resolve one of our own suggestions back to a place. No Google call, ever. */
export async function resolveOwnPlace(velocityId: string): Promise<ResolvedOwnPlace | null> {
  try {
    const snap = await db.collection(LOCATIONS_COLLECTION).doc(velocityId).get();
    if (!snap.exists) return null;
    if ((snap.get('status') as LocationStatus | undefined) !== 'verified') return null;

    const lat = snap.get('lat') as number | undefined;
    const lng = snap.get('lng') as number | undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    return {
      lat,
      lng,
      address: (snap.get('name') as string | undefined) ?? '',
      velocityId: (snap.get('velocityId') as string | undefined) ?? snap.id,
    };
  } catch (e) {
    logger.warn('velocityLocations: could not resolve a suggestion', { velocityId, e });
    return null;
  }
}

/** Exported for the admin desk's summary row. */
export async function countByStatus(): Promise<Record<LocationStatus, number>> {
  const out: Record<LocationStatus, number> = { pending: 0, verified: 0, rejected: 0 };
  await Promise.all(
    (['pending', 'verified', 'rejected'] as LocationStatus[]).map(async (status) => {
      const agg = await db
        .collection(LOCATIONS_COLLECTION)
        .where('status', '==', status)
        .count()
        .get();
      out[status] = agg.data().count;
    }),
  );
  return out;
}

export { Timestamp };
