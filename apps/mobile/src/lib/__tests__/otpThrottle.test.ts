import { describe, expect, it } from 'vitest';

import {
  COOLDOWN_LADDER_S,
  DEVICE_KEY,
  LONGEST_COOLDOWN_S,
  EMPTY_LOG,
  MAX_SENDS_PER_DEVICE,
  MAX_SENDS_PER_DEVICE_HARD,
  MAX_SENDS_PER_NUMBER,
  WINDOW_MS,
  describeDecision,
  evaluateSend,
  formatWait,
  pruneLog,
  recordSend,
  recordThrottle,
  type OtpSendLog,
} from '../otpThrottle';

const T0 = 1_800_000_000_000;
const NUM = '3341015013';

/**
 * A gap wide enough that the cooldown ladder is always satisfied, yet narrow
 * enough that a full hour's worth of sends still lands inside WINDOW_MS. The
 * caps are counted over a sliding hour, so a test that spaces its sends too
 * far apart stops testing the cap and starts testing the window.
 */
const SPACED_MS = 4 * 60_000;

/** Sends `n` codes for `key`, each `gapMs` apart, starting at `start`. */
function sendTimes(log: OtpSendLog, key: string, n: number, start: number, gapMs: number) {
  let out = log;
  for (let i = 0; i < n; i++) out = recordSend(out, key, start + i * gapMs);
  return out;
}

describe('evaluateSend', () => {
  it('allows the very first send', () => {
    expect(evaluateSend(EMPTY_LOG, NUM, T0)).toEqual({ allowed: true });
  });

  it('blocks the panic double-tap right after a send', () => {
    const log = recordSend(EMPTY_LOG, NUM, T0);
    const d = evaluateSend(log, NUM, T0 + 2_000);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('cooldown');
  });

  it('opens up again once the ladder gap has passed', () => {
    // Read off the ladder rather than copied from it: the second rung is a
    // product decision that gets retuned, and a test that hardcodes today's
    // value fails on the next tuning without anything actually being wrong.
    const secondRungMs = (COOLDOWN_LADDER_S[1] ?? 0) * 1000;
    const log = recordSend(EMPTY_LOG, NUM, T0);
    expect(evaluateSend(log, NUM, T0 + secondRungMs - 1).allowed).toBe(false);
    expect(evaluateSend(log, NUM, T0 + secondRungMs)).toEqual({ allowed: true });
  });

  it('demands a longer gap each time, so retries get slower not faster', () => {
    let log = recordSend(EMPTY_LOG, NUM, T0);
    let now = T0 + 30_000;
    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      log = recordSend(log, NUM, now);
      // Walk forward until the brake lets go, and note how long that took.
      let wait = 0;
      while (!evaluateSend(log, NUM, now + wait).allowed && wait < WINDOW_MS) wait += 1_000;
      gaps.push(wait);
      now += wait;
    }
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(gaps.at(-1)).toBeGreaterThan(gaps[0] ?? 0);
  });

  it('caps a single number for the rest of the hour', () => {
    // Spaced so the ladder is satisfied and only the cap can bite.
    const log = sendTimes(EMPTY_LOG, NUM, MAX_SENDS_PER_NUMBER, T0, SPACED_MS);
    const now = T0 + MAX_SENDS_PER_NUMBER * SPACED_MS;
    const d = evaluateSend(log, NUM, now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('capped');
      expect(d.waitMs).toBeGreaterThan(0);
    }
  });

  it('stops a user cycling SIMs from throttling the whole device', () => {
    let log = EMPTY_LOG;
    let now = T0;
    // A different number every time, so the per-number cap can never fire.
    for (let i = 0; i < MAX_SENDS_PER_DEVICE; i++) {
      log = recordSend(log, `30012345${String(i).padStart(2, '0')}`, now);
      now += 10_000;
    }
    // A RETRY — this number has already been through the device today, so the
    // device cap is exactly the thing that should stop it.
    const d = evaluateSend(log, `30012345${String(MAX_SENDS_PER_DEVICE - 1).padStart(2, '0')}`, now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('capped');
  });

  it('never makes a new person wait behind somebody else queue', () => {
    // A signup desk: one handset, MAX_SENDS_PER_DEVICE people already served
    // this hour. The next person in the queue is not a retry and must not be
    // treated as one — their first code goes out.
    let log = EMPTY_LOG;
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_DEVICE; i++) {
      log = recordSend(log, `30012345${String(i).padStart(2, '0')}`, now);
      now += 10_000;
    }
    expect(evaluateSend(log, '3009999999', now)).toEqual({ allowed: true });
  });

  it('still refuses everyone once the hard device ceiling is reached', () => {
    let log = EMPTY_LOG;
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_DEVICE_HARD; i++) {
      log = recordSend(log, `3001${String(i).padStart(6, '0')}`, now);
      now += 5_000;
    }
    const d = evaluateSend(log, '3009999999', now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('capped');
  });

  it('a Firebase throttle on one number never blocks a different one', () => {
    // The device-wide block is what used to spread one number punishment across
    // everybody sharing the handset.
    const log = recordThrottle(EMPTY_LOG, NUM, T0, 60 * 60_000);
    expect(evaluateSend(log, '3009999999', T0 + 60_000)).toEqual({ allowed: true });
  });

  it('forgets everything once the hour is up', () => {
    const log = sendTimes(EMPTY_LOG, NUM, MAX_SENDS_PER_NUMBER, T0, SPACED_MS);
    const wellAfter = T0 + MAX_SENDS_PER_NUMBER * SPACED_MS + WINDOW_MS;
    expect(evaluateSend(log, NUM, wellAfter)).toEqual({ allowed: true });
  });

  it('leaves room for a genuinely bad SMS night', () => {
    // The complaint the raised ceiling answers: five codes were gone before the
    // network had delivered one, and the app — not Firebase — was what said no.
    // Six honest, ladder-respecting retries must still get through.
    let log = EMPTY_LOG;
    let now = T0;
    for (let i = 0; i < 6; i++) {
      expect(evaluateSend(log, NUM, now).allowed).toBe(true);
      log = recordSend(log, NUM, now);
      now += SPACED_MS;
    }
  });

  it('never makes anyone wait longer than the ladder itself promises', () => {
    // The ladder is allowed to be retuned; what must stay true is that no
    // retry is ever charged MORE than its own top rung. A bug in the index
    // arithmetic is exactly how a user ends up waiting an hour for a code the
    // ladder says costs five minutes.
    let log = EMPTY_LOG;
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_NUMBER - 1; i++) {
      log = recordSend(log, NUM, now);
      let wait = 0;
      while (!evaluateSend(log, NUM, now + wait).allowed && wait < WINDOW_MS) wait += 1_000;
      expect(wait).toBeLessThanOrEqual(LONGEST_COOLDOWN_S * 1000);
      now += wait;
    }
  });
});

