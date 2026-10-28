/**
 * The parts of the Google Ads connection that decide what the console says
 * and what blended ROAS adds: ids, Google's own error sentence, money out of
 * micros, and the one currency conversion the desk is allowed to make.
 */
import { describe, expect, it } from 'vitest';

import { adsErrorText, customerDigits, dashed, inCurrency, sumMetrics } from '../googleAds';

describe('customer ids', () => {
  it('reads every way Google writes one, and nothing else', () => {
    expect(customerDigits('123-456-7890')).toBe('1234567890');
    expect(customerDigits('customers/1234567890')).toBe('1234567890');
    expect(customerDigits(' 1234567890 ')).toBe('1234567890');
    expect(customerDigits('12345')).toBeNull();
    expect(customerDigits('act_1234567890')).toBeNull();
    expect(dashed('1234567890')).toBe('123-456-7890');
  });
});

describe("Google's sentence", () => {
  it('prefers the per-field error, which is the fixable one', () => {
    const body = {
      error: {
        message: 'The caller does not have permission',
        details: [{ errors: [{ message: 'User does not have permission to access customer.' }] }],
      },
    };
    expect(adsErrorText(body, 403)).toBe('User does not have permission to access customer.');
    expect(adsErrorText({ error: { message: 'Request had invalid authentication credentials.' } }, 401)).toMatch(/invalid authentication/);
    expect(adsErrorText('<html>', 502)).toBe('Google Ads returned HTTP 502.');
  });

  it('says what to do when a Test-access Cloud project reads a real account (v25+)', () => {
    const body = {
      error: {
        message: 'The caller does not have permission',
        details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }, message: 'x' }] }],
      },
    };
    expect(adsErrorText(body, 403)).toMatch(/Explorer access/);
  });
});

describe('money', () => {
  it('sums rows out of micros, treating a missing metric as zero', () => {
    expect(
      sumMetrics([
        { metrics: { costMicros: '2500000', clicks: '10', impressions: '400', conversions: 1.5, conversionsValue: 30 } },
        { metrics: { costMicros: '500000', clicks: '2' } },
        {},
      ]),
    ).toEqual({ spend: 3, clicks: 12, impressions: 400, conversions: 1.5, value: 30 });
  });

  it('converts only between the two currencies it knows, and refuses to guess the rest', () => {
    expect(inCurrency(10, 'PKR', 'PKR')).toBe(10);
    expect(inCurrency(1, 'USD', 'PKR')).toBe(280);
    expect(inCurrency(280, 'PKR', 'USD')).toBe(1);
    expect(inCurrency(1, 'EUR', 'PKR')).toBeNull();
  });
});
