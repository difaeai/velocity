/**
 * "Locations people are traveling to" (pure logic, no emulator).
 *
 * The callable only ever hands out area names, a head count, a gender tally and
 * a rounded average time, so these tests pin exactly that: addresses collapse
 * to areas, a person is counted once, the average wraps midnight, and "going
 * that way" never counts the rider asking.
 */
import { describe, it, expect } from 'vitest';
import {
  areaLabel,
  averageTime,
  groupAreas,
  parseRoute,
  sameWayRoutes,
  seededRoutes,
  tally,
  type SavedRoute,
} from '../travelAreas';

const F7 = { lat: 33.72, lng: 73.06 };
const BLUE_AREA = { lat: 33.71, lng: 73.08 };
const G11 = { lat: 33.67, lng: 72.99 };

function route(uid: string, time: string | null, from = F7, to = BLUE_AREA): SavedRoute {
  return {
    uid,
    pickup: { ...from, address: from === F7 ? 'House 12, Street 5, F-7/4, Islamabad, Pakistan' : 'G-11/2, Islamabad' },
    dropoff: { ...to, address: to === BLUE_AREA ? 'Shop 3, Blue Area, Islamabad' : 'G-11/2, Islamabad' },
    time,
  };
}

describe('areaLabel', () => {
  it('drops the house, the street and the sub-sector', () => {
    expect(areaLabel('House 12, Street 5, F-7/4, Islamabad, Pakistan')).toBe('F-7');
    expect(areaLabel('140, Street Number 5, Korang Town, Islamabad')).toBe('Korang Town');
    expect(areaLabel('Shop 3, Main Blvd, DHA Phase 2, Lahore')).toBe('DHA Phase 2');
  });
});

describe('averageTime', () => {
  it('rounds to 15 minutes', () => {
    expect(averageTime(['08:00', '08:40'])).toBe('08:15');
  });
  it('wraps midnight instead of averaging to noon', () => {
    expect(averageTime(['23:30', '00:30'])).toBe('00:00');
  });
  it('is null with no times, or times with no mean', () => {
    expect(averageTime([])).toBeNull();
    expect(averageTime(['08:00', '20:00'])).toBeNull();
  });
});

describe('parseRoute', () => {
  it('skips the old (0, 0) placeholder and keeps a missing time as null', () => {
    expect(parseRoute('u', { pickup: { lat: 0, lng: 0, address: 'x' }, dropoff: { ...BLUE_AREA, address: 'y' } })).toBeNull();
    const r = parseRoute('u', { pickup: { ...F7, address: 'F-7' }, dropoff: { ...BLUE_AREA, address: 'Blue Area' }, time: null });
    expect(r?.time).toBeNull();
  });
});

describe('groupAreas', () => {
  const genders = new Map<string, 'male' | 'female' | null>([
    ['a', 'male'], ['b', 'female'], ['c', null], ['d', 'male'],
  ]);

  it('groups by area pair, counts each person once, busiest first', () => {
    const areas = groupAreas(
      [route('a', '08:00'), route('a', '08:30'), route('b', '09:00'), route('c', null), route('d', '07:00', G11, G11)],
      genders,
    );
    expect(areas).toEqual([
      { from: 'F-7', to: 'Blue Area', people: 3, male: 1, female: 1, time: '08:30' },
      { from: 'G-11', to: 'G-11', people: 1, male: 1, female: 0, time: '07:00' },
    ]);
  });

  it('never carries an address or a uid', () => {
    const [row] = groupAreas([route('a', '08:00')], genders);
    expect(JSON.stringify(row)).not.toMatch(/House|Street|Shop|"a"/);
  });
});

describe('seededRoutes', () => {
  it('turns an admin seed into that many people, merged with saved routes', () => {
    const seeds = seededRoutes([
      { pickup: { ...F7, address: 'F-7, Islamabad' }, dropoff: { ...BLUE_AREA, address: 'Blue Area' }, male: 2, female: 1, time: '08:30' },
      { pickup: { lat: 0, lng: 0, address: 'x' }, dropoff: { ...BLUE_AREA, address: 'y' }, male: 5 },
      { pickup: { ...F7, address: 'F-7' }, dropoff: { ...BLUE_AREA, address: 'Blue Area' }, male: -3, female: '4' },
      null,
    ]);
    expect(seeds.routes).toHaveLength(3);
    const genders = new Map([...seeds.genders, ['a', 'male' as const]]);
    expect(groupAreas([route('a', '08:30'), ...seeds.routes], genders)).toEqual([
      { from: 'F-7', to: 'Blue Area', people: 4, male: 3, female: 1, time: '08:30' },
    ]);
  });

  it('is empty when nothing was seeded', () => {
    expect(seededRoutes(undefined).routes).toEqual([]);
  });
});

describe('sameWayRoutes', () => {
  it('counts others on the same pickup and drop-off, never the caller', () => {
    const routes = [route('me', '08:00'), route('a', '08:00'), route('b', null), route('d', '08:00', F7, G11)];
    const same = sameWayRoutes(routes, { from: F7, to: BLUE_AREA }, 'me');
    expect(tally(same, new Map([['a', 'male'], ['b', 'female']]))).toEqual({ people: 2, male: 1, female: 1 });
  });
});
