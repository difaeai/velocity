/**
 * Integration tests for Phase 3 social CFs.
 *
 * Critical paths:
 *  - sendTravelMateMessage: participant check, closed-match rejection
 *  - reportTravelMateUser: SECURITY — non-participant cannot auto-close a match
 *  - unmatchTravelMate: participant check
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, seedProfile, seedMatch, makeReq, db } from './helpers';
import { sendTravelMateMessage, unmatchTravelMate, reportTravelMateUser } from '../social';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const EVE = 'eve-uid';

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(ALICE);
  await seedProfile(BOB);
  await seedProfile(EVE);
});

describe('sendTravelMateMessage', () => {
  it('participant can send a message', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    const res = await sendTravelMateMessage.run(makeReq({ matchId, text: 'Hello!' }, ALICE));
    expect(res.messageId).toBeTruthy();

    const msgs = await db().collection(`travelMateMatches/${matchId}/messages`).get();
    expect(msgs.size).toBe(1);
    expect(msgs.docs[0].data().text).toBe('Hello!');
    expect(msgs.docs[0].data().senderId).toBe(ALICE);
  });

  it('non-participant is rejected', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await expect(
      sendTravelMateMessage.run(makeReq({ matchId, text: 'Hi' }, EVE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('closed match rejects message', async () => {
    const matchId = await seedMatch(ALICE, BOB, 'unmatched');
    await expect(
      sendTravelMateMessage.run(makeReq({ matchId, text: 'Hi' }, ALICE)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('bumps lastMessageAt on the match doc', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    const beforeSnap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(beforeSnap.exists).toBe(true);
    expect(beforeSnap.data()!.lastMessageAt).toBeNull();

    await sendTravelMateMessage.run(makeReq({ matchId, text: 'Ping' }, ALICE));

    const afterSnap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(afterSnap.data()!.lastMessageAt).toBeTruthy();
  });
});

describe('unmatchTravelMate', () => {
  it('participant can unmatch', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await unmatchTravelMate.run(makeReq({ matchId }, ALICE));
    const snap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(snap.data()!.status).toBe('unmatched');
    expect(snap.data()!.unmatchedBy).toBe(ALICE);
  });

  it('non-participant cannot unmatch', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await expect(
      unmatchTravelMate.run(makeReq({ matchId }, EVE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    const snap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()!['status']).toBe('active');
  });
});

describe('reportTravelMateUser', () => {
  it('reporter can file a report', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    const res = await reportTravelMateUser.run(makeReq({ reportedUid: BOB, matchId, reason: 'Spam' }, ALICE));
    expect(res.reportId).toBeTruthy();
    expect(res.status).toBe('open');

    const reports = await db().collection('travelMateReports').get();
    expect(reports.size).toBe(1);
    expect(reports.docs[0].data().reason).toBe('Spam');
    expect(reports.docs[0].data().reporterId).toBe(ALICE);
  });

  it('auto-closes match when reporter is a participant', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await reportTravelMateUser.run(makeReq({ reportedUid: BOB, matchId, reason: 'Harassment' }, ALICE));

    const snap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(snap.data()!.status).toBe('unmatched');
  });

  it('SECURITY: non-participant cannot auto-close a match', async () => {
    // Eve knows Alice and Bob's matchId but is not in the match.
    const matchId = await seedMatch(ALICE, BOB);
    await reportTravelMateUser.run(makeReq({ reportedUid: BOB, matchId, reason: 'Abuse' }, EVE));

    // Match must still be active — the report is created but the match is NOT closed.
    const snap = await db().doc(`travelMateMatches/${matchId}`).get();
    expect(snap.data()!.status).toBe('active');

    // Report doc IS created (reporter still files the report)
    const reports = await db().collection('travelMateReports').get();
    expect(reports.size).toBe(1);
  });

  it('report without matchId does not touch any match', async () => {
    await reportTravelMateUser.run(makeReq({ reportedUid: BOB, reason: 'Profile spam' }, ALICE));
    const matches = await db().collection('travelMateMatches').get();
    expect(matches.empty).toBe(true);
  });

  it('cannot report yourself', async () => {
    await expect(
      reportTravelMateUser.run(makeReq({ reportedUid: ALICE, reason: 'Self-report' }, ALICE)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
