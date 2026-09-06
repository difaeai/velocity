/**
 * The server-side half of the car-photo rule.
 *
 * Three implementations have to agree on this — this guard, `firestore.rules`,
 * and apps/mobile/src/domain/vehicleCheck.ts — and the cost of them disagreeing
 * is a driver being handed a passenger in a car nobody has seen, or being locked
 * out of work they are entitled to. The cases below are the ones the security
 * rule has to answer identically.
 *
 * Pure: no emulator, no Firestore. The snapshot is faked down to the single
 * method the guard uses.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import {
  PRIMARY_VEHICLE_ID,
  VEHICLE_CHECK_TTL_DAYS,
  activeVehicleIdOf,
  isVehicleConfirmed,
} from '../../domain/vehicleCheck';

const DAY = 24 * 60 * 60 * 1000;

/** A driver document that answers `.get('a.b')` the way Firestore does. */
function snap(data: Record<string, unknown>): DocumentSnapshot {
  return {
    get(path: string) {
      return path.split('.').reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
        data,
      );
    },
  } as unknown as DocumentSnapshot;
}

/** A Firestore Timestamp `daysAgo` days old, as the Admin SDK returns one. */
const at = (daysAgo: number) => ({ toMillis: () => Date.now() - daysAgo * DAY });

describe('isVehicleConfirmed', () => {
  it('refuses a driver who has never photographed a car', () => {
    expect(isVehicleConfirmed(snap({}))).toBe(false);
  });

  it('accepts a photo taken today of the car being driven', () => {
    expect(
      isVehicleConfirmed(
        snap({
          activeVehicleId: PRIMARY_VEHICLE_ID,
          vehicleCheck: { status: 'pending', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(0) },
        }),
      ),
    ).toBe(true);
  });

  it('refuses a photo a reviewer threw out, however recent', () => {
    expect(
      isVehicleConfirmed(
        snap({ vehicleCheck: { status: 'rejected', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(0) } }),
      ),
    ).toBe(false);
  });

  it('refuses a photo of the car the driver used to drive', () => {
    expect(
      isVehicleConfirmed(
        snap({
          activeVehicleId: 'vehicle-b',
          vehicleCheck: { status: 'approved', vehicleId: 'vehicle-a', confirmedAt: at(0) },
        }),
      ),
    ).toBe(false);
  });

  it('expires on the TTL boundary and not before it', () => {
    const check = (daysAgo: number) =>
      isVehicleConfirmed(
        snap({ vehicleCheck: { status: 'approved', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(daysAgo) } }),
      );
    expect(check(VEHICLE_CHECK_TTL_DAYS - 1)).toBe(true);
    expect(check(VEHICLE_CHECK_TTL_DAYS + 1)).toBe(false);
  });

  it("falls back to 'primary' for a driver whose account predates multiple cars", () => {
    // No activeVehicleId: firestore.rules defaults it to 'primary' too. If this
    // guard disagreed, every driver approved before the vehicles subcollection
    // existed would be unable to take work.
    expect(activeVehicleIdOf(snap({}))).toBe(PRIMARY_VEHICLE_ID);
    expect(
      isVehicleConfirmed(
        snap({ vehicleCheck: { status: 'approved', vehicleId: PRIMARY_VEHICLE_ID, confirmedAt: at(1) } }),
      ),
    ).toBe(true);
  });

  it('refuses a check that names no car', () => {
    // firestore.rules requires all three fields present; a guard that was more
    // forgiving would clear a driver the rules then refuse to put online.
    expect(isVehicleConfirmed(snap({ vehicleCheck: { status: 'approved', confirmedAt: at(1) } }))).toBe(false);
  });
});
