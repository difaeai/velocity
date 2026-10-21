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
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

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
    // Photographed their car a minute ago, so they are allowed to go online.
    activeVehicleId: 'primary',
    vehicleCheck: { status: 'pending', vehicleId: 'primary', confirmedAt: new Date() },
  });
  await setDoc(doc(db, 'drivers/driver1/vehicles/primary'), {
    vehicleId: 'primary', plate: 'ABC-123', status: 'approved',
  });
  // A second driver who has never photographed their car.
  await setDoc(doc(db, 'drivers/driver2'), {
    driverId: 'driver2', verificationStatus: 'approved', online: false, rating: 5,
  });
  // …and a third whose photo is of the car they used to drive.
  await setDoc(doc(db, 'drivers/driver3'), {
    driverId: 'driver3', verificationStatus: 'approved', online: false, rating: 5,
    activeVehicleId: 'vehicle-b',
    vehicleCheck: { status: 'approved', vehicleId: 'vehicle-a', confirmedAt: new Date() },
  });
  await setDoc(doc(db, 'system/counters'), { totalRevenue: 0 });
  await setDoc(doc(db, 'driver_submissions/sub1'), {
    partnerId: 'partner1', fullName: 'Rashid', phone: '+923001234567', status: 'pending',
  });
  await setDoc(doc(db, 'config/fares'), { bike: 150 });
  await setDoc(doc(db, 'trips/trip1'), {
    passengerId: 'passenger1', driverId: 'driver1', status: 'requested',
  });
  await setDoc(doc(db, 'trips/poolTrip1'), {
    passengerId: 'passenger1', driverId: null, status: 'requested',
    pool: true, poolMembers: ['passenger1', 'joiner1'],
  });
  // A pool a driver is carrying, with somebody asking for its last seat.
  await setDoc(doc(db, 'trips/poolTrip2'), {
    passengerId: 'passenger1', driverId: 'driver1', status: 'matched',
    pool: true, poolMembers: ['passenger1'],
  });
  await setDoc(doc(db, 'trips/poolTrip2/joinRequests/asker1'), {
    riderId: 'asker1', riderName: 'Asker', status: 'pending', farePerSeat: 240,
  });
  await setDoc(doc(db, 'poolRideRequests/poolReq1'), {
    leaderId: 'passenger1', driverId: 'driver1', status: 'active',
    passengers: ['passenger1'],
  });
  await setDoc(doc(db, 'poolRideRequests/poolReq1/joinRequests/asker1'), {
    riderId: 'asker1', riderName: 'Asker', status: 'pending', farePerSeat: 200,
  });
  // Under offer to driver9, who is not (yet) its driver.
  await setDoc(doc(db, 'poolRideRequests/poolReqOffered'), {
    leaderId: 'passenger1', driverId: null, status: 'open',
    passengers: ['passenger1'],
    dispatch: {
      offeredDriverId: 'driver9', offeredAt: Date.now(),
      offerExpiresAt: Date.now() + 25000, offers: 1, declined: [], openToAll: false,
    },
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

test('a rider can record who they will share a car with', async () => {
  // The home-screen selector writes both fields in one update: mixedRideOk is
  // what every gender gate in the app reads, and sharedRideGenderPref is the
  // explicit answer that tells "chose same-gender" apart from "never asked".
  // Leave either off the whitelist and the selector fails silently — the chip
  // moves, the write is rejected, and the preference never applies anywhere.
  await assertSucceeds(updateDoc(doc(passenger, 'users/passenger1'), {
    sharedRideGenderPref: 'any_gender',
    mixedRideOk: true,
  }));
  await assertSucceeds(updateDoc(doc(passenger, 'users/passenger1'), {
    sharedRideGenderPref: 'same_gender',
    mixedRideOk: false,
  }));
  // Still nobody else's to set — being able to flip a stranger's preference is
  // being able to seat them next to whoever you like.
  await assertFails(updateDoc(doc(driver, 'users/passenger1'), { mixedRideOk: true }));
});

test('a user cannot read or write someone else’s profile', async () => {
  await assertFails(getDoc(doc(driver, 'users/passenger1')));
  await assertFails(updateDoc(doc(driver, 'users/passenger1'), { displayName: 'hax' }));
});

test('emergency contacts: owner-only, and the limit of five is the rule, not the app', async () => {
  const contact = (i) => ({ id: `c${i}`, name: `Contact ${i}`, phone: `9230012345${i}${i}`, whatsappCheckedAt: null });
  const mine = doc(passenger, 'users/passenger1/safety/emergencyContacts');

  // Five is fine.
  await assertSucceeds(setDoc(mine, { contacts: [1, 2, 3, 4, 5].map(contact), updatedAt: 1 }));
  await assertSucceeds(getDoc(mine));

  // Six is not. The cap lives here because a modified client would ignore one
  // that lived only in the app.
  await assertFails(setDoc(mine, { contacts: [1, 2, 3, 4, 5, 6].map(contact), updatedAt: 2 }));

  // These are other people's phone numbers. Nobody else reads or writes them —
  // not the driver on the rider's trip, not anyone.
  await assertFails(getDoc(doc(driver, 'users/passenger1/safety/emergencyContacts')));
  await assertFails(setDoc(doc(driver, 'users/passenger1/safety/emergencyContacts'), { contacts: [] }));

  // And the shape is pinned: `contacts` must be a list, so a scalar cannot
  // slip past the size check.
  await assertFails(setDoc(mine, { contacts: 'all of them' }));

  // No other settings document may be invented through this path.
  await assertFails(setDoc(doc(passenger, 'users/passenger1/safety/somethingElse'), { contacts: [] }));
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

test('driver may choose solo or sharing work, and the server reads it', async () => {
  // The pool offer ladder skips drivers who have chosen solo. Safe for the
  // handset to own: lying about it can only take a driver OUT of pool offers,
  // and an absent value already means available.
  await assertSucceeds(updateDoc(doc(driver, 'drivers/driver1'), { rideMode: 'solo' }));
  await assertSucceeds(updateDoc(doc(driver, 'drivers/driver1'), { rideMode: 'sharing' }));
});

test('a driver offered a shared ride may read it before they are its driver', async () => {
  const offeredTo = testEnv.authenticatedContext('driver9', { role: 'driver' }).firestore();
  const otherDriver = testEnv.authenticatedContext('driver8', { role: 'driver' }).firestore();

  // They hold the exclusive offer and are NOT yet `driverId` — they need the
  // document to watch their own countdown rather than discover at the next
  // poll that the ride already went to somebody else.
  await assertSucceeds(getDoc(doc(offeredTo, 'poolRideRequests/poolReqOffered')));
  await assertFails(getDoc(doc(otherDriver, 'poolRideRequests/poolReqOffered')));
  // Reading it never means writing it.
  await assertFails(updateDoc(doc(offeredTo, 'poolRideRequests/poolReqOffered'), { driverId: 'driver9' }));
});

test('a pool created before the offer ladder is still readable', async () => {
  // `poolReq1` has no `dispatch` map at all, as every pool created before the
  // ladder shipped does. The read rule has to reach that field through `get`
  // with a default — a missing-field access is an ERROR, not a false, and in an
  // `||` chain it would have denied the whole existing backlog to its own
  // participants and to admins.
  await assertSucceeds(getDoc(doc(passenger, 'poolRideRequests/poolReq1')));
  await assertSucceeds(getDoc(doc(driver, 'poolRideRequests/poolReq1')));
  await assertSucceeds(getDoc(doc(admin, 'poolRideRequests/poolReq1')));

  const stranger = testEnv.authenticatedContext('stranger1', { role: 'passenger' }).firestore();
  await assertFails(getDoc(doc(stranger, 'poolRideRequests/poolReq1')));
});

test('going online requires a live photo of the car being driven', async () => {
  const unphotographed = testEnv.authenticatedContext('driver2', { role: 'driver' }).firestore();
  const switchedCars   = testEnv.authenticatedContext('driver3', { role: 'driver' }).firestore();

  // Never photographed their car, and photographed a car they no longer drive.
  await assertFails(updateDoc(doc(unphotographed, 'drivers/driver2'), { online: true }));
  await assertFails(updateDoc(doc(switchedCars,   'drivers/driver3'), { online: true }));
  // The gate is on going online only — everything else still works offline, and
  // going offline must never be blocked by it.
  await assertSucceeds(updateDoc(doc(unphotographed, 'drivers/driver2'), { online: false }));
  await assertSucceeds(
    updateDoc(doc(unphotographed, 'drivers/driver2'), { lastLocation: { lat: 33.6, lng: 73.0 } }),
  );

  // A stale check is no check: the same driver, 40 days later.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'drivers/driver2'),
      {
        activeVehicleId: 'primary',
        vehicleCheck: {
          status: 'approved',
          vehicleId: 'primary',
          confirmedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        },
      },
      { merge: true },
    );
  });
  await assertFails(updateDoc(doc(unphotographed, 'drivers/driver2'), { online: true }));

  // Fresh photo of the car they actually drive → through.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'drivers/driver2'),
      { vehicleCheck: { status: 'pending', vehicleId: 'primary', confirmedAt: new Date() } },
      { merge: true },
    );
  });
  await assertSucceeds(updateDoc(doc(unphotographed, 'drivers/driver2'), { online: true }));
});

