/**
 * The rules that keep the business number alive.
 *
 * Every one of these is a way a WhatsApp sender gets itself restricted —
 * messaging people who never agreed, messaging at 3am, messaging the same
 * person six times an hour, or carrying on after Meta has said stop. The tests
 * are written from that angle rather than from the code's: each names the
 * mistake it is there to prevent.
 */
import { describe, it, expect } from 'vitest';

import {
  afterSend,
  blockFanout,
  DEFAULT_ALERT_SETTINGS,
  isQuietHour,
  pktDayKey,
  planFanout,
  readAlertSettings,
  readInboundIntent,
  type CandidateDriver,
  type WhatsAppAlertSettings,
} from '../policy';
import { classifySendError, extractErrorCode, toWhatsAppNumber } from '../client';

/** A live configuration: the feature armed, with the shipped defaults. */
const ON: WhatsAppAlertSettings = { ...DEFAULT_ALERT_SETTINGS, enabled: true };

/** 2026-08-26, 14:00 PKT — a busy weekday afternoon, well outside quiet hours. */
const NOON = Date.UTC(2026, 7, 26, 9, 0, 0);

const OK_CONTEXT = {
  onlineNearby: 0,
  fare: 400,
  sentToday: 0,
  circuitOpen: false,
  configured: true,
};

function driver(over: Partial<CandidateDriver> = {}): CandidateDriver {
  return {
    uid: over.uid ?? 'd1',
    phone: '923001234567',
    distanceKm: 1,
    // Went offline an hour ago, no heartbeat since: the shape of a driver
    // whose app is genuinely shut, which is the only kind this channel is for.
    lastSeenAt: NOON - 60 * 60_000,
    appActiveAt: null,
    alerts: { optIn: true },
    ...over,
  };
}

describe('blockFanout — the gates that cover a whole ride request', () => {
  it('sends nothing at all until somebody arms the feature', () => {
    expect(blockFanout(DEFAULT_ALERT_SETTINGS, OK_CONTEXT, NOON)).toBe('disabled');
  });

  it('stays silent when the credentials are missing rather than half-trying', () => {
    expect(blockFanout(ON, { ...OK_CONTEXT, configured: false }, NOON)).toBe('not-configured');
  });

  it('obeys the circuit breaker above every other consideration', () => {
    // Perfect conditions in every other respect — this must still refuse.
    expect(blockFanout(ON, { ...OK_CONTEXT, circuitOpen: true }, NOON)).toBe('circuit-open');
  });

  it('never wakes anyone at 3am', () => {
    const threeAm = Date.UTC(2026, 7, 26, 22, 0, 0); // 03:00 PKT the next day
    expect(blockFanout(ON, OK_CONTEXT, threeAm)).toBe('quiet-hours');
  });

  it('says nothing when there are already drivers online to take the ride', () => {
    expect(blockFanout(ON, { ...OK_CONTEXT, onlineNearby: 5 }, NOON)).toBe('enough-drivers-online');
  });

  it('stops at the daily platform budget', () => {
    const ctx = { ...OK_CONTEXT, sentToday: DEFAULT_ALERT_SETTINGS.dailyGlobalCap };
    expect(blockFanout(ON, ctx, NOON)).toBe('global-cap');
  });

  it('lets a genuinely unserved ride through', () => {
    expect(blockFanout(ON, OK_CONTEXT, NOON)).toBeNull();
  });
});

describe('isQuietHour', () => {
  it('covers the whole night across the midnight wrap', () => {
    const at = (pktHour: number) => Date.UTC(2026, 7, 26, (pktHour - 5 + 24) % 24, 30);
    expect(isQuietHour(at(23), ON)).toBe(true);
    expect(isQuietHour(at(2), ON)).toBe(true);
    expect(isQuietHour(at(6), ON)).toBe(true);
    expect(isQuietHour(at(7), ON)).toBe(false);
    expect(isQuietHour(at(15), ON)).toBe(false);
  });

  it('treats an empty window as no quiet hours, not as silence all day', () => {
    const s = { ...ON, quietStartHour: 9, quietEndHour: 9 };
    expect(isQuietHour(NOON, s)).toBe(false);
  });
});

