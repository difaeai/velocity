/**
 * The wiring, against a real Firestore.
 *
 * The classifier and the route maths are covered by pure tests. What these
 * check is everything between them and a screen, which is where this feature
 * can fail silently and still look finished:
 *
 *  1. A kept alert is actually written, under an id derived from the story URL.
 *  2. Re-reading the same feed UPDATES that document rather than multiplying
 *     it. The run is on a twenty-minute schedule, so a non-idempotent write
 *     would mean seventy-two copies of one closure a day.
 *  3. The live query is a single range on `expiresAt` and nothing else, so it
 *     needs no composite index — the deploy's index step is continue-on-error,
 *     and a feature that quietly returns nothing because an index never built
 *     is the exact failure this avoids.
 *  4. Expired alerts are swept, not left to accumulate.
 *
 * Nothing here touches the network. `runTrafficRefresh` fetches live news, so
 * testing it would make this suite depend on what Pakistan's newsrooms happened
 * to publish this morning — which is a thing to check by hand, never in CI.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { classify } from '../classify';
import { alertIdFor, storeAlerts, sweepExpired } from '../ingest';
import { TRAFFIC_COLLECTION, type TrafficAlert } from '../types';
import type { FeedItem } from '../types';

const NOW = Date.now();
const LINK = 'https://www.dawn.com/news/1899001/shahrah-e-faisal-closed';

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  sourceId: 'dawn',
  sourceName: 'Dawn',
  title: 'Shahrah-e-Faisal closed to all traffic after protest',
  summary: 'Police said the road was closed in both directions on Friday morning.',
  link: LINK,
  publishedAt: NOW - 30 * 60 * 1000,
  ...over,
});

/**
 * The storage half of a run, without the network half.
 *
 * Classify exactly as the job does, then hand the result to the job's OWN
 * `storeAlerts`. Re-implementing the write here would have tested a copy of the
 * code rather than the code — and the createdAt bug these tests caught lived in
 * precisely the lines a copy would have left out.
 */
async function store(items: FeedItem[], now = NOW): Promise<number> {
  const alerts: TrafficAlert[] = [];
  for (const i of items) {
    const verdict = classify(i, now);
    if (!verdict.kept || !verdict.alert) continue;
    alerts.push({ ...verdict.alert, id: alertIdFor(i.link), createdAt: now });
  }
  return storeAlerts(alerts);
}

const live = (now = NOW) =>
  db().collection(TRAFFIC_COLLECTION).where('expiresAt', '>', now).get();

describe('storing and serving road alerts', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('writes a kept alert under an id derived from the story URL', async () => {
    expect(await store([item()])).toBe(1);
    const snap = await db().doc(`${TRAFFIC_COLLECTION}/${alertIdFor(LINK)}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.get('cityCode')).toBe('KHI');
    expect(snap.get('roads')).toContain('Shahrah-e-Faisal');
    expect(snap.get('fingerprint')).toBeTruthy();
  });

  it('re-reading the same feed updates one document instead of multiplying it', async () => {
    await store([item()]);
    await store([item()]);
    await store([item()]);
    const all = await db().collection(TRAFFIC_COLLECTION).get();
    expect(all.size).toBe(1);
  });

  it('keeps the first createdAt, so "2h ago" counts from when we first saw it', async () => {
    await store([item()]);
    const first = (await db().doc(`${TRAFFIC_COLLECTION}/${alertIdFor(LINK)}`).get()).get('createdAt');
    await store([item()], NOW + 60 * 60 * 1000);
    const second = (await db().doc(`${TRAFFIC_COLLECTION}/${alertIdFor(LINK)}`).get()).get('createdAt');
    expect(second).toBe(first);
  });

  it('serves the live set from one range query — no composite index needed', async () => {
    await store([
      item(),
      item({ link: 'https://tribune.com.pk/story/2/jail-road', title: 'Jail Road closed by protest' }),
    ]);
    const snap = await live();
    expect(snap.size).toBe(2);
  });

  it('sweeps alerts whose own expiry has passed, and only those', async () => {
    await store([
      item(),
      item({
        link: 'https://tribune.com.pk/story/3/old',
        title: 'Traffic jam on Canal Road',
        publishedAt: NOW - 10 * 60 * 60 * 1000, // a jam lives 3h
      }),
    ]);
    expect((await db().collection(TRAFFIC_COLLECTION).get()).size).toBe(2);

    expect(await sweepExpired(NOW)).toBe(1);
    const left = await db().collection(TRAFFIC_COLLECTION).get();
    expect(left.size).toBe(1);
    expect(left.docs[0]!.get('roads')).toContain('Shahrah-e-Faisal');
  });

  it('never stores an item the classifier refused', async () => {
    expect(
      await store([
        item({ title: 'A road is not a corridor', summary: 'A column about the Wakhan Corridor.' }),
      ]),
    ).toBe(0);
    expect((await db().collection(TRAFFIC_COLLECTION).get()).size).toBe(0);
  });
});
