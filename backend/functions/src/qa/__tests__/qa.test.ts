/**
 * The testing engine, tested.
 *
 * It watches everything else, so when it is wrong it is wrong silently and in
 * the one place nobody is watching. Three kinds of wrong are worth guarding:
 *
 *  - A LIE IN THE REGISTRY. A contract pointing at a file that no longer
 *    exists, or a diagnosis that claims a cause it has no evidence for.
 *  - A LOG THAT LOSES THINGS. The same bug four hundred times must be one row
 *    with a count; a bug marked fixed that comes back must say so rather than
 *    being quietly re-counted.
 *  - THE TWO HALVES DRIFTING. The app reports feature ids that the backend
 *    registry has to recognise. Nothing at runtime notices when they diverge —
 *    the reports simply start arriving as "unknown feature".
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { pktDayKey } from '../../domain/dailyTarget';
import {
  FEATURE_CONTRACTS,
  diagnose,
  featureContract,
  severityOf,
  unknownFeatureContract,
} from '../features';
import { recordAgentRun, recordFailure, renderPrompt, signatureFor } from '../log';
import { QA_CHECKS, checksDueAt } from '../checks';
import { reportFeatureCheck } from '../report';
import { qaRunChecksNow } from '../agent';

/** Repo root, from backend/functions/src/qa/__tests__. */
const REPO = resolve(__dirname, '../../../../..');

