/**
 * The testing log: one day, one problem, one entry — written as a prompt.
 * ----------------------------------------------------------------------------
 * WHY THE LOG IS SHAPED LIKE A PROMPT
 * The point of this log is not to be looked at. It is to be ACTED ON: read in
 * the morning, pasted into Claude Code, fixed. So every entry carries a
 * `prompt` field that is already the whole brief — what the feature was built
 * to do, what it did instead, the best guess at why, what to try, the evidence,
 * and the files to start in. Copy one row, paste it, and work can begin without
 * anybody first reconstructing the context from a stack trace.
 *
 * WHY ONLY FAILURES ARE WRITTEN
 * A feature that works needs nothing from us. Writing a document per healthy
 * tap would cost real money on every ride in the country and would bury the
 * three rows that matter under a hundred thousand that do not. So a passing
 * check writes NOTHING, and the only trace of health is a counter on the day
 * document — which is how the admin page can still say "the agent checked 11
 * things and 9 were fine" without storing a row per success.
 *
 * WHY ONE ENTRY PER SIGNATURE PER DAY
 * A broken button tapped four hundred times is one bug, not four hundred. The
 * signature (feature + failure kind + error code) collapses them into a single
 * row with a count, a first-seen and a last-seen. That keeps the day readable,
 * keeps the writes bounded no matter how badly something breaks, and makes
 * "this happened 412 times today" the headline it deserves to be.
 *
 * SHAPE
 *   qaLogs/{YYYY-MM-DD}                        the day: counters, agent run info
 *   qaLogs/{YYYY-MM-DD}/entries/{signature}    one problem, however often it happened
 *
 * Days are Pakistan days (pktDayKey), because the people reading this log work
 * in Pakistan and a log that rolls over at 5am local is a log nobody can use.
 *
 * Entry ids never contain a slash: a Firestore document id that does would
 * silently become a subcollection path. Everything but [a-z0-9._-] is folded out.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { pktDayKey } from '../domain/dailyTarget';
import {
  type FeatureContract,
  type QaFailureKind,
  type QaSeverity,
  diagnose,
  severityOf,
} from './features';

/** Where the report came from. */
export type QaSource =
  /** A real user tapped a real feature and it did not do its job. */
  | 'tap'
  /** The agent found it while testing on its own. */
  | 'agent';

/** Everything we know about one failure, beyond the narrative. */
export interface QaEvidence {
  appVersion?: string | null;
  platform?: string | null;
  /** The route the user was on, e.g. /passenger/booking. */
  screen?: string | null;
  /** The callable that failed, when one did. */
  callable?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  tookMs?: number | null;
  budgetMs?: number | null;
  /** Free-form, short, strings only — ids, counts, flags. */
  detail?: Record<string, string>;
  /** Documents found in a bad state, as paths. Capped; a count tells the rest. */
  samples?: string[];
}

export interface QaFailureInput {
  contract: FeatureContract;
  kind: QaFailureKind;
  source: QaSource;
  /** What actually happened, in a sentence a human wrote (or the agent did). */
  whatHappened: string;
  evidence?: QaEvidence;
  /** The agent check that found it, for an agent finding. */
  checkId?: string | null;
  /** How many occurrences this one report stands for. Defaults to 1. */
  occurrences?: number;
  /** Overrides the computed severity when a check knows better. */
  severity?: QaSeverity;
  /** The instant it happened; defaults to now. Decides which day it lands in. */
  at?: Date;
}

/** Hard ceiling on distinct problems recorded in one day. */
const MAX_ENTRIES_PER_DAY = 400;
/** Evidence documents kept on an entry. The rest are a number. */
const MAX_SAMPLES = 12;
const MAX_TEXT = 600;

const clip = (s: string, max = MAX_TEXT): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

/**
 * A stable, readable id for "this problem".
 *
 * Readable on purpose: an admin reading the URL of a log entry can tell what it
 * is. The error MESSAGE is deliberately not part of it — messages carry trip ids
 * and names, and including them would turn one bug into a thousand rows.
 */
export function signatureFor(
  featureId: string,
  kind: QaFailureKind,
  errorCodeOrCheckId?: string | null,
): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  const tail = errorCodeOrCheckId ? `__${slug(errorCodeOrCheckId)}` : '';
  return `${slug(featureId)}__${kind}${tail}`.slice(0, 180);
}

/** PKT clock time for a timestamp, for the human-readable part of a prompt. */
function pktTime(at: Date): string {
  return `${new Date(at.getTime() + 5 * 3_600_000).toISOString().slice(11, 16)} PKT`;
}

