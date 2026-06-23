/**
 * Security-rules unit tests.
 *
 * These assert the loopholes from the original demo are closed. Run with:
 *   cd tests && npm install && npm test
 * (uses the Firestore emulator via `firebase emulators:exec`).
 */
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

const testEnv = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT ?? 'velocity-rules-test',
  firestore: {
    rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    host,
    port: Number(port),
  },
});

after(() => testEnv.cleanup());

const anon = testEnv.unauthenticatedContext().firestore();
const passenger = testEnv.authenticatedContext('passenger1', { role: 'passenger' }).firestore();
const driver = testEnv.authenticatedContext('driver1', { role: 'driver' }).firestore();
const admin = testEnv.authenticatedContext('admin1', { role: 'admin' }).firestore();

// Seed baseline data with rules bypassed.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/passenger1'), {
    uid: 'passenger1', role: 'passenger', displayName: 'P', gender: 'unspecified',
  });
  await setDoc(doc(db, 'drivers/driver1'), {
    driverId: 'driver1', verificationStatus: 'pending', online: false, rating: 4.5,
  });
  await setDoc(doc(db, 'system/counters'), { totalRevenue: 0 });
  await setDoc(doc(db, 'config/fares'), { bike: 150 });
  await setDoc(doc(db, 'trips/trip1'), {
    passengerId: 'passenger1', driverId: 'driver1', status: 'requested',
  });
  await setDoc(doc(db, 'wallets/passenger1'), { uid: 'passenger1', balance: 0 });
  await setDoc(doc(db, 'openRequests/trip1'), { tripId: 'trip1', rideType: 'ac', offeredFare: 500 });
  await setDoc(doc(db, 'payouts/payout1'), { driverId: 'driver1', amount: 500, status: 'pending' });
  await setDoc(doc(db, 'paymentIntents/intent1'), { uid: 'passenger1', amount: 1000, status: 'pending' });
});

test('unauthenticated users are denied everything (default deny)', async () => {
  await assertFails(getDoc(doc(anon, 'config/fares')));
  await assertFails(getDoc(doc(anon, 'users/passenger1')));
  await assertFails(setDoc(doc(anon, 'trips/x'), { hi: 1 }));
});

test('clients cannot write the financial counters (server-only)', async () => {
  await assertFails(setDoc(doc(passenger, 'system/counters'), { totalRevenue: 999999 }));
  await assertFails(updateDoc(doc(admin, 'system/counters'), { totalRevenue: 999999 }));
});

test('only admins can read the financial counters', async () => {
  await assertFails(getDoc(doc(passenger, 'system/counters')));
  await assertSucceeds(getDoc(doc(admin, 'system/counters')));
});

test('a user can read & safely edit their own profile', async () => {
  await assertSucceeds(getDoc(doc(passenger, 'users/passenger1')));
  await assertSucceeds(updateDoc(doc(passenger, 'users/passenger1'), { displayName: 'New' }));
});

test('privilege escalation via profile write is blocked', async () => {
  await assertFails(updateDoc(doc(passenger, 'users/passenger1'), { role: 'admin' }));
});

test('a user cannot read or write someone else’s profile', async () => {
  await assertFails(getDoc(doc(driver, 'users/passenger1')));
  await assertFails(updateDoc(doc(driver, 'users/passenger1'), { displayName: 'hax' }));
});

test('clients cannot write trips directly (server-authoritative)', async () => {
  await assertFails(setDoc(doc(passenger, 'trips/trip2'), { passengerId: 'passenger1' }));
  await assertFails(updateDoc(doc(driver, 'trips/trip1'), { status: 'completed' }));
});

test('participants can read their trip; outsiders cannot', async () => {
  await assertSucceeds(getDoc(doc(passenger, 'trips/trip1')));
  await assertSucceeds(getDoc(doc(driver, 'trips/trip1')));
  const outsider = testEnv.authenticatedContext('rando', { role: 'passenger' }).firestore();
  await assertFails(getDoc(doc(outsider, 'trips/trip1')));
});

test('driver may toggle presence but not self-verify', async () => {
  await assertSucceeds(updateDoc(doc(driver, 'drivers/driver1'), { online: true }));
  await assertFails(updateDoc(doc(driver, 'drivers/driver1'), { verificationStatus: 'approved' }));
  await assertFails(updateDoc(doc(driver, 'drivers/driver1'), { rating: 5 }));
});

test('wallets are not client-writable', async () => {
  await assertFails(updateDoc(doc(passenger, 'wallets/passenger1'), { balance: 100000 }));
  await assertSucceeds(getDoc(doc(passenger, 'wallets/passenger1')));
});

test('config is readable by any signed-in user, writable only by admins', async () => {
  await assertSucceeds(getDoc(doc(passenger, 'config/fares')));
  await assertFails(setDoc(doc(passenger, 'config/fares'), { bike: 1 }));
  await assertSucceeds(setDoc(doc(admin, 'config/fares'), { bike: 160 }));
});

test('open requests are readable by drivers only, never client-writable', async () => {
  await assertSucceeds(getDoc(doc(driver, 'openRequests/trip1')));
  await assertFails(getDoc(doc(passenger, 'openRequests/trip1')));
  await assertFails(setDoc(doc(driver, 'openRequests/x'), { tripId: 'x' }));
});

test('payouts & payment intents are owner/admin-read, server-write only', async () => {
  await assertSucceeds(getDoc(doc(driver, 'payouts/payout1')));
  await assertFails(getDoc(doc(passenger, 'payouts/payout1')));
  await assertFails(setDoc(doc(driver, 'payouts/x'), { driverId: 'driver1' }));
  await assertSucceeds(getDoc(doc(passenger, 'paymentIntents/intent1')));
  await assertFails(getDoc(doc(driver, 'paymentIntents/intent1')));
});