describe('recordThrottle', () => {
  it('serves a Firebase throttle locally instead of retrying into it', () => {
    const log = recordThrottle(EMPTY_LOG, NUM, T0, 60 * 60_000);
    const d = evaluateSend(log, NUM, T0 + 60_000);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('throttled');
  });

  it('outranks the cooldown reason, so the copy names the real cause', () => {
    let log = recordSend(EMPTY_LOG, NUM, T0);
    log = recordThrottle(log, NUM, T0, 60 * 60_000);
    const d = evaluateSend(log, NUM, T0 + 1_000);
    if (!d.allowed) expect(d.reason).toBe('throttled');
  });

  it('lifts when the penalty expires', () => {
    const log = recordThrottle(EMPTY_LOG, NUM, T0, 10 * 60_000);
    expect(evaluateSend(log, NUM, T0 + 11 * 60_000)).toEqual({ allowed: true });
  });

  it('does not block a different number', () => {
    const log = recordThrottle(EMPTY_LOG, NUM, T0, 60 * 60_000);
    expect(evaluateSend(log, '3009999999', T0 + 1_000)).toEqual({ allowed: true });
  });
});

describe('pruneLog', () => {
  it('keeps persisted state bounded', () => {
    const log = sendTimes(EMPTY_LOG, NUM, 3, T0, 1_000);
    // Past the window for the *newest* entry, so nothing at all should survive.
    const pruned = pruneLog(log, T0 + 2_000 + WINDOW_MS + 1);
    expect(pruned.sends).toEqual({});
    expect(pruned.blockedUntil).toEqual({});
  });

  it('tolerates a half-written or legacy record', () => {
    expect(pruneLog({} as OtpSendLog, T0)).toEqual({ sends: {}, blockedUntil: {} });
  });

  it('records every send against the device tally too', () => {
    const log = recordSend(EMPTY_LOG, NUM, T0);
    expect(log.sends[DEVICE_KEY]).toEqual([T0]);
  });
});

describe('formatWait', () => {
  it('speaks in units a user can act on', () => {
    expect(formatWait(1_000)).toBe('1 second');
    expect(formatWait(30_000)).toBe('30 seconds');
    expect(formatWait(4 * 60_000)).toBe('4 minutes');
    expect(formatWait(60 * 60_000)).toBe('about 1 hour');
  });
});

describe('describeDecision', () => {
  it('says nothing when the send is allowed', () => {
    expect(describeDecision({ allowed: true })).toBeNull();
  });

  it('always gives the user a time to come back at', () => {
    for (const reason of ['throttled', 'cooldown', 'capped'] as const) {
      const msg = describeDecision({ allowed: false, reason, waitMs: 90_000 });
      expect(msg).toMatch(/minutes?|seconds?|hours?/);
    }
  });
});
