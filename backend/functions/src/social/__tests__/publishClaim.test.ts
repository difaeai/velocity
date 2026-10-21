/**
 * The one property publishing must never lose: a piece is never posted twice.
 *
 * Three things can try to post the same piece at once — a double-click, the
 * approve call, and the five-minute sweep — and "Post again" after a partial
 * failure is pressed on purpose. `claimForPublish` decides, inside one
 * transaction on the document as it is at that instant, whether this caller
 * may post and to which networks. Against the emulator, because the property
 * lives in the transaction.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { claimForPublish } from '../pipeline';

const ID = '2026-10-21-post';

const image = {
  kind: 'image',
  provider: 'velocity-render',
  model: null,
  jobId: null,
  storagePath: `social/${ID}/slide-1.jpg`,
  url: 'https://storage.example/slide-1.jpg',
  urlExpiresAtMs: 0,
  durationSec: null,
  aspect: '4:5',
  slide: 1,
  alt: '',
};

const ok = { ok: true, id: '1789', url: 'https://www.instagram.com/p/x', error: null, atMs: 1 };

async function seed(over: Record<string, unknown> = {}) {
  await db()
    .doc(`socialPosts/${ID}`)
    .set({ id: ID, date: '2026-10-21', format: 'post', status: 'ready', targets: ['instagram', 'facebook'], results: {}, media: [image], ...over });
}

const status = async () => (await db().doc(`socialPosts/${ID}`).get()).get('status') as string;

describe('claimForPublish', () => {
  beforeEach(clearFirestore);

  it('takes the piece and names every network it still has to reach', async () => {
    await seed();
    const { targets } = await claimForPublish(ID);
    expect(targets).toEqual(['instagram', 'facebook']);
    expect(await status()).toBe('publishing');
  });

  it('turns away a second publisher while the first is posting', async () => {
    await seed();
    await claimForPublish(ID);
    await expect(claimForPublish(ID)).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('frees a claim whose function died', async () => {
    await seed({ status: 'publishing', publishingSinceMs: Date.now() - 60 * 60_000 });
    await expect(claimForPublish(ID)).resolves.toMatchObject({ targets: ['instagram', 'facebook'] });
  });

  it('skips a network that already has it, so "Post again" retries only the rest', async () => {
    await seed({ status: 'partial', results: { instagram: ok } });
    const { targets } = await claimForPublish(ID);
    expect(targets).toEqual(['facebook']);
  });

  it('refuses outright once it is live everywhere — the case that would double-post', async () => {
    await seed({ status: 'published', results: { instagram: ok, facebook: ok } });
    await expect(claimForPublish(ID)).rejects.toThrow(/already live everywhere/);
    expect(await status()).toBe('published');
  });

  it('writes nothing when there is nothing to post', async () => {
    await seed({ media: [] });
    await expect(claimForPublish(ID)).rejects.toThrow(/nothing to publish/);
    expect(await status()).toBe('ready');
  });
});
