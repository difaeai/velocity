/**
 * Disconnecting YouTube has to erase what came from YouTube.
 *
 * The YouTube API Services Developer Policies (III.D.2.c, III.E.4.g) allow
 * seven calendar days from a disconnection, a deletion request, or an account
 * being deleted, and our privacy policy now says so — so this is the test that
 * keeps the document honest. The other networks are deliberately untouched:
 * their own clause says the channel's name and picture stay until the workspace
 * is deleted.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { forgetYouTubeData } from '../accounts';

const comment = (id: string, platform: string) =>
  db().doc(`socialComments/${id}`).set({
    id,
    platform,
    mediaId: 'v1',
    postId: null,
    commentId: id,
    authorName: 'Someone',
    text: 'Is there a women-only shared ride?',
    permalink: null,
    createdAtMs: Date.now(),
    status: 'drafted',
    intent: 'question',
    draftReply: null,
    draftedBy: null,
    sentReply: null,
    sentAtMs: null,
    error: null,
  });

const account = (platform: string) =>
  db().doc(`socialAccounts/${platform}`).set({
    platform,
    status: 'disconnected',
    displayName: 'Velocity Rides',
    handle: '@velocityridesapp',
    externalId: 'UC123',
    followers: 41,
    avatarUrl: 'https://yt3.example/avatar.jpg',
  });

describe('forgetYouTubeData', () => {
  beforeEach(clearFirestore);

  it('deletes every comment read from YouTube and leaves the other networks alone', async () => {
    await Promise.all([
      comment('youtube_a', 'youtube'),
      comment('youtube_b', 'youtube'),
      comment('facebook_a', 'facebook'),
      comment('instagram_a', 'instagram'),
    ]);

    await forgetYouTubeData();

    const left = (await db().collection('socialComments').get()).docs.map((d) => d.id);
    expect(left.sort()).toEqual(['facebook_a', 'instagram_a']);
  });

  it('clears the channel the API told us about, and nobody else’s', async () => {
    await Promise.all([account('youtube'), account('facebook')]);

    await forgetYouTubeData();

    const yt = (await db().doc('socialAccounts/youtube').get()).data();
    expect(yt).toMatchObject({
      displayName: '',
      handle: null,
      externalId: '',
      followers: null,
      avatarUrl: null,
    });
    // The row itself stays, so the workspace can still say YouTube is disconnected.
    expect(yt?.status).toBe('disconnected');
    expect((await db().doc('socialAccounts/facebook').get()).get('displayName')).toBe('Velocity Rides');
  });

  it('is safe to run when there is nothing to forget', async () => {
    await expect(forgetYouTubeData()).resolves.toBeUndefined();
  });

  it('gets through more comments than one write batch holds', async () => {
    // 500 is the ceiling, and a channel with a popular video passes it.
    await Promise.all(Array.from({ length: 520 }, (_, i) => comment(`youtube_${i}`, 'youtube')));

    await forgetYouTubeData();

    expect((await db().collection('socialComments').get()).size).toBe(0);
  });
});
