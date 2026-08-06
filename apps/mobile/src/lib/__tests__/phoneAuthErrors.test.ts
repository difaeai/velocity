import { describe, expect, it } from 'vitest';

import { describePhoneAuthError, phoneAuthErrorMessage } from '../phoneAuthErrors';

/** Shape of what firebase/auth actually throws, for the bits we read. */
function fbError(code: string) {
  const e = new Error(`Firebase: Error (${code}).`);
  (e as Error & { code: string }).code = code;
  return e;
}

describe('describePhoneAuthError', () => {
  it('maps the numeric anti-abuse code that used to leak to the login screen', () => {
    const { message, throttled } = describePhoneAuthError(fbError('auth/error-code:-39'));
    expect(throttled).toBe(true);
    expect(message).toMatch(/too many code requests/i);
  });

  it('treats every unmapped numeric code as a throttle, not just -39', () => {
    for (const code of ['auth/error-code:-39', 'auth/error-code:-40', 'auth/error-code:39']) {
      expect(describePhoneAuthError(fbError(code)).throttled).toBe(true);
    }
  });

  it('never leaks an SDK code or the word Firebase into user copy', () => {
    const codes = [
      'auth/error-code:-39',
      'auth/too-many-requests',
      'auth/invalid-phone-number',
      'auth/captcha-check-failed',
      'auth/quota-exceeded',
      'auth/operation-not-allowed',
      'auth/app-not-authorized',
      'auth/network-request-failed',
      'auth/code-expired',
    ];
    for (const code of codes) {
      const msg = phoneAuthErrorMessage(fbError(code));
      expect(msg).not.toContain(code);
      expect(msg).not.toContain('auth/');
      expect(msg).not.toContain('Firebase');
    }
  });

  it('hides console-configuration steps from users but stays truthful', () => {
    const msg = phoneAuthErrorMessage(fbError('auth/operation-not-allowed'));
    expect(msg).not.toMatch(/console/i);
    expect(msg).toMatch(/unavailable/i);
  });

  it('falls back to a friendly sentence with a short support ref', () => {
    const msg = phoneAuthErrorMessage(fbError('auth/internal-error'));
    expect(msg).toMatch(/try again/i);
    expect(msg).toContain('ref: internal-error');
  });

  it('survives a non-Firebase throw', () => {
    expect(phoneAuthErrorMessage(new Error('socket hang up'))).toMatch(/try again/i);
    expect(phoneAuthErrorMessage(null)).toMatch(/try again/i);
    expect(phoneAuthErrorMessage('boom')).toMatch(/try again/i);
  });

  it('does not tell a throttled user to switch numbers — that deepens the ban', () => {
    const msg = phoneAuthErrorMessage(fbError('auth/error-code:-39'));
    expect(msg).toMatch(/another number now will not help/i);
  });
});