test('going online requires today’s face check, once it is switched on', async () => {
  // The backstop behind the app and the trip guards. Papers prove whose account
  // this is on the day it is approved; this is what keeps answering the question
  // afterwards, when the phone could be in anybody's hands.
  const gated = testEnv.authenticatedContext('driver4', { role: 'driver' }).firestore();
  const live = () => ({
    activeVehicleId: 'primary',
    vehicleCheck: { status: 'approved', vehicleId: 'primary', confirmedAt: new Date() },
  });

  // Enforced, never done → no going online.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'drivers/driver4'), {
      driverId: 'driver4', verificationStatus: 'approved', online: false, rating: 5,
      ...live(),
      faceCheckIn: { required: true },
    });
  });
  await assertFails(updateDoc(doc(gated, 'drivers/driver4'), { online: true }));
  // …and going OFFLINE is never blocked by it, whatever the state.
  await assertSucceeds(updateDoc(doc(gated, 'drivers/driver4'), { online: false }));

  // Yesterday's check is yesterday's.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'drivers/driver4'),
      { faceCheckIn: { required: true, passedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) } },
      { merge: true },
    );
  });
  await assertFails(updateDoc(doc(gated, 'drivers/driver4'), { online: true }));

  // Done this morning → through.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'drivers/driver4'),
      { faceCheckIn: { required: true, passedAt: new Date() } },
      { merge: true },
    );
  });
  await assertSucceeds(updateDoc(doc(gated, 'drivers/driver4'), { online: true }));

  // And a driver the check is NOT switched on for is never gated by it — the
  // default, and the one that must hold while the app in the stores has no
  // camera screen to satisfy it with.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'drivers/driver5'), {
      driverId: 'driver5', verificationStatus: 'approved', online: false, rating: 5,
      ...live(),
    });
  });
  const ungated = testEnv.authenticatedContext('driver5', { role: 'driver' }).firestore();
  await assertSucceeds(updateDoc(doc(ungated, 'drivers/driver5'), { online: true }));
});

