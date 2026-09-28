import { describe, expect, it } from 'vitest';

import { isWarmPing } from '../warmup';

describe('isWarmPing', () => {
  it('recognises the ping the app sends', () => {
    expect(isWarmPing({ warm: true })).toBe(true);
  });

  // A ping short-circuits the whole handler, so anything that merely looks
  // like one must go on to the real checks instead.
  it('refuses anything that is not exactly warm: true', () => {
    expect(isWarmPing({ warm: 'true' })).toBe(false);
    expect(isWarmPing({ warm: 1 })).toBe(false);
    expect(isWarmPing({ phone: '+923001234567' })).toBe(false);
    expect(isWarmPing({})).toBe(false);
    expect(isWarmPing(null)).toBe(false);
    expect(isWarmPing(undefined)).toBe(false);
    expect(isWarmPing('warm')).toBe(false);
  });
});
