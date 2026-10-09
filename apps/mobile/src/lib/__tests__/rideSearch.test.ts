import { describe, expect, it } from 'vitest';

import {
  clockTime,
  groupRidesByArea,
  humanGap,
  normaliseArea,
  rideMatchesSearch,
  rideSearchMatch,
  rideTimeInfo,
  searchTokens,
  shortAreaName,
  type SearchableRide,
} from '../rideSearch';

/**
 * These helpers decide what the Shared rides screen claims about a car: where
 * it goes, whether it matches what the rider typed, and - the part that can
 * actually mislead someone into standing on a road - when it leaves.
 *
 * The rule the time tests defend: only a driver-posted ride has a real
 * departure time. Everything else is a window, a wait, or nothing, and must be
 * worded as such.
 */

const BASE: SearchableRide = {
  pickupAreaName: 'F-8 Markaz, Islamabad, Pakistan',
  destinationAreaName: 'Blue Area, Islamabad, Pakistan',
  farePerSeat: 250,
  hasDriver: false,
  joinWindowEndsAt: null,
  departureAtMs: null,
  postedAtMs: null,
  expiresAtMs: null,
};

function ride(over: Partial<SearchableRide> = {}): SearchableRide {
  return { ...BASE, ...over };
}

/** A fixed, local-time instant: 2026-10-09 18:00 local. */
const NOW = new Date(2026, 9, 9, 18, 0, 0).getTime();
const MIN = 60_000;

describe('shortAreaName', () => {
  it('keeps the first line of a postal address', () => {
    expect(shortAreaName('Blue Area, Islamabad, Islamabad Capital Territory 44000, Pakistan'))
      .toBe('Blue Area');
    expect(shortAreaName('Saddar, Karachi, Pakistan')).toBe('Saddar');
  });

  it('borrows the next segment when the first is only a number or a plot', () => {
    // "House 12" alone names nowhere a driver could drive to.
    expect(shortAreaName('House 12, Gulberg III, Lahore')).toBe('House 12, Gulberg III');
    expect(shortAreaName('12, Gulberg III, Lahore')).toBe('12, Gulberg III');
  });

  it('survives junk rather than rendering an empty row', () => {
    expect(shortAreaName('')).toBe('Unknown area');
    // Everything was filtered out, so it shows what it was given - a row that
    // says "Pakistan" is poor, a row that says "Unknown area" is worse.
    expect(shortAreaName('Pakistan')).toBe('Pakistan');
    expect(shortAreaName('Clifton')).toBe('Clifton');
  });
});

describe('normaliseArea and searchTokens', () => {
  it('strips case and punctuation so typed and stored spellings meet', () => {
    expect(normaliseArea('F-8 Markaz, Islamabad')).toBe('f 8 markaz islamabad');
    expect(normaliseArea('  Blue   Area!! ')).toBe('blue area');
  });

  it('treats an empty or punctuation-only query as no search at all', () => {
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('   ')).toEqual([]);
    expect(searchTokens(',,,')).toEqual([]);
    expect(searchTokens('Blue Area')).toEqual(['blue', 'area']);
  });
});

describe('rideSearchMatch', () => {
  it('matches the destination and says so', () => {
    expect(rideSearchMatch(ride(), searchTokens('blue area'))).toBe('to');
    expect(rideSearchMatch(ride(), searchTokens('BLUE'))).toBe('to');
  });

  it('matches the pickup end too, because riders search where they stand', () => {
    expect(rideSearchMatch(ride(), searchTokens('f-8'))).toBe('from');
    expect(rideSearchMatch(ride(), searchTokens('markaz'))).toBe('from');
  });

  it('reports "both" when the query only names the city they share', () => {
    expect(rideSearchMatch(ride(), searchTokens('islamabad'))).toBe('both');
  });

  it('requires every token, so a second word narrows instead of widening', () => {
    expect(rideSearchMatch(ride(), searchTokens('blue islamabad'))).toBe('to');
    expect(rideSearchMatch(ride(), searchTokens('blue karachi'))).toBeNull();
    // Tokens must land on the SAME end - a query is one place, not two.
    expect(rideSearchMatch(ride(), searchTokens('blue markaz'))).toBeNull();
  });

  it('matches nothing it was not asked about, and everything when asked nothing', () => {
    expect(rideSearchMatch(ride(), searchTokens('gulberg'))).toBeNull();
    expect(rideMatchesSearch(ride(), [])).toBe(true);
    expect(rideMatchesSearch(ride(), searchTokens('gulberg'))).toBe(false);
  });
});

describe('clockTime and humanGap', () => {
  it('writes a 12-hour clock without leaning on Intl', () => {
    expect(clockTime(new Date(2026, 9, 9, 18, 30).getTime())).toBe('6:30 PM');
    expect(clockTime(new Date(2026, 9, 9, 0, 5).getTime())).toBe('12:05 AM');
    expect(clockTime(new Date(2026, 9, 9, 12, 0).getTime())).toBe('12:00 PM');
    expect(clockTime(new Date(2026, 9, 9, 9, 7).getTime())).toBe('9:07 AM');
  });

  it('keeps a gap short enough to read on one line', () => {
    expect(humanGap(30_000)).toBe('under a minute');
    expect(humanGap(25 * MIN)).toBe('25 min');
    expect(humanGap(2 * 60 * MIN)).toBe('2 h');
    expect(humanGap(125 * MIN)).toBe('2 h 5 min');
    expect(humanGap(26 * 60 * MIN)).toBe('1 day');
  });
});