test('a driver reads their own cars but can never write one', async () => {
  await assertSucceeds(getDoc(doc(driver, 'drivers/driver1/vehicles/primary')));
  await assertFails(getDoc(doc(passenger, 'drivers/driver1/vehicles/primary')));
  // Self-approving an unvetted car is the whole thing the review exists to stop.
  await assertFails(
    setDoc(doc(driver, 'drivers/driver1/vehicles/mine'), { plate: 'XYZ-999', status: 'approved' }),
  );
  await assertFails(
    updateDoc(doc(driver, 'drivers/driver1/vehicles/primary'), { status: 'approved' }),
  );
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

test('presence: owner writes their own beacon, nobody may read anyone else\'s', async () => {
  const beacon = {
    uid: 'passenger1', lat: 33.71, lng: 73.055, geohash: 'tuu4z',
    lastSeenAt: new Date(), expireAt: new Date(Date.now() + 86_400_000),
  };
  await assertSucceeds(setDoc(doc(passenger, 'userPresence/passenger1'), beacon));
  await assertSucceeds(getDoc(doc(passenger, 'userPresence/passenger1')));
  await assertSucceeds(getDoc(doc(admin, 'userPresence/passenger1')));

  // The whole point: this collection is NOT a "where is everyone" feed. Only
  // the blurred, anonymous getNearbyActivity callable may fan it out.
  await assertFails(getDoc(doc(driver, 'userPresence/passenger1')));
  await assertFails(getDoc(doc(anon, 'userPresence/passenger1')));

  // Nobody may plant a beacon for somebody else, or fake a swarm of users.
  await assertFails(setDoc(doc(driver, 'userPresence/passenger1'), beacon));
  await assertFails(setDoc(doc(passenger, 'userPresence/ghost-user'), { ...beacon, uid: 'ghost-user' }));

  // Field whitelist: nothing privileged rides along on a location ping.
  await assertFails(updateDoc(doc(passenger, 'userPresence/passenger1'), { role: 'admin' }));
  await assertFails(updateDoc(doc(passenger, 'userPresence/passenger1'), { verified: true }));

  // Moving is allowed; so is going dark.
  await assertSucceeds(updateDoc(doc(passenger, 'userPresence/passenger1'), {
    lat: 33.72, lng: 73.06, geohash: 'tuu4z', lastSeenAt: new Date(),
  }));
  await assertSucceeds(deleteDoc(doc(passenger, 'userPresence/passenger1')));
});

test('fleet submissions are admin-read and server-write only', async () => {
  // The partner who filed it reads their own through the franchiseListDrivers
  // callable, never from the collection — otherwise a partner could widen the
  // filter and enumerate a rival fleet's drivers and their CNICs.
  await assertFails(getDoc(doc(passenger, 'driver_submissions/sub1')));
  await assertFails(getDoc(doc(driver, 'driver_submissions/sub1')));
  await assertFails(getDoc(doc(anon, 'driver_submissions/sub1')));
  await assertSucceeds(getDoc(doc(admin, 'driver_submissions/sub1')));

  // Nobody writes here directly — a client-writable queue would let a partner
  // file a driver and mark it approved in the same breath.
  await assertFails(setDoc(doc(passenger, 'driver_submissions/sub2'), { status: 'approved' }));
  await assertFails(updateDoc(doc(admin, 'driver_submissions/sub1'), { status: 'approved' }));
});

test('social access tokens are unreadable by everyone, admins included', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'socialAccounts/facebook'), {
      platform: 'facebook', status: 'connected', displayName: 'Velocity', followers: 158000,
    });
    await setDoc(doc(db, 'socialAccounts/facebook/secret/credentials'), {
      accessToken: { c: 'sealed', iv: 'iv', t: 'tag' },
    });
    await setDoc(doc(db, 'socialPosts/2026-08-24'), { date: '2026-08-24', status: 'ready' });
    await setDoc(doc(db, 'analyticsDaily/2026-08-24'), { date: '2026-08-24', tripsCompleted: 12 });
    await setDoc(doc(db, 'system/socialAutomation'), { enabled: false, runHour: 10 });
  });

  // The profile half is what the console renders, so admins read it.
  await assertSucceeds(getDoc(doc(admin, 'socialAccounts/facebook')));
  await assertFails(getDoc(doc(passenger, 'socialAccounts/facebook')));
  await assertFails(getDoc(doc(anon, 'socialAccounts/facebook')));

  // The token half is a password that can post to the whole audience. An admin
  // session is exactly the thing an attacker would be holding, so it is shut to
  // admins too — subcollections don't inherit the parent's read rule, which is
  // what makes this a real gate rather than a comment.
  await assertFails(getDoc(doc(admin, 'socialAccounts/facebook/secret/credentials')));
  await assertFails(getDoc(doc(passenger, 'socialAccounts/facebook/secret/credentials')));
  await assertFails(
    setDoc(doc(admin, 'socialAccounts/facebook/secret/credentials'), { accessToken: 'mine-now' }),
  );

  // Connecting, disconnecting and publishing all go through callables that
  // verify the credential first — a client write here would let anyone mark an
  // account connected without ever proving a token.
  await assertFails(setDoc(doc(admin, 'socialAccounts/tiktok'), { status: 'connected' }));
  await assertFails(updateDoc(doc(admin, 'socialPosts/2026-08-24'), { status: 'published' }));

  // Posts, the analytics cache and the automation settings are admin-read.
  await assertSucceeds(getDoc(doc(admin, 'socialPosts/2026-08-24')));
  await assertFails(getDoc(doc(driver, 'socialPosts/2026-08-24')));
  await assertSucceeds(getDoc(doc(admin, 'analyticsDaily/2026-08-24')));
  await assertFails(getDoc(doc(passenger, 'analyticsDaily/2026-08-24')));

  // The marketing brief lives under system/ precisely so that config/{doc}'s
  // "any signed-in user may read" does not apply to it.
  await assertSucceeds(getDoc(doc(admin, 'system/socialAutomation')));
  await assertFails(getDoc(doc(passenger, 'system/socialAutomation')));
});

