/**
 * Velocity's own map, and the one property that makes it legal.
 *
 * Everything in `velocityLocations` is permanent, which is only defensible
 * because every coordinate in it is a first-party measurement. The tests that
 * matter most here are therefore not about caching behaviour but about
 * provenance and about who gets served: a Google coordinate must not be able to
 * reach this collection, and an unverified guess must not be able to reach a
 * passenger.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  LOCATIONS_COLLECTION,
  VERIFY_AFTER_CONFIRMATIONS,
  cityFor,
  countByStatus,
  lookupOwnPlace,
  metresBetween,
  observePlace,
  resolveOwnPlace,
  searchOwnPlaces,
  velocityLocationId,
} from '../registry';

/** F-7 Markaz, Islamabad. */
const F7 = { lat: 33.7196, lng: 73.0724 };

async function confirmTimes(name: string, coord: { lat: number; lng: number }, times: number) {
  for (let i = 0; i < times; i++) {
    await observePlace({ ...coord, name, source: 'trip_gps', tripId: `trip-${name}-${i}` });
  }
}

beforeEach(async () => {
  await clearFirestore();
});

describe('velocityLocationId', () => {
  it('is stable for the same place, so an upsert cannot duplicate it', () => {
    expect(velocityLocationId('F-7 Markaz, Islamabad', 'ISB')).toBe(
      velocityLocationId('f 7 markaz islamabad', 'ISB'),
    );
  });

  it('is readable — it turns up in the admin desk and in support chats', () => {
    expect(velocityLocationId('F-7 Markaz', 'ISB')).toMatch(/^VL-ISB-[0-9A-F]{6}$/);
  });

  it('falls back to a country code when the place is not near a city', () => {
    expect(velocityLocationId('Somewhere remote', null)).toMatch(/^VL-PAK-[0-9A-F]{6}$/);
  });

  it('separates two different places', () => {
    expect(velocityLocationId('F-7 Markaz', 'ISB')).not.toBe(velocityLocationId('F-8 Markaz', 'ISB'));
  });
});

describe('cityFor', () => {
  it('names the city a point sits in', () => {
    expect(cityFor(F7)?.name).toBe('Islamabad');
    expect(cityFor({ lat: 24.8607, lng: 67.0011 })?.name).toBe('Karachi');
  });

  it('returns null out in the country rather than guessing the nearest metro', () => {
    // Middle of Balochistan — hundreds of km from anything in the table.
    expect(cityFor({ lat: 27.5, lng: 64.0 })).toBeNull();
  });
});

describe('observePlace — provenance', () => {
  it('refuses a coordinate that did not come from one of our own devices', async () => {
    // The whole point of the collection. A Google coordinate in here would be a
    // licence breach with no expiry and no way to notice it later, so the door
    // throws rather than logging and carrying on.
    await expect(
      observePlace({
        name: 'F-7 Markaz',
        ...F7,
        // Simulates a caller inventing a provenance, e.g. from a geocoder.
        source: 'google_geocode' as unknown as 'trip_gps',
      }),
    ).rejects.toThrow(/first-party/i);

    expect((await db().collection(LOCATIONS_COLLECTION).get()).size).toBe(0);
  });

  it('accepts an admin pin — a human taking responsibility is a valid source', async () => {
    const id = await observePlace({ name: 'Rider pickup point', ...F7, source: 'admin_pin' });
    expect(id).not.toBeNull();
    expect((await db().collection(LOCATIONS_COLLECTION).doc(id!).get()).get('coordSource')).toBe(
      'admin_pin',
    );
  });

  it('never stores a coordinate outside Pakistan', async () => {
    // A zeroed or swapped lat/lng is the usual way this happens, and it would put
    // a pin in the Gulf of Guinea.
    expect(await observePlace({ name: 'Broken fix', lat: 0, lng: 0, source: 'trip_gps' })).toBeNull();
    expect(await observePlace({ name: 'Swapped', lat: 73.07, lng: 33.71, source: 'trip_gps' })).toBeNull();
  });

  it('ignores a name too short to be a place', async () => {
    expect(await observePlace({ name: 'F7', ...F7, source: 'trip_gps' })).toBeNull();
  });
});