function adminReq<T>(data: T, uid = 'qa-admin'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'admin' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

const today = () => pktDayKey();

describe('the feature registry', () => {
  it('points only at code that exists', () => {
    const missing: string[] = [];
    for (const c of FEATURE_CONTRACTS) {
      for (const path of c.code) {
        if (!existsSync(resolve(REPO, path))) missing.push(`${c.id} → ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has no duplicate ids, and every contract says what it is for', () => {
    const ids = FEATURE_CONTRACTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of FEATURE_CONTRACTS) {
      expect(c.designedTo.length).toBeGreaterThan(20);
      expect(c.code.length).toBeGreaterThan(0);
      expect(c.budgetMs).toBeGreaterThan(1000);
    }
  });

  it('prefers a feature’s own cause over a generic one', () => {
    // "unavailable" on the OTP path is a cold start, which is a real and
    // actionable thing; the shared transport cause would have shrugged at it.
    const otp = featureContract('auth.otp.request')!;
    const cold = diagnose(otp, 'slow', 'deadline-exceeded', 'took ages');
    expect(cold.matched).toBe(true);
    expect(cold.why).toMatch(/cold start/i);
    expect(cold.fix).toMatch(/warm/i);
  });

  it('falls back to the shared causes for plumbing failures', () => {
    const booking = featureContract('booking.request')!;
    const denied = diagnose(booking, 'threw', 'permission-denied', 'Missing permissions');
    expect(denied.matched).toBe(true);
    expect(denied.fix).toMatch(/firestore\.rules/);
  });

  it('says so plainly when it does not recognise a failure', () => {
    const maps = featureContract('platform.maps')!;
    const out = diagnose(maps, 'wrong_result', 'weird-code', 'something nobody has seen');
    expect(out.matched).toBe(false);
    expect(out.why).toMatch(/no known cause/i);
    // And it still tells the reader where to start and how to improve the log.
    expect(out.fix).toContain('apps/mobile/src/ui/LiveMap.tsx');
    expect(out.fix).toMatch(/knownCauses/);
  });

  it('grades a core feature that threw as a blocker, and slowness as degraded', () => {
    const core = featureContract('booking.request')!;
    const normal = featureContract('platform.theme')!;
    expect(severityOf(core, 'threw')).toBe('blocker');
    expect(severityOf(core, 'slow')).toBe('degraded');
    expect(severityOf(normal, 'threw')).toBe('broken');
    expect(severityOf(normal, 'empty')).toBe('degraded');
  });

  it('keeps an unknown id rather than dropping the report', () => {
    const c = unknownFeatureContract('something.new');
    expect(c.id).toBe('something.new');
    expect(c.designedTo).toMatch(/not in the feature registry/i);
  });
});

describe('the app and the backend agree on the feature ids', () => {
  // Read as text on purpose: the app's module cannot be imported here (React
  // Native), and a hand-maintained copy of the list would be the very drift
  // this test exists to catch.
  const source = readFileSync(resolve(REPO, 'apps/mobile/src/lib/featureCheck.ts'), 'utf8');

  it('reports only features this backend knows about', () => {
    const block = source.slice(source.indexOf('export const FEATURE = {'));
    const ids = [...block.slice(0, block.indexOf('} as const')).matchAll(/'([a-z][a-z.]+)'/g)].map(
      (m) => m[1]!,
    );
    expect(ids.length).toBeGreaterThan(10);
    const known = new Set(FEATURE_CONTRACTS.map((c) => c.id));
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
  });

  it('gives every watched callable a feature the registry has', () => {
    const block = source.slice(source.indexOf('const CALLABLE_FEATURE'));
    const mapped = [...block.slice(0, block.indexOf('};')).matchAll(/FEATURE\.(\w+)/g)].map(
      (m) => m[1]!,
    );
    const featureBlock = source.slice(source.indexOf('export const FEATURE = {'));
    const keys = [
      ...featureBlock
        .slice(0, featureBlock.indexOf('} as const'))
        .matchAll(/^\s{2}(\w+):/gm),
    ].map((m) => m[1]!);
    expect(mapped.length).toBeGreaterThan(10);
    expect(mapped.filter((k) => !keys.includes(k))).toEqual([]);
  });
});

describe('the log', () => {
  it('collapses one bug into one id, whatever the message said', () => {
    const a = signatureFor('booking.request', 'threw', 'failed-precondition');
    const b = signatureFor('booking.request', 'threw', 'failed-precondition');
    expect(a).toBe(b);
    // Ids with a slash in them silently become subcollection paths.
    expect(a).not.toContain('/');
    expect(signatureFor('booking.request', 'threw', 'functions/not ok')).not.toContain('/');
    // A different kind of failure on the same feature is a different problem.
    expect(signatureFor('booking.request', 'slow', 'failed-precondition')).not.toBe(a);
  });

  it('writes a brief somebody can act on', () => {
    const contract = featureContract('booking.request')!;
    const prompt = renderPrompt({
      contract,
      kind: 'threw',
      severity: 'blocker',
      source: 'tap',
      day: '2026-10-17',
      at: new Date('2026-10-17T09:30:00Z'),
      count: 412,
      whatHappened: 'createTrip was refused with "failed-precondition".',
      why: 'The pointer is stale.',
      fix: 'Clear it.',
      matched: true,
      evidence: {
        appVersion: '1.18.0 (44)',
        platform: 'android 14',
        screen: '/passenger/booking',
        callable: 'createTrip',
        errorCode: 'failed-precondition',
        errorMessage: 'You already have an active ride.',
        tookMs: 1200,
        samples: ['trips/abc'],
      },
    });

    expect(prompt).toContain('DESIGNED TO');
    expect(prompt).toContain(contract.designedTo);
    expect(prompt).toContain('WHAT HAPPENED INSTEAD');
    expect(prompt).toContain('seen 412×');
    expect(prompt).toContain('14:30 PKT'); // 09:30 UTC in Pakistan
    expect(prompt).toContain('callable createTrip → failed-precondition');
    expect(prompt).toContain('backend/functions/src/trips/index.ts');
    // It has to end as an instruction, or it is a paragraph and not a prompt.
    expect(prompt).toMatch(/Confirm whether that cause is the real one/);
  });

  it('says when no cause matched, so a guess is never read as a finding', () => {
    const contract = featureContract('platform.theme')!;
    const prompt = renderPrompt({
      contract,
      kind: 'wrong_result',
      severity: 'broken',
      source: 'agent',
      day: '2026-10-17',
      at: new Date('2026-10-17T05:00:00Z'),
      count: 1,
      whatHappened: 'x',
      why: 'y',
      fix: 'z',
      matched: false,
      evidence: {},
      checkId: 'some.check',
    });
    expect(prompt).toContain('WHY (no known cause matched)');
    expect(prompt).toContain('found by the testing agent (check some.check)');
    expect(prompt).toContain('Nothing beyond the above was captured.');
  });
});

describe('recording failures', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  const entryRef = (sig: string) => db().doc(`qaLogs/${today()}/entries/${sig}`);

  it('writes one entry, counts the day, and bumps a repeat instead of duplicating it', async () => {
    const contract = featureContract('booking.request')!;
    const input = {
      contract,
      kind: 'threw' as const,
      source: 'tap' as const,
      whatHappened: 'createTrip was refused.',
      evidence: { errorCode: 'failed-precondition' },
    };

    await recordFailure(input);
    await recordFailure(input);

    const sig = signatureFor(contract.id, 'threw', 'failed-precondition');
    const entry = await entryRef(sig).get();
    expect(entry.exists).toBe(true);
    expect(entry.get('count')).toBe(2);
    expect(entry.get('severity')).toBe('blocker');
    expect(entry.get('status')).toBe('open');
    expect(entry.get('prompt')).toContain('DESIGNED TO');

    const day = await db().doc(`qaLogs/${today()}`).get();
    // One distinct problem, two occurrences — that distinction is the whole
    // reason the log is shaped this way.
    expect(day.get('entryCount')).toBe(1);
    expect(day.get('occurrences')).toBe(2);
    expect(day.get('severity.blocker')).toBe(1);
    expect(day.get('areas.Booking')).toBe(1);

    // A different failure on the same feature is its own row.
    await recordFailure({ ...input, kind: 'slow', evidence: {} });
    const after = await db().doc(`qaLogs/${today()}`).get();
    expect(after.get('entryCount')).toBe(2);
  });

  it('reopens a problem that was marked fixed and came back', async () => {
    const contract = featureContract('safety.sos')!;
    const input = {
      contract,
      kind: 'no_effect' as const,
      source: 'agent' as const,
      checkId: 'safety.events.open',
      whatHappened: 'An alert sat open for half an hour.',
    };
    await recordFailure(input);
    const sig = signatureFor(contract.id, 'no_effect', 'safety.events.open');
    await entryRef(sig).update({ status: 'fixed' });

    await recordFailure(input);
    const entry = await entryRef(sig).get();
    expect(entry.get('status')).toBe('open');
    expect(entry.get('reopenedAt')).toBeTruthy();
    const day = await db().doc(`qaLogs/${today()}`).get();
    expect(day.get('reopened')).toBe(1);
  });

  it('records what the agent looked at, including what was fine', async () => {
    await recordAgentRun({
      passed: ['requests.feed.mirror', 'support.unanswered'],
      failed: ['trips.stuck'],
      skipped: [],
      durationMs: 1234,
    });
    const day = await db().doc(`qaLogs/${today()}`).get();
    expect(day.get('agent.checksRun')).toBe(3);
    expect(day.get('agent.passed')).toEqual(['requests.feed.mirror', 'support.unanswered']);
    expect(day.get('agent.failed')).toEqual(['trips.stuck']);
  });
});

describe('reports from the app', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('records a tap that did not do its job', async () => {
    const res = (await reportFeatureCheck.run(
      makeReq(
        {
          reports: [
            {
              featureId: 'platform.theme',
              kind: 'no_effect',
              whatHappened: 'Switching to dark left this screen light.',
              occurrences: 3,
              screen: '/passenger/settings',
            },
          ],
          appVersion: '1.18.0 (44)',
          platform: 'android 14',
        },
        'rider-1',
      ),
    )) as any;
    expect(res.recorded).toBe(1);

    const sig = signatureFor('platform.theme', 'no_effect', null);
    const entry = await db().doc(`qaLogs/${today()}/entries/${sig}`).get();
    expect(entry.get('count')).toBe(3);
    expect(entry.get('source')).toBe('tap');
    expect(entry.get('evidence.screen')).toBe('/passenger/settings');
    expect(entry.get('evidence.appVersion')).toBe('1.18.0 (44)');
    // The diagnosis for a theme switch that did nothing is a known one.
    expect(entry.get('why')).toMatch(/StyleSheet\.create/);
  });

  it('keeps a report for a feature it has never heard of', async () => {
    await reportFeatureCheck.run(
      makeReq(
        {
          reports: [
            { featureId: 'brand.new.thing', kind: 'threw', whatHappened: 'It fell over.' },
          ],
        },
        'rider-2',
      ),
    );
    const sig = signatureFor('brand.new.thing', 'threw', null);
    const entry = await db().doc(`qaLogs/${today()}/entries/${sig}`).get();
    expect(entry.exists).toBe(true);
    expect(entry.get('designedTo')).toMatch(/not in the feature registry/i);
  });

  it('will not let a wrong clock file a report on another day', async () => {
    const nextYear = Date.now() + 365 * 86_400_000;
    await reportFeatureCheck.run(
      makeReq(
        {
          reports: [
            {
              featureId: 'booking.places.search',
              kind: 'empty',
              whatHappened: 'Nothing came back.',
              at: nextYear,
            },
          ],
        },
        'rider-3',
      ),
    );
    const sig = signatureFor('booking.places.search', 'empty', null);
    // Today's log, not next year's.
    expect((await db().doc(`qaLogs/${today()}/entries/${sig}`).get()).exists).toBe(true);
    expect((await db().doc(`qaLogs/${pktDayKey(new Date(nextYear))}`).get()).exists).toBe(false);
  });
});

describe('the agent', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('runs the urgent checks every quarter of an hour and the slow ones on their own clock', () => {
    const everyMin = 15;
    // 03:00 PKT — the three-hourly fuel check is due with everything else.
    const atThree = new Date(Date.parse('2026-10-17T03:00:00Z') - 5 * 3_600_000);
    const dueAtThree = checksDueAt(atThree, everyMin).map((c) => c.id);
    expect(dueAtThree).toContain('safety.events.open');
    expect(dueAtThree).toContain('pricing.fuel.daily');

    // 03:15 PKT — only the quarter-hourly ones.
    const atQuarterPast = new Date(atThree.getTime() + 15 * 60_000);
    const dueLater = checksDueAt(atQuarterPast, everyMin).map((c) => c.id);
    expect(dueLater).toContain('safety.events.open');
    expect(dueLater).not.toContain('pricing.fuel.daily');

    // Every check belongs to a feature the registry knows, or its findings
    // would be filed against a contract that cannot explain them.
    for (const check of QA_CHECKS) {
      expect(featureContract(check.featureId), check.id).not.toBeNull();
    }
  });

  it('catches a booked ride that no driver can see', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await db().doc('trips/invisible-1').set({
      passengerId: 'rider-9',
      status: 'requested',
      createdAt: old,
      pool: false,
    });

    const check = QA_CHECKS.find((c) => c.id === 'requests.feed.mirror')!;
    const finding = await check.run(new Date());
    expect(finding).not.toBeNull();
    expect(finding!.evidence.samples).toContain('trips/invisible-1');
    expect(finding!.whatHappened).toMatch(/no entry in the driver feed/);

    // Give it its mirror and the check goes quiet — a passing check writes
    // nothing at all, which is the point of the whole design.
    await db().doc('openRequests/invisible-1').set({ tripId: 'invisible-1', createdAt: old });
    expect(await check.run(new Date())).toBeNull();
  });

  it('catches a rider locked out of booking by a ride that is over', async () => {
    await db().doc('trips/done-1').set({ status: 'completed', passengerId: 'rider-8' });
    await db().doc('users/rider-8').set({ uid: 'rider-8', activeTripId: 'done-1' });
    await db().doc('users/rider-7').set({ uid: 'rider-7', activeTripId: null });

    const check = QA_CHECKS.find((c) => c.id === 'users.activeTrip.dangling')!;
    const finding = await check.run(new Date());
    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('blocker');
    expect(finding!.evidence.samples).toEqual(['users/rider-8']);
  });

  it('is admins only', async () => {
    await expect(qaRunChecksNow.run(makeReq({}, 'rider-1'))).rejects.toThrow();
    const res = (await qaRunChecksNow.run(adminReq({}))) as unknown as { ran: number };
    expect(res.ran).toBe(QA_CHECKS.length);
  });
});