test('the ads desk shows its campaigns to admins and its ad token to nobody', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'system/socialAds'), { adAccountId: 'act_123', dailyCap: 2000, mode: 'ask' });
    await setDoc(doc(db, 'system/socialAds/secret/credentials'), { token: { c: 'sealed', iv: 'iv', t: 'tag' } });
    await setDoc(doc(db, 'socialAds/120200000000001'), { name: 'Drivers — Lahore', status: 'PAUSED', managed: true });
  });

  await assertSucceeds(getDoc(doc(admin, 'system/socialAds')));
  await assertSucceeds(getDoc(doc(admin, 'socialAds/120200000000001')));
  await assertFails(getDoc(doc(passenger, 'socialAds/120200000000001')));
  await assertFails(getDoc(doc(driver, 'system/socialAds')));

  // The user token can spend the company's money. Not even an admin session
  // reads it back, and nobody writes the limit or a campaign from a client —
  // every change goes through a callable that checks the daily limit first.
  await assertFails(getDoc(doc(admin, 'system/socialAds/secret/credentials')));
  await assertFails(setDoc(doc(admin, 'system/socialAds'), { dailyCap: 9999999 }, { merge: true }));
  await assertFails(updateDoc(doc(admin, 'socialAds/120200000000001'), { status: 'ACTIVE' }));
});