describe('planFanout — who actually gets a message', () => {
  it('refuses a driver who never opted in, however perfect a match they are', () => {
    const plan = planFanout([driver({ alerts: {} })], ON, NOON, 10);
    expect(plan.picked).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('not-opted-in');
  });

  it('never messages a number Meta told us to stop using', () => {
    const plan = planFanout([driver({ alerts: { optIn: true, blocked: true } })], ON, NOON, 10);
    expect(plan.picked).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('blocked');
  });

  it('respects the minimum gap between two messages to one person', () => {
    const recent = driver({ alerts: { optIn: true, lastSentAt: NOON - 5 * 60_000 } });
    const plan = planFanout([recent], ON, NOON, 10);
    expect(plan.skipped[0]?.reason).toBe('too-soon');
  });

  it("stops at a driver's daily allowance", () => {
    const maxed = driver({
      alerts: {
        optIn: true,
        sentDay: pktDayKey(NOON),
        sentToday: DEFAULT_ALERT_SETTINGS.maxPerDriverPerDay,
      },
    });
    expect(planFanout([maxed], ON, NOON, 10).skipped[0]?.reason).toBe('driver-daily-cap');
  });

  it("rolls a driver's allowance over at the PKT day boundary", () => {
    const yesterday = driver({
      alerts: { optIn: true, sentDay: '2026-08-25', sentToday: 99 },
    });
    expect(planFanout([yesterday], ON, NOON, 10).picked).toHaveLength(1);
  });

  it('leaves dormant drivers alone — dead numbers are a spam signal', () => {
    const gone = driver({ lastSeenAt: NOON - 60 * 24 * 60 * 60_000 });
    expect(planFanout([gone], ON, NOON, 10).skipped[0]?.reason).toBe('stale');
  });

  it('skips a driver with no usable Pakistani mobile on file', () => {
    expect(planFanout([driver({ phone: null })], ON, NOON, 10).skipped[0]?.reason).toBe('no-phone');
  });

  it('messages the nearest drivers first', () => {
    const far = driver({ uid: 'far', distanceKm: 4 });
    const near = driver({ uid: 'near', distanceKm: 0.4 });
    const mid = driver({ uid: 'mid', distanceKm: 2 });
    const plan = planFanout([far, near, mid], { ...ON, maxRecipientsPerTrip: 2 }, NOON, 10);
    expect(plan.picked.map((p) => p.uid)).toEqual(['near', 'mid']);
  });

  it('caps how many people one ride may wake', () => {
    const many = Array.from({ length: 30 }, (_, i) => driver({ uid: `d${i}`, distanceKm: i * 0.1 }));
    const plan = planFanout(many, ON, NOON, 100);
    expect(plan.picked).toHaveLength(DEFAULT_ALERT_SETTINGS.maxRecipientsPerTrip);
  });

  it('never exceeds what is left of the platform budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => driver({ uid: `d${i}`, distanceKm: i * 0.1 }));
    const plan = planFanout(many, ON, NOON, 3);
    expect(plan.picked).toHaveLength(3);
  });
});

describe('the app-is-closed gate — the one that costs money to get wrong', () => {
  const MIN = 60_000;

  it('says nothing to a driver sitting in the app with the toggle set to Offline', () => {
    // The exact case: they flipped Offline thirty seconds ago and are still
    // holding the phone. The ride is already one tap away on their screen, so a
    // paid WhatsApp message buys nothing and reads as pestering.
    const inApp = driver({ lastSeenAt: NOON - 30_000, appActiveAt: NOON - 20_000 });
    expect(planFanout([inApp], ON, NOON, 10).skipped[0]?.reason).toBe('app-open');
  });

  it('trusts a live heartbeat even when the offline toggle is ancient', () => {
    // Went offline this morning but has the app open right now — browsing
    // earnings, say. Still nothing to tell them.
    const browsing = driver({ lastSeenAt: NOON - 6 * 60 * MIN, appActiveAt: NOON - MIN });
    expect(planFanout([browsing], ON, NOON, 10).skipped[0]?.reason).toBe('app-open');
  });

  it('catches a just-went-offline driver on an app too old to send heartbeats', () => {
    // No appActiveAt at all, but lastSeenAt is stamped by the Offline toggle —
    // which is why both signals are checked rather than only the new one.
    const legacy = driver({ lastSeenAt: NOON - 30_000, appActiveAt: null });
    expect(planFanout([legacy], ON, NOON, 10).skipped[0]?.reason).toBe('app-open');
  });

  it('messages a driver whose app has genuinely been shut a while', () => {
    const gone = driver({ lastSeenAt: NOON - 40 * MIN, appActiveAt: NOON - 40 * MIN });
    expect(planFanout([gone], ON, NOON, 10).picked).toHaveLength(1);
  });

  it('does not silence itself for installs that have never sent a heartbeat', () => {
    // A missing heartbeat must read as "app closed", not as "unknown, stay
    // quiet" — otherwise the feature does nothing for precisely the drivers on
    // older builds it was written for.
    const noHeartbeat = driver({ lastSeenAt: NOON - 3 * 60 * MIN, appActiveAt: null });
    expect(planFanout([noHeartbeat], ON, NOON, 10).picked).toHaveLength(1);
  });

  it('lets the grace period be widened without a deploy', () => {
    const patient = { ...ON, appClosedAfterMinutes: 60 };
    const halfHourAgo = driver({ lastSeenAt: NOON - 30 * MIN, appActiveAt: NOON - 30 * MIN });
    expect(planFanout([halfHourAgo], ON, NOON, 10).picked).toHaveLength(1);
    expect(planFanout([halfHourAgo], patient, NOON, 10).skipped[0]?.reason).toBe('app-open');
  });
});

