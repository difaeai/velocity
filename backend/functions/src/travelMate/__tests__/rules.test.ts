/**
 * Firestore security rules tests using @firebase/rules-unit-testing.
 *
 * Each test verifies the client-side rules for Travel Mate collections.
 * Requires Firestore emulator running at localhost:8080.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Timestamp } from 'firebase/firestore';

// firestore.rules is two directories above backend/functions/
const RULES_PATH = join(process.cwd(), '..', '..', 'firestore.rules');

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rules = readFileSync(RULES_PATH, 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-velocity',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed via withSecurityRulesDisabled (same client SDK as tests, same connection path)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();

    await fs.doc('travelMateMatches/alice_bob').set({
      users: ['alice', 'bob'],
      userInfo: {},
      status: 'active',
      matchedAt: Timestamp.now(),
      lastMessageAt: null,
    });

    await fs.doc('travelMateMatches/alice_bob/messages/msg1').set({
      senderId: 'alice',
      text: 'Hi!',
      createdAt: Timestamp.now(),
    });

    await fs.doc('travelMateGroups/grp1').set({
      name: 'Morning Group',
      createdBy: 'alice',
      members: ['alice', 'bob'],
      memberInfo: {},
      destinationName: 'Office',
      maxSize: 4,
      status: 'open',
      createdAt: Timestamp.now(),
    });

    await fs.doc('travelMateProfiles/alice').set({
      uid: 'alice',
      displayName: 'Alice',
      active: true,
    });

    await fs.doc('travelMateQuota/alice').set({
      uid: 'alice',
      tier: 'free',
      dailyAllowance: 0,
      dailyUsed: 0,
    });

    await fs.doc('travelMateReports/rep1').set({
      reporterId: 'alice',
      reportedUid: 'bob',
      reason: 'Test',
      status: 'open',
      createdAt: Timestamp.now(),
    });
  });
});

describe('travelMateMatches rules', () => {
  it('participant can read their match', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateMatches/alice_bob').get());
  });

  it('non-participant cannot read a match', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateMatches/alice_bob').get());
  });

  it('unauthenticated cannot read a match', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(anon.firestore().doc('travelMateMatches/alice_bob').get());
  });

  it('participant can read messages subcollection', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateMatches/alice_bob/messages/msg1').get());
  });

  it('non-participant cannot read messages', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateMatches/alice_bob/messages/msg1').get());
  });

  it('nobody can write to messages (CF only)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(alice.firestore().doc('travelMateMatches/alice_bob/messages/msg2').set({ text: 'hi' }));
  });

  it('nobody can write travelMateQuota (CF only)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(alice.firestore().doc('travelMateQuota/alice').set({ tier: 'subscribed' }));
  });
});

describe('travelMateGroups rules', () => {
  it('member can read their group', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateGroups/grp1').get());
  });

  it('non-member cannot read a group', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateGroups/grp1').get());
  });

  it('nobody can write a group (CF only)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(alice.firestore().doc('travelMateGroups/newgrp').set({ name: 'X' }));
  });
});

describe('travelMateProfiles rules', () => {
  it('owner can read their own profile', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateProfiles/alice').get());
  });

  // Signed-in reads are intentional: the swipe deck renders profile cards
  // directly (see the travelMateProfiles rules comment).
  it('any signed-in user can read a profile (swipe deck)', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertSucceeds(eve.firestore().doc('travelMateProfiles/alice').get());
  });

  it('owner can write their own profile (setup screen)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    // Mirrors the exact payload the setup screen writes.
    await assertSucceeds(alice.firestore().doc('travelMateProfiles/alice').set({
      uid: 'alice',
      displayName: 'Alice',
      age: 25,
      gender: 'female',
      genderPref: 'any',
      bio: '',
      interests: [],
      photoURL: null,
      active: true,
      location: null,
      searchRadiusKm: null,
      lastActive: Timestamp.now(),
    }));
  });

  it('SECURITY: non-owner cannot write someone else\'s profile', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateProfiles/alice').set({ displayName: 'Hacked' }));
  });

  it('SECURITY: owner cannot smuggle server-only fields into their profile', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(alice.firestore().doc('travelMateProfiles/alice').set(
      { ratingAvg: 5, ratingCount: 9999 },
      { merge: true },
    ));
  });
});

describe('travelMateSwipes rules', () => {
  it('user can record their own swipe under the {swiper}_{swiped} doc ID', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateSwipes/alice_carol').set({
      swiperId: 'alice', swipedId: 'carol', direction: 'like', createdAt: Timestamp.now(),
    }));
  });

  it('SECURITY: cannot forge someone else\'s swipe via a mismatched doc ID', async () => {
    const eve = testEnv.authenticatedContext('eve');
    // Doc ID claims bob swiped eve, but the writer is eve.
    await assertFails(eve.firestore().doc('travelMateSwipes/bob_eve').set({
      swiperId: 'eve', swipedId: 'eve', direction: 'like', createdAt: Timestamp.now(),
    }));
    await assertFails(eve.firestore().doc('travelMateSwipes/bob_eve').set({
      swiperId: 'bob', swipedId: 'eve', direction: 'like', createdAt: Timestamp.now(),
    }));
  });

  it('SECURITY: cannot swipe yourself', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateSwipes/eve_eve').set({
      swiperId: 'eve', swipedId: 'eve', direction: 'like', createdAt: Timestamp.now(),
    }));
  });
});

describe('travelMateMatches creation rules', () => {
  it('mutual like allows either user to create the match', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await fs.doc('travelMateSwipes/carol_dave').set({ swiperId: 'carol', swipedId: 'dave', direction: 'like' });
      await fs.doc('travelMateSwipes/dave_carol').set({ swiperId: 'dave', swipedId: 'carol', direction: 'like' });
    });
    const carol = testEnv.authenticatedContext('carol');
    await assertSucceeds(carol.firestore().doc('travelMateMatches/carol_dave').set({
      users: ['carol', 'dave'],
      userInfo: {},
      status: 'active',
      createdAt: Timestamp.now(),
      lastMessage: null,
      lastMessageAt: null,
    }));
  });

  it('SECURITY: cannot create a match without a mutual like', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      // Only eve liked dave — dave never liked eve back.
      await ctx.firestore().doc('travelMateSwipes/eve_dave').set({ swiperId: 'eve', swipedId: 'dave', direction: 'like' });
    });
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateMatches/dave_eve').set({
      users: ['dave', 'eve'],
      userInfo: {},
      status: 'active',
      createdAt: Timestamp.now(),
      lastMessage: null,
      lastMessageAt: null,
    }));
  });

  it('SECURITY: cannot create a match you are not part of', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await fs.doc('travelMateSwipes/carol_dave').set({ swiperId: 'carol', swipedId: 'dave', direction: 'like' });
      await fs.doc('travelMateSwipes/dave_carol').set({ swiperId: 'dave', swipedId: 'carol', direction: 'like' });
    });
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateMatches/carol_dave').set({
      users: ['carol', 'dave'],
      userInfo: {},
      status: 'active',
      createdAt: Timestamp.now(),
      lastMessage: null,
      lastMessageAt: null,
    }));
  });
});

describe('travelMateQuota rules', () => {
  it('owner can read their own quota', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateQuota/alice').get());
  });

  it('other user cannot read quota', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateQuota/alice').get());
  });
});

describe('travelMateReports rules', () => {
  it('reporter can read their own report', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(alice.firestore().doc('travelMateReports/rep1').get());
  });

  it('non-reporter cannot read another user\'s report', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateReports/rep1').get());
  });
});