function evidenceLines(ev: QaEvidence, sampleOverflow: number): string[] {
  const lines: string[] = [];
  const where = [ev.appVersion, ev.platform, ev.screen].filter(Boolean).join(' · ');
  if (where) lines.push(where);
  if (ev.callable) {
    const code = ev.errorCode ? ` → ${ev.errorCode}` : '';
    const msg = ev.errorMessage ? ` "${clip(ev.errorMessage, 200)}"` : '';
    lines.push(`callable ${ev.callable}${code}${msg}`);
  } else if (ev.errorCode || ev.errorMessage) {
    lines.push(`${ev.errorCode ?? 'error'}${ev.errorMessage ? ` "${clip(ev.errorMessage, 200)}"` : ''}`);
  }
  if (typeof ev.tookMs === 'number') {
    const budget = typeof ev.budgetMs === 'number' ? ` (budget ${Math.round(ev.budgetMs / 100) / 10}s)` : '';
    lines.push(`took ${Math.round(ev.tookMs / 100) / 10}s${budget}`);
  }
  for (const [k, v] of Object.entries(ev.detail ?? {})) lines.push(`${k}: ${clip(String(v), 200)}`);
  if (ev.samples?.length) {
    lines.push(`documents: ${ev.samples.join(', ')}${sampleOverflow > 0 ? ` and ${sampleOverflow} more` : ''}`);
  }
  return lines;
}

/**
 * The entry, rendered as the brief somebody will paste into Claude Code.
 *
 * Written in the second person and ending in an instruction, because that is
 * what makes it usable as a prompt rather than as a paragraph about a prompt.
 * It deliberately asks for the cause to be CONFIRMED: the "why" above it is a
 * best guess from a signature match, and a prompt that presents a guess as a
 * finding is how a wrong fix gets made confidently.
 */
export function renderPrompt(args: {
  contract: FeatureContract;
  kind: QaFailureKind;
  severity: QaSeverity;
  source: QaSource;
  day: string;
  at: Date;
  count: number;
  whatHappened: string;
  why: string;
  fix: string;
  matched: boolean;
  evidence: QaEvidence;
  sampleOverflow?: number;
  checkId?: string | null;
}): string {
  const { contract, evidence } = args;
  const seen =
    args.count > 1
      ? `seen ${args.count}× · last at ${pktTime(args.at)}`
      : `at ${pktTime(args.at)}`;
  const found =
    args.source === 'agent'
      ? `found by the testing agent${args.checkId ? ` (check ${args.checkId})` : ''}`
      : 'reported by the app when a user tapped it';

  const ev = evidenceLines(evidence, args.sampleOverflow ?? 0);

  return [
    `Velocity — ${contract.area} · ${contract.title} [${args.severity}]`,
    `${args.day} · ${seen} · ${found}`,
    '',
    'DESIGNED TO',
    contract.designedTo,
    '',
    'WHAT HAPPENED INSTEAD',
    args.whatHappened,
    '',
    args.matched ? 'WHY (matches a failure we have had before)' : 'WHY (no known cause matched)',
    args.why,
    '',
    'WHAT TO TRY',
    args.fix,
    '',
    'EVIDENCE',
    ...(ev.length ? ev : ['Nothing beyond the above was captured.']),
    '',
    'WHERE THE CODE LIVES',
    contract.code.join('\n'),
    '',
    `Confirm whether that cause is the real one, then make "${contract.designedTo}" true again.`,
    'If the cause turns out to be something else, say so and add it to this feature in backend/functions/src/qa/features.ts.',
  ].join('\n');
}

/**
 * Record a failure against a day.
 *
 * Idempotent per signature: the first occurrence writes the entry and moves the
 * day's counters, and every later one bumps a count. An entry an admin had
 * already marked fixed is REOPENED rather than silently counted, because
 * "fixed and came back" is a different and more interesting fact than "still
 * broken".
 *
 * Never throws. A QA engine that can break the feature it is watching is worse
 * than no QA engine, so every failure to write is logged and swallowed.
 */
