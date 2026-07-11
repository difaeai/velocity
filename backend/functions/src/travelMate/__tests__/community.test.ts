/**
 * Regression tests — null-encoded optional fields.
 *
 * The mobile Firebase SDK encodes absent optional fields as `null` on the
 * wire (undefined → null), so callable schemas must accept null wherever a
 * field is optional. Before the .nullish() fix every text-only feed post
 * failed with "Invalid post data." and minimal group creates failed with
 * "Invalid group data."
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, seedProfile, makeReq, db } from './helpers';
import { createTravelMatePost } from '../community';
import { createTravelMateGroup } from '../groups';

const UID = 'author-uid';

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(UID);
});

describe('null-encoded optional fields (mobile SDK wire format)', () => {
  it('text-only post with null media/community fields succeeds', async () => {
    const res = await createTravelMatePost.run(makeReq({
      text: 'Hello',
      imageBase64: null,
      videoPath: null,
      communityId: null,
    }, UID));
    expect(res.postId).toBeTruthy();
    const doc = await db().doc(`travelMatePosts/${res.postId}`).get();
    expect(doc.get('text')).toBe('Hello');
    expect(doc.get('communityId')).toBeNull();
    expect(doc.get('mediaType')).toBeNull();
  });

  it('group create with null name/destination/schedule succeeds', async () => {
    const res = await createTravelMateGroup.run(makeReq({
      name: null,
      destinationName: null,
      schedule: null,
    }, UID));
    expect(res.groupId).toBeTruthy();
    const doc = await db().doc(`travelMateGroups/${res.groupId}`).get();
    expect(doc.get('members')).toEqual([UID]);
  });
});