test('the Instagram one-click connect leaks neither the app secret nor a page token', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'system/socialMetaApp'), { appId: '123456789', appName: 'Velocity Rides' });
    await setDoc(doc(db, 'system/socialMetaApp/secret/credentials'), {
      appSecret: { c: 'sealed', iv: 'iv', t: 'tag' },
    });
    // The few minutes between pressing Connect and choosing a Page. This
    // document holds the Page tokens Facebook just handed back.
    await setDoc(doc(db, 'socialOAuthStates/state-abc'), {
      uid: 'admin1',
      stage: 'granted',
      pages: [{ id: '1', name: 'Velocity Rides', token: { c: 'sealed', iv: 'iv', t: 'tag' } }],
    });
  });

  // The App ID is public by design — it travels in the OAuth dialog URL — so
  // the console may read it to tell the admin which app is wired up.
  await assertSucceeds(getDoc(doc(admin, 'system/socialMetaApp')));
  await assertFails(getDoc(doc(passenger, 'system/socialMetaApp')));

  // The App Secret is not. Subcollections do not inherit the read above.
  await assertFails(getDoc(doc(admin, 'system/socialMetaApp/secret/credentials')));
  await assertFails(
    setDoc(doc(admin, 'system/socialMetaApp/secret/credentials'), { appSecret: 'mine-now' }),
  );

  // Nor is the handshake. Unlike every other admin-readable social record, this
  // one is shut to the console too: nothing client-side needs it, and what it
  // carries for those few minutes is a token that can post to the whole page.
  await assertFails(getDoc(doc(admin, 'socialOAuthStates/state-abc')));
  await assertFails(getDoc(doc(passenger, 'socialOAuthStates/state-abc')));
  await assertFails(setDoc(doc(admin, 'socialOAuthStates/forged'), { uid: 'admin1' }));
});

