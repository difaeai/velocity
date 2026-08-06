import { describe, expect, it } from 'vitest';

import {
  DEVICE_KEY,
  EMPTY_LOG,
  MAX_SENDS_PER_DEVICE,
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
    const log = recordSend(EMPTY_LOG, NUM, T0);
    expect(evaluateSend(log, NUM, T0 + 30_000)).toEqual({ allowed: true });
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
    // Spaced 10 minutes apart so the ladder is satisfied and only the cap can bite.
    const log = sendTimes(EMPTY_LOG, NUM, MAX_SENDS_PER_NUMBER, T0, 10 * 60_000);
    const now = T0 + MAX_SENDS_PER_NUMBER * 10 * 60_000;
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
      now += 60_000;
    }
    const d = evaluateSend(log, '3009999999', now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('capped');
  });

  it('forgets everything once the hour is up', () => {
    const log = sendTimes(EMPTY_LOG, NUM, MAX_SENDS_PER_NUMBER, T0, 10 * 60_000);
    const wellAfter = T0 + MAX_SENDS_PER_NUMBER * 10 * 60_000 + WINDOW_MS;
    expect(evaluateSend(log, NUM, wellAfter)).toEqual({ allowed: true });
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
