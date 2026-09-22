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

/**
 * The car-photo fields a driver document needs to be allowed to take work.
 *
 * Every callable that hands a driver a passenger runs `assertVehicleConfirmed`
 * (see domain/vehicleCheck.ts), so a driver seeded without these is refused —
 * correctly, but it has nothing to do with whatever the test is actually about.
 * Spread this into the seed to say "this driver photographed their car today".
 */
export function confirmedCar(vehicleId = 'primary'): Record<string, unknown> {
  return {
    activeVehicleId: vehicleId,
    vehicleCheck: { status: 'approved', vehicleId, confirmedAt: new Date() },
  };
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

/**
 * Build a CallableRequest whose caller holds the admin claim.
 *
 * requireAdmin reads the role off the decoded token, not off the uid, so an
 * admin test request differs from makeReq only in that claim.
 */
export function makeAdminReq<T>(data: T, uid = 'admin-uid'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'admin' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

/** Seed a commute group with the given members (first one is the creator). */
export async function seedGroup(members: string[], overrides: Record<string, unknown> = {}) {
  const ref = db().collection('travelMateGroups').doc();
  const memberInfo: Record<string, unknown> = {};
  for (const m of members) memberInfo[m] = { displayName: `User ${m}`, photoURL: null };
  await ref.set({
    name: 'Test group',
    createdBy: members[0],
    members,
    memberInfo,
    destinationName: 'Office',
    maxSize: 4,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
}

/** Seed a wallet with a balance. */
export async function seedWallet(uid: string, balance: number) {
  await db().doc(`wallets/${uid}`).set({ uid, balance, currency: 'PKR' });
}
