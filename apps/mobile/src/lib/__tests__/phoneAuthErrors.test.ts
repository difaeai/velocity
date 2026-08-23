import { describe, expect, it } from 'vitest';

import { describePhoneAuthError, phoneAuthErrorMessage } from '../phoneAuthErrors';

/** Shape of what firebase/auth actually throws, for the bits we read. */
function fbError(code: string) {
  const e = new Error(`Firebase: Error (${code}).`);
  (e as Error & { code: string }).code = code;
  return e;
}

/**
 * What @react-native-firebase hands us on Android when the underlying throw is a
 * plain FirebaseException: the code collapses to `auth/unknown` and the real
 * cause survives only on `nativeErrorMessage`.
 */
function nativeError(nativeErrorMessage: string, code = 'auth/unknown') {
  const e = new Error(`[${code}] An internal error has occurred.`);
  Object.assign(e, { code, nativeErrorMessage });
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
    expect(msg).toMatch(/not available/i);
    // Provider disabled is a project setting; "try again shortly" would be a
    // promise the app cannot keep no matter how long the user waits.
    expect(msg).not.toMatch(/try again/i);
    expect(describePhoneAuthError(fbError('auth/operation-not-allowed')).misconfigured).toBe(true);
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

  it('names the console misconfiguration instead of dead-ending on "unknown"', () => {
    const cases: Array<[string, string]> = [
      ['An internal error has occurred. [ Requests from this Android client application are blocked. ]', 'KEY-BLOCKED'],
      ['This app is not authorized to use Firebase Authentication. Please verify that the correct package name, SHA-1, and SHA-256 are configured.', 'APP-UNVERIFIED'],
      ['An internal error has occurred. [ Integrity token was not valid ]', 'INTEGRITY'],
      ['An internal error has occurred. [ API key not valid. Please pass a valid API key. ]', 'KEY-INVALID'],
      ['An internal error has occurred. [ Identitytoolkit API has not been used in project 63950615894 before or it is disabled. ]', 'API-DISABLED'],
    ];
    for (const [native, ref] of cases) {
      const failure = describePhoneAuthError(nativeError(native));
      expect(failure.misconfigured).toBe(true);
      expect(failure.message).toContain(`ref: ${ref}`);
      // The old copy promised a retry would work. It never would.
      expect(failure.message).not.toMatch(/try again/i);
    }
  });

  it('keeps the native text on `detail` so a report can identify the fix', () => {
    const native = 'An internal error has occurred. [ Requests from this Android client application are blocked. ]';
    expect(describePhoneAuthError(nativeError(native)).detail).toBe(native);
  });

  it('never renders the native text in the user-facing sentence', () => {
    const native = 'An internal error has occurred. [ Requests from this Android client application are blocked. ]';
    const { message } = describePhoneAuthError(nativeError(native));
    expect(message).not.toContain('internal error');
    expect(message).not.toContain('Android client');
    expect(message).not.toContain('auth/');
  });

  it('still falls through to the retry sentence for a genuinely unclassified failure', () => {
    const failure = describePhoneAuthError(nativeError('Something nobody has seen before'));
    expect(failure.misconfigured).toBe(false);
    expect(failure.message).toMatch(/try again in a few minutes/i);
  });

  it('does not mistake a throttle for a misconfiguration', () => {
    expect(describePhoneAuthError(fbError('auth/error-code:-39')).misconfigured).toBe(false);
    expect(describePhoneAuthError(fbError('auth/too-many-requests')).misconfigured).toBe(false);
  });
});
