/**
 * The five-day review end to end, on a real Firestore.
 *
 * The pure half is covered in `review.test.ts`. This is the half that breaks in
 * production rather than in a unit test: the paths it reads, the document it
 * writes, the settings it patches, and the shared industry memory two different
 * workspaces take turns writing — including the thing the arithmetic cannot
 * prove, which is that a lesson learned in one customer's workspace turns up in
 * the prompts of the next customer in the same trade and carries nothing of
 * theirs with it.
 *
 * No model key is configured here, so this exercises the local path: the one
 * every deployment falls back to, and the one that must never throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../lib/firebase';
import { industryOf, lessonsRef, review, seedLearned, type IndustryLessons, type Review } from '../review';
import { learnedBlock } from '../crew';
import { getSocialSettings } from '../settings';
import { inWorkspace, workspaceRef } from '../workspace';
import { DEFAULT_SETTINGS, type AccountRead, type SocialSettings } from '../types';
import type { PageRead, RankedPost } from '../insights';
import type { Brand } from '../../studio/plans';

const DAY = 86_400_000;
const now = Date.now();
const dayKey = (ms: number) => new Date(ms + 5 * 3_600_000).toISOString().slice(0, 10);

/** Everything the desk writes, cleared between cases so one test cannot seed the next. */
async function wipe(prefix = ''): Promise<void> {
  const paths = ['socialPosts', 'socialAds', 'socialResearch', 'socialInsights', 'socialPlans'];
  for (const name of paths) {
    const snap = await db.collection(`${prefix}${name}`).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await Promise.all([
    db.doc(`${prefix}system/socialAutomation`).delete(),
    db.doc(`${prefix}system/socialAds`).delete(),
    db.doc(`${prefix}system/store`).delete(),
  ]);
}

const ranked = (over: Partial<RankedPost> = {}): RankedPost => ({
  mediaId: Math.random().toString(36).slice(2),
  permalink: null,
  mediaType: 'REELS',
  postedAtMs: now - DAY,
  hook: 'Rs 320 is what this ride cost.',
  reach: 1000,
  saves: 10,
  sends: 5,
  comments: 4,
  likes: 60,
  multiple: 1,
  sendRate: 5,
  saveRate: 10,
  hookScore: 80,
  ...over,
});

/** A desk five days into a bad week: half of it stuck in the queue, reach halved, ads idle. */
async function seedStruggling(prefix = ''): Promise<void> {
  const settings: Partial<SocialSettings> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    postsPerDay: 1,
    dailyStory: false,
    goal: 'I want more sales from Instagram',
  };
  await db.doc(`${prefix}system/socialAutomation`).set(settings);

  for (let i = 0; i < 5; i++) {
    const date = dayKey(now - i * DAY);
    await db
      .doc(`${prefix}socialPosts/${date}-post`)
      .set({ date, format: 'post', status: i < 2 ? 'published' : 'awaiting_approval' });
  }

  const read: PageRead = {
    atMs: now,
    date: dayKey(now),
    sampled: 6,
    medianReach: 700,
    best: [
      ranked({ postedAtMs: now - DAY, reach: 400, sendRate: 0.1, saveRate: 0.2, hookScore: 30, likes: 5, comments: 0 }),
      ranked({ postedAtMs: now - 2 * DAY, reach: 400, sendRate: 0.1, saveRate: 0.2, hookScore: 30, likes: 5, comments: 0 }),
      ranked({ postedAtMs: now - 3 * DAY, reach: 400, sendRate: 0.1, saveRate: 0.2, hookScore: 30, likes: 5, comments: 0 }),
      ranked({ postedAtMs: now - 7 * DAY, reach: 1200 }),
      ranked({ postedAtMs: now - 8 * DAY, reach: 1200 }),
    ],
    worst: [],
    lessons: [],
    useMore: [],
    useLess: [],
    error: null,
  };
  await db.doc(`${prefix}socialInsights/latest`).set(read);
  await db.doc(`${prefix}socialInsights/profile`).set({
    atMs: now,
    score: 38,
    profile: { username: 'us', displayName: null, biography: null, website: null, followers: 2000, posts: 40, avatarUrl: null, recentThumbnails: [] },
    items: [],
    rewrites: [],
    error: null,
  });

  // An ad account with a limit and nothing running: the commonest real state.
  await db.doc(`${prefix}system/socialAds`).set({
    adAccountId: 'act_1',
    currency: 'PKR',
    dailyCap: 1500,
    account: { daily: [], week: { ctr: 0 }, committed: 0, bench: null },
  });
  await db.doc(`${prefix}socialAds/c1`).set({ objectiveKind: 'traffic', verdict: { grade: 'idle' }, managed: true });

  const accounts: AccountRead[] = [
    {
      username: 'rival',
      followers: 4000,
      medianEngagement: 800,
      top: [{ caption: 'This flat cost less than you think.\nmore', mediaType: 'REELS', permalink: null, likes: 2000, comments: 90, multiple: 2.5 }],
    },
  ];
  await db.doc(`${prefix}socialResearch/${dayKey(now)}`).set({ date: dayKey(now), accounts, trends: [], competitorMoves: [], opportunities: [], hookPatterns: [], avoid: [], sources: [], atMs: now });
}

