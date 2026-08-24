/**
 * Which Pakistan day a moment belongs to.
 *
 * Every number on the dashboard is bucketed by this, so an off-by-one here
 * quietly moves a day's revenue onto the day before. PKT is UTC+05:00 with no
 * daylight saving, which is what makes the arithmetic a fixed offset rather
 * than a timezone library.
 */
import { describe, it, expect } from 'vitest';

import { dayKey } from '../index';

const at = (iso: string) => dayKey(Date.parse(iso));

describe('dayKey', () => {
  it('uses the Pakistan date, not the UTC one', () => {
    // 20:00 UTC is already 01:00 the next morning in Karachi.
    expect(at('2026-08-24T20:00:00Z')).toBe('2026-08-25');
    expect(at('2026-08-24T18:59:59Z')).toBe('2026-08-24');
  });

  it('puts midnight PKT at the start of its own day', () => {
    // 19:00 UTC is exactly 00:00 PKT.
    expect(at('2026-08-23T19:00:00Z')).toBe('2026-08-24');
    expect(at('2026-08-23T18:59:59Z')).toBe('2026-08-23');
  });

  it('rolls month and year boundaries in Pakistan time', () => {
    expect(at('2026-08-31T19:00:00Z')).toBe('2026-09-01');
    expect(at('2026-12-31T19:00:00Z')).toBe('2027-01-01');
    expect(at('2026-12-31T18:00:00Z')).toBe('2026-12-31');
  });

  it('does not shift across a northern-hemisphere DST change', () => {
    // Pakistan has no daylight saving; late March must behave like any other day.
    expect(at('2026-03-29T19:00:00Z')).toBe('2026-03-30');
    expect(at('2026-03-29T18:00:00Z')).toBe('2026-03-29');
  });
});
