/**
 * The car-photo rule.
 *
 * Worth testing directly because three separate implementations have to agree on
 * it — this one, `firestore.rules`, and the backend guard — and the cost of them
 * disagreeing is a driver pressing Online into a write Firestore silently
 * refuses. Every case below is also a case the security rule has to answer the
 * same way.
 */
import { describe, expect, it } from 'vitest';

import {
  PRIMARY_VEHICLE_ID,
  VEHICLE_CHECK_TTL_DAYS,
  evaluateVehicleCheck,
} from '../vehicleCheck';

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

/** A Firestore timestamp `daysAgo` days before NOW, as the web SDK returns it. */
const at = (daysAgo: number) => ({ seconds: Math.floor((NOW - daysAgo * DAY) / 1000) });

describe('evaluateVehicleCheck', () => {
  it('asks a driver who has never confirmed a car', () => {
    expect(evaluateVehicleCheck(null, NOW)).toMatchObject({ needsPhoto: true, reason: 'never' });
    expect(evaluateVehicleCheck({}, NOW)).toMatchObject({ needsPhoto: true, reason: 'never' });
  });

  it('lets a driver who photographed their car today straight through', () => {
    const status = evaluateVehicleCheck(
      { vehicleCheck: { status: 'pending', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(0) } },
      NOW,
    );
    expect(status.needsPhoto).toBe(false);
    expect(status.daysLeft).toBe(VEHICLE_CHECK_TTL_DAYS);
  });

  it('counts a photo awaiting review, so a shift is never lost to a queue', () => {
    // 'pending' is the state confirmVehiclePhoto writes; the driver drives on it
    // while an admin looks at the picture afterwards.
    expect(
      evaluateVehicleCheck(
        { vehicleCheck: { status: 'pending', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(1) } },
        NOW,
      ).needsPhoto,
    ).toBe(false);
  });

  it('treats a rejected photo as no photo, however recent', () => {
    const status = evaluateVehicleCheck(
      {
        vehicleCheck: {
          status: 'rejected',
          vehicleId: PRIMARY_VEHICLE_ID,
          confirmedAt: at(0),
          reason: 'Plate is unreadable.',
        },
      },
      NOW,
    );
    expect(status).toMatchObject({ needsPhoto: true, reason: 'rejected' });
    expect(status.rejectionReason).toBe('Plate is unreadable.');
  });

  it('asks again after a car switch, because the photo is of the other car', () => {
    expect(
      evaluateVehicleCheck(
        {
          activeVehicleId: 'vehicle-b',
          vehicleCheck: { status: 'approved', vehicleId: 'vehicle-a', confirmedAt: at(0) },
        },
        NOW,
      ),
    ).toMatchObject({ needsPhoto: true, reason: 'car_changed' });
  });

  it('expires exactly on the TTL boundary, not a day either side', () => {
    const dayBefore = evaluateVehicleCheck(
      { vehicleCheck: { status: 'approved', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(VEHICLE_CHECK_TTL_DAYS - 1) } },
      NOW,
    );
    expect(dayBefore.needsPhoto).toBe(false);
    expect(dayBefore.daysLeft).toBe(1);

    expect(
      evaluateVehicleCheck(
        { vehicleCheck: { status: 'approved', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(VEHICLE_CHECK_TTL_DAYS) } },
        NOW,
      ),
    ).toMatchObject({ needsPhoto: true, reason: 'expired', daysLeft: 0 });
  });

  it("clears a driver whose account predates multiple cars", () => {
    // No activeVehicleId: the backend guard and firestore.rules both default it
    // to 'primary'. If this ever disagreed, every driver approved before the
    // vehicles subcollection existed would be locked out of going online.
    expect(
      evaluateVehicleCheck(
        { vehicleCheck: { status: 'approved', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(2) } },
        NOW,
      ).needsPhoto,
    ).toBe(false);
  });

  it('treats a check that names no car as no check', () => {
    // firestore.rules refuses a vehicleCheck missing any of its three fields, so
    // saying "confirmed" here would hand the driver a dead Online button.
    expect(
      evaluateVehicleCheck({ vehicleCheck: { status: 'approved', confirmedAt: at(2) } }, NOW),
    ).toMatchObject({ needsPhoto: true, reason: 'car_changed' });
  });
});