describe('review, end to end', () => {
  beforeEach(async () => {
    await wipe();
    await lessonsRef('transport').delete();
    await lessonsRef('real-estate').delete();
  });

  it('reads the desk, scores it, and stores one report', async () => {
    await seedStruggling();
    const out = await review(now);

    expect(out.score).toBeGreaterThan(0);
    expect(out.score).toBeLessThan(60);
    expect(out.delivery.published).toBe(2);
    expect(out.delivery.waiting).toBe(3);
    expect(out.reach.trendPct).toBe(-67);
    expect(out.summary.length).toBeGreaterThan(80);

    const stored = (await db.doc('socialInsights/review').get()).data() as Review;
    expect(stored.atMs).toBe(out.atMs);
    expect(stored.findings.length).toBe(out.findings.length);
  });

  it('finds the real shortcomings of that week, each with its numbers', async () => {
    await seedStruggling();
    const out = await review(now);
    const ids = out.findings.map((f) => f.id);

    expect(ids).toContain('under_delivered');
    expect(ids).toContain('weak_hooks');
    expect(ids).toContain('not_sent');
    expect(ids).toContain('weak_profile');
    expect(ids).toContain('ads_idle');
    expect(ids).toContain('behind_competitor');
    // The goal is about sales and nothing can count a sale here.
    expect(ids).toContain('not_measurable');
    for (const f of out.findings) expect(f.evidence.length).toBeGreaterThan(10);
  });

  it('puts what it learned in front of every employee, without being asked', async () => {
    await seedStruggling();
    const out = await review(now);

    const settings = await getSocialSettings();
    expect(settings.learned?.doMore.length).toBeGreaterThan(0);
    expect(settings.learned?.atMs).toBe(out.atMs);

    // The part that actually changes the next five days: it is in the prompt.
    const prompt = learnedBlock(settings);
    expect(prompt).toContain('Do more of this');
    expect(prompt).toContain("team lead's own instructions outrank");
  });

  it('remembers its own score, so "are we improving" has an answer', async () => {
    await seedStruggling();
    const first = await review(now);
    const second = await review(now + 5 * DAY);

    expect(second.previousScore).toBe(first.score);
    expect(second.history).toHaveLength(2);
    expect(second.history.at(-1)?.score).toBe(second.score);
  });

  it('survives a desk with nothing in it at all', async () => {
    // Every read empty: no settings, no posts, no insights, no ads. This is a
    // workspace on its first day, and it must produce a report rather than a
    // stack trace.
    const out = await review(now);
    expect(out.score).toBe(0);
    expect(out.findings[0].id).toBe('desk_off');
    expect(out.summary.length).toBeGreaterThan(40);
    expect(out.spend).toBeNull();
    expect(out.competitors).toBeNull();
  });

  it('carries what one business taught it to the next one of the same kind', async () => {
    const brand: Brand = {
      name: 'Shahzad Estates',
      what: 'An estate agency selling plots and houses in Bahria Town',
      audience: 'Overseas Pakistanis buying property',
      market: 'Lahore',
      language: 'Urdu and English',
      differences: 'We only list what we have verified',
      website: 'https://shahzadestates.pk',
    };
    expect(industryOf(brand)).toBe('real-estate');

    const wid = 'wsreview1';
    await workspaceRef(wid).set({
      name: 'Shahzad Estates',
      ownerUid: 'u1',
      ownerEmail: null,
      plan: 'all',
      trialEndsAtMs: now + DAY,
      paidUntilMs: now + 30 * DAY,
      accessUntilMs: now + 30 * DAY,
      createdAtMs: now - 10 * DAY,
      brand,
    });

    await wipe(`workspaces/${wid}/`);
    await seedStruggling(`workspaces/${wid}/`);
    const out = await inWorkspace(wid, () => review(now));
    expect(out.industry).toBe('real-estate');

    const shared = (await lessonsRef('real-estate').get()).data() as IndustryLessons;
    expect(shared.reviews).toBe(1);
    expect(shared.lessons.length).toBeGreaterThan(0);

    // Nothing of theirs crossed the line: no name, no handle, no site, no figure.
    const text = shared.lessons.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/Shahzad/i);
    expect(text).not.toMatch(/shahzadestates/i);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{4,}/);

    // And the next estate agent to sign up starts with it.
    const seeded = await seedLearned(brand, now);
    expect(seeded?.fromIndustry.length).toBeGreaterThan(0);
    expect(learnedBlock({ ...DEFAULT_SETTINGS, learned: seeded ?? undefined })).toContain('other businesses of this kind');

    // A restaurant gets none of it: the pile is per trade.
    const cafe: Brand = {
      name: 'Chacha Biryani',
      what: 'A family restaurant doing biryani',
      audience: 'Families in Johar Town',
      market: 'Lahore',
      language: 'Urdu',
      differences: 'One recipe, forty years',
      website: '',
    };
    expect(industryOf(cafe)).toBe('food');
    expect(await seedLearned(cafe, now)).toBeNull();

    await workspaceRef(wid).delete();
    await wipe(`workspaces/${wid}/`);
  });
});