describe('afterSend', () => {
  it('counts the message against today and starts a fresh day when needed', () => {
    const first = afterSend({ optIn: true, sentDay: '2026-08-25', sentToday: 4 }, NOON);
    expect(first.sentToday).toBe(1);
    expect(first.sentDay).toBe(pktDayKey(NOON));
    expect(afterSend(first, NOON).sentToday).toBe(2);
  });
});

describe('readAlertSettings', () => {
  it('refuses to be armed by a missing document', () => {
    expect(readAlertSettings(null).enabled).toBe(false);
    expect(readAlertSettings({ enabled: 'yes' }).enabled).toBe(false);
  });

  it('clamps a fat-fingered admin edit instead of obeying it', () => {
    const s = readAlertSettings({ enabled: true, maxPerDriverPerDay: 400, radiusKm: 900 });
    expect(s.maxPerDriverPerDay).toBeLessThanOrEqual(10);
    expect(s.radiusKm).toBeLessThanOrEqual(25);
  });

  it('falls back to the default for a value of the wrong type', () => {
    expect(readAlertSettings({ minGapMinutes: 'soon' }).minGapMinutes)
      .toBe(DEFAULT_ALERT_SETTINGS.minGapMinutes);
  });
});

describe('readInboundIntent', () => {
  it('hears STOP however it is typed', () => {
    for (const t of ['STOP', 'stop', ' Stop ', 'unsubscribe', 'BAND', 'بند']) {
      expect(readInboundIntent(t)).toBe('stop');
    }
  });

  it('hears a driver asking to be switched back on', () => {
    expect(readInboundIntent('START')).toBe('start');
    expect(readInboundIntent('chalu karo')).toBe('start');
  });

  it('does not read an opt-out into an ordinary sentence', () => {
    // "Stop" mid-sentence is a driver talking about traffic, not withdrawing
    // consent — and silently losing their alerts is a real cost.
    expect(readInboundIntent('I had to stop for fuel')).toBe('none');
    expect(readInboundIntent('kitna time lagega?')).toBe('none');
  });
});

describe('toWhatsAppNumber', () => {
  it('accepts every shape a Pakistani number gets typed in', () => {
    for (const raw of ['03001234567', '+92 300 1234567', '0092-300-1234567', '3001234567']) {
      expect(toWhatsAppNumber(raw)).toBe('923001234567');
    }
  });

  it('rejects anything that is not a PK mobile, rather than guessing', () => {
    // Landlines and truncated numbers have no WhatsApp; attempting them earns
    // undeliverables, which count against the sender.
    for (const raw of ['0512345678', '923', '', null, undefined, '+1 415 555 0100']) {
      expect(toWhatsAppNumber(raw)).toBeNull();
    }
  });
});

describe('classifySendError — what Meta is really telling us', () => {
  it('halts everything on the codes that precede a ban', () => {
    expect(classifySendError(131048)).toBe('halt'); // spam rate limit
    expect(classifySendError(368)).toBe('halt');    // policy block
    expect(classifySendError(132016)).toBe('halt'); // template disabled
  });

  it('drops a recipient who is not on WhatsApp', () => {
    expect(classifySendError(131026)).toBe('drop-recipient');
  });

  it('backs off without blaming the recipient or the account', () => {
    expect(classifySendError(130429)).toBe('back-off');
  });

  it('does not invent a verdict for a code it does not know', () => {
    // Guessing "halt" would let one odd response silence the platform; guessing
    // "drop-recipient" would quietly lose a real driver.
    expect(classifySendError(999999)).toBe('ignore');
    expect(classifySendError(null)).toBe('ignore');
  });

  it('prefers the specific subcode over the generic outer code', () => {
    const body = { error: { code: 100, error_subcode: 131048, message: 'nope' } };
    expect(extractErrorCode(body)).toBe(131048);
    expect(classifySendError(extractErrorCode(body))).toBe('halt');
  });
});
