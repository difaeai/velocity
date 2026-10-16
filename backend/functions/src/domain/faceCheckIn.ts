/**
 * "Is the person about to start driving the person this account belongs to?"
 *
 * Onboarding proves identity once: the papers are read, the live face is
 * compared with the CNIC and the licence, and an account is granted. It proves
 * nothing about who picks the phone up four months later. The account that
 * passed verification in June is the same account a brother, a cousin or a
 * buyer can be driving in October, and nothing in the system would notice —
 * the rating, the trips and the passenger's safety screen would all still show
 * the name on the CNIC.
 *
 * So once a day, the first time a driver opens the app, they look into the
 * front camera for a few seconds and the frames are compared against the face
 * that was enrolled when their application was approved.
 *
 * WHY THIS IS THE COMPARISON WORTH ACTING ON. At onboarding the live face is
 * measured against a photograph printed on a card, which may be a decade old,
 * at 200 dpi, behind a laminate — a hard comparison, and the reason a mismatch
 * there is never allowed to refuse anybody (see FACE_MISMATCH_IS_REVIEW_ONLY in
 * ./driverVerification.ts). Here both sides are a selfie taken on a phone held
 * at arm's length, and the enrolled side was itself proven against the card.
 * That is the easy case for a descriptor, and it is the only face comparison in
 * this system allowed to stop a driver working.
 *
 * WHAT IT STILL MAY NOT DO. It may not ban, it may not reject, and it may not
 * act on a measurement that landed in the undecided band — see
 * UNDECIDED_IS_NOT_A_REFUSAL below. A driver whose check reads wrong loses
 * minutes while they retry, and if it keeps reading wrong a human looks.
 *
 * THREE implementations of "is today's check done" exist and they must agree:
 *   · here — the server guard on every callable that hands a driver a passenger;
 *   · firestore.rules — the backstop on flipping `online` to true;
 *   · apps/mobile/src/domain/faceCheckIn.ts — what the app shows and gates on.
 *
 * Pure predicates and one guard, with no Firestore reads of its own, so every
 * path a driver can take work through can import it. Same shape and the same
 * job as `assertVehicleConfirmed` in ./vehicleCheck.ts, applied at the same
 * call sites.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { pktDayKey, type DayKey } from './dailyTarget';
import type { Agreement } from './driverVerification';
import type { FaceScanVerdict } from './faceScan';

/**
 * Frames in a daily check, against three at onboarding.
 *
 * One baseline frame plus one movement is all this needs: the question is "same
 * person, live, right now", not "can this applicant follow three instructions".
 * Every frame costs a driver about four seconds of a morning they are trying to
 * start earning in, every single day, and a ritual that outstays its welcome is
 * a ritual drivers find ways around.
 */
export const FACE_CHECK_IN_FRAMES = 2;

/**
 * Attempts per hour. Higher than the onboarding limit on purpose: a driver in a
 * dark stairwell at 6 a.m. trying to start a shift is the ordinary case, and
 * each attempt costs a few hundred milliseconds of our own CPU. The limit is
 * here to stop a script grinding against the comparison, not to ration a
 * driver's own face.
 */
export const FACE_CHECK_IN_ATTEMPTS_PER_HOUR = 20;

/**
 * An undecided measurement is not a refusal.
 *
 * The descriptor reports three things — same person, different person, or not
 * sure — and the middle answer is genuinely common: a mask pulled down, a phone
 * pointed up a nostril, a streetlight behind the head. Blocking on "not sure"
 * costs an honest driver a day's income on a number that does not actually say
 * anything about them.
 *
 * So an undecided check PASSES the driver through and is recorded as `review`,
 * which puts them on a list an admin can look at. A driver whose check is
 * undecided every morning for a week is a far better signal than any single
 * frame, and it is a signal a person acts on, not this file.
 */
export const UNDECIDED_IS_NOT_A_REFUSAL = true;

export type FaceCheckInStatus = 'passed' | 'review' | 'failed';

/** Why a driver is being asked. Each reason gets its own sentence on screen. */
export type FaceCheckInReason =
  /** Approved before daily checks existed, or never enrolled. */
  | 'never'
  /** Yesterday's check was yesterday's. */
  | 'new_day'
  /** Today's attempt did not pass — it has to be cleared before driving. */
  | 'failed'
  | null;

/**
 * The record as it sits on `drivers/{uid}.faceCheckIn`.
 *
 * Written only by the backend. `required` is the enforcement switch, stamped
 * from `adminConfig/driverVerification.dailyFaceCheckIn` — it lives on the
 * driver document rather than being read from the config on every call because
 * the security rules and the hot trip paths both have to see it and neither can
 * afford a second document read. drivers/faceCheckIn.ts says who stamps it.
 */
export interface FaceCheckInRecord {
  /** The Pakistan day this check belongs to, `YYYY-MM-DD`. */
  day?: DayKey;
  status?: FaceCheckInStatus;
  /** How far the live face landed from the enrolled one. Null when uncomparable. */
  distance?: number | null;
  /** Whether this driver is actually gated on it. Absent means no. */
  required?: boolean;
  scanId?: string;
  reasons?: string[];
  /** Firestore timestamps, as the Admin SDK hands them back. */
  passedAt?: { toMillis?: () => number } | null;
  checkedAt?: { toMillis?: () => number } | null;
}

export interface FaceCheckInState {
  /** True when this driver should be asked for a check before taking work. */
  due: boolean;
  reason: FaceCheckInReason;
  /** The day a check would be recorded against, so no caller recomputes it. */
  today: DayKey;
  /** Whether the check is enforced at all for this driver. */
  required: boolean;
}

