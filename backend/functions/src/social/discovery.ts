/**
 * Reading other accounts — with their real numbers.
 *
 * The morning read used to be one web search and the model's summary of it:
 * nobody on the desk ever looked at what a competitor or a creator in the same
 * market actually posted, or how it did. Instagram's Business Discovery does
 * exactly that, through our own connected account and at no cost: any public
 * Business or Creator account's recent posts, each with its like and comment
 * counts. Nothing is scraped and no login of anyone else's is involved.
 *
 * Raw likes say nothing on their own — 2,000 is a quiet day for a big brand and
 * a breakout for a small one — so each account's posts are ranked by the
 * multiple over that account's own median, the same rule `insights.ts` applies
 * to ours. What comes out is "this kind of post did 4x their normal", which is
 * evidence a writer can use, where "trending: short videos" is not.
 *
 * Whose accounts: the competitor list's Instagram handles, plus the ones the
 * grounded search named that morning. A handle that is not a Business or
 * Creator account, is age-gated, or does not exist simply returns nothing.
 */
import { logger } from 'firebase-functions';

import { loadCredentials } from './accounts';
import type { AccountRead } from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** How many accounts one morning reads. Each is one free Graph call. */
export const MAX_ACCOUNTS = 14;

/**
 * Velocity's own desk also studies brands next door whose posts travel — not
 * rivals, so never in the competitor list the search reads around. Handles
 * taken from each brand's own site where it links one (rapidoapp, zomato);
 * one Instagram will not answer for is skipped and logged, never guessed at.
 */
export const HOUSE_STUDY = ['rapidoapp', 'zomato', 'swiggyindia', 'letsblinkit'];

/** An Instagram username as people write it — "@careem", a profile link — cut to the handle, or null. */
export function handleOf(raw: string): string | null {
  // Anything left after the handle that is not a path or a query means it was prose, not a handle.
  const s = raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s.toLowerCase() : null;
}

interface RawMedia {
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  permalink?: string;
}

/** Rank one account's posts against its own median. Pure. */
export function rankAccount(username: string, followers: number, media: RawMedia[]): AccountRead {
  const scored = media.map((m) => ({ m, engagement: (m.like_count ?? 0) + (m.comments_count ?? 0) }));
  const sorted = scored.map((s) => s.engagement).sort((a, b) => a - b);
  const mid = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const median = sorted.length % 2 || !sorted.length ? mid : (sorted[sorted.length / 2 - 1] + mid) / 2;
  const top = scored
    .filter((s) => median > 0 && s.engagement >= median * 1.5)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3)
    .map((s) => ({
      caption: (s.m.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
      mediaType: s.m.media_type ?? 'UNKNOWN',
      permalink: s.m.permalink ?? null,
      likes: s.m.like_count ?? 0,
      comments: s.m.comments_count ?? 0,
      multiple: Math.round((s.engagement / median) * 10) / 10,
    }));
  return { username, followers, medianEngagement: Math.round(median), top };
}

/**
 * Read up to `MAX_ACCOUNTS` accounts. Never throws: with no Instagram connected,
 * or a handle Instagram will not answer for, that account is simply absent.
 */
export async function readAccounts(handles: string[]): Promise<AccountRead[]> {
  const wanted = [...new Set(handles.map(handleOf).filter((h): h is string => Boolean(h)))].slice(0, MAX_ACCOUNTS);
  if (!wanted.length) return [];
  const credentials = await loadCredentials('instagram').catch(() => null);
  if (!credentials?.externalId) return [];

  const reads: AccountRead[] = [];
  for (const username of wanted) {
    const fields =
      `business_discovery.username(${username})` +
      '{username,followers_count,media.limit(25){caption,like_count,comments_count,media_type,permalink}}';
    try {
      const res = await fetch(
        `${GRAPH}/${credentials.externalId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(credentials.accessToken)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const body = (await res.json().catch(() => ({}))) as {
        business_discovery?: { username?: string; followers_count?: number; media?: { data?: RawMedia[] } };
        error?: { message?: string };
      };
      const found = body.business_discovery;
      if (!res.ok || !found) {
        logger.info('social: an account could not be read', { username, error: body.error?.message?.slice(0, 200) });
        continue;
      }
      reads.push(rankAccount(found.username ?? username, found.followers_count ?? 0, found.media?.data ?? []));
    } catch (e) {
      logger.info('social: an account could not be read', { username, error: (e as Error).message });
    }
  }
  return reads;
}

/** The accounts, rendered for a prompt: what beat its own normal, with the numbers. Pure. */
export function accountsBlock(accounts: AccountRead[] | undefined): string {
  const lines = (accounts ?? [])
    .filter((a) => a.top.length)
    .map(
      (a) =>
        `@${a.username} (${a.followers.toLocaleString('en-US')} followers, usually ${a.medianEngagement} likes+comments):\n` +
        a.top.map((t) => `  - ${t.multiple}x their normal · ${t.mediaType} · "${t.caption.slice(0, 160)}"`).join('\n'),
    );
  return lines.length
    ? `WHAT IS BEATING ITS OWN NORMAL ON OTHER ACCOUNTS RIGHT NOW (real numbers, read this morning — learn the shape, never copy the post, never name the account):\n${lines.join('\n')}`
    : '';
}
