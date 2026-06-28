/**
 * Test helpers — seed/tear-down Firestore emulator data.
 */
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

export function db(): admin.firestore.Firestore {
  return admin.firestore();
}

/** Wipe the entire emulator Firestore between tests. */
export async function clearFirestore(): Promise<void> {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [host, port] = fsHost.split(':');
  const url = `http://${host}:${port}/emulator/v1/projects/demo-velocity/databases/(default)/documents`;
  await fetch(url, { method: 'DELETE' });
}

/**
 * Build a minimal CallableRequest.
 * The `as unknown as CallableRequest<T>` sidesteps the strict `acceptsStreaming`
 * required field so tests compile; the real handler only reads `.auth` and `.data`.
 */
export function makeReq<T>(data: T, uid: string): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid } as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/** Seed a travelMateProfile. */
export async function seedProfile(uid: string, overrides: Record<string, unknown> = {}) {
  await db().doc(`travelMateProfiles/${uid}`).set({
    uid,
    displayName: `User ${uid}`,
    gender: 'male',
    genderPreference: 'any',
    active: true,
    home: { lat: 33.7, lng: 73.0 },
    destination: { type: 'office', name: 'Office', lat: 33.65, lng: 73.1, address: '' },
    schedule: { days: ['mon', 'tue'], departTime: '09:00', returnTime: '18:00' },
    geohash: 'tq1j',
    photoURL: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
}

/** Seed a mutual match between two users. */
export async function seedMatch(uidA: string, uidB: string, status = 'active') {
  const id = [uidA, uidB].sort().join('_');
  await db().doc(`travelMateMatches/${id}`).set({
    users: [uidA, uidB].sort(),
    userInfo: {
      [uidA]: { displayName: `User ${uidA}`, photoURL: null },
      [uidB]: { displayName: `User ${uidB}`, photoURL: null },
    },
    status,
    matchedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageAt: null,
  });
  return id;
}

/** Seed a wallet with a balance. */
export async function seedWallet(uid: string, balance: number) {
  await db().doc(`wallets/${uid}`).set({ uid, balance, currency: 'PKR' });
}
