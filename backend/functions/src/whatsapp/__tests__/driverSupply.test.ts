/**
 * WhatsApp demand reaching drivers: a lead's typed office timings become a
 * departure time, and a shared car's alert says it is shared and how full.
 */
import { describe, expect, it } from 'vitest';

import { rideLabelFor } from '../alerts';
import { leadDemand, leadTimes } from '../leads';
import { blockFanout, DEFAULT_ALERT_SETTINGS } from '../policy';

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

describe('leadDemand', () => {
  const pin = (name: string | null, address: string | null) => ({ lat: 33.7, lng: 73.0, name, address });

  it('is the office and the start time, never the home', () => {
    const d = leadDemand({ pickup: pin('Street 39', null), dropoff: pin('PIMS, G-8/3', null), timings: '8am to 6pm' });
    expect(d).toEqual({ pickup: pin('Street 39', null), to: 'PIMS', time: '8:00 AM' });
  });

  it('reads an afternoon start and an office with no name', () => {
    expect(leadDemand({ pickup: pin(null, null), dropoff: pin(null, null), timings: '2 to 10' }))
      .toMatchObject({ to: 'their office', time: '2:00 PM' });
  });

  it('is nothing without a time or both pins', () => {
    expect(leadDemand({ pickup: pin(null, null), dropoff: pin(null, null), timings: 'morning' })).toBeNull();
    expect(leadDemand({ pickup: null, dropoff: pin(null, null), timings: '9 to 5' })).toBeNull();
  });
});

describe('blockFanout for demand', () => {
  const noonPkt = Date.UTC(2026, 10, 5, 7, 0);
  const ctx = { onlineNearby: 0, sentToday: 0, circuitOpen: false, configured: true };

  it('does not judge demand by a fare it does not have', () => {
    const s = { ...DEFAULT_ALERT_SETTINGS, enabled: true, minFare: 300 };
    expect(blockFanout(s, { ...ctx, fare: null }, noonPkt)).toBeNull();
    expect(blockFanout(s, { ...ctx, fare: 200 }, noonPkt)).toBe('fare-too-small');
  });

  it('still keeps quiet at night and stays off until switched on', () => {
    const s = { ...DEFAULT_ALERT_SETTINGS, enabled: true };
    expect(blockFanout(s, { ...ctx, fare: null }, Date.UTC(2026, 10, 5, 20, 0))).toBe('quiet-hours');
    expect(blockFanout(DEFAULT_ALERT_SETTINGS, { ...ctx, fare: null }, noonPkt)).toBe('disabled');
  });
});