test('a seat request is visible to its rider, the driver and the car — nobody else', async () => {
  const asker = testEnv.authenticatedContext('asker1', { role: 'passenger' }).firestore();
  const stranger = testEnv.authenticatedContext('stranger1', { role: 'passenger' }).firestore();

  // The rider watching for an answer, and the driver who owes them one.
  await assertSucceeds(getDoc(doc(asker, 'trips/poolTrip2/joinRequests/asker1')));
  await assertSucceeds(getDoc(doc(driver, 'trips/poolTrip2/joinRequests/asker1')));
  await assertSucceeds(getDoc(doc(admin, 'trips/poolTrip2/joinRequests/asker1')));

  // The riders already in the car, too — passenger1 is in poolTrip2's
  // poolMembers. This used to be refused, which was right while the driver was
  // the only person who could act on the queue. They are not any more: a ride
  // with no driver yet sends vetting requests to the host, and ANY co-rider can
  // refuse one outright (coRiderObjectToPoolJoin), binding on its own. Nobody
  // can answer a request they are not allowed to look at.
  //
  // What they see is a first name, a gender and a seat fare — all of which the
  // roster and the join announcements already tell them about anyone who ends
  // up sharing the car. This has to stay in step with the same decision in
  // `getPoolJoinRequests`, which grants exactly this.
  await assertSucceeds(getDoc(doc(passenger, 'trips/poolTrip2/joinRequests/asker1')));

  // Somebody with no seat in this car still gets nothing.
  await assertFails(getDoc(doc(stranger, 'trips/poolTrip2/joinRequests/asker1')));

  // Every write goes through joinPoolTrip / driverRespondToPoolJoin /
  // coRiderObjectToPoolJoin. A client that could write here could seat itself
  // in a stranger's car, answer a request on the driver's behalf, or forge a
  // co-rider's refusal. Reading the queue is widened above; writing to it is
  // not, and a co-rider's refusal still has to go through the callable.
  await assertFails(setDoc(doc(asker, 'trips/poolTrip2/joinRequests/asker1'), { status: 'accepted' }));
  await assertFails(updateDoc(doc(driver, 'trips/poolTrip2/joinRequests/asker1'), { status: 'accepted' }));
  await assertFails(setDoc(doc(stranger, 'trips/poolTrip2/joinRequests/stranger1'), { status: 'pending' }));
  await assertFails(updateDoc(doc(passenger, 'trips/poolTrip2/joinRequests/asker1'), { status: 'rejected' }));
});

test('the same rule holds for seat requests on pool ride requests', async () => {
  const asker = testEnv.authenticatedContext('asker1', { role: 'passenger' }).firestore();
  const stranger = testEnv.authenticatedContext('stranger1', { role: 'passenger' }).firestore();

  await assertSucceeds(getDoc(doc(asker, 'poolRideRequests/poolReq1/joinRequests/asker1')));
  await assertSucceeds(getDoc(doc(driver, 'poolRideRequests/poolReq1/joinRequests/asker1')));
  await assertFails(getDoc(doc(stranger, 'poolRideRequests/poolReq1/joinRequests/asker1')));
  await assertFails(
    setDoc(doc(asker, 'poolRideRequests/poolReq1/joinRequests/asker1'), { status: 'accepted' }),
  );
});

test('an offer question is readable by its asker and the business only', async () => {
  const asker = testEnv.authenticatedContext('asker1', { role: 'passenger' }).firestore();
  const shop = testEnv.authenticatedContext('shop1', { role: 'passenger' }).firestore();
  const stranger = testEnv.authenticatedContext('stranger1', { role: 'passenger' }).firestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'businessAdQueries/ad1_asker1'), {
      adId: 'ad1', ownerUid: 'shop1', askerUid: 'asker1', askerName: 'Asker', lastMessage: 'Hi',
    });
    await setDoc(doc(db, 'businessAdQueries/ad1_asker1/messages/m1'), {
      from: 'customer', senderUid: 'asker1', text: 'Is it on delivery too?',
    });
  });

  for (const who of [asker, shop, admin]) {
    await assertSucceeds(getDoc(doc(who, 'businessAdQueries/ad1_asker1')));
    await assertSucceeds(getDoc(doc(who, 'businessAdQueries/ad1_asker1/messages/m1')));
  }
  await assertFails(getDoc(doc(stranger, 'businessAdQueries/ad1_asker1')));
  await assertFails(getDoc(doc(stranger, 'businessAdQueries/ad1_asker1/messages/m1')));

  // The customer listens to their thread BEFORE the first message creates it.
  // Refusing that read would kill the listener, and the reply would never show.
  await assertSucceeds(getDoc(doc(stranger, 'businessAdQueries/ad2_stranger1')));
  await assertFails(getDoc(doc(stranger, 'businessAdQueries/ad2_asker1')));

  // The two inbox queries: the business's Queries list and the customer's own.
  await assertSucceeds(getDocs(query(collection(shop, 'businessAdQueries'), where('ownerUid', '==', 'shop1'))));
  await assertSucceeds(getDocs(query(collection(asker, 'businessAdQueries'), where('askerUid', '==', 'asker1'))));
  await assertFails(getDocs(query(collection(stranger, 'businessAdQueries'), where('ownerUid', '==', 'shop1'))));

  // Blocks and reports are server-only; a client that could write a block could
  // unblock itself, and reports quote both people's messages.
  await assertFails(getDoc(doc(asker, 'businessAdQueryBlocks/shop1_asker1')));
  await assertFails(setDoc(doc(asker, 'businessAdQueryBlocks/shop1_asker1'), { byBusiness: false }));
  await assertFails(getDoc(doc(shop, 'businessAdQueryReports/r1')));
  await assertSucceeds(getDoc(doc(admin, 'businessAdQueryReports/r1')));

  // Every message is a push to someone else's phone, so writes are callable-only.
  await assertFails(setDoc(doc(asker, 'businessAdQueries/ad1_asker1/messages/m2'), { text: 'x' }));
  await assertFails(updateDoc(doc(shop, 'businessAdQueries/ad1_asker1'), { ownerUnread: 0 }));
});

