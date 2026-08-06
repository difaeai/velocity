import { describe, expect, it } from 'vitest';

import {
  MAX_VERIFICATION_AGE_SEC,
  checkExchangeable,
  type PhoneTokenClaims,
} from '../sessionExchange';

const NOW = 1_800_000_000;

function phoneToken(over: Partial<PhoneTokenClaims> = {}): PhoneTokenClaims {
  return {
    phone_number: '+923341015013',
    auth_time: NOW,
    firebase: { sign_in_provider: 'phone' },
    ...over,
  };
}

describe('checkExchangeable', () => {
  it('allows a fresh phone verification', () => {
    expect(checkExchangeable(phoneToken(), NOW)).toBeNull();
  });

  it('allows a verification right up to the age limit', () => {
    expect(checkExchangeable(phoneToken(), NOW + MAX_VERIFICATION_AGE_SEC)).toBeNull();
  });

  // The whole point of the endpoint is that it upgrades *one* specific credential.
  // If any other provider were accepted it would become a privilege-escalation
  // primitive: trade a token you already hold for a session as that same uid.
  it('refuses every provider other than phone', () => {
    for (const provider of ['password', 'google.com', 'apple.com', 'custom', 'anonymous', '']) {
      expect(checkExchangeable(phoneToken({ firebase: { sign_in_provider: provider } }), NOW)).toBe(
        'not-phone',
      );
    }
  });

  it('refuses a token with no provider information at all', () => {
    expect(checkExchangeable(phoneToken({ firebase: undefined }), NOW)).toBe('not-phone');
    expect(checkExchangeable(phoneToken({ firebase: {} }), NOW)).toBe('not-phone');
  });

  it('refuses a phone-provider token that carries no number', () => {
    expect(checkExchangeable(phoneToken({ phone_number: undefined }), NOW)).toBe('not-phone');
    expect(checkExchangeable(phoneToken({ phone_number: '' }), NOW)).toBe('not-phone');
  });

  it('refuses a stale verification, so a leaked token cannot be redeemed later', () => {
    expect(checkExchangeable(phoneToken(), NOW + MAX_VERIFICATION_AGE_SEC + 1)).toBe('stale');
    expect(checkExchangeable(phoneToken(), NOW + 3600)).toBe('stale');
  });

  it('checks the provider before the age, so the reason is never misleading', () => {
    const old = phoneToken({ firebase: { sign_in_provider: 'password' }, auth_time: NOW - 7200 });
    expect(checkExchangeable(old, NOW)).toBe('not-phone');
  });

  it('does not treat a clock skew into the future as stale', () => {
    expect(checkExchangeable(phoneToken({ auth_time: NOW + 30 }), NOW)).toBeNull();
  });
});
