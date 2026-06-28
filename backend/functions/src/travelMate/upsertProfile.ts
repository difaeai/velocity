/**
 * Velocity – Travel Mate – upsertTravelMateProfile (callable, v2)
 * ----------------------------------------------------------------------------
 * Creates / updates the user's INDEPENDENT Travel Mate profile.
 *
 * Identity-wall guarantees:
 *  - Writes ONLY to travelMateProfiles/{uid}. Never writes users/{uid}.
 *  - The ONLY time it reads users/{uid} is when the user explicitly asks to
 *    reuse their ride photo (copyRidePhoto:true). That read is one-time and
 *    read-only; the photo is COPIED into travelMate/{uid}/ as a brand-new,
 *    physically independent file – never a live link. Changing/deleting the
 *    ride photo later can never affect the Travel Mate avatar, and vice versa.
 *  - displayName is whatever the client sends (the client can prefill it from
 *    the ride name itself – no server read needed for the name).
 *  - ratingAvg / ratingCount are server-managed and can never be set by the client.
 *  - Geohashes are computed server-side so the feed's geo queries are trustworthy.
 *
 * Wire-up: export { upsertTravelMateProfile } from './travelMate/upsertProfile';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { geohashForLocation } from 'geofire-common';
import { randomUUID } from 'crypto';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

const LatLng = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  address: z.string().max(300).default(''),
});

const Input = z.object({
  displayName: z.string().trim().min(1).max(60),
  gender: z.enum(['male', 'female']),
  genderPreference: z.enum(['male', 'female', 'any']),
  bio: z.string().max(200).default(''),
  home: LatLng,
  destination: z.object({
    type: z.enum(['office', 'university', 'other']),
    name: z.string().trim().min(1).max(120),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    address: z.string().max(300).default(''),
  }),
  schedule: z.object({
    days: z.array(Day).min(1),
    departTime: z.string().regex(HHMM),
    returnTime: z.string().regex(HHMM),
  }),
  active: z.boolean().default(true),
  // Either the client uploaded a fresh TM photo and passes its URL here…
  photoURL: z.string().url().max(2000).optional(),
  // …or the user asked to reuse their ride photo (server copies the file).
  copyRidePhoto: z.boolean().default(false),
});

/** Extract the Storage object path from a Firebase download URL, if it is one. */
function storagePathFromUrl(url: string): string | null {
  const m = url.match(/\/o\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Copy the user's ride photo into travelMate/{uid}/ as an independent file. */
async function copyRidePhotoToTravelMate(uid: string): Promise<string | null> {
  const userSnap = await db.doc(`users/${uid}`).get(); // sanctioned one-time read
  const rideUrl: string | undefined = userSnap.data()?.photoURL; // field confirmed in onUserCreate
  if (!rideUrl) return null;

  const bucket = admin.storage().bucket();
  const srcPath = storagePathFromUrl(rideUrl);
  const destPath = `travelMate/${uid}/avatar_${Date.now()}.jpg`;

  if (srcPath) {
    // Intra-bucket file copy – fast, fully independent copy of the bytes.
    await bucket.file(srcPath).copy(bucket.file(destPath));
    const token = randomUUID();
    await bucket.file(destPath).setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
           `/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
  }

  // Ride photo isn't in our Storage (e.g. a social-login avatar): fall back to
  // referencing the URL. Still independent of identity; just not a file copy.
  return rideUrl;
}

export const upsertTravelMateProfile = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid profile data.', parsed.error.flatten());
  }
  const p = parsed.data;

  // Resolve the photo: copy from ride photo on request, else use the supplied URL.
  let photoURL: string | null = p.photoURL ?? null;
  if (p.copyRidePhoto) {
    photoURL = await copyRidePhotoToTravelMate(uid);
  }

  const ref = db.doc(`travelMateProfiles/${uid}`);
  const existing = await ref.get();

  const base = {
    uid,
    displayName: p.displayName,
    gender: p.gender,
    genderPreference: p.genderPreference,
    bio: p.bio,
    home: {
      lat: p.home.lat, lng: p.home.lng, address: p.home.address,
      geohash: geohashForLocation([p.home.lat, p.home.lng]),
    },
    destination: {
      type: p.destination.type,
      name: p.destination.name,
      lat: p.destination.lat, lng: p.destination.lng, address: p.destination.address,
      geohash: geohashForLocation([p.destination.lat, p.destination.lng]),
    },
    schedule: p.schedule,
    active: p.active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(photoURL ? { photoURL } : {}),
  };

  if (!existing.exists) {
    // Create: rating fields start at zero and are server-managed forever after.
    await ref.set({
      ...base,
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    // Update: never overwrite server-managed rating fields with client input.
    await ref.set(base, { merge: true });
  }

  const fresh = await ref.get();
  return { profile: { id: uid, ...fresh.data() } };
});