describe('observePlace — learning where a place is', () => {
  it('starts a new place as pending, not verified', async () => {
    const id = await observePlace({ name: 'Giga Mall', ...F7, source: 'trip_gps', tripId: 't1' });
    const doc = await db().collection(LOCATIONS_COLLECTION).doc(id!).get();
    expect(doc.get('status')).toBe('pending');
    expect(doc.get('confirmations')).toBe(1);
  });

  it('verifies a place once enough separate trips agree', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('Giga Mall', 'ISB');
    expect((await db().collection(LOCATIONS_COLLECTION).doc(id).get()).get('status')).toBe('verified');
  });

  it('will not let one trip confirm the same place twice', async () => {
    // The sweep overlaps its own window on purpose, so it re-reads trips it has
    // already processed. Those must not inflate the confidence in a place.
    for (let i = 0; i < 4; i++) {
      await observePlace({ name: 'Giga Mall', ...F7, source: 'trip_gps', tripId: 'same-trip' });
    }
    const id = velocityLocationId('Giga Mall', 'ISB');
    const doc = await db().collection(LOCATIONS_COLLECTION).doc(id).get();
    expect(doc.get('confirmations')).toBe(1);
    expect(doc.get('status')).toBe('pending');
  });

  it('averages nearby fixes, so the point settles where cars actually stop', async () => {
    const id = velocityLocationId('Jinnah Super', 'ISB');
    // Two fixes ~60 m apart along a frontage.
    await observePlace({ name: 'Jinnah Super', lat: 33.7196, lng: 73.0724, source: 'trip_gps', tripId: 'a' });
    await observePlace({ name: 'Jinnah Super', lat: 33.7201, lng: 73.0728, source: 'trip_gps', tripId: 'b' });

    const doc = await db().collection(LOCATIONS_COLLECTION).doc(id).get();
    const lat = doc.get('lat') as number;
    expect(lat).toBeGreaterThan(33.7196);
    expect(lat).toBeLessThan(33.7201);
  });

  it('does not let a distant fix inside the same city drag the point off the map', async () => {
    const id = velocityLocationId('Blue Area office', 'ISB');
    await observePlace({ name: 'Blue Area office', ...F7, source: 'trip_gps', tripId: 'a' });
    // ~4 km away, still Islamabad, so it lands on the same row. It counts as a
    // visit but gets no vote on where the pin sits — the honest reading is that
    // somebody was dropped somewhere else and called it the same thing.
    await observePlace({
      name: 'Blue Area office',
      lat: 33.6844,
      lng: 73.0479,
      source: 'trip_gps',
      tripId: 'b',
    });

    const doc = await db().collection(LOCATIONS_COLLECTION).doc(id).get();
    expect(doc.get('lat')).toBeCloseTo(F7.lat, 4);
    expect(doc.get('lng')).toBeCloseTo(F7.lng, 4);
    expect(doc.get('confirmations')).toBe(2);
  });

  it('keeps same-named places in different cities apart', async () => {
    // Saddar is in Islamabad, Rawalpindi and Karachi, and they are not the same
    // place. Because the city code is part of the id, one name in two cities lands
    // on two rows without anybody having to notice — which is also why the test
    // above had to pick two points inside one city to exercise the centroid guard.
    await observePlace({ name: 'Saddar', ...F7, source: 'trip_gps', tripId: 'isb' });
    await observePlace({ name: 'Saddar', lat: 33.5651, lng: 73.0169, source: 'trip_gps', tripId: 'rwp' });

    const isb = await db().collection(LOCATIONS_COLLECTION).doc(velocityLocationId('Saddar', 'ISB')).get();
    const rwp = await db().collection(LOCATIONS_COLLECTION).doc(velocityLocationId('Saddar', 'RWP')).get();

    expect(isb.exists).toBe(true);
    expect(rwp.exists).toBe(true);
    expect(isb.get('city')).toBe('Islamabad');
    expect(rwp.get('city')).toBe('Rawalpindi');
    expect(isb.get('confirmations')).toBe(1);
    expect(rwp.get('confirmations')).toBe(1);
  });

  it('keeps a rejected place rejected however many cars go there', async () => {
    const id = velocityLocationId('Bad name', 'ISB');
    await observePlace({ name: 'Bad name', ...F7, source: 'trip_gps', tripId: 'a' });
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ status: 'rejected' }, { merge: true });

    await confirmTimes('Bad name', F7, VERIFY_AFTER_CONFIRMATIONS + 2);

    expect((await db().collection(LOCATIONS_COLLECTION).doc(id).get()).get('status')).toBe('rejected');
  });

  it('records a place id when one is known, and never overwrites it with nothing', async () => {
    const id = velocityLocationId('Centaurus', 'ISB');
    await observePlace({ name: 'Centaurus', ...F7, source: 'trip_gps', placeId: 'ChIJcent', tripId: 'a' });
    // A later trip whose booking carried no place id tells us nothing about the
    // one we already have.
    await observePlace({ name: 'Centaurus', ...F7, source: 'trip_gps', placeId: null, tripId: 'b' });

    expect((await db().collection(LOCATIONS_COLLECTION).doc(id).get()).get('placeId')).toBe('ChIJcent');
  });
});

