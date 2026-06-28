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

  it('other user cannot read a profile', async () => {
    const eve = testEnv.authenticatedContext('eve');
    await assertFails(eve.firestore().doc('travelMateProfiles/alice').get());
  });

  it('nobody can write their own profile directly (CF only)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(alice.firestore().doc('travelMateProfiles/alice').set({ displayName: 'Alice' }));
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