export async function recordFailure(input: QaFailureInput): Promise<void> {
  try {
    const at = input.at ?? new Date();
    const day = pktDayKey(at);
    const { contract, kind } = input;
    const ev: QaEvidence = { ...(input.evidence ?? {}) };
    const allSamples = ev.samples ?? [];
    const sampleOverflow = Math.max(0, allSamples.length - MAX_SAMPLES);
    ev.samples = allSamples.slice(0, MAX_SAMPLES);
    ev.budgetMs = ev.budgetMs ?? contract.budgetMs;
    if (ev.errorMessage) ev.errorMessage = clip(ev.errorMessage);

    const { why, fix, matched } = diagnose(contract, kind, ev.errorCode, ev.errorMessage);
    const severity = input.severity ?? severityOf(contract, kind);
    const signature = signatureFor(contract.id, kind, ev.errorCode ?? input.checkId ?? null);
    const occurrences = Math.max(1, Math.min(10_000, Math.round(input.occurrences ?? 1)));

    const dayRef = db.doc(`qaLogs/${day}`);
    const entryRef = dayRef.collection('entries').doc(signature);

    await db.runTransaction(async (tx) => {
      const [daySnap, entrySnap] = await Promise.all([tx.get(dayRef), tx.get(entryRef)]);
      const isNew = !entrySnap.exists;

      // A day that has already collected its ceiling of distinct problems stops
      // taking NEW ones but keeps counting the ones it has. Something is very
      // wrong by then, and the log has already said so 400 different ways.
      if (isNew && ((daySnap.get('entryCount') as number | undefined) ?? 0) >= MAX_ENTRIES_PER_DAY) {
        tx.set(
          dayRef,
          { droppedEntries: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        return;
      }

      const count = ((entrySnap.get('count') as number | undefined) ?? 0) + occurrences;
      const prompt = renderPrompt({
        contract,
        kind,
        severity,
        source: input.source,
        day,
        at,
        count,
        whatHappened: input.whatHappened,
        why,
        fix,
        matched,
        evidence: ev,
        sampleOverflow,
        checkId: input.checkId ?? null,
      });

      const wasFixed = entrySnap.exists && entrySnap.get('status') !== 'open';

      tx.set(
        entryRef,
        {
          day,
          featureId: contract.id,
          feature: contract.title,
          area: contract.area,
          designedTo: contract.designedTo,
          code: contract.code,
          source: input.source,
          checkId: input.checkId ?? null,
          kind,
          severity,
          whatHappened: clip(input.whatHappened),
          why,
          fix,
          causeMatched: matched,
          evidence: ev,
          sampleOverflow,
          prompt,
          count,
          status: 'open',
          ...(wasFixed ? { reopenedAt: Timestamp.fromDate(at) } : {}),
          ...(isNew ? { firstSeenAt: Timestamp.fromDate(at) } : {}),
          lastSeenAt: Timestamp.fromDate(at),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        dayRef,
        {
          day,
          occurrences: FieldValue.increment(occurrences),
          // Nested maps, NOT dotted keys. `set` treats "severity.blocker" as a
          // field whose NAME contains a dot, which then reads back as nothing
          // at all: every reader asks for the path severity → blocker. Only
          // `update` interprets a dot as a path separator.
          ...(isNew
            ? {
                entryCount: FieldValue.increment(1),
                severity: { [severity]: FieldValue.increment(1) },
                areas: { [contract.area]: FieldValue.increment(1) },
              }
            : {}),
          ...(wasFixed ? { reopened: FieldValue.increment(1) } : {}),
          lastFailureAt: Timestamp.fromDate(at),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch (e) {
    logger.warn('qa: could not record a failure', { feature: input.contract.id, error: e });
  }
}

/**
 * Note that the agent ran, and what it found — including what it found nothing
 * wrong with.
 *
 * This is the whole record of the healthy features: a list of check ids that
 * passed, overwritten each run, instead of a document per passing check. It is
 * what lets the admin page distinguish "nothing is broken" from "nothing was
 * tested", which are the two things a green screen can otherwise mean.
 */
export async function recordAgentRun(args: {
  at?: Date;
  passed: string[];
  failed: string[];
  skipped: string[];
  durationMs: number;
}): Promise<void> {
  const at = args.at ?? new Date();
  const day = pktDayKey(at);
  try {
    await db.doc(`qaLogs/${day}`).set(
      {
        day,
        agent: {
          lastRunAt: Timestamp.fromDate(at),
          durationMs: Math.round(args.durationMs),
          checksRun: args.passed.length + args.failed.length,
          passed: args.passed.sort(),
          failed: args.failed.sort(),
          skipped: args.skipped.sort(),
        },
        agentRuns: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    logger.warn('qa: could not record the agent run', { error: e });
  }
}

/**
 * Count the taps a feature reported, without storing a document each.
 *
 * Feature ids contain dots and a map key may not, so each one is flattened with
 * underscores — `booking_request`, not `booking.request`. The counter is a
 * nested map rather than dotted keys for the reason given above: a dotted key
 * in a `set` is a field whose name has a dot in it, which nothing can read.
 */
export async function noteTapReports(day: string, perFeature: Record<string, number>): Promise<void> {
  const taps: Record<string, FirebaseFirestore.FieldValue> = {};
  for (const [featureId, n] of Object.entries(perFeature)) {
    taps[featureId.replace(/\./g, '_')] = FieldValue.increment(n);
  }
  try {
    await db.doc(`qaLogs/${day}`).set(
      { day, taps, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (e) {
    logger.warn('qa: could not count tap reports', { error: e });
  }
}