/**
 * A pool ride's group chat is for the people in that car and nobody else.
 *
 * Before this, `poolRides/{rideId}/chat` was `allow read: if isSignedIn()` with
 * a create rule that only checked the sender had signed their own message. So
 * any account could read, and post into, the conversation of a car full of
 * strangers — and because the parent `poolRides` doc is deliberately readable by
 * everybody (it is a browsable offer), collecting the ride ids to do it was one
 * query, not a guess.
 */
test('a pool ride chat is readable and writable only by that car', async () => {
  const rider = testEnv.authenticatedContext('poolRider1', { role: 'passenger' }).firestore();
  const outsider = testEnv.authenticatedContext('poolOutsider', { role: 'passenger' }).firestore();
  const poolDriver = testEnv.authenticatedContext('poolDriver1', { role: 'driver' }).firestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'poolRides/pool1'), {
      rideId: 'pool1', driverId: 'poolDriver1', status: 'open', seatsTotal: 4, seatsTaken: 1,
    });
    // Seat docs are written only by the joinPoolRide CF; holding one is what
    // makes somebody a member of this car.
    await setDoc(doc(db, 'poolRides/pool1/passengers/poolRider1'), {
      passengerId: 'poolRider1', seats: 1, status: 'confirmed',
    });
    await setDoc(doc(db, 'poolRides/pool1/chat/m1'), {
      senderId: 'poolRider1', senderName: 'R', text: 'On my way', sentAt: new Date(),
    });
  });

  const message = (senderId, senderName) => ({
    senderId, senderName, text: 'hello', sentAt: new Date(),
  });

  // The rider holding a seat and the ride's own driver are both in the car.
  await assertSucceeds(getDoc(doc(rider, 'poolRides/pool1/chat/m1')));
  await assertSucceeds(getDoc(doc(poolDriver, 'poolRides/pool1/chat/m1')));
  await assertSucceeds(
    setDoc(doc(rider, 'poolRides/pool1/chat/m2'), message('poolRider1', 'R')),
  );
  await assertSucceeds(
    setDoc(doc(poolDriver, 'poolRides/pool1/chat/m3'), message('poolDriver1', 'D')),
  );

  // A signed-in stranger is not, even though they can see the ride itself.
  await assertSucceeds(getDoc(doc(outsider, 'poolRides/pool1')));
  await assertFails(getDoc(doc(outsider, 'poolRides/pool1/chat/m1')));
  await assertFails(getDocs(collection(outsider, 'poolRides/pool1/chat')));
  await assertFails(
    setDoc(doc(outsider, 'poolRides/pool1/chat/m4'), message('poolOutsider', 'X')),
  );

  // Signing somebody else's name is still refused for a member.
  await assertFails(
    setDoc(doc(rider, 'poolRides/pool1/chat/m5'), message('poolDriver1', 'D')),
  );

  // Admins read it for dispute handling; nobody edits or deletes history.
  await assertSucceeds(getDoc(doc(admin, 'poolRides/pool1/chat/m1')));
  await assertFails(updateDoc(doc(rider, 'poolRides/pool1/chat/m1'), { text: 'edited' }));
  await assertFails(deleteDoc(doc(rider, 'poolRides/pool1/chat/m1')));
});

