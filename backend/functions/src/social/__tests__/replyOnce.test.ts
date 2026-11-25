/**
 * The one property answering a comment must never lose: it is answered once.
 *
 * On 2026-11-25 a single press of "Send reply" in the console reached
 * `adminReplySocialComment` three times in eighteen seconds, and the duplicate
 * does not land in a draft — it lands under a customer's comment in public.
 * Checking the status first would not have stopped it: the network call takes
 * seconds, so all three callers read `drafted` before any of them finished.
 * Hence a transaction, and hence this test against the emulator, where the
 * transaction is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';

const sent: string[] = [];
let fail = false;

vi.mock('../accounts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../accounts')>();
  return {
    ...real,
    loadCredentials: async () => ({ accessToken: 'token' }),
    flagIfDead: async () => undefined,
  };
});

vi.mock('../platforms', async (importOriginal) => {
  const real = await importOriginal<typeof import('../platforms')>();
  return {
    ...real,
    replyToComment: async (_p: string, _c: unknown, id: string, text: string) => {
      // Long enough that a second caller is inside the window, which is the
      // only thing that makes this test worth running.
      await new Promise((r) => setTimeout(r, 120));
      if (fail) throw new Error('the network refused the reply');
      sent.push(`${id}:${text}`);
    },
  };
});

const { sendReply } = await import('../engagement');

const ID = 'youtube_c1';
const ref = () => db().doc(`socialComments/${ID}`);

const seed = async (over: Record<string, unknown> = {}) =>
  ref().set({
    id: ID,
    platform: 'youtube',
    mediaId: 'v1',
    postId: null,
    commentId: 'c1',
    authorName: 'Difaeai',
    text: 'Is there a women-only shared ride?',
    permalink: null,
    createdAtMs: Date.now(),
    status: 'drafted',
    intent: 'question',
    draftReply: 'Yes — pick the preference on the booking screen.',
    draftedBy: 'Awaaz',
    sentReply: null,
    sentAtMs: null,
    error: null,
    ...over,
  });

describe('sendReply', () => {
  beforeEach(async () => {
    await clearFirestore();
    sent.length = 0;
    fail = false;
  });

  it('answers a comment once, however many callers press Send at the same time', async () => {
    await seed();

    const results = await Promise.all([
      sendReply('youtube', 'c1', 'Yes.'),
      sendReply('youtube', 'c1', 'Yes.'),
      sendReply('youtube', 'c1', 'Yes.'),
    ]);

    expect(sent).toHaveLength(1);
    // Every caller is told the comment is answered, because it is.
    expect(results.every((r) => r.ok)).toBe(true);
    const row = (await ref().get()).data();
    expect(row?.status).toBe('replied');
    expect(row?.sendingAtMs).toBeNull();
  });

  it('refuses to answer a comment that is already answered', async () => {
    await seed({ status: 'replied', sentReply: 'Already said.', sentAtMs: Date.now() });

    const result = await sendReply('youtube', 'c1', 'Said again.');

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(0);
    expect((await ref().get()).get('sentReply')).toBe('Already said.');
  });

  it('lets a reply that failed be tried again', async () => {
    await seed();
    fail = true;
    const first = await sendReply('youtube', 'c1', 'Yes.');
    expect(first.ok).toBe(false);
    // A send that died must not hold the comment: the lease is cleared, not left
    // to expire an hour later.
    expect((await ref().get()).get('sendingAtMs')).toBeNull();

    fail = false;
    const second = await sendReply('youtube', 'c1', 'Yes.');
    expect(second.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('frees a comment whose send died before it could clear the lease', async () => {
    await seed({ sendingAtMs: Date.now() - 5 * 60_000 });

    const result = await sendReply('youtube', 'c1', 'Yes.');

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
