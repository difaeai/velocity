/**
 * "Does this driver owe today's face check?"
 *
 * The first time a driver opens the app each day they look into the front
 * camera for a few seconds, and the frames are compared with the face enrolled
 * when their application was approved. Papers prove who an account belongs to
 * on the day it is granted; this is what keeps answering the question
 * afterwards, when the phone could be in anybody's hands.
 *
 * Pure, so the answer is computed identically everywhere the app asks: the
 * driver layout that sends them to the camera, the Online toggle, and the home
 * banner. A screen that decided this for itself would eventually send a driver
 * into a write the security rules then refuse, which reads as a broken button
 * rather than as a rule.
 *
 * THREE implementations of this rule exist and they must agree:
 *   · here — what the app shows and gates on;
 *   · firestore.rules — the backstop on flipping `online` to true;
 *   · backend/functions/src/domain/faceCheckIn.ts — the guard on every callable
 *     that hands a driver a passenger, and the only authority on the answer.
 *
 * THE DAY IS PAKISTAN'S, not the handset's. A phone set to another timezone
 * would otherwise disagree with the server about when "today" started and ask
 * for a second check at an hour that makes no sense to the driver.
 */

/** Pakistan Standard Time, UTC+05:00. No DST. Mirrors the backend. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Which Pakistan day an instant falls in, as `YYYY-MM-DD`. */
export function pktDayKey(at: Date = new Date()): string {
  return new Date(at.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export type FaceCheckInStatus = 'passed' | 'review' | 'failed';

/** Why the driver is being asked — each one gets its own sentence on screen. */
export type FaceCheckInReason = 'never' | 'new_day' | 'failed' | null;

/** How the check sits on `drivers/{uid}`, written only by the backend. */
export interface FaceCheckIn {
  day?: string;
  status?: FaceCheckInStatus;
  /** Whether this driver is actually gated on it. Absent means no. */
  required?: boolean;
  distance?: number | null;
  reasons?: string[];
  /** Firestore timestamps, as the web SDK hands them back. */
  passedAt?: { seconds: number } | null;
  checkedAt?: { seconds: number } | null;
}

export interface FaceCheckInState {
  /** True when the driver should be sent to the camera before anything else. */
  due: boolean;
  reason: FaceCheckInReason;
  /** Whether it is enforced for this driver at all. */
  required: boolean;
  /** True when they are being stopped, rather than merely asked. */
  blocking: boolean;
}

/**
 * Evaluate the check on a driver document.
 *
 * `now` is injectable for tests only; every caller in the app leaves it out.
 *
 * A `review` check — one where the comparison was undecided — counts as done.
 * The server let the driver through and flagged it for a person to look at;
 * asking them again on the same day would be asking them to fix something that
 * is not theirs to fix.
 */
export function evaluateFaceCheckIn(
  profile: { faceCheckIn?: FaceCheckIn } | null | undefined,
  now: number = Date.now(),
): FaceCheckInState {
  const check = profile?.faceCheckIn;
  const required = check?.required === true;
  const state = (due: boolean, reason: FaceCheckInReason): FaceCheckInState => ({
    due,
    reason,
    required,
    blocking: required && due,
  });

  if (!check?.day || !check.status) return state(true, 'never');
  if (check.day !== pktDayKey(new Date(now))) return state(true, 'new_day');
  if (check.status === 'failed') return state(true, 'failed');
  return state(false, null);
}

/** Why we are asking, in the driver's own terms. */
export const FACE_CHECK_IN_WHY: Record<Exclude<FaceCheckInReason, null>, string> = {
  never: 'A quick face check keeps your account yours. It takes a few seconds.',
  new_day: 'Good morning. A quick face check and you can start driving.',
  failed: 'That check did not go through. Try once more in good light.',
};
