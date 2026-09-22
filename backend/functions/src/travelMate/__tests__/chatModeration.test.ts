/**
 * Integration tests for Travel Partner chat management.
 *
 * The paths that matter are the ones where a mistake is a safety failure
 * rather than a bug:
 *  - leaveTravelMateChat:      the thread really closes, and sending stops.
 *  - leaveTravelMateGroupChat: membership is access, so removal must be real,
 *                              and an ownerless or ghost group must not survive.
 *  - reportTravelMateChat:     SECURITY — a non-participant must not be able to
 *                              attach someone else's conversation to a report
 *                              (that would leak the transcript AND let them
 *                              close a thread they are not in).
 *  - adminResolveTravelMateReport: only an admin, and the outcome is carried
 *                              out rather than just recorded.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearFirestore,
  seedProfile,
  seedMatch,
  seedGroup,
  makeReq,
  makeAdminReq,
  db,
} from './helpers';
import {
  leaveTravelMateChat,
  leaveTravelMateGroupChat,
  reportTravelMateChat,
  adminResolveTravelMateReport,
} from '../chatModeration';
import { sendTravelMateMessage } from '../social';
import { sendTravelMateGroupMessage } from '../groupChat';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const EVE = 'eve-uid';
const CARL = 'carl-uid';

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(ALICE);
  await seedProfile(BOB);
  await seedProfile(EVE);
  await seedProfile(CARL);
});

// ── leaveTravelMateChat ──────────────────────────────────────────────────────

describe('leaveTravelMateChat', () => {
  it('closes the thread and hides it from the leaver', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await leaveTravelMateChat.run(makeReq({ matchId }, ALICE));

    const match = (await db().doc(`travelMateMatches/${matchId}`).get()).data()!;
    expect(match.status).toBe('left');
    expect(match.leftBy).toEqual([ALICE]);
    expect(match.hiddenFor).toEqual([ALICE]);
  });

  it('stops both sides sending — not only the one who left', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await leaveTravelMateChat.run(makeReq({ matchId }, ALICE));

    await expect(
      sendTravelMateMessage.run(makeReq({ matchId, text: 'still here?' }, BOB)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      sendTravelMateMessage.run(makeReq({ matchId, text: 'actually…' }, ALICE)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('non-participant is rejected', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await expect(
      leaveTravelMateChat.run(makeReq({ matchId }, EVE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('leaving an already-closed thread hides it without rewriting who closed it', async () => {
    const matchId = await seedMatch(ALICE, BOB, 'unmatched');
    await leaveTravelMateChat.run(makeReq({ matchId }, BOB));

    const match = (await db().doc(`travelMateMatches/${matchId}`).get()).data()!;
    expect(match.status).toBe('unmatched');
    expect(match.hiddenFor).toEqual([BOB]);
  });
});

// ── leaveTravelMateGroupChat ─────────────────────────────────────────────────

describe('leaveTravelMateGroupChat', () => {
  it('removes membership, drops memberInfo and posts a system line', async () => {
    const groupId = await seedGroup([ALICE, BOB, CARL]);
    await leaveTravelMateGroupChat.run(makeReq({ groupId }, BOB));

    const group = (await db().doc(`travelMateGroups/${groupId}`).get()).data()!;
    expect(group.members).toEqual([ALICE, CARL]);
    expect(group.memberInfo[BOB]).toBeUndefined();
    expect(group.leftMembers).toEqual([BOB]);

    const msgs = await db().collection(`travelMateGroups/${groupId}/messages`).get();
    expect(msgs.size).toBe(1);
    expect(msgs.docs[0].data().type).toBe('system');
    expect(msgs.docs[0].data().text).toContain('left the group');
  });

  it('stops the leaver sending to the group', async () => {
    const groupId = await seedGroup([ALICE, BOB]);
    await leaveTravelMateGroupChat.run(makeReq({ groupId }, BOB));

    await expect(
      sendTravelMateGroupMessage.run(makeReq({ groupId, text: 'hello?' }, BOB)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('hands the group to another member when the creator leaves', async () => {
    const groupId = await seedGroup([ALICE, BOB]);
    await leaveTravelMateGroupChat.run(makeReq({ groupId }, ALICE));

    const group = (await db().doc(`travelMateGroups/${groupId}`).get()).data()!;
    expect(group.createdBy).toBe(BOB);
    expect(group.status).toBe('open');
  });

  it('closes the group when the last member leaves, with no system line', async () => {
    const groupId = await seedGroup([ALICE]);
    await leaveTravelMateGroupChat.run(makeReq({ groupId }, ALICE));

    const group = (await db().doc(`travelMateGroups/${groupId}`).get()).data()!;
    expect(group.members).toEqual([]);
    expect(group.status).toBe('closed');

    const msgs = await db().collection(`travelMateGroups/${groupId}/messages`).get();
    expect(msgs.size).toBe(0);
  });

  it('non-member is rejected', async () => {
    const groupId = await seedGroup([ALICE, BOB]);
    await expect(
      leaveTravelMateGroupChat.run(makeReq({ groupId }, EVE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ── reportTravelMateChat ─────────────────────────────────────────────────────

describe('reportTravelMateChat', () => {
  it('captures the transcript, names both sides and closes the 1:1', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await sendTravelMateMessage.run(makeReq({ matchId, text: 'first' }, ALICE));
    await sendTravelMateMessage.run(makeReq({ matchId, text: 'second' }, BOB));

    const { reportId } = await reportTravelMateChat.run(
      makeReq(
        { scope: 'match', roomId: matchId, reportedUid: BOB, category: 'harassment', reason: 'rude' },
        ALICE,
      ),
    );

    const report = (await db().doc(`travelMateReports/${reportId}`).get()).data()!;
    expect(report.scope).toBe('match');
    expect(report.status).toBe('open');
    expect(report.category).toBe('harassment');
    expect(report.reporterName).toBe(`User ${ALICE}`);
    expect(report.reportedName).toBe(`User ${BOB}`);
    expect(report.matchId).toBe(matchId);
    // Oldest first, so the transcript reads forwards.
    expect(report.transcript.map((l: { text: string }) => l.text)).toEqual(['first', 'second']);

    const match = (await db().doc(`travelMateMatches/${matchId}`).get()).data()!;
    expect(match.status).toBe('unmatched');
    expect(match.hiddenFor).toEqual([ALICE]);
  });

  it('SECURITY: a non-participant cannot report into someone else’s chat', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await sendTravelMateMessage.run(makeReq({ matchId, text: 'private' }, ALICE));

    await expect(
      reportTravelMateChat.run(
        makeReq({ scope: 'match', roomId: matchId, reportedUid: BOB, reason: 'x' }, EVE),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // And the thread they tried to close is untouched.
    const match = (await db().doc(`travelMateMatches/${matchId}`).get()).data()!;
    expect(match.status).toBe('active');
  });

  it('rejects a reported user who is not in the conversation', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    await expect(
      reportTravelMateChat.run(
        makeReq({ scope: 'match', roomId: matchId, reportedUid: EVE, reason: 'x' }, ALICE),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('reports a group member without disturbing the group', async () => {
    const groupId = await seedGroup([ALICE, BOB, CARL]);
    await sendTravelMateGroupMessage.run(makeReq({ groupId, text: 'in the group' }, BOB));

    const { reportId } = await reportTravelMateChat.run(
      makeReq({ scope: 'group', roomId: groupId, reportedUid: BOB, category: 'spam', reason: 'ads' }, ALICE),
    );

    const report = (await db().doc(`travelMateReports/${reportId}`).get()).data()!;
    expect(report.scope).toBe('group');
    expect(report.groupId).toBe(groupId);
    expect(report.matchId).toBeNull();
    expect(report.roomName).toBe('Test group');
    expect(report.transcript).toHaveLength(1);

    // Reporting is not moderation: nobody is removed from the room.
    const group = (await db().doc(`travelMateGroups/${groupId}`).get()).data()!;
    expect(group.members).toEqual([ALICE, BOB, CARL]);
  });

  it('SECURITY: a non-member cannot report into a group', async () => {
    const groupId = await seedGroup([ALICE, BOB]);
    await expect(
      reportTravelMateChat.run(
        makeReq({ scope: 'group', roomId: groupId, reportedUid: BOB, reason: 'x' }, EVE),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('alsoBlock places a real block', async () => {
    const matchId = await seedMatch(ALICE, BOB);
    const { blocked } = await reportTravelMateChat.run(
      makeReq(
        { scope: 'match', roomId: matchId, reportedUid: BOB, reason: 'x', alsoBlock: true },
        ALICE,
      ),
    );

    expect(blocked).toBe(true);
    expect((await db().doc(`travelMateBlocks/${ALICE}_${BOB}`).get()).exists).toBe(true);
    await expect(
      sendTravelMateMessage.run(makeReq({ matchId, text: 'hi' }, BOB)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('a profile report needs no room', async () => {
    const { reportId } = await reportTravelMateChat.run(
      makeReq({ scope: 'profile', reportedUid: BOB, category: 'fake_profile', reason: 'not real' }, ALICE),
    );
    const report = (await db().doc(`travelMateReports/${reportId}`).get()).data()!;
    expect(report.roomId).toBeNull();
    expect(report.transcript).toEqual([]);
  });

  it('nobody can report themselves', async () => {
    await expect(
      reportTravelMateChat.run(makeReq({ scope: 'profile', reportedUid: ALICE, reason: 'x' }, ALICE)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ── adminResolveTravelMateReport ─────────────────────────────────────────────

describe('adminResolveTravelMateReport', () => {
  async function openReport(): Promise<string> {
    const { reportId } = await reportTravelMateChat.run(
      makeReq({ scope: 'profile', reportedUid: BOB, category: 'scam', reason: 'asked for money' }, ALICE),
    );
    return reportId;
  }

  it('a non-admin cannot resolve', async () => {
    const reportId = await openReport();
    await expect(
      adminResolveTravelMateReport.run(makeReq({ reportId, outcome: 'dismissed' }, ALICE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('dismiss closes the report and touches nothing else', async () => {
    const reportId = await openReport();
    await adminResolveTravelMateReport.run(makeAdminReq({ reportId, outcome: 'dismissed' }));

    const report = (await db().doc(`travelMateReports/${reportId}`).get()).data()!;
    expect(report.status).toBe('dismissed');
    expect(report.outcome).toBe('dismissed');

    const prof = (await db().doc(`travelMateProfiles/${BOB}`).get()).data()!;
    expect(prof.active).toBe(true);
  });

  it('suspend deactivates the Travel Partner profile', async () => {
    const reportId = await openReport();
    await adminResolveTravelMateReport.run(
      makeAdminReq({ reportId, outcome: 'suspended', note: 'repeat offender' }),
    );

    const prof = (await db().doc(`travelMateProfiles/${BOB}`).get()).data()!;
    expect(prof.active).toBe(false);
    const report = (await db().doc(`travelMateReports/${reportId}`).get()).data()!;
    expect(report.status).toBe('resolved');
    expect(report.adminNote).toBe('repeat offender');
  });

  it('ban suspends the profile AND bans the account', async () => {
    const reportId = await openReport();
    await adminResolveTravelMateReport.run(makeAdminReq({ reportId, outcome: 'banned' }));

    expect((await db().doc(`travelMateProfiles/${BOB}`).get()).data()!.active).toBe(false);
    expect((await db().doc(`users/${BOB}`).get()).data()!.banned).toBe(true);
  });

  it('warn counts against the profile and leaves it usable', async () => {
    const reportId = await openReport();
    await adminResolveTravelMateReport.run(
      makeAdminReq({ reportId, outcome: 'warned', note: 'watch your tone' }),
    );

    const prof = (await db().doc(`travelMateProfiles/${BOB}`).get()).data()!;
    expect(prof.warnings).toBe(1);
    expect(prof.active).toBe(true);
  });

  it('writes an audit log for every outcome', async () => {
    const reportId = await openReport();
    await adminResolveTravelMateReport.run(makeAdminReq({ reportId, outcome: 'suspended' }));

    const logs = await db().collection('auditLogs').get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().action).toBe('travelMate.report.suspended');
    expect(logs.docs[0].data().targetUid).toBe(BOB);
  });
});