describe('rideTimeInfo', () => {
  it('prints a clock time only for a scheduled, driver-posted ride', () => {
    const t = rideTimeInfo(ride({ departureAtMs: NOW + 25 * MIN }), NOW);
    expect(t.kind).toBe('scheduled');
    expect(t.label).toBe('Leaves 6:25 PM · in 25 min');
    expect(t.short).toBe('6:25 PM');
    expect(t.sortMs).toBe(NOW + 25 * MIN);
  });

  it('says "leaving now" for a confirmed driver, and never a clock time', () => {
    const t = rideTimeInfo(ride({ hasDriver: true, postedAtMs: NOW - 10 * MIN }), NOW);
    expect(t.kind).toBe('now');
    expect(t.label).toBe('Leaving now');
  });

  it('treats a posted time that has arrived as leaving now, not as late', () => {
    const t = rideTimeInfo(ride({ departureAtMs: NOW - 2 * MIN }), NOW);
    expect(t.kind).toBe('now');
    expect(t.short).toBe('Now');
  });

  it('gives a gathering ride its window, not a departure', () => {
    const t = rideTimeInfo(ride({ joinWindowEndsAt: NOW + 7 * MIN }), NOW);
    expect(t.kind).toBe('window');
    expect(t.label).toBe('Leaves by 6:07 PM · still gathering riders');
  });

  it('is honest that a driverless request is only waiting', () => {
    const t = rideTimeInfo(ride({ expiresAtMs: NOW + 18 * MIN }), NOW);
    expect(t.kind).toBe('waiting');
    expect(t.label).toBe('Waiting for a driver · until 6:18 PM');
  });

  it('falls back to when it was posted, and to nothing at all', () => {
    expect(rideTimeInfo(ride({ postedAtMs: NOW - 6 * MIN }), NOW).label).toBe('Posted 6 min ago');
    expect(rideTimeInfo(ride({ postedAtMs: NOW - 20_000 }), NOW).label).toBe('Posted just now');
    expect(rideTimeInfo(ride(), NOW).kind).toBe('unknown');
  });

  it('prefers the strongest fact when a ride carries several', () => {
    // Scheduled beats a driver; a driver beats a window; a window beats a wait.
    expect(rideTimeInfo(ride({ departureAtMs: NOW + MIN, hasDriver: true }), NOW).kind)
      .toBe('scheduled');
    expect(rideTimeInfo(ride({ hasDriver: true, joinWindowEndsAt: NOW + MIN }), NOW).kind)
      .toBe('now');
    expect(rideTimeInfo(ride({ joinWindowEndsAt: NOW + MIN, expiresAtMs: NOW + 9 * MIN }), NOW).kind)
      .toBe('window');
    // An expired window does not keep a dead ride at the top of the list.
    expect(rideTimeInfo(ride({ joinWindowEndsAt: NOW - MIN, expiresAtMs: NOW + 9 * MIN }), NOW).kind)
      .toBe('waiting');
  });
});

describe('groupRidesByArea', () => {
  const rides = [
    ride({ destinationAreaName: 'Blue Area, Islamabad, Pakistan', farePerSeat: 300, expiresAtMs: NOW + 20 * MIN }),
    ride({
      destinationAreaName: 'Blue Area, Islamabad, Islamabad Capital Territory 44000, Pakistan',
      pickupAreaName: 'G-11 Markaz, Islamabad',
      farePerSeat: 180,
      departureAtMs: NOW + 5 * MIN,
      females: 2,
    }),
    ride({
      destinationAreaName: 'Saddar, Rawalpindi, Pakistan',
      pickupAreaName: 'F-8 Markaz, Islamabad, Pakistan',
      farePerSeat: 400,
      joinWindowEndsAt: NOW + 9 * MIN,
      males: 1,
    }),
  ];

  it('groups two spellings of one destination into one area', () => {
    const groups = groupRidesByArea(rides, NOW);
    expect(groups.map((g) => g.area)).toEqual(['Blue Area', 'Saddar']);
    expect(groups[0]!.rides).toHaveLength(2);
  });

  it('puts the area with the soonest departure first', () => {
    const groups = groupRidesByArea(rides, NOW);
    // Blue Area has a car at 6:05, Saddar's window closes at 6:09.
    expect(groups[0]!.area).toBe('Blue Area');
    expect(groups[0]!.nextLabel).toBe('Leaves 6:05 PM · in 5 min');
    expect(groups[1]!.nextLabel).toBe('Leaves by 6:09 PM · still gathering riders');
  });

  it('reports the cheapest seat, the pickups and the mix of cars', () => {
    const [blue, saddar] = groupRidesByArea(rides, NOW);
    expect(blue!.cheapestFare).toBe(180);
    expect(blue!.pickupAreas).toEqual(['F-8 Markaz', 'G-11 Markaz']);
    expect(blue!.audiences).toEqual({ female: 1, male: 0, mixed: 0, open: 1 });
    expect(saddar!.audiences.male).toBe(1);
  });

  it('never lists the same pickup twice, however it was spelled', () => {
    const groups = groupRidesByArea(
      [
        ride({ pickupAreaName: 'F-8 Markaz, Islamabad, Pakistan' }),
        ride({ pickupAreaName: 'f-8 markaz, Islamabad' }),
      ],
      NOW,
    );
    expect(groups[0]!.pickupAreas).toEqual(['F-8 Markaz']);
  });

  it('returns nothing for nothing', () => {
    expect(groupRidesByArea([], NOW)).toEqual([]);
  });
});