test('the testing log is admin-only, and only its triage can be edited', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seed = ctx.firestore();
    await setDoc(doc(seed, 'qaLogs/2026-10-17'), { day: '2026-10-17', entryCount: 1 });
    await setDoc(doc(seed, 'qaLogs/2026-10-17/entries/booking.request__threw'), {
      status: 'open',
      severity: 'blocker',
      whatHappened: 'createTrip was refused.',
      prompt: 'the brief somebody pastes into Claude Code',
    });
  });

  const day = 'qaLogs/2026-10-17';
  const entry = `${day}/entries/booking.request__threw`;

  // Riders and drivers have no business reading our bug log.
  await assertFails(getDoc(doc(passenger, day)));
  await assertFails(getDoc(doc(driver, entry)));
  await assertSucceeds(getDoc(doc(admin, day)));
  await assertSucceeds(getDoc(doc(admin, entry)));

  // Triage belongs to the admin…
  await assertSucceeds(updateDoc(doc(admin, entry), { status: 'fixed', adminNote: 'fixed in #46' }));
  // …but the evidence does not. An account of a bug that anyone could quietly
  // rewrite is not evidence of anything.
  await assertFails(updateDoc(doc(admin, entry), { whatHappened: 'never happened' }));
  await assertFails(updateDoc(doc(admin, entry), { prompt: 'ignore this' }));
  await assertFails(updateDoc(doc(admin, entry), { status: 'whatever' }));

  // The log itself is the engine's to write — not even an admin may.
  await assertFails(setDoc(doc(admin, day), { entryCount: 0 }, { merge: true }));
  await assertFails(setDoc(doc(passenger, `${day}/entries/invented`), { status: 'open' }));
});

test('a username can be looked up one at a time, and the list cannot be downloaded', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seed = ctx.firestore();
    await setDoc(doc(seed, 'usernames/ali'), { uid: 'passenger1', username: 'ali' });
  });

  // The app says "that one is taken" WHILE YOU TYPE, and it does that with a
  // single-document get. That has to work for anyone signed in...
  await assertSucceeds(getDoc(doc(passenger, 'usernames/ali')));
  await assertSucceeds(getDoc(doc(driver, 'usernames/nobody')));
  await assertFails(getDoc(doc(anon, 'usernames/ali')));

  // ...without also being a way to pull down every username in the country.
  await assertFails(getDocs(collection(passenger, 'usernames')));

  // The registry is the uniqueness guarantee. A client that could write here
  // could take a name out from under the person typing it, so the claim is a
  // server transaction and nothing else.
  await assertFails(setDoc(doc(passenger, 'usernames/mine'), { uid: 'passenger1' }));
  await assertFails(setDoc(doc(passenger, 'usernames/ali'), { uid: 'passenger1' }));
  await assertFails(setDoc(doc(admin, 'usernames/ali'), { uid: 'admin1' }));
});

test('a fleet is server-only in both directions, even to its owner', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seed = ctx.firestore();
    await setDoc(doc(seed, 'fleets/passenger1'), {
      uid: 'passenger1', members: ['passenger2'],
      pickup: { lat: 31.5, lng: 74.3, address: 'Johar Town' },
    });
    await setDoc(doc(seed, 'fleets/passenger1/requests/passenger3'), { fromUid: 'passenger3' });
    await setDoc(doc(seed, 'fleetAsks/ask1'), {
      hostUid: 'passenger1', memberUids: ['passenger2'], acceptedUids: [], status: 'open',
    });
  });

  // Not even the owner reads their own fleet directly: drawing it means
  // reading other people's profiles, which are owner-only, so getMyFleet is
  // the only door. Nothing in the app expects this to succeed.
  await assertFails(getDoc(doc(passenger, 'fleets/passenger1')));
  await assertFails(getDoc(doc(passenger, 'fleets/passenger1/requests/passenger3')));
  await assertFails(getDoc(doc(driver, 'fleets/passenger1')));

  // Writable would be worse than readable: adding yourself to a stranger's
  // fleet is a licence to push ride invitations at them.
  await assertFails(setDoc(doc(driver, 'fleets/passenger1'), { members: ['driver1'] }, { merge: true }));
  await assertFails(setDoc(doc(passenger, 'fleets/passenger1'), { members: ['driver1'] }, { merge: true }));
  await assertFails(deleteDoc(doc(passenger, 'fleets/passenger1/requests/passenger3')));

  // The accepted list decides who gets seated on the car, so it is not a
  // thing a client may edit itself onto.
  await assertFails(getDoc(doc(passenger, 'fleetAsks/ask1')));
  await assertFails(updateDoc(doc(driver, 'fleetAsks/ask1'), { acceptedUids: ['driver1'] }));
});