/**
 * Does this driver owe a face check right now?
 *
 * `due` answers "should they be asked", which is not "may they be stopped" —
 * that is `required && due`. The distinction matters: a driver on an app build
 * with no camera screen must be asked for nothing and stopped by nothing, which
 * is exactly what an absent `required` gives them.
 *
 * A `failed` check counts as still outstanding rather than as a verdict. The
 * driver retries; nothing about a failed attempt is held against them beyond
 * having to do it again, because the alternative — one bad frame costing a
 * day — is worse than the fraud it would prevent.
 */
export function evaluateFaceCheckIn(
  record: FaceCheckInRecord | null | undefined,
  now: number = Date.now(),
): FaceCheckInState {
  const today = pktDayKey(new Date(now));
  const required = record?.required === true;

  if (!record?.day || !record.status) {
    return { due: true, reason: 'never', today, required };
  }
  if (record.day !== today) {
    return { due: true, reason: 'new_day', today, required };
  }
  // Today's check exists. `review` is a pass a human will look at — see
  // UNDECIDED_IS_NOT_A_REFUSAL — so only an outright failure is still owed.
  if (record.status === 'failed') {
    return { due: true, reason: 'failed', today, required };
  }
  return { due: false, reason: null, today, required };
}

export interface FaceCheckInVerdict {
  status: FaceCheckInStatus;
  /** Whether the driver may start work on the strength of this check. */
  allowed: boolean;
  reasons: string[];
  /** One line for the driver. Never an accusation. */
  message: string;
  /** True when this face should become (or replace) the enrolled reference. */
  enrol: boolean;
}

/**
 * Score one daily check.
 *
 * `liveness` is the ordinary scan verdict — frames, poses, one face, not a
 * screen — scored by ./faceScan.ts and shared with onboarding. Everything below
 * is about WHOSE face passed it.
 *
 * `reference` is the comparison against the enrolled face and is the one that
 * can stop a driver. `card` is the fallback for a driver who was approved
 * before enrolment existed: their live face is measured against the CNIC
 * photograph on file instead, and — because that is the hard comparison this
 * system never refuses anybody on — the worst it can do is send them to a human
 * while they keep driving.
 */
export function scoreFaceCheckIn(params: {
  liveness: FaceScanVerdict;
  /** Against the enrolled face. Null when this driver has never been enrolled. */
  reference: Agreement | null;
  /** Against the CNIC photograph on file. Used only without an enrolment. */
  card: Agreement;
}): FaceCheckInVerdict {
  const { liveness, reference, card } = params;

  // Not a live person following the prompts: nothing to compare, so nothing is
  // decided about identity. They try again — in better light, usually.
  if (liveness.status !== 'passed') {
    return {
      status: 'failed',
      allowed: false,
      reasons: liveness.reasons,
      message: liveness.message,
      enrol: false,
    };
  }

  if (reference === 'match') {
    return {
      status: 'passed',
      allowed: true,
      reasons: [],
      message: 'Face check complete. Have a good day driving.',
      // Re-enrolled on every pass, so the reference follows a driver through a
      // beard, a haircut and ten years rather than drifting away from them.
      enrol: true,
    };
  }

  if (reference === 'mismatch') {
    // The only face comparison in this system that refuses anybody, and it
    // refuses the DAY, not the driver: no ban, no role change, no mark on the
    // application. They can try again immediately, and if it keeps reading
    // this way an admin sees it on the list.
    return {
      status: 'failed',
      allowed: false,
      reasons: ['face_check_not_the_driver'],
      message:
        'This does not look like the driver registered on this account. Please try again in good light, or contact support if this keeps happening.',
      enrol: false,
    };
  }

  if (reference === 'unclear') {
    return {
      status: 'review',
      allowed: true,
      reasons: ['face_check_unclear'],
      message: 'Face check done. We could not be sure it was a match, so our team will take a look.',
      enrol: false,
    };
  }

  // No enrolment yet — the first check of a driver approved before this existed.
  if (card === 'match') {
    return {
      status: 'passed',
      allowed: true,
      reasons: ['face_check_matched_card'],
      message: 'Face check complete. Have a good day driving.',
      enrol: true,
    };
  }
  return {
    status: 'review',
    allowed: true,
    reasons: card === 'mismatch' ? ['face_check_card_mismatch'] : ['face_check_no_reference'],
    message: 'Face check done. Our team will confirm it against your documents.',
    // A face that does not match the card on file is not the face to enrol as
    // this account's reference — that would quietly bless whoever did the scan.
    enrol: card !== 'mismatch',
  };
}

/** Read the record off a driver snapshot, in the shape the rule above wants. */
export function faceCheckInOf(driverSnap: DocumentSnapshot): FaceCheckInRecord | null {
  return (driverSnap.get('faceCheckIn') as FaceCheckInRecord | undefined) ?? null;
}

/** Has this driver cleared today's check — or is nothing being asked of them? */
export function isFaceCheckedInToday(
  driverSnap: DocumentSnapshot,
  now: number = Date.now(),
): boolean {
  const state = evaluateFaceCheckIn(faceCheckInOf(driverSnap), now);
  return !state.required || !state.due;
}

/**
 * Guard for taking new work — throws when today's check has not been done.
 *
 * The security rules already stop a gated driver going online and every solo
 * path requires being online. This closes the pool and en-route paths, which
 * take a driver on without asking about presence at all, and it is the layer
 * that cannot be patched out of a build.
 */
export function assertFaceCheckedIn(driverSnap: DocumentSnapshot): void {
  if (!isFaceCheckedInToday(driverSnap)) {
    throw new HttpsError(
      'failed-precondition',
      'Verify your face to start driving today — open the app and complete the quick face check.',
    );
  }
}
