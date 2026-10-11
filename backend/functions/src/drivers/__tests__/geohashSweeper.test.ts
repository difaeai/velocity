/**
 * Tests for sweepDriverGeohashes — the job that makes drivers findable by cell.
 *
 * This one job is load-bearing for two separate features: the passenger home
 * map and the ride broadcast both look drivers up through
 * `queryNearbyDriverDocs`, which matches on `drivers/{uid}.geohash` and nothing
 * else. If this sweep stops stamping, both go quiet — no error, no empty-state,
 * just a country with no drivers in it. So what is defended here is the whole
 * contract the query depends on:
 *
 *  - a position becomes a cell, and that cell is the one the query searches by
 *  - a driver with no position is left alone rather than stamped at (0, 0),
 *    which is in the Gulf of Guinea and would put every locationless driver in
 *    the same cell off the coast of Africa
 *  - an unchanged position costs no write, because a parked driver pings the
 *    same spot every 30 s and rewriting that every minute is a write per driver
 *    per minute for nothing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { geohashForLocation } from 'geofire-common';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { queryNearbyDriverDocs } from '../../lib/nearbyDrivers';
import { sweepDriverGeohashes } from '../geohashSweeper';

const sweep = () => sweepDriverGeohashes.run({} as never);

/** Islamabad F-7. */
const HERE = { lat: 33.7100, lng: 73.0550 };
/** ~1.1 km north of HERE. */
const NEAR = { lat: 33.7200, lng: 73.0550 };
/** ~22 km north of HERE. */
const FAR = { lat: 33.9100, lng: 73.0550 };

async function seedDriver(
  uid: string,
  loc: { lat: number; lng: number } | null,
  overrides: Record<string, unknown> = {},
) {
  await db().doc(`drivers/${uid}`).set({
    online: true,
    verificationStatus: 'approved',
    ...(loc ? { lastLocation: loc } : {}),
    lastSeenAt: admin.firestore.Timestamp.now(),
    ...overrides,
  });
}

const cellOf = (uid: string) =>
  db().doc(`drivers/${uid}`).get().then((s) => s.get('geohash') as string | undefined);

describe('sweepDriverGeohashes', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('stamps the cell of the position the handset wrote', async () => {
    await seedDriver('d1', NEAR);

    await sweep();

    expect(await cellOf('d1')).toBe(geohashForLocation([NEAR.lat, NEAR.lng]));
  });

  it('makes a driver findable by the query the map and the broadcast both use', async () => {
    await seedDriver('near', NEAR);
    await seedDriver('far', FAR);

    // Before the sweep neither has a cell, so neither is findable — this is the
    // window a newly-online driver sits in until the next run.
    expect(await queryNearbyDriverDocs(HERE.lat, HERE.lng, 3000)).toHaveLength(0);

    await sweep();

    const found = await queryNearbyDriverDocs(HERE.lat, HERE.lng, 3000);
    expect(found.map((d) => d.id)).toEqual(['near']);
  });

  it('leaves a driver with no position unstamped rather than putting them at (0, 0)', async () => {
    await seedDriver('nowhere', null);

    await sweep();

    expect(await cellOf('nowhere')).toBeUndefined();
  });

  it('rejects a position that is not a usable coordinate', async () => {
    await seedDriver('bad-lat', { lat: 991, lng: 73.05 });
    await seedDriver('bad-lng', { lat: 33.71, lng: -400 });
    await seedDriver('not-a-number', { lat: Number.NaN, lng: 73.05 });

    await sweep();

    expect(await cellOf('bad-lat')).toBeUndefined();
    expect(await cellOf('bad-lng')).toBeUndefined();
    expect(await cellOf('not-a-number')).toBeUndefined();
  });

  it('does not rewrite a driver whose cell is already correct', async () => {
    await seedDriver('parked', NEAR);
    await sweep();

    const after = await db().doc('drivers/parked').get();
    const writeTime = after.updateTime!.toMillis();

    await sweep();

    const again = await db().doc('drivers/parked').get();
    expect(again.updateTime!.toMillis()).toBe(writeTime);
  });

  it('restamps a driver who has moved to another cell', async () => {
    await seedDriver('mover', NEAR);
    await sweep();
    expect(await cellOf('mover')).toBe(geohashForLocation([NEAR.lat, NEAR.lng]));

    await db().doc('drivers/mover').set({ lastLocation: FAR }, { merge: true });
    await sweep();

    expect(await cellOf('mover')).toBe(geohashForLocation([FAR.lat, FAR.lng]));
  });

  it('ignores drivers who are offline or not approved', async () => {
    await seedDriver('offline', NEAR, { online: false });
    await seedDriver('pending', NEAR, { verificationStatus: 'pending' });

    await sweep();

    expect(await cellOf('offline')).toBeUndefined();
    expect(await cellOf('pending')).toBeUndefined();
  });
});
