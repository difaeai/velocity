/**
 * What the app tells us when a tap does not do its job.
 * ----------------------------------------------------------------------------
 * The watcher on the phone (apps/mobile/src/lib/featureCheck.ts) wraps features
 * at the point of use: it times them, catches what they throw, and compares the
 * outcome against what the feature was built to produce. When the promise holds
 * it does nothing at all. When it does not, the report arrives here.
 *
 * WHY REPORTS ARRIVE IN BATCHES
 * The failures worth knowing about cluster — a dead callable fails for the same
 * person three times in ten seconds, and a phone that lost its connection has
 * nothing to send until it comes back. So the watcher queues and flushes, and
 * one call can carry up to twenty reports.
 *
 * EVERYTHING HERE IS A CLAIM, NOT A FACT
 * It comes from a client, so it is rate-limited, length-capped, and its clock is
 * not trusted: a phone whose date is wrong must not be able to write tomorrow's
 * log. Unknown feature ids are kept rather than rejected, because an app build
 * newer than this backend is the normal state of affairs during a rollout and
 * losing its reports is exactly when we would most want them.
 *
 * WHAT IT CANNOT DO
 * It cannot mark anything fixed, it cannot write outside today's log, and no
 * amount of reporting can exceed the day's entry ceiling (see log.ts). A client
 * that decides to shout can make one row say 400, and nothing else.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { pktDayKey } from '../domain/dailyTarget';
import { QA_FAILURE_KINDS, featureContract, unknownFeatureContract } from './features';
import { noteTapReports, recordFailure } from './log';

const reportSchema = z.object({
  featureId: z.string().min(1).max(80),
  kind: z.enum(QA_FAILURE_KINDS as unknown as [string, ...string[]]),
  whatHappened: z.string().min(1).max(400),
  /** The phone's clock, in ms. Clamped — see `instantOf`. */
  at: z.number().int().optional(),
  /**
   * How many identical failures this report stands for.
   *
   * The watcher collapses repeats of the same signature while it waits to
   * flush, so a button tapped nine times in frustration arrives as one report
   * saying nine rather than nine reports saying one.
   */
  occurrences: z.number().int().min(1).max(500).optional(),
  tookMs: z.number().int().min(0).max(600_000).optional(),
  callable: z.string().max(60).optional(),
  errorCode: z.string().max(80).optional(),
  errorMessage: z.string().max(400).optional(),
  screen: z.string().max(80).optional(),
  detail: z.record(z.string().max(200)).optional(),
});

const schema = z.object({
  reports: z.array(reportSchema).min(1).max(20),
  appVersion: z.string().max(40).optional(),
  platform: z.string().max(20).optional(),
});

/**
 * When it happened, as far as we are willing to believe the phone.
 *
 * A client clock is allowed to place a report in the recent past — that is the
 * whole point of a queue that survives being offline — but never in the future
 * and never further back than a day. Anything outside that lands at "now",
 * because a log entry on the wrong day is harder to notice than a slightly
 * misdated one.
 */
function instantOf(clientMs: number | undefined, now: number): Date {
  if (typeof clientMs !== 'number' || !Number.isFinite(clientMs)) return new Date(now);
  if (clientMs > now || clientMs < now - 86_400_000) return new Date(now);
  return new Date(clientMs);
}

export const reportFeatureCheck = onCall(async (req) => {
  const ctx = requireAuth(req);
  // Generous enough for a phone coming back from a tunnel with a full queue,
  // tight enough that a loop cannot pay for itself in log writes.
  await rateLimit(ctx.uid, 'reportFeatureCheck', 30, 300);

  const parsed = schema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid report.');
  const { reports, appVersion, platform } = parsed.data;

  const now = Date.now();
  const perFeature: Record<string, number> = {};

  for (const r of reports) {
    const contract = featureContract(r.featureId) ?? unknownFeatureContract(r.featureId);
    const occurrences = r.occurrences ?? 1;
    perFeature[r.featureId] = (perFeature[r.featureId] ?? 0) + occurrences;
    await recordFailure({
      contract,
      kind: r.kind as (typeof QA_FAILURE_KINDS)[number],
      source: 'tap',
      whatHappened: r.whatHappened,
      occurrences,
      at: instantOf(r.at, now),
      evidence: {
        appVersion: appVersion ?? null,
        platform: platform ?? null,
        screen: r.screen ?? null,
        callable: r.callable ?? null,
        errorCode: r.errorCode ?? null,
        errorMessage: r.errorMessage ?? null,
        tookMs: r.tookMs ?? null,
        detail: { ...(r.detail ?? {}), lastReportedBy: ctx.uid },
      },
    });
  }

  await noteTapReports(pktDayKey(new Date(now)), perFeature);
  return { recorded: reports.length };
});
