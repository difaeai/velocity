/**
 * Integration tests for Phase 4 groups — settleTravelMateSplit.
 *
 * Critical paths:
 *  - equal share with booker absorbing rounding (Math.floor)
 *  - idempotent on repeated tripId
 *  - insufficient balance → failed-precondition, no state change
 *  - riderUids must be group members
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import {
  clearFirestore, seedProfile, seedMatch, seedWallet, makeReq, db,
} from './helpers';
import { createTravelMateGroup, settleTravelMateSplit } from '../groups';

const BOOKER = 'booker-uid';
const RIDER1 = 'rider1-uid';
const RIDER2 = 'rider2-uid';

async function makeGroup(): Promise<string> {
  const res = await createTravelMateGroup.run(makeReq({}, BOOKER));
  // Manually add RIDER1, RIDER2 as members (join CF would require matches;
  // we test settle here, so seed members directly)
  await db().doc(`travelMateGroups/${res.groupId}`).update({
    members: admin.firestore.FieldValue.arrayUnion(RIDER1, RIDER2),
  });
  return res.groupId;
}

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(BOOKER);
  await seedProfile(RIDER1);
  await seedProfile(RIDER2);
  await seedMatch(BOOKER, RIDER1);
});

describe('settleTravelMateSplit', () => {
  it('Math.floor: booker always absorbs the remainder', async () => {
    const groupId = await makeGroup();
    await seedWallet(RIDER1, 1000);
    await seedWallet(RIDER2, 1000);
    await seedWallet(BOOKER, 0);

    // fare=103, n=3 → floor(103/3)=34 per other rider, collected=68, booker net=35
    const res = await settleTravelMateSplit.run(makeReq({
      groupId,
      tripId: 'trip-abc',
      riderUids: [BOOKER, RIDER1, RIDER2],
      amountPKR: 103,
    }, BOOKER));

    expect(res.settled).toBe(true);
    expect(res.fare).toBe(103);
    expect(res.share).toBe(34);          // floor(103/3)=34, NOT round=34 (same here, see next test)
    expect(res.collected).toBe(68);      // 34 * 2
    expect(res.bookerNetCost).toBe(35);  // 103 - 68 = 35, booker absorbs extra

    const r1 = (await db().doc(`wallets/${RIDER1}`).get()).data()!;
    const r2 = (await db().doc(`wallets/${RIDER2}`).get()).data()!;
    const bk = (await db().doc(`wallets/${BOOKER}`).get()).data()!;
    expect(r1.balance).toBe(966);  // 1000 - 34
    expect(r2.balance).toBe(966);
    expect(bk.balance).toBe(68);   // 0 + 68
  });

  it('Math.floor vs Math.round: fare=103,n=4 — floor gives 25, not 26', async () => {
    const groupId = await makeGroup();
    const RIDER3 = 'rider3-uid';
    await seedProfile(RIDER3);
    await db().doc(`travelMateGroups/${groupId}`).update({
      members: admin.firestore.FieldValue.arrayUnion(RIDER3),
    });
    await seedWallet(RIDER1, 1000);
    await seedWallet(RIDER2, 1000);
    await seedWallet(RIDER3, 1000);
    await seedWallet(BOOKER, 0);

    // fare=103, n=4 → floor(103/4)=25, collected=75, booker net=28
    // If Math.round: share=26, collected=78, booker net=25 (WRONG: booker pays less than others)
    const res = await settleTravelMateSplit.run(makeReq({
      groupId,
      tripId: 'trip-round-check',
      riderUids: [BOOKER, RIDER1, RIDER2, RIDER3],
      amountPKR: 103,
    }, BOOKER));

    expect(res.share).toBe(25);  // floor, not round(26)
    expect(res.collected).toBe(75);
    expect(res.bookerNetCost).toBe(28);  // 103 - 75
    expect(res.bookerNetCost).toBeGreaterThanOrEqual(res.share); // booker always >= others
  });

  it('exact division: equal shares, booker net equals share', async () => {
    const groupId = await makeGroup();
    await seedWallet(RIDER1, 1000);
    await seedWallet(RIDER2, 1000);
    await seedWallet(BOOKER, 0);

    // fare=90, n=3 → 30 each
    const res = await settleTravelMateSplit.run(makeReq({
      groupId, tripId: 'trip-exact', riderUids: [BOOKER, RIDER1, RIDER2], amountPKR: 90,
    }, BOOKER));

    expect(res.share).toBe(30);
    expect(res.collected).toBe(60);
    expect(res.bookerNetCost).toBe(30);
  });

  it('idempotent: second call with same tripId throws already-exists', async () => {
    const groupId = await makeGroup();
    await seedWallet(RIDER1, 1000);
    await seedWallet(RIDER2, 1000);
    await seedWallet(BOOKER, 0);

    const args = { groupId, tripId: 'trip-idem', riderUids: [BOOKER, RIDER1, RIDER2], amountPKR: 60 };
    await settleTravelMateSplit.run(makeReq(args, BOOKER));

    await expect(settleTravelMateSplit.run(makeReq(args, BOOKER))).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('insufficient balance: fails-precondition, wallets unchanged', async () => {
    const groupId = await makeGroup();
    await seedWallet(RIDER1, 5);   // only 5 PKR, needs 34
    await seedWallet(RIDER2, 1000);
    await seedWallet(BOOKER, 0);

    await expect(
      settleTravelMateSplit.run(makeReq({
        groupId, tripId: 'trip-broke', riderUids: [BOOKER, RIDER1, RIDER2], amountPKR: 103,
      }, BOOKER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const r1 = (await db().doc(`wallets/${RIDER1}`).get()).data()!;
    expect(r1.balance).toBe(5);  // unchanged
  });

  it('rejects rider not in group', async () => {
    const groupId = await makeGroup();
    await seedProfile('outsider');
    await seedWallet('outsider', 1000);
    await seedWallet(RIDER1, 1000);
    await seedWallet(BOOKER, 0);

    await expect(
      settleTravelMateSplit.run(makeReq({
        groupId, tripId: 'trip-outsider', riderUids: [BOOKER, 'outsider'], amountPKR: 60,
      }, BOOKER)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('booker must be in riderUids', async () => {
    const groupId = await makeGroup();
    await seedWallet(RIDER1, 1000);
    await seedWallet(RIDER2, 1000);

    await expect(
      settleTravelMateSplit.run(makeReq({
        groupId, tripId: 'trip-no-booker', riderUids: [RIDER1, RIDER2], amountPKR: 60,
      }, BOOKER)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
