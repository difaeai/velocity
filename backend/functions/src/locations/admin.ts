/**
 * The Locations desk — the admin side of Velocity's own map.
 * ----------------------------------------------------------------------------
 * The registry fills itself from completed trips (see promote.ts), which is the
 * only way it could realistically stay current. What it cannot do by itself is
 * judgement: whether "Blue Area" and "Blue Area, Islamabad" are one place, whether
 * a name a rider typed is worth keeping, whether a point that three trips agree on
 * is actually the right gate. That is what this desk is for.
 *
 * Four verbs, and they are deliberately few:
 *
 *   list     read the registry, filtered and searchable
 *   review   verify or reject a row, or rename it
 *   alias    teach a row another spelling that should resolve to it
 *   merge    fold a duplicate into the row it should have been
 *
 * There is no "create with coordinates" and no "edit the coordinate to whatever I
 * like" beyond dropping a pin, because the value of this collection is that every
 * point in it is a first-party measurement. An admin pin is allowed and is
 * recorded as such (`coordSource: 'admin_pin'`) — a human taking responsibility is
 * a legitimate source. A coordinate copied out of Google Maps is not, and
 * `observePlace` refuses anything whose provenance is not one of the two.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { requireAdmin, invalid } from '../lib/guards';
import { db, FieldValue } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { normalizeQuery } from '../lib/mapsCache';
import {
  LOCATIONS_COLLECTION,
  cityFor,
  countByStatus,
  type LocationStatus,
} from './registry';

const listSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'all']).default('all'),
  /** Free text, matched against the normalised name as a prefix. */
  search: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const adminListVelocityLocations = onCall(async (req) => {
  requireAdmin(req);

  const parsed = listSchema.safeParse(req.data ?? {});
  if (!parsed.success) invalid('Provide valid list filters.');
  const { status, search, city, limit } = parsed.data;

  let q = db.collection(LOCATIONS_COLLECTION) as FirebaseFirestore.Query;
  if (status !== 'all') q = q.where('status', '==', status);
  if (city) q = q.where('city', '==', city);

  const term = search ? normalizeQuery(search) : '';
  if (term) {
    // Prefix range on the normalised name. Firestore has no substring search and
    // this desk does not warrant a search index — an operator looking for "giga"
    // finds "giga mall" either way, and the alternative is reading the whole
    // collection into memory to filter it here.
    q = q.orderBy('normalizedName').startAt(term).endAt(`${term}`);
  } else {
    // Most recently confirmed first: the rows an operator wants are the ones the
    // platform is currently learning about.
    q = q.orderBy('lastConfirmedAt', 'desc');
  }

  const snap = await q.limit(limit).get();

  return {
    ok: true,
    counts: await countByStatus(),
    locations: snap.docs.map((d) => ({
      id: d.id,
      velocityId: (d.get('velocityId') as string | undefined) ?? d.id,
      name: (d.get('name') as string | undefined) ?? '',
      city: (d.get('city') as string | null | undefined) ?? null,
      aliases: (d.get('aliases') as string[] | undefined) ?? [],
      placeId: (d.get('placeId') as string | null | undefined) ?? null,
      lat: (d.get('lat') as number | undefined) ?? 0,
      lng: (d.get('lng') as number | undefined) ?? 0,
      coordSource: (d.get('coordSource') as string | undefined) ?? 'trip_gps',
      confirmations: (d.get('confirmations') as number | undefined) ?? 0,
      status: (d.get('status') as LocationStatus | undefined) ?? 'pending',
      lastConfirmedAt:
        (d.get('lastConfirmedAt') as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? null,
    })),
  };
});

const reviewSchema = z.object({
  id: z.string().min(3).max(120),
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  name: z.string().min(3).max(160).optional(),
  /** Move the point. Recorded as an admin pin, never as a trip fix. */
  lat: z.number().min(23).max(38).optional(),
  lng: z.number().min(60).max(78).optional(),
});

export const adminReviewVelocityLocation = onCall(async (req) => {
  requireAdmin(req);

  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a location id and at least one change.');
  const { id, status, name, lat, lng } = parsed.data;

  if (status === undefined && name === undefined && lat === undefined && lng === undefined) {
    invalid('Nothing to change.');
  }
  // Half a coordinate is a bug, not a pin.
  if ((lat === undefined) !== (lng === undefined)) {
    invalid('Provide both a latitude and a longitude, or neither.');
  }

  const ref = db.collection(LOCATIONS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) invalid('That location no longer exists.');

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (status) patch.status = status;
  if (name) {
    patch.name = name.trim();
    patch.normalizedName = normalizeQuery(name);
  }
  if (lat !== undefined && lng !== undefined) {
    patch.lat = lat;
    patch.lng = lng;
    patch.geohash = encodeGeohash(lat, lng, 6);
    // Provenance is the point of this collection, so an admin move is stamped as
    // an admin move. It also stops the running mean from quietly averaging a
    // deliberate correction back towards the fixes it was correcting.
    patch.coordSource = 'admin_pin';
    patch.city = cityFor({ lat, lng })?.name ?? null;
  }

  await ref.set(patch, { merge: true });
  return { ok: true };
});

const aliasSchema = z.object({
  id: z.string().min(3).max(120),
  alias: z.string().min(2).max(160),
  action: z.enum(['add', 'remove']).default('add'),
});

export const adminAliasVelocityLocation = onCall(async (req) => {
  requireAdmin(req);

  const parsed = aliasSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a location id and an alias.');
  const { id, alias, action } = parsed.data;

  // Stored normalised, because that is the form `lookupOwnPlace` matches against.
  const normalized = normalizeQuery(alias);
  if (normalized.length < 2) invalid('That alias is too short to match anything.');

  await db
    .collection(LOCATIONS_COLLECTION)
    .doc(id)
    .set(
      {
        aliases:
          action === 'add' ? FieldValue.arrayUnion(normalized) : FieldValue.arrayRemove(normalized),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return { ok: true, alias: normalized };
});

const mergeSchema = z.object({
  /** The row to keep. */
  keepId: z.string().min(3).max(120),
  /** The duplicate to fold in and reject. */
  mergeId: z.string().min(3).max(120),
});

export const adminMergeVelocityLocations = onCall(async (req) => {
  requireAdmin(req);

  const parsed = mergeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide both location ids.');
  const { keepId, mergeId } = parsed.data;
  if (keepId === mergeId) invalid('A location cannot be merged into itself.');

  await db.runTransaction(async (tx) => {
    const keepRef = db.collection(LOCATIONS_COLLECTION).doc(keepId);
    const mergeRef = db.collection(LOCATIONS_COLLECTION).doc(mergeId);
    const [keep, dupe] = await Promise.all([tx.get(keepRef), tx.get(mergeRef)]);
    if (!keep.exists || !dupe.exists) invalid('One of those locations no longer exists.');

    const dupeName = (dupe.get('name') as string | undefined) ?? '';
    const dupeAliases = (dupe.get('aliases') as string[] | undefined) ?? [];
    // The duplicate's own name becomes an alias of the survivor, so every spelling
    // that used to resolve still resolves after the merge.
    const carried = [normalizeQuery(dupeName), ...dupeAliases].filter((a) => a.length >= 2);

    tx.set(
      keepRef,
      {
        aliases: FieldValue.arrayUnion(...carried),
        confirmations:
          ((keep.get('confirmations') as number | undefined) ?? 0) +
          ((dupe.get('confirmations') as number | undefined) ?? 0),
        // Keep whichever place id we have; the survivor's wins when both do.
        ...(keep.get('placeId') ? {} : { placeId: dupe.get('placeId') ?? null }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Rejected rather than deleted. The promoter keys a place by its name, so a
    // deleted duplicate would simply be recreated by the next trip that used that
    // spelling; a rejected one stays out of the resolver permanently.
    tx.set(
      mergeRef,
      {
        status: 'rejected' as LocationStatus,
        mergedInto: keepId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  return { ok: true };
});
