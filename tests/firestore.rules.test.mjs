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
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
  await setDoc(doc(db, 'trips/poolTrip1'), {
    passengerId: 'passenger1', driverId: null, status: 'requested',
    pool: true, poolMembers: ['passenger1', 'joiner1'],
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

test('pool members who joined via a share link can read the trip; outsiders cannot', async () => {
  const joiner = testEnv.authenticatedContext('joiner1', { role: 'passenger' }).firestore();
  await assertSucceeds(getDoc(doc(joiner, 'trips/poolTrip1')));
  await assertSucceeds(getDoc(doc(passenger, 'trips/poolTrip1')));
  const outsider = testEnv.authenticatedContext('rando2', { role: 'passenger' }).firestore();
  await assertFails(getDoc(doc(outsider, 'trips/poolTrip1')));
  // Membership grants read only — writes stay server-authoritative.
  await assertFails(updateDoc(doc(joiner, 'trips/poolTrip1'), { poolMembers: ['joiner1'] }));
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

test('rate-limit counters are not client-accessible', async () => {
  await assertFails(getDoc(doc(passenger, 'rateLimits/x')));
  await assertFails(setDoc(doc(driver, 'rateLimits/y'), { count: 0 }));
});

// ── TravelMate community feed ────────────────────────────────────────────────

test('community posts are readable by signed-in users, never client-writable', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'travelMatePosts/post1'), {
      authorId: 'author1', authorName: 'A', text: 'hello', likeCount: 0, commentCount: 0,
    });
    await setDoc(doc(ctx.firestore(), 'travelMatePosts/post1/comments/c1'), {
      postId: 'post1', authorId: 'author1', text: 'first',
    });
    await setDoc(doc(ctx.firestore(), 'travelMatePosts/post1/likes/liker1'), {
      uid: 'liker1', postId: 'post1',
    });
  });
  await assertSucceeds(getDoc(doc(passenger, 'travelMatePosts/post1')));
  await assertFails(getDoc(doc(anon, 'travelMatePosts/post1')));
  await assertFails(setDoc(doc(passenger, 'travelMatePosts/hax'), { authorId: 'passenger1', text: 'x' }));
  await assertFails(updateDoc(doc(passenger, 'travelMatePosts/post1'), { likeCount: 999 }));
  // Comments + likes readable, but only the CFs write them (counters stay honest).
  await assertSucceeds(getDoc(doc(passenger, 'travelMatePosts/post1/comments/c1')));
  await assertFails(setDoc(doc(passenger, 'travelMatePosts/post1/comments/c2'), { authorId: 'passenger1', text: 'x' }));
  await assertSucceeds(getDoc(doc(passenger, 'travelMatePosts/post1/likes/liker1')));
  await assertFails(setDoc(doc(passenger, 'travelMatePosts/post1/likes/passenger1'), { uid: 'passenger1' }));
});

test('follows: ID must encode the real follower; no forged follows', async () => {
  // Legit: passenger1 follows author1 with the correctly-encoded doc ID.
  await assertSucceeds(setDoc(doc(passenger, 'travelMateFollows/passenger1_author1'), {
    followerId: 'passenger1', followedId: 'author1',
  }));
  // Forged follower ID or mismatched doc ID → denied.
  await assertFails(setDoc(doc(passenger, 'travelMateFollows/driver1_author1'), {
    followerId: 'driver1', followedId: 'author1',
  }));
  await assertFails(setDoc(doc(passenger, 'travelMateFollows/passenger1_other'), {
    followerId: 'passenger1', followedId: 'author1',
  }));
  // Self-follow → denied.
  await assertFails(setDoc(doc(passenger, 'travelMateFollows/passenger1_passenger1'), {
    followerId: 'passenger1', followedId: 'passenger1',
  }));
  // Unfollow own edge OK; deleting someone else's follow → denied.
  await assertSucceeds(deleteDoc(doc(passenger, 'travelMateFollows/passenger1_author1')));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'travelMateFollows/driver1_author1'), {
      followerId: 'driver1', followedId: 'author1',
    });
  });
  await assertFails(deleteDoc(doc(passenger, 'travelMateFollows/driver1_author1')));
});

test('communities are readable by signed-in users, writes go through CFs', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'travelMateCommunities/comm1'), {
      name: 'Lahore Travellers', city: 'Lahore', members: ['author1'], memberCount: 1,
    });
  });
  await assertSucceeds(getDoc(doc(passenger, 'travelMateCommunities/comm1')));
  await assertFails(setDoc(doc(passenger, 'travelMateCommunities/hax'), { name: 'x', city: 'y' }));
  await assertFails(updateDoc(doc(passenger, 'travelMateCommunities/comm1'), { memberCount: 999 }));
});

test('block list is private to the blocker (and admins) and CF-write-only', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'travelMateBlocks/passenger1_author1'), {
      blockerId: 'passenger1', blockedId: 'author1', blockedName: 'A',
    });
  });
  await assertSucceeds(getDoc(doc(passenger, 'travelMateBlocks/passenger1_author1')));
  await assertSucceeds(getDoc(doc(admin, 'travelMateBlocks/passenger1_author1')));
  // The blocked user (or anyone else) must never learn about the block.
  const author = testEnv.authenticatedContext('author1', { role: 'passenger' }).firestore();
  await assertFails(getDoc(doc(author, 'travelMateBlocks/passenger1_author1')));
  // Blocks are written only by the block/unblock CFs.
  await assertFails(setDoc(doc(passenger, 'travelMateBlocks/passenger1_driver1'), {
    blockerId: 'passenger1', blockedId: 'driver1',
  }));
  await assertFails(deleteDoc(doc(passenger, 'travelMateBlocks/passenger1_author1')));
});

test('travelMate profile owner may set community fields, others may not write', async () => {
  await assertSucceeds(setDoc(doc(passenger, 'travelMateProfiles/passenger1'), {
    uid: 'passenger1', displayName: 'P', displayNameLower: 'p',
    age: 25, gender: 'male', genderPref: 'any', bio: '', interests: [],
    photoURL: null, active: true, lastActive: new Date(), createdAt: new Date(),
    location: null, searchRadiusKm: null,
  }));
  await assertFails(updateDoc(doc(driver, 'travelMateProfiles/passenger1'), { displayName: 'hax' }));
  // Server-only fields can't be smuggled in.
  await assertFails(updateDoc(doc(passenger, 'travelMateProfiles/passenger1'), { suspended: false }));
});
