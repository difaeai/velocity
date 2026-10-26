/**
 * "Post on its own" posts what was already waiting too — each piece on its own
 * calendar day, as one finished in that mode would be — and leaves to a person
 * only what a person has to decide.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { dayKey } from '../../analytics';
import { scheduleWaiting } from '../pipeline';
import { DEFAULT_SETTINGS } from '../types';

const image = {
  kind: 'image',
  provider: 'velocity-render',
  model: null,
  jobId: null,
  storagePath: 'social/x/slide-1.jpg',
  url: 'https://storage.example/slide-1.jpg',
  urlExpiresAtMs: 0,
  durationSec: null,
  aspect: '4:5',
  slide: 1,
  alt: '',
};

const day = (offset: number) => dayKey(Date.now() + offset * 86_400_000);

async function seed(id: string, over: Record<string, unknown> = {}) {
  await db()
    .doc(`socialPosts/${id}`)
    .set({
      id,
      date: day(3),
      format: 'post',
      status: 'awaiting_approval',
      engine: 'gemini',
      script: { hook: 'h' },
      targets: ['instagram'],
      results: {},
      media: [image],
      ...over,
    });
}

const read = async (id: string) => (await db().doc(`socialPosts/${id}`).get()).data()!;

describe('scheduleWaiting', () => {
  beforeEach(async () => {
    await clearFirestore();
    process.env.GEMINI_KEY_RESEARCH = 'test-key';
  });
  afterEach(() => {
    delete process.env.GEMINI_KEY_RESEARCH;
  });

  it('leaves every piece for a person while the desk asks first', async () => {
    await seed('a');
    expect(await scheduleWaiting({ ...DEFAULT_SETTINGS, autoPublish: false })).toBe(0);
    expect((await read('a')).status).toBe('awaiting_approval');
  });

  it('puts waiting pieces on their calendar days, and leaves what only a person can decide', async () => {
    await seed('later');
    await seed('today', { date: day(0) });
    await seed('past', { date: day(-2) });
    await seed('red', { error: 'Every network rejected the post — see the per-network errors.' });
    await seed('empty', { media: [] });
    await seed('held', { heldByChoice: true });
    await seed('local', { engine: 'local' });

    expect(await scheduleWaiting({ ...DEFAULT_SETTINGS, autoPublish: true })).toBe(2);
    for (const id of ['later', 'today']) {
      expect(await read(id)).toMatchObject({ status: 'ready', scheduled: true, approvedBy: 'auto' });
      expect((await read(id)).publishQueuedAtMs).toBeGreaterThan(0);
    }
    for (const id of ['past', 'red', 'empty', 'held', 'local']) {
      expect((await read(id)).status).toBe('awaiting_approval');
    }
  });
});