describe('lookupOwnPlace — what the app is allowed to be served', () => {
  it('answers for a verified place, with no Google call in sight', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);

    const hit = await lookupOwnPlace('giga mall');
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeCloseTo(F7.lat, 4);
    expect(hit!.velocityId).toBe(velocityLocationId('Giga Mall', 'ISB'));
  });

  it('refuses a place only one or two trips have seen', async () => {
    // A pending row is a guess. Sending a passenger to a guess to save half a cent
    // is the wrong trade, so the resolver falls through to Google instead.
    await observePlace({ name: 'Giga Mall', ...F7, source: 'trip_gps', tripId: 'a' });
    expect(await lookupOwnPlace('Giga Mall')).toBeNull();
  });

  it('matches regardless of how the name was punctuated or capitalised', async () => {
    await confirmTimes('F-7 Markaz, Islamabad', F7, VERIFY_AFTER_CONFIRMATIONS);
    expect(await lookupOwnPlace('  f 7   MARKAZ islamabad ')).not.toBeNull();
  });

  it('matches an alias an operator added', async () => {
    await confirmTimes('F-7 Markaz, Islamabad', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('F-7 Markaz, Islamabad', 'ISB');
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ aliases: ['jinnah super'] }, { merge: true });

    const hit = await lookupOwnPlace('Jinnah Super');
    expect(hit?.velocityId).toBe(id);
  });

  it('misses cleanly on a place we have never driven to', async () => {
    expect(await lookupOwnPlace('somewhere nobody has been')).toBeNull();
  });

  it('ignores a query too short to mean anything', async () => {
    expect(await lookupOwnPlace('f7')).toBeNull();
  });
});

describe('countByStatus', () => {
  it('counts the desk summary', async () => {
    await observePlace({ name: 'Pending place', ...F7, source: 'trip_gps', tripId: 'p1' });
    await confirmTimes('Verified place', F7, VERIFY_AFTER_CONFIRMATIONS);

    const counts = await countByStatus();
    expect(counts.verified).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.rejected).toBe(0);
  });
});

describe('metresBetween', () => {
  it('measures a known Islamabad hop', () => {
    // F-10 to F-7 is roughly 7 km.
    const d = metresBetween({ lat: 33.6938, lng: 72.9989 }, F7);
    expect(d).toBeGreaterThan(6_000);
    expect(d).toBeLessThan(8_500);
  });

  it('is zero for a point against itself', () => {
    expect(metresBetween(F7, F7)).toBeCloseTo(0, 5);
  });
});

