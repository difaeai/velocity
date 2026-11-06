/**
 * WhatsApp demand reaching drivers: a lead's typed office timings become
 * departures, riders leaving together become one car's alert an hour ahead,
 * and a shared car's alert says it is shared and how full.
 */
import { describe, expect, it } from 'vitest';

import { pktClock, rideLabelFor } from '../alerts';
import { leadTimes } from '../leads';
import { dueGroups, leadLegs } from '../scheduledDemand';

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

describe('scheduled demand', () => {
  // Thursday 5 Nov 2026, 4:00 PM in Pakistan.
  const fourPm = Date.UTC(2026, 10, 5, 11, 0);
  const pin = (lat: number, lng: number, name: string | null = null) => ({ lat, lng, name, address: null });
  const home = pin(33.70, 73.00, 'Street 39');
  const blueArea = pin(33.7100, 73.0600, 'Blue Area');
  const lead = (id: string, office = blueArea, timings = '8am to 5pm') =>
    leadLegs(id, { pickup: home, dropoff: office, timings }, fourPm);

  it('has a trip to the office at the start and home at the end, on the quarter hour', () => {
    const [toWork, toHome] = leadLegs('a', { pickup: home, dropoff: blueArea, timings: '8:05 to 5pm' }, fourPm);
    expect(toWork).toMatchObject({ from: home, to: blueArea, atMs: Date.UTC(2026, 10, 5, 3, 0) });
    expect(toHome).toMatchObject({ from: blueArea, to: home, atMs: Date.UTC(2026, 10, 5, 12, 0) });
  });

  it('has none on Sunday', () => {
    expect(leadLegs('a', { pickup: home, dropoff: blueArea, timings: '9 to 5' }, Date.UTC(2026, 10, 8, 11, 0))).toEqual([]);
  });

  it('puts riders leaving one hour from now near each other in one car, four at most', () => {
    const near = pin(33.7150, 73.0650);
    const far = pin(33.60, 73.10);
    const legs = [
      ...['a', 'b', 'c', 'd', 'e'].flatMap((id) => lead(id)),
      ...lead('f', near),
      ...lead('g', far),
      ...lead('h', blueArea, '9 to 6'),
    ];
    const cars = dueGroups(legs, fourPm).map((c) => c.map((l) => l.id));
    expect(cars).toEqual([['a', 'b', 'c', 'd'], ['e', 'f'], ['g']]);
  });

  it('picks the same hour when the tick is a few seconds early', () => {
    expect(dueGroups(lead('a'), fourPm - 5_000)).toHaveLength(1);
    expect(dueGroups(lead('a'), fourPm + 15 * 60_000)).toHaveLength(0);
  });

  it('says the time on a Pakistani clock', () => {
    expect(pktClock(Date.UTC(2026, 10, 5, 12, 0))).toBe('5:00 PM');
    expect(pktClock(Date.UTC(2026, 10, 5, 3, 30))).toBe('8:30 AM');
  });
});
