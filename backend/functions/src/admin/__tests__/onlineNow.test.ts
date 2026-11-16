/**
 * The ONLINE box: who is online, which area they are in, and the alert that
 * tells each side the other is there.
 *
 * Three things are worth pinning down, because each one is a way this feature
 * quietly becomes useless or harmful:
 *
 *  1. An area name must come from our own map when we have one and fall back to
 *     a city when we do not — never to an empty string, which would group every
 *     unrecognised coordinate in the country into one meaningless row.
 *  2. The row that matters is the one with BOTH sides in it. If sorting ever
 *     puts "forty riders, no cars" above "one rider, one car", the desk stops
 *     seeing the only row it can act on.
 *  3. The automatic alert must not repeat. The cooldown is the difference
 *     between a useful nudge and the reason somebody uninstalls the app, so it
 *     is tested by running the sweep twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { areaKey, areaOf, forgetPlaces, matchedAreas, runAreaAlerts, tallyAreas, UNKNOWN_AREA, type OnlineRow } from '../onlineNow';

const BLUE_AREA = { lat: 33.7089, lng: 73.0551 };

const row = (uid: string, area: string): OnlineRow => ({ uid, name: uid, area, lastSeenMs: 1, phone: null });

describe('areaOf', () => {
  const places = [
    { name: 'Blue Area', lat: 33.7089, lng: 73.0551 },
    { name: 'F-10 Markaz', lat: 33.6938, lng: 73.0119 },
  ];

  it('names the nearest place from our own map', () => {
    expect(areaOf({ lat: 33.6940, lng: 73.0125 }, places)).toBe('F-10 Markaz');
  });

  it('falls back to the city when no named place is close enough', () => {
    // Bahria Town, ~20 km from both pins above.
    expect(areaOf({ lat: 33.5219, lng: 73.0948 }, places)).toBe('Rawalpindi');
  });

  it('says so rather than inventing a name when nothing is near', () => {
    expect(areaOf({ lat: 27.5, lng: 66.0 }, places)).toBe(UNKNOWN_AREA);
  });

  it('works with an empty registry, which is every city on day one', () => {
    expect(areaOf(BLUE_AREA, [])).toBe('Islamabad');
  });
});

describe('tallyAreas', () => {
  it('counts each side per area', () => {
    const areas = tallyAreas([row('d1', 'Blue Area')], [row('p1', 'Blue Area'), row('p2', 'Saddar')]);
    expect(areas.find((a) => a.area === 'Blue Area')).toEqual({ area: 'Blue Area', drivers: 1, passengers: 1 });
    expect(areas.find((a) => a.area === 'Saddar')).toEqual({ area: 'Saddar', drivers: 0, passengers: 1 });
  });

  it('puts an area with both sides above a busier one-sided area', () => {
    const areas = tallyAreas(
      [row('d1', 'Blue Area')],
      [row('p1', 'Blue Area'), ...Array.from({ length: 9 }, (_, i) => row(`p${i + 2}`, 'Saddar'))],
    );
    expect(areas[0].area).toBe('Blue Area');
    expect(matchedAreas(areas).map((a) => a.area)).toEqual(['Blue Area']);
  });
});

describe('areaKey', () => {
  it('makes a field name Firestore can hold', () => {
    expect(areaKey('F-10/4 Markaz, Islamabad')).toBe('f-10-4-markaz-islamabad');
    expect(areaKey('...')).toBe('unknown');
  });
});

describe('runAreaAlerts', () => {
  const now = Date.now();

  beforeEach(async () => {
    await clearFirestore();
    // The registry is cached for ten minutes per instance; a test that seeds
    // places must not be answered from the run before it.
    forgetPlaces();
    await db().doc('drivers/driver-1').set({
      online: true,
      fullName: 'Kamran',
      lastLocation: BLUE_AREA,
      lastSeenAt: new Date(now - 60_000),
    });
    await db().doc('userPresence/rider-1').set({ ...BLUE_AREA, lastSeenAt: new Date(now - 60_000) });
    await db().doc('users/rider-1').set({ displayName: 'Ayesha', role: 'passenger' });
  });

  async function inbox(uid: string) {
    return (await db().collection(`notifications/${uid}/items`).get()).docs.map((d) => d.get('title') as string);
  }

  it('tells both sides about each other, once', async () => {
    expect(await runAreaAlerts(now)).toBe(2);
    expect((await inbox('rider-1'))[0]).toContain('1 driver is online in Islamabad');
    expect((await inbox('driver-1'))[0]).toContain('1 person is using the app in Islamabad');

    // Same area, minutes later: nobody is told anything a second time.
    expect(await runAreaAlerts(now + 60_000)).toBe(0);
    expect(await inbox('rider-1')).toHaveLength(1);
  });

  it('says nothing where only one side is online', async () => {
    await db().doc('userPresence/rider-1').delete();
    expect(await runAreaAlerts(now)).toBe(0);
    expect(await inbox('driver-1')).toHaveLength(0);
  });

  it('stays quiet when the owner has switched it off', async () => {
    await db().doc('adminConfig/areaAlerts').set({ enabled: false });
    expect(await runAreaAlerts(now)).toBe(0);
    expect(await inbox('rider-1')).toHaveLength(0);
  });
});