/**
 * Autocomplete from our own map. This is where the money is: every keystroke that
 * reaches Google is billed, and a suggestion served from here never will be.
 *
 * The rules that matter are about what must NOT be suggested — an unverified guess,
 * or a row with no coordinate — because a bad suggestion at the top of the list is
 * how somebody ends up at the wrong place, and that is worse than a paid call.
 */
describe('searchOwnPlaces', () => {
  it('suggests a verified place from a prefix of its name', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);

    const hits = await searchOwnPlaces('giga');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe('Giga Mall');
    expect(hits[0]!.lat).toBeCloseTo(F7.lat, 4);
    expect(hits[0]!.velocityId).toBe(velocityLocationId('Giga Mall', 'ISB'));
    expect(hits[0]!.city).toBe('Islamabad');
  });

  it('never suggests a place only one or two trips have seen', async () => {
    await observePlace({ name: 'Giga Mall', ...F7, source: 'trip_gps', tripId: 'a' });
    expect(await searchOwnPlaces('giga')).toEqual([]);
  });

  it('never suggests a rejected place', async () => {
    await confirmTimes('Bad name here', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('Bad name here', 'ISB');
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ status: 'rejected' }, { merge: true });

    expect(await searchOwnPlaces('bad name')).toEqual([]);
  });

  it('matches an alias an operator added', async () => {
    await confirmTimes('F-7 Markaz, Islamabad', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('F-7 Markaz, Islamabad', 'ISB');
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ aliases: ['jinnah super'] }, { merge: true });

    const hits = await searchOwnPlaces('jinnah super');
    expect(hits.map((h) => h.velocityId)).toEqual([id]);
  });

  it('does not return the same place twice when name and alias both match', async () => {
    await confirmTimes('Jinnah Super Market', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('Jinnah Super Market', 'ISB');
    // The alias is also a prefix of the name, so both queries find this row.
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ aliases: ['jinnah super market'] }, { merge: true });

    const hits = await searchOwnPlaces('jinnah super market');
    expect(hits).toHaveLength(1);
  });

  it('respects the limit, so it can never outgrow the dropdown', async () => {
    for (const n of ['Mall One', 'Mall Two', 'Mall Three', 'Mall Four', 'Mall Five', 'Mall Six']) {
      await confirmTimes(n, F7, VERIFY_AFTER_CONFIRMATIONS);
    }
    expect((await searchOwnPlaces('mall', 5)).length).toBeLessThanOrEqual(5);
  });

  it('ignores a query too short to mean anything', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);
    expect(await searchOwnPlaces('gi')).toEqual([]);
  });

  it('is a prefix search, and does not pretend otherwise', async () => {
    // "mall" will not find "Giga Mall". That is the honest limit of a query this
    // cheap, and exactly why the caller still asks Google when we come up short.
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);
    expect(await searchOwnPlaces('mall')).toEqual([]);
  });
});

describe('resolveOwnPlace', () => {
  it('resolves one of our suggestions with no Google call in sight', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('Giga Mall', 'ISB');

    const got = await resolveOwnPlace(id);
    expect(got).toMatchObject({ velocityId: id, address: 'Giga Mall' });
    expect(got!.lat).toBeCloseTo(F7.lat, 4);
  });

  it('refuses a place that stopped being verified between the suggestion and the tap', async () => {
    await confirmTimes('Giga Mall', F7, VERIFY_AFTER_CONFIRMATIONS);
    const id = velocityLocationId('Giga Mall', 'ISB');
    await db().collection(LOCATIONS_COLLECTION).doc(id).set({ status: 'rejected' }, { merge: true });

    expect(await resolveOwnPlace(id)).toBeNull();
  });

  it('returns null for an id we have never heard of', async () => {
    expect(await resolveOwnPlace('VL-ISB-DEADBE')).toBeNull();
  });
});
