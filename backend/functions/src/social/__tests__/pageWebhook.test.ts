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
import { createHmac } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentWhatsappWebhook } from '../../agents/whatsapp';

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

/**
 * The same comment, arriving the way it really does: as a signed POST to the
 * desk's public webhook.
 *
 * It lands there rather than on the WhatsApp webhook next door because the
 * Page is connected through Vexa's own Meta app, which signs with that app's
 * secret. Getting this wrong is silent — Meta keeps delivering, the endpoint
 * keeps answering, and no comment ever reaches a customer's inbox.
 */
describe('the webhook Meta actually posts to', () => {
  const APP_SECRET = 'f'.repeat(32);
  const sign = (raw: Buffer) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

  const post = async (body: unknown, signature?: string) => {
    const raw = Buffer.from(JSON.stringify(body));
    const res = {
      code: 0,
      body: '',
      // firebase-functions wraps the handler and listens for the response to
      // finish; without this the wrapper throws before our code is reached.
      on() {
        return this;
      },
      setHeader() {
        return this;
      },
      status(c: number) {
        this.code = c;
        return this;
      },
      send(b: string) {
        this.body = b;
        return this;
      },
    };
    await (agentWhatsappWebhook as unknown as (q: unknown, s: unknown) => Promise<void>)(
      { method: 'POST', body, rawBody: raw, headers: { 'x-hub-signature-256': signature ?? sign(raw) }, query: {} },
      res,
    );
    return res;
  };

  const pageEvent = () => ({ object: 'page', entry: [{ id: PAGE, changes: [{ field: 'feed', value: feed() }] }] });

  beforeEach(() => {
    process.env.META_APP_ID = '4719371214988288';
    process.env.META_APP_SECRET = APP_SECRET;
  });

  it('takes a signed Page comment and files it in that Page’s workspace', async () => {
    const res = await post(pageEvent());
    expect(res.code).toBe(200);
    expect((await stored())?.text).toBe('Lahore se Islamabad kitna hai?');
  });

  it('refuses one signed with anything else, and files nothing', async () => {
    const res = await post(pageEvent(), 'sha256=deadbeef');
    expect(res.code).toBe(401);
    expect(await stored()).toBeUndefined();
  });
});
