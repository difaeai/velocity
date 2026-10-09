import { describe, expect, it } from 'vitest';

import {
  POOL_AUDIENCE_LABEL,
  poolAudience,
  type PoolAudience,
} from '../genderAccess';

/**
 * `poolAudience` decides which heading a shared car is listed under — the
 * women's pools, the men's pools, the mixed ones, or the empty ones anyone may
 * start. It is presentation only: `canJoinPool` still decides who may actually
 * take the seat, and the server has already dropped the rows this rider cannot.
 *
 * What it must never do is contradict that gate. A car labelled "Women" that a
 * man can join, or one labelled "Mixed" that is actually same-gender-only, is
 * worse than no label — the heading is what riders choose on before they read
 * the row, and in Pakistan that choice is the whole reason pooling is usable.
 */
describe('poolAudience', () => {
  it('follows the hard preference whether or not anyone is aboard', () => {
    expect(poolAudience({ genderPref: 'female_only', males: 0, females: 0 })).toBe('female');
    expect(poolAudience({ genderPref: 'male_only', males: 0, females: 0 })).toBe('male');
    // Even a seat already taken by the other gender does not relabel the car:
    // the preference is the rule the join gate enforces, so it is the rule the
    // heading must report.
    expect(poolAudience({ genderPref: 'female_only', males: 2, females: 0 })).toBe('female');
  });

  it('reads an unrestricted pool off who is actually in it', () => {
    expect(poolAudience({ males: 0, females: 0 })).toBe('open');
    expect(poolAudience({ males: 2, females: 0 })).toBe('male');
    expect(poolAudience({ males: 0, females: 2 })).toBe('female');
    expect(poolAudience({ males: 1, females: 1 })).toBe('mixed');
  });

  it('calls a single-rider car that rider\'s own, not "open"', () => {
    // This is the case that matters most. One man aboard means a woman needs her
    // mixed-ride opt-in to join, so listing it as "open" would promise a seat
    // the rules may refuse. One rider is already a gendered car.
    expect(poolAudience({ males: 1, females: 0 })).toBe('male');
    expect(poolAudience({ males: 0, females: 1 })).toBe('female');
  });

  it('treats a missing count as zero rather than guessing', () => {
    expect(poolAudience({})).toBe('open');
    expect(poolAudience({ females: 1 })).toBe('female');
    expect(poolAudience({ genderPref: 'any' })).toBe('open');
  });

  it('ignores a preference value it does not recognise', () => {
    // Older documents and future values must fall through to the counts, never
    // to a heading that claims a restriction nothing is enforcing.
    expect(poolAudience({ genderPref: 'everyone', males: 0, females: 2 })).toBe('female');
    expect(poolAudience({ genderPref: '', males: 1, females: 1 })).toBe('mixed');
  });

  it('has a heading for every audience it can return', () => {
    const all: PoolAudience[] = ['female', 'male', 'mixed', 'open'];
    for (const a of all) {
      expect(POOL_AUDIENCE_LABEL[a]).toBeTruthy();
    }
  });
});
