/**
 * The testing agent: it uses the app's own data to test the app, all day.
 * ----------------------------------------------------------------------------
 * WHAT IT IS
 * A scheduled job that wakes every fifteen minutes, runs whichever checks are
 * due (see checks.ts), and writes a prompt-shaped log entry for each promise the
 * product is not keeping. Nothing else. It cannot change data, it cannot mark
 * anything fixed, and it never writes a row to say a feature was fine.
 *
 * WHY A SCHEDULE AND NOT A TRIGGER
 * A document trigger would be the obvious design and it is the one thing this
 * repo cannot have: CI is unable to grant the Eventarc service-agent roles, so a
 * single onDocument* export makes EVERY function in the codebase undeployable.
 * That is a far worse failure than a checking delay measured in minutes, so the
 * agent polls. Every other background job here does the same, for the same
 * reason.
 *
 * WHY THE CADENCE LIVES IN THE CHECKS
 * Some questions are worth asking every fifteen minutes (is anybody holding an
 * SOS that nobody picked up?) and some once every three hours (did the daily
 * fuel job run?). Waking often and letting each check declare its own interval
 * keeps the urgent ones urgent without asking the expensive ones ninety-six
 * times a day.
 *
 * WHEN THE AGENT ITSELF BREAKS
 * A check that throws is reported as the AGENT failing, never as the feature
 * failing — a missing Firestore index is not a bug in Rapid Response, and a log
 * that says otherwise sends somebody to the wrong file. The run continues:
 * one broken check must not cost the other eight.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { pktDayKey, pktDayStart } from '../domain/dailyTarget';
import { featureContract, unknownFeatureContract } from './features';
import { QA_CHECKS, checksDueAt, type QaCheck } from './checks';
import { recordAgentRun, recordFailure } from './log';

/** How often the agent wakes. The checks' own cadences are rounded to this. */
const WAKE_EVERY_MIN = 15;

/** Stop starting new checks past this, so a slow one cannot outlive the run. */
const RUN_BUDGET_MS = 110_000;

/** Days of log kept. Long enough to see a pattern, short enough to stay cheap. */
const LOG_RETENTION_DAYS = 90;

interface RunSummary {
  passed: string[];
  failed: string[];
  skipped: string[];
  durationMs: number;
}

/**
 * Run a set of checks and record what they found.
 *
 * Shared by the schedule and by the admin's "test everything now" button, so
 * that what an admin sees on demand is exactly what the agent does on its own —
 * two code paths here would mean the button could pass while the agent failed.
 */
async function runChecks(checks: readonly QaCheck[], now: Date): Promise<RunSummary> {
  const started = Date.now();
  const passed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const check of checks) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      skipped.push(check.id);
      continue;
    }
    try {
      const finding = await check.run(now);
      if (!finding) {
        passed.push(check.id);
        continue;
      }
      failed.push(check.id);
      const contract = featureContract(check.featureId) ?? unknownFeatureContract(check.featureId);
      await recordFailure({
        contract,
        kind: finding.kind,
        source: 'agent',
        checkId: check.id,
        severity: finding.severity,
        whatHappened: finding.whatHappened,
        evidence: finding.evidence,
        at: now,
      });
    } catch (e) {
      // The check broke, not the feature. Say so, and attribute it to the agent.
      skipped.push(check.id);
      const message = e instanceof Error ? e.message : String(e);
      logger.error('qa agent: a check failed to run', { check: check.id, error: message });
      await recordFailure({
        contract: featureContract('platform.qa.agent') ?? unknownFeatureContract('platform.qa.agent'),
        kind: 'threw',
        source: 'agent',
        checkId: check.id,
        whatHappened: `The check "${check.title}" could not run, so nothing is known about ${check.featureId} right now. This is the testing agent failing, not that feature.`,
        evidence: {
          errorCode: 'check-threw',
          errorMessage: message,
          detail: { check: check.id, feature: check.featureId },
        },
        at: now,
      });
    }
  }

  return { passed, failed, skipped, durationMs: Date.now() - started };
}

/**
 * The agent proper.
 *
 * Timeout sits above the run budget so a run that hits the budget still gets to
 * write its summary; without that, an overrun would look like a day on which
 * the agent never ran at all.
 */
export const runQaAgent = onSchedule(
  {
    schedule: `every ${WAKE_EVERY_MIN} minutes`,
    timeZone: 'Asia/Karachi',
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async () => {
    const now = new Date();
    const due = checksDueAt(now, WAKE_EVERY_MIN);
    if (due.length === 0) return;

    const summary = await runChecks(due, now);
    await recordAgentRun({ at: now, ...summary });

    logger.info('qa agent ran', {
      day: pktDayKey(now),
      passed: summary.passed.length,
      failed: summary.failed.length,
      skipped: summary.skipped.length,
      ms: summary.durationMs,
    });
  },
);

/**
 * "Test everything now", from the admin's Testing page.
 *
 * Runs every check regardless of cadence. Deliberately available: the honest
 * answer to "is the app healthy right now?" should take one tap, and waiting
 * fifteen minutes to find out is how a release goes out untested.
 */
export const qaRunChecksNow = onCall({ timeoutSeconds: 240, memory: '512MiB' }, async (req) => {
  requireAdmin(req);
  const now = new Date();
  const summary = await runChecks(QA_CHECKS, now);
  await recordAgentRun({ at: now, ...summary });
  return {
    day: pktDayKey(now),
    ran: summary.passed.length + summary.failed.length,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    durationMs: summary.durationMs,
  };
});

/**
 * Throw away logs nobody will read again.
 *
 * Ninety days is enough to tell a recurring bug from a bad afternoon. Entries
 * are deleted before their day document so a half-finished sweep leaves a day
 * that still says how much it once held, rather than an empty day that claims
 * nothing ever happened.
 */
export const sweepQaLogs = onSchedule(
  { schedule: '35 3 * * *', timeZone: 'Asia/Karachi', timeoutSeconds: 300 },
  async () => {
    const cutoffDay = pktDayKey(
      new Date(pktDayStart(pktDayKey()).getTime() - LOG_RETENTION_DAYS * 86_400_000),
    );
    const old = await db
      .collection('qaLogs')
      .where('__name__', '<', db.doc(`qaLogs/${cutoffDay}`))
      .limit(30)
      .get();
    if (old.empty) return;

    let days = 0;
    let entries = 0;
    for (const dayDoc of old.docs) {
      const subs = await dayDoc.ref.collection('entries').limit(400).get();
      if (!subs.empty) {
        const batch = db.batch();
        subs.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        entries += subs.size;
      }
      // Only retire the day once its entries are gone; a day with more than one
      // batch of entries is picked up again by tomorrow's run.
      if (subs.size < 400) {
        await dayDoc.ref.delete();
        days += 1;
      }
    }
    logger.info('qa logs swept', { days, entries, olderThan: cutoffDay });
  },
);
