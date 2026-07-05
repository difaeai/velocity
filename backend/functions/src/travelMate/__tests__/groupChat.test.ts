/**
 * Integration tests for Phase 5 group chat + private DMs.
 *
 * Critical paths:
 *  - group message: members only, lastMessage/lastMessageAt bumped
 *  - openTravelMateDirectChat: reuses an existing match; creates a
 *    group-origin match for two members; rejects outsiders and closed matches
 *  - previewTravelMateGroup: canJoin only for matched-with-a-member profiles
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import {
  clearFirestore, seedProfile, seedMatch, makeReq, db,
} from './helpers';
import {
  sendTravelMateGroupMessage, openTravelMateDirectChat, previewTravelMateGroup,
} from '../groupChat';
import { createTravelMateGroup } from '../groups';

const CREATOR = 'creator-uid';
const MEMBER  = 'member-uid';
const OUTSIDER = 'outsider-uid';
const REGULAR = 'regular-uid'; // no profile

async function makeGroup(): Promise<string> {
  const res = await createTravelMateGroup.run(makeReq({}, CREATOR));
  await db().doc(`travelMateGroups/${res.groupId}`).update({
    members: admin.firestore.FieldValue.arrayUnion(MEMBER),
    [`memberInfo.${MEMBER}`]: { displayName: `User ${MEMBER}`, photoURL: null },
  });
  return res.groupId;
}

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(CREATOR);
  await seedProfile(MEMBER);
  await seedProfile(OUTSIDER);
});

describe('sendTravelMateGroupMessage', () => {
  it('member sends; message stored and group lastMessage bumped', async () => {
    const groupId = await makeGroup();
    const res = await sendTravelMateGroupMessage.run(makeReq({ groupId, text: 'On my way!' }, MEMBER));
    expect(res.messageId).toBeTruthy();

    const msg = (await db().doc(`travelMateGroups/${groupId}/messages/${res.messageId}`).get()).data()!;
    expect(msg.senderId).toBe(MEMBER);
    expect(msg.text).toBe('On my way!');
    expect(msg.type).toBe('text');

    const group = (await db().doc(`travelMateGroups/${groupId}`).get()).data()!;
    expect(group.lastMessage).toBe('On my way!');
    expect(group.lastMessageAt).toBeTruthy();
  });

  it('non-member is rejected', async () => {
    const groupId = await makeGroup();
    await expect(sendTravelMateGroupMessage.run(makeReq({ groupId, text: 'hi' }, OUTSIDER)))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('openTravelMateDirectChat', () => {
  it('creates a group-origin private match between two members', async () => {
    const groupId = await makeGroup();
    const res = await openTravelMateDirectChat.run(makeReq({ targetUid: CREATOR, groupId }, MEMBER));
    expect(res.created).toBe(true);
    expect(res.matchId).toBe([CREATOR, MEMBER].sort().join('_'));

    const match = (await db().doc(`travelMateMatches/${res.matchId}`).get()).data()!;
    expect(match.status).toBe('active');
    expect(match.origin).toBe('group');
    expect(match.users).toEqual([CREATOR, MEMBER].sort());
    expect(match.userInfo[MEMBER].displayName).toBe(`User ${MEMBER}`);
  });

  it('reuses an existing active match without creating a new one', async () => {
    const groupId = await makeGroup();
    const existingId = await seedMatch(CREATOR, MEMBER);
    const res = await openTravelMateDirectChat.run(makeReq({ targetUid: CREATOR, groupId }, MEMBER));
    expect(res.created).toBe(false);
    expect(res.matchId).toBe(existingId);
  });

  it('rejects when the pair is not in the group together', async () => {
    const groupId = await makeGroup();
    await expect(openTravelMateDirectChat.run(makeReq({ targetUid: MEMBER, groupId }, OUTSIDER)))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a closed (unmatched) conversation', async () => {
    const groupId = await makeGroup();
    await seedMatch(CREATOR, MEMBER, 'unmatched');
    await expect(openTravelMateDirectChat.run(makeReq({ targetUid: CREATOR, groupId }, MEMBER)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects self-chat', async () => {
    const groupId = await makeGroup();
    await expect(openTravelMateDirectChat.run(makeReq({ targetUid: MEMBER, groupId }, MEMBER)))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('previewTravelMateGroup', () => {
  it('member sees alreadyMember; matched outsider canJoin; unmatched cannot', async () => {
    const groupId = await makeGroup();

    const asMember = await previewTravelMateGroup.run(makeReq({ groupId }, MEMBER));
    expect(asMember.alreadyMember).toBe(true);
    expect(asMember.canJoin).toBe(true);

    const unmatched = await previewTravelMateGroup.run(makeReq({ groupId }, OUTSIDER));
    expect(unmatched.canJoin).toBe(false);
    expect(unmatched.reason).toBe('not_partner');

    await seedMatch(OUTSIDER, MEMBER);
    const matched = await previewTravelMateGroup.run(makeReq({ groupId }, OUTSIDER));
    expect(matched.canJoin).toBe(true);
    expect(matched.reason).toBe('ok');
  });

  it('regular user without a profile cannot join', async () => {
    const groupId = await makeGroup();
    const res = await previewTravelMateGroup.run(makeReq({ groupId }, REGULAR));
    expect(res.canJoin).toBe(false);
    expect(res.reason).toBe('no_profile');
    expect(res.group.memberCount).toBe(2);
  });
});
