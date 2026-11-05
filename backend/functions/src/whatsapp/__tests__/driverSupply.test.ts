/**
 * WhatsApp demand reaching drivers: a lead's typed office timings become a
 * departure time, and a shared car's alert says it is shared and how full.
 */
import { describe, expect, it } from 'vitest';

import { rideLabelFor } from '../alerts';
import { leadTimes } from '../leads';

describe('leadTimes', () => {
  it.each([
    ['8am to 6pm', '08:00', '18:00'],
    ['9 to 5', '09:00', '17:00'],
    ['09:00-17:00', '09:00', '17:00'],
    ['9:30 am - 6:30 pm', '09:30', '18:30'],
    ['9.30 to 5.30', '09:30', '17:30'],
    ['2 to 10', '14:00', '22:00'],
    ['12pm to 8pm', '12:00', '20:00'],
    ['Mon to Fri 9am to 5pm, 6 days', '09:00', '17:00'],
  ])('reads %s', (typed, start, end) => {
    expect(leadTimes(typed)).toEqual({ start, end });
  });

  it('keeps a start with no end', () => {
    expect(leadTimes('9am')).toEqual({ start: '09:00', end: null });
  });

  it('gives up on words and impossible hours', () => {
    expect(leadTimes('morning')).toBeNull();
    expect(leadTimes(null)).toBeNull();
    expect(leadTimes('25 to 99')).toBeNull();
  });
});

describe('rideLabelFor', () => {
  it('is the car alone for a solo ride', () => {
    expect(rideLabelFor('ac')).toBe('AC car');
  });

  it('says shared, how many and where for a shared car', () => {
    expect(rideLabelFor('mini', { riders: 3, to: 'PIMS, G-8/3, Islamabad' })).toBe('shared Mini, 3 riders to PIMS');
    expect(rideLabelFor('mini', { riders: 1 })).toBe('shared Mini, 1 rider');
  });
});
