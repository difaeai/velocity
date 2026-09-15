/**
 * Queries: a customer asks about an offer, the business answers, and either
 * side can report or block the other.
 *
 * The things that must never regress:
 *   - one thread per offer per person, and "queries" counts people, not messages;
 *   - only the offer's owner can answer;
 *   - a block is per business × customer, so it holds across every offer;
 *   - a customer who blocked a business stops getting its offers too;
 *   - "Seen by" counts each person once and never the owner.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { recordBusinessAdClick } from '../nearby';
import { businessesBlockedByCustomer, reportBusinessAdQuery, setBusinessAdQueryBlock } from '../moderation';
import { markBusinessAdQueryRead, replyBusinessAdQuery, sendBusinessAdQuery } from '../queries';

const SHOP = 'shop1';
const ASKER = 'asker1';

async function seedAd(adId: string, overrides: Record<string, unknown> = {}) {
  await db().doc(`businessAds/${adId}`).set({
    adId,
    ownerUid: SHOP,
    title: '25% off Sundays',
    businessName: 'Test Shop',
    offerDetails: 'Details',
    imageUrl: 'https://example.com/a.jpg',
    status: 'active',
    notified: 0,
    reach: 0,
    clicks: 0,
    viewers: 0,
    queries: 0,
    ...overrides,
  });
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${ASKER}`).set({ name: 'Ayesha Khan' });
  await db().doc(`businessAdvertisers/${SHOP}`).set({ businessName: 'Test Shop' });
  await seedAd('ad1');
  await seedAd('ad2');
});

describe('Queries', () => {
  it('opens one thread per offer per person and counts people, not messages', async () => {
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'Is it on delivery?' }, ASKER));
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'And on Saturdays?' }, ASKER));

    const thread = await db().doc(`businessAdQueries/ad1_${ASKER}`).get();
    expect(thread.get('askerName')).toBe('Ayesha');
    expect(thread.get('ownerUnread')).toBe(2);
    expect(thread.get('status')).toBe('waiting');
    expect((await thread.ref.collection('messages').get()).size).toBe(2);
    expect((await db().doc('businessAds/ad1').get()).get('queries')).toBe(1);
  });

  it('lets only the owner reply, and a reply clears the business side', async () => {
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'Hi' }, ASKER));
    const queryId = `ad1_${ASKER}`;

    await expect(replyBusinessAdQuery.run(makeReq({ queryId, text: 'Nope' }, 'stranger'))).rejects.toThrow();
    await replyBusinessAdQuery.run(makeReq({ queryId, text: 'Yes, it is!' }, SHOP));

    const thread = await db().doc(`businessAdQueries/${queryId}`).get();
    expect(thread.get('status')).toBe('answered');
    expect(thread.get('ownerUnread')).toBe(0);
    expect(thread.get('askerUnread')).toBe(1);

    await markBusinessAdQueryRead.run(makeReq({ queryId }, ASKER));
    expect((await thread.ref.get()).get('askerUnread')).toBe(0);
  });

  it('refuses a question about the owner’s own offer or a deleted one', async () => {
    await expect(sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'x' }, SHOP))).rejects.toThrow();
    await seedAd('gone', { status: 'removed' });
    await expect(sendBusinessAdQuery.run(makeReq({ adId: 'gone', text: 'x' }, ASKER))).rejects.toThrow();
  });

  it('a business block holds across every offer and both directions', async () => {
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'Hi' }, ASKER));
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad2', text: 'Hi again' }, ASKER));

    await setBusinessAdQueryBlock.run(makeReq({ queryId: `ad1_${ASKER}`, blocked: true }, SHOP));

    // Mirrored onto the OTHER offer's thread too.
    expect((await db().doc(`businessAdQueries/ad2_${ASKER}`).get()).get('blockedByBusiness')).toBe(true);
    await expect(sendBusinessAdQuery.run(makeReq({ adId: 'ad2', text: 'Still there?' }, ASKER))).rejects.toThrow(
      /can’t send messages/,
    );
    await expect(
      replyBusinessAdQuery.run(makeReq({ queryId: `ad1_${ASKER}`, text: 'Sorry' }, SHOP)),
    ).rejects.toThrow(/blocked this customer/);

    await setBusinessAdQueryBlock.run(makeReq({ queryId: `ad1_${ASKER}`, blocked: false }, SHOP));
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad2', text: 'Back' }, ASKER));
  });

  it('a customer block also stops that business’s offers', async () => {
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'Hi' }, ASKER));
    expect(await businessesBlockedByCustomer(ASKER)).toEqual(new Set());

    await setBusinessAdQueryBlock.run(makeReq({ queryId: `ad1_${ASKER}`, blocked: true }, ASKER));
    expect(await businessesBlockedByCustomer(ASKER)).toEqual(new Set([SHOP]));
  });

  it('a report snapshots the conversation and can block in the same step', async () => {
    await sendBusinessAdQuery.run(makeReq({ adId: 'ad1', text: 'Buy my stuff' }, ASKER));
    const queryId = `ad1_${ASKER}`;

    await expect(
      reportBusinessAdQuery.run(makeReq({ queryId, reason: 'spam' as const }, 'stranger')),
    ).rejects.toThrow();
    await reportBusinessAdQuery.run(makeReq({ queryId, reason: 'spam' as const, block: true }, SHOP));

    const reports = await db().collection('businessAdQueryReports').get();
    expect(reports.size).toBe(1);
    const r = reports.docs[0]!;
    expect(r.get('reporterSide')).toBe('business');
    expect(r.get('reportedUid')).toBe(ASKER);
    expect(r.get('status')).toBe('open');
    expect((r.get('messages') as { text: string }[]).map((m) => m.text)).toEqual(['Buy my stuff']);
    expect((await db().doc(`businessAdQueries/${queryId}`).get()).get('blockedByBusiness')).toBe(true);
  });
});

describe('Seen by', () => {
  it('counts each person once, and never the owner', async () => {
    await recordBusinessAdClick.run(makeReq({ adId: 'ad1' }, ASKER));
    await recordBusinessAdClick.run(makeReq({ adId: 'ad1' }, ASKER));
    await recordBusinessAdClick.run(makeReq({ adId: 'ad1' }, 'asker2'));
    await recordBusinessAdClick.run(makeReq({ adId: 'ad1' }, SHOP));

    const ad = await db().doc('businessAds/ad1').get();
    expect(ad.get('viewers')).toBe(2);
    expect(ad.get('clicks')).toBe(3);
    const imp = await db().doc(`businessAdImpressions/ad1_${ASKER}`).get();
    expect(imp.get('firstViewedAt')).toBeInstanceOf(admin.firestore.Timestamp);
  });
});
