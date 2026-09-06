/**
 * "Is the car about to arrive the car we told the passenger about?"
 *
 * A driver photographs the car they are driving, and that photo is what stands
 * behind the plate on the passenger's screen. It has to be recent, it has to be
 * of the car currently selected, and it must not have been thrown out by a
 * reviewer — anything else and the plate is a guess.
 *
 * Pure predicates only, with no Firestore access and no callables, so that every
 * path a driver can take work through can import the guard without dragging the
 * vehicle callables in with it. Same shape and the same job as
 * `assertCommissionClear` in ./commission.ts, and applied at the same call sites.
 *
 * THREE PLACES implement this rule and they must agree:
 *   · here — the server guard on every callable that hands a driver a passenger;
 *   · firestore.rules — the gate on flipping `online` to true;
 *   · apps/mobile/src/hooks/driver.ts — what the app shows the driver.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

/** How long a car photo stands before a fresh one is required. */
export const VEHICLE_CHECK_TTL_DAYS = 30;

/**
 * The id the car registered at onboarding is seeded under, and the fallback for
 * a driver whose account predates multiple cars. firestore.rules hard-codes the
 * same string; changing one without the other locks drivers out of going online.
 */
export const PRIMARY_VEHICLE_ID = 'primary';

const TTL_MS = VEHICLE_CHECK_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Whichever car the driver is signed up to be driving right now. */
export function activeVehicleIdOf(driverSnap: DocumentSnapshot): string {
  return (driverSnap.get('activeVehicleId') as string | undefined) ?? PRIMARY_VEHICLE_ID;
}

/** Does this driver have a live photo of the car they have selected? */
export function isVehicleConfirmed(driverSnap: DocumentSnapshot): boolean {
  const status = driverSnap.get('vehicleCheck.status') as string | undefined;
  const vehicleId = driverSnap.get('vehicleCheck.vehicleId') as string | undefined;
  const confirmedAt = driverSnap.get('vehicleCheck.confirmedAt') as
    | { toMillis: () => number }
    | undefined;

  if (!confirmedAt || typeof confirmedAt.toMillis !== 'function') return false;
  if (status === 'rejected') return false;
  // A check that names no car is no check. firestore.rules requires the field to
  // be present too — all three implementations have to refuse the same rows.
  if (vehicleId !== activeVehicleIdOf(driverSnap)) return false;
  return Date.now() - confirmedAt.toMillis() < TTL_MS;
}

/**
 * Guard for taking new work — throws when the car has not been photographed.
 *
 * The security rules already stop an unconfirmed driver going online, and every
 * solo path requires being online. This closes the pool paths, which take a
 * driver on without asking about presence at all: a driver could otherwise be
 * handed four riders while offline in a car nobody has seen.
 */
export function assertVehicleConfirmed(driverSnap: DocumentSnapshot): void {
  if (!isVehicleConfirmed(driverSnap)) {
    throw new HttpsError(
      'failed-precondition',
      'Take a photo of the car you are driving before you accept rides.',
    );
  }
}
