/**
 * Cost refresh — pull last month's spend from the vendors that will tell us.
 *
 * Writes into `adminConfig/platformCosts` alongside the hand-typed amounts, in
 * a **separate** `fetched` map. The console decides which of the two to show
 * per line, and a fetched figure can never quietly overwrite one a person
 * entered: an admin who pins an amount keeps it until they unpin it. That
 * separation is the whole safety property of this feature — the alternative,
 * one `amount` field written by both a person and a cron job, loses somebody's
 * work the first time a vendor returns something odd.
 *
 * Nothing here is required for the page to work. With no credentials deployed
 * every source reports `not-configured`, the job writes only its status, and
 * the console behaves exactly as it did when every number was typed by hand.
 */
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import {
  anthropicAdminConfig,
  cloudBillingSetting,
  lastCompleteMonth,
  metaCostConfig,
} from './config';
import { fetchAnthropicCost, fetchCloudCosts, fetchMetaCosts, type FetchedAmounts } from './sources';

const REGION = 'asia-south1';
const DOC = db.collection('adminConfig').doc('platformCosts');

type SourceState = 'ok' | 'not-configured' | 'error';

export interface SourceStatus {
  state: SourceState;
  /** Why it failed, or what it could not attribute. Shown in the console. */
  detail?: string;
  lines?: number;
  /** Cloud services that fell through to the catch-all line. */
  unmapped?: string[];
}

export interface RefreshOutcome {
  /** The month every amount covers — `2026-07`. */
  window: string;
  fetchedAt: number;
  sources: Record<'googleCloud' | 'anthropic' | 'meta', SourceStatus>;
  /** How many catalogue lines came back with a number. */
  lines: number;
}

interface FetchedEntry {
  amount: number;
  currency: string;
  source: 'google-cloud' | 'anthropic' | 'meta';
  window: string;
  fetchedAt: number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Ask all three, write what came back.
 *
 * Each vendor is isolated: Anthropic being down has nothing to do with whether
 * the Google numbers are good, and a run that gets two out of three is a
 * successful run. The per-source status is what the console renders, so a
 * half-working configuration explains itself instead of looking broken.
 */
export async function refreshCosts(): Promise<RefreshOutcome> {
  const window = lastCompleteMonth();
  const fetchedAt = Date.now();
  const fetched: Record<string, FetchedEntry> = {};

  const sources: RefreshOutcome['sources'] = {
    googleCloud: { state: 'not-configured' },
    anthropic: { state: 'not-configured' },
    meta: { state: 'not-configured' },
  };

  const absorb = (amounts: FetchedAmounts, source: FetchedEntry['source']): number => {
    let n = 0;
    for (const [id, value] of Object.entries(amounts)) {
      if (!isFinite(value.amount)) continue;
      fetched[id] = {
        // A vendor crediting more than it charged is a real (if rare) outcome;
        // a negative run rate on the dashboard is not a useful way to show it.
        amount: Math.max(0, value.amount),
        currency: value.currency,
        source,
        window: window.label,
        fetchedAt,
      };
      n += 1;
    }
    return n;
  };

  const cloud = cloudBillingSetting();
  if (cloud.state === 'invalid') {
    // A typo must never read as "nobody set this up" — that is the one state
    // an admin would look at and correctly decide there is nothing to do.
    sources.googleCloud = { state: 'error', detail: cloud.detail };
  } else if (cloud.state === 'ok') {
    try {
      const result = await fetchCloudCosts(cloud.config, window);
      const lines = absorb(result.amounts, 'google-cloud');
      sources.googleCloud = {
        state: 'ok',
        lines,
        ...(result.unmapped.length
          ? {
              unmapped: [...new Set(result.unmapped)],
              detail: `${new Set(result.unmapped).size} services landed on the catch-all line.`,
            }
          : {}),
      };
    } catch (e) {
      sources.googleCloud = { state: 'error', detail: message(e) };
      logger.error('costs: Google Cloud fetch failed', { error: message(e) });
    }
  }

  const anthropic = anthropicAdminConfig();
  if (anthropic) {
    try {
      sources.anthropic = { state: 'ok', lines: absorb(await fetchAnthropicCost(anthropic, window), 'anthropic') };
    } catch (e) {
      sources.anthropic = { state: 'error', detail: message(e) };
      logger.error('costs: Anthropic fetch failed', { error: message(e) });
    }
  }

  const meta = metaCostConfig();
  if (meta) {
    try {
      const amounts = await fetchMetaCosts(meta, window);
      const lines = absorb(amounts, 'meta');
      sources.meta = lines
        ? { state: 'ok', lines }
        : {
            state: 'error',
            detail:
              'Meta returned no cost. A WABA billing through a Solution Partner’s credit line never does — ask the partner for those charges.',
          };
    } catch (e) {
      sources.meta = { state: 'error', detail: message(e) };
      logger.error('costs: Meta fetch failed', { error: message(e) });
    }
  }

  const outcome: RefreshOutcome = {
    window: window.label,
    fetchedAt,
    sources,
    lines: Object.keys(fetched).length,
  };

  // mergeFields, not merge: `fetched` is rebuilt whole every run, and a deep
  // merge would leave last month's line for a service that has since stopped
  // costing anything sitting in the total forever.
  await DOC.set(
    { fetched, fetchedAt, fetchWindow: window.label, fetchStatus: sources },
    { mergeFields: ['fetched', 'fetchedAt', 'fetchWindow', 'fetchStatus'] },
  );

  logger.info('costs: refresh complete', outcome);
  return outcome;
}

/**
 * Daily, early. Vendors close a month a few days into the next one, so this
 * runs every day rather than monthly: the first runs of a new month may return
 * a partial figure for the previous one, and the last one to land is right.
 */
export const refreshPlatformCosts = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 300 },
  async () => {
    await refreshCosts();
  },
);

/** The console's "Refresh now" button — same job, on demand, admin only. */
export const adminRefreshPlatformCosts = onCall(
  { region: REGION, timeoutSeconds: 300 },
  async (req): Promise<RefreshOutcome> => {
    requireAdmin(req);
    return refreshCosts();
  },
);
