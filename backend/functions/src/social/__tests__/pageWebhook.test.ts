/**
 * A comment on a connected Page, arriving by webhook.
 *
 * One Meta app carries every customer's Page and they all post to the one
 * public webhook, so the routing is the part worth testing: a Page event says
 * whose Page it is and nothing else. Get that wrong and one customer's
 * comments land in another customer's inbox.
 *
 * The loop guard is the other one. Our own replies come back down the same
 * webhook, and without it the desk answers itself — forever, billing for a
 * model call every turn.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../lib/firebase';
import { handlePageComment, handlePageFeedEvent } from '../engagement';
import { seal } from '../secrets';
import { inWorkspace, workspaceRef } from '../workspace';
import type { SocialComment } from '../types';

const WID = 'wspage1';
const WS = `workspaces/${WID}`;
const PAGE = '102030405060708';
const OTHER_PAGE = '900000000000001';

const feed = (over: Record<string, unknown> = {}) => ({
  item: 'comment',
  verb: 'add',
  comment_id: '102030405060708_111',
  post_id: '102030405060708_1',
  message: 'Lahore se Islamabad kitna hai?',
  // Meta sends seconds here, milliseconds everywhere else.
  created_time: 1_763_000_000,
  from: { id: '7788', name: 'Ali' },
  ...over,
});

const stored = async (id = 'facebook_102030405060708_111') =>
  (await db.doc(`${WS}/socialComments/${id}`).get()).data() as SocialComment | undefined;

beforeAll(() => {
  // A 32-byte key, so the Page credential can be sealed and read back.
  process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 5).toString('base64');
});

beforeEach(async () => {
  await workspaceRef(WID).set({ name: 'Shahzad Estates', ownerUid: 'u1', plan: 'all', createdAtMs: Date.now() });
  await db.doc(`vexaPages/${PAGE}`).set({ wid: WID, atMs: Date.now() });
  await db.doc(`${WS}/socialAccounts/facebook/secret/credentials`).set({
    accessToken: seal('EAAG-page-token-cccccccccccccccccccccccccc'),
    externalId: PAGE,
  });
  for (const doc of (await db.collection(`${WS}/socialComments`).get()).docs) await doc.ref.delete();
});

describe('a comment arrives on a connected Page', () => {
  it('lands in that Page’s own workspace, with the time Meta gave it', async () => {
    expect(await handlePageFeedEvent(PAGE, feed())).toBe(true);

    const row = await stored();
    expect(row?.text).toBe('Lahore se Islamabad kitna hai?');
    expect(row?.authorName).toBe('Ali');
    expect(row?.status).toBe('new');
    // Seconds in, milliseconds stored — not 1763000000.
    expect(row?.createdAtMs).toBe(1_763_000_000_000);
  });

  it('ignores a Page nobody here has connected', async () => {
    expect(await handlePageFeedEvent(OTHER_PAGE, feed())).toBe(false);
    expect(await stored()).toBeUndefined();
  });

  it('never answers itself when our own reply comes back', async () => {
    await inWorkspace(WID, async () => {
      expect(await handlePageComment(feed({ from: { id: PAGE, name: 'Shahzad Estates' } }))).toBe(false);
    });
    expect(await stored()).toBeUndefined();
  });

  it('writes a comment once, however many times Meta delivers it', async () => {
    await handlePageFeedEvent(PAGE, feed());
    await handlePageFeedEvent(PAGE, feed({ message: 'edited after the fact' }));

    const row = await stored();
    expect(row?.text).toBe('Lahore se Islamabad kitna hai?');
    expect((await db.collection(`${WS}/socialComments`).get()).size).toBe(1);
  });

  it('acts on a new comment and on nothing else', async () => {
    await inWorkspace(WID, async () => {
      // A like, an edit and a deletion all arrive on the same `feed` field.
      expect(await handlePageComment(feed({ item: 'like' }))).toBe(false);
      expect(await handlePageComment(feed({ verb: 'remove' }))).toBe(false);
      expect(await handlePageComment(feed({ message: '   ' }))).toBe(false);
    });
    expect((await db.collection(`${WS}/socialComments`).get()).size).toBe(0);
  });
});
