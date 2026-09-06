/**
 * "Has this driver photographed the car they are about to drive?"
 *
 * Pure, so it can be tested and so that the answer is computed identically
 * everywhere the app asks: the Online toggle, the home banner, Settings, and the
 * car screens. A screen that decided this for itself would eventually let a
 * driver press Online into a write the security rules then refuse, which reads
 * as a broken button rather than as a rule.
 *
 * THREE implementations of this rule exist and they must agree:
 *   · here — what the app shows and gates on;
 *   · firestore.rules — the gate on flipping `online` to true;
 *   · backend/functions/src/domain/vehicleCheck.ts — the guard on every callable
 *     that hands a driver a passenger.
 */

/**
 * The id the onboarding car is seeded under, and the fallback for a driver whose
 * account predates multiple cars. The backend and the security rules hard-code
 * the same string.
 */
export const PRIMARY_VEHICLE_ID = 'primary';

/**
 * How long a car photo stands. Mirrors VEHICLE_CHECK_TTL_DAYS on the backend and
 * the `duration.value(30, 'd')` in firestore.rules — the app must never tell a
 * driver they are clear to go online when the rules will bounce the write.
 */
export const VEHICLE_CHECK_TTL_DAYS = 30;

const TTL_MS = VEHICLE_CHECK_TTL_DAYS * 24 * 60 * 60 * 1000;

/** The car-photo record as it sits on the driver document. */
export interface VehicleCheck {
  status?: 'pending' | 'approved' | 'rejected';
  vehicleId?: string;
  plate?: string | null;
  photoUrl?: string | null;
  /** Firestore timestamp, as the web SDK hands it back. */
  confirmedAt?: { seconds: number };
  reason?: string | null;
}

/** Why the driver is being asked for a photo — each one gets its own wording. */
export type VehicleCheckReason = 'never' | 'car_changed' | 'expired' | 'rejected' | null;

export interface VehicleCheckStatus {
  /** True when a fresh photo is required before this driver can go online. */
  needsPhoto: boolean;
  reason: VehicleCheckReason;
  /** Whole days the current confirmation still has left (0 once it lapsed). */
  daysLeft: number;
  /** An admin's note when the last photo was turned down. */
  rejectionReason?: string | null;
}

/**
 * Evaluate the car photo on a driver document.
 *
 * `now` is injectable for tests only; every caller in the app leaves it out.
 */
export function evaluateVehicleCheck(
  profile: { vehicleCheck?: VehicleCheck; activeVehicleId?: string } | null | undefined,
  now: number = Date.now(),
): VehicleCheckStatus {
  const check = profile?.vehicleCheck;
  const activeId = profile?.activeVehicleId ?? PRIMARY_VEHICLE_ID;
  const fail = (reason: VehicleCheckReason, rejectionReason?: string | null): VehicleCheckStatus => ({
    needsPhoto: true,
    reason,
    daysLeft: 0,
    rejectionReason: rejectionReason ?? null,
  });

  if (!check?.confirmedAt) return fail('never');
  // A reviewer threw the last photo out: it proves nothing, whatever its age.
  if (check.status === 'rejected') return fail('rejected', check.reason);
  // A photo of the car they used to drive says nothing about this one. A check
  // that names no car at all is treated the same way rather than being assumed
  // to mean the primary one — firestore.rules refuses it outright, and the app
  // must never promise a driver a write the rules will then bounce.
  if (check.vehicleId !== activeId) return fail('car_changed');

  const ageMs = now - check.confirmedAt.seconds * 1000;
  if (ageMs >= TTL_MS) return fail('expired');
  return {
    needsPhoto: false,
    reason: null,
    daysLeft: Math.max(0, Math.ceil((TTL_MS - ageMs) / (24 * 60 * 60 * 1000))),
    rejectionReason: null,
  };
}
