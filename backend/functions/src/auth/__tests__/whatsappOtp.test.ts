import { describe, expect, it } from 'vitest';

import {
  CODE_LENGTH,
  MAX_ATTEMPTS,
  type ChallengeState,
  checkChallenge,
  generateCode,
  hashCode,
  readOtpSettings,
} from '../whatsappOtp';

const NOW = 1_800_000_000_000;
const CHALLENGE = 'abc123';
const PHONE = '923001234567';
const CODE = '045912';

function live(over: Partial<ChallengeState> = {}): ChallengeState {
  return {
    codeHash: hashCode(CHALLENGE, PHONE, CODE),
    attempts: 0,
    consumed: false,
    validUntilMs: NOW + 60_000,
    ...over,
  };
}

const right = () => hashCode(CHALLENGE, PHONE, CODE);
const wrong = () => hashCode(CHALLENGE, PHONE, '000000');

describe('generateCode', () => {
  it('is always exactly CODE_LENGTH digits', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateCode()).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
    }
  });

  // Dropping leading zeros would shrink the space AND make short codes
  // recognisable on sight, so padding is a security property, not formatting.
  it('pads rather than truncating small draws', () => {
    const codes = Array.from({ length: 2000 }, generateCode);
    expect(codes.every((c) => c.length === CODE_LENGTH)).toBe(true);
    // 2000 draws from a million: a repeat is possible but a constant is not.
    expect(new Set(codes).size).toBeGreaterThan(1000);
  });
});

describe('hashCode', () => {
  it('is deterministic for the same challenge, number and code', () => {
    expect(hashCode(CHALLENGE, PHONE, CODE)).toBe(hashCode(CHALLENGE, PHONE, CODE));
  });

  it('never stores the code itself', () => {
    expect(hashCode(CHALLENGE, PHONE, CODE)).not.toContain(CODE);
  });

  // Each of the three inputs is bound in for a reason: without the challenge id
  // a hash could be replayed against a later challenge, and without the number
  // it could be replayed against a different person's.
  it('differs when any one input differs', () => {
    const base = hashCode(CHALLENGE, PHONE, CODE);
    expect(hashCode('other', PHONE, CODE)).not.toBe(base);
    expect(hashCode(CHALLENGE, '923009999999', CODE)).not.toBe(base);
    expect(hashCode(CHALLENGE, PHONE, '045913')).not.toBe(base);
  });
});

describe('checkChallenge', () => {
  it('accepts the right code on a live challenge', () => {
    expect(checkChallenge(live(), right(), NOW)).toBe('ok');
  });

  it('rejects the wrong code without killing the challenge', () => {
    expect(checkChallenge(live(), wrong(), NOW)).toBe('wrong');
  });

  it('expires exactly at validUntilMs', () => {
    expect(checkChallenge(live({ validUntilMs: NOW + 1 }), right(), NOW)).toBe('ok');
    expect(checkChallenge(live({ validUntilMs: NOW }), right(), NOW)).toBe('expired');
  });

  // The one rule the whole scheme rests on: six digits are only safe because
  // guessing stops.
  it('locks after MAX_ATTEMPTS wrong guesses, even for the right code', () => {
    expect(checkChallenge(live({ attempts: MAX_ATTEMPTS - 1 }), wrong(), NOW)).toBe('wrong');
    expect(checkChallenge(live({ attempts: MAX_ATTEMPTS }), right(), NOW)).toBe('locked');
  });

  it('refuses a code that has already been redeemed', () => {
    expect(checkChallenge(live({ consumed: true }), right(), NOW)).toBe('spent');
  });

  // Order matters: a dead challenge must never report on the digits, or the
  // attempt cap can be sidestepped by reading which refusal comes back.
  it('reports the challenge as dead before it reports on the code', () => {
    expect(checkChallenge(live({ consumed: true }), wrong(), NOW)).toBe('spent');
    expect(checkChallenge(live({ validUntilMs: NOW - 1 }), wrong(), NOW)).toBe('expired');
    expect(checkChallenge(live({ attempts: MAX_ATTEMPTS }), wrong(), NOW)).toBe('locked');
  });

  it('prefers spent over expired for a redeemed, aged-out challenge', () => {
    expect(checkChallenge(live({ consumed: true, validUntilMs: NOW - 1 }), right(), NOW)).toBe(
      'spent',
    );
  });

  it('never matches an empty stored hash', () => {
    expect(checkChallenge(live({ codeHash: '' }), right(), NOW)).toBe('wrong');
  });
});

describe('readOtpSettings', () => {
  // Unlike the alerts settings this defaults ON: the switch that actually gates
  // the feature is whether an approved template is configured.
  it('is enabled by default and on an empty document', () => {
    expect(readOtpSettings(null).enabled).toBe(true);
    expect(readOtpSettings({}).enabled).toBe(true);
  });

  it('honours an explicit disable', () => {
    expect(readOtpSettings({ enabled: false }).enabled).toBe(false);
  });

  it('falls back to defaults for values of the wrong shape', () => {
    const s = readOtpSettings({ dailyCap: 'lots', maxSendsPerNumberPerHour: null });
    expect(s.dailyCap).toBe(3_000);
    expect(s.maxSendsPerNumberPerHour).toBe(10);
  });

  // Below the app's own MAX_SENDS_PER_NUMBER this becomes the limit users
  // actually hit, and hitting it costs them an hour locked out of SMS too.
  it('defaults in step with the client-side send brake', () => {
    expect(readOtpSettings(null).maxSendsPerNumberPerHour).toBe(10);
  });

  // Clamped on READ, so a bad admin edit can never become a bad send — the same
  // posture as readAlertSettings.
  it('clamps out-of-range edits instead of trusting them', () => {
    expect(readOtpSettings({ dailyCap: -10 }).dailyCap).toBe(0);
    expect(readOtpSettings({ dailyCap: 10_000_000 }).dailyCap).toBe(100_000);
    expect(readOtpSettings({ maxSendsPerNumberPerHour: 0 }).maxSendsPerNumberPerHour).toBe(1);
    expect(readOtpSettings({ maxSendsPerNumberPerHour: 999 }).maxSendsPerNumberPerHour).toBe(20);
  });

  it('reads a zero daily cap as a real stop, not as missing', () => {
    expect(readOtpSettings({ dailyCap: 0 }).dailyCap).toBe(0);
  });
});
