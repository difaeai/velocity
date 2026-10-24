/**
 * Seeing the head move, on the phone, while the driver is still looking at it.
 *
 * The scan used to fire the shutter on a three-second timer and leave every
 * judgement to the server, so a driver turned their head into a countdown and
 * found out much later whether it had counted. Now every picture is read on the
 * phone as it is taken (modules/velocity-face), the pose is captured the moment
 * it is seen, and until then the driver is told what is missing.
 *
 * Presentation, not security. The frames still go to submitFaceScan, which
 * scores them against the poses the SERVER chose
 * (backend/functions/src/domain/faceScan.ts) — a patched build that skipped all
 * of this gains nothing.
 */
import type { FaceChallenge } from './faceScan';
import type { FaceReading } from '../../modules/velocity-face';

/** Poses the phone can see for itself. Anything else falls back to the timer. */
export const JUDGED_ON_PHONE: ReadonlySet<FaceChallenge> = new Set([
  'look_straight',
  'turn_left',
  'turn_right',
]);

/** Face width, as a share of the picture, below which the driver is asked to come closer. */
export const FACE_MIN_WIDTH = 0.2;

/** How far off straight-on the first frame may be — it is the one compared with the CNIC. */
export const STRAIGHT_MAX_DEG = 10;

/**
 * A turn counts this far from the driver's OWN straight-ahead frame. "Slightly",
 * as the prompt says, and still well clear of the head sway of somebody holding
 * a phone still (a few degrees) — and of what the server needs to see in the
 * frame (TURN_DELTA in backend/functions/src/domain/localVision.ts).
 */
export const TURN_MIN_DEG = 18;

export interface PoseProgress {
  /** Yaw of the accepted straight-ahead frame; every turn is measured from it. */
  straightYaw: number | null;
  /** Which way, in the picture, the first turn went — so the next one goes the other way. */
  firstTurn: 1 | -1 | null;
}

export const NO_PROGRESS: PoseProgress = { straightYaw: null, firstTurn: null };

export type FrameJudgement =
  | { ok: true; progress: PoseProgress }
  /** `hint` is what to tell the driver; null when the prompt already says it. */
  | { ok: false; hint: string | null };

/**
 * Does this picture show the pose asked for?
 *
 * WHICH WAY a turn goes is not checked, only that it happened and that a second
 * turn goes the opposite way to the first: a front camera may or may not mirror
 * what it saves, so the sign of the angle is not the person's left or right.
 * The server ignores direction for the same reason (TURN_DIRECTION_IS_NOT_CHECKED).
 */
export function judgeFrame(
  asked: FaceChallenge,
  reading: FaceReading,
  progress: PoseProgress,
): FrameJudgement {
  if (reading.count === 0 || !reading.box || reading.yaw === undefined) {
    return { ok: false, hint: 'Fit your face inside the oval' };
  }
  if (reading.count > 1) return { ok: false, hint: 'Only you in the picture, please' };
  if (reading.box.width < FACE_MIN_WIDTH) return { ok: false, hint: 'Bring the phone a little closer' };

  if (asked === 'look_straight') {
    return Math.abs(reading.yaw) <= STRAIGHT_MAX_DEG
      ? { ok: true, progress: { ...progress, straightYaw: reading.yaw } }
      : { ok: false, hint: 'Look straight at the camera' };
  }

  const turned = reading.yaw - (progress.straightYaw ?? 0);
  const side = turned >= 0 ? 1 : -1;
  const far = Math.abs(turned);
  if (progress.firstTurn === side && far >= TURN_MIN_DEG / 2) {
    return { ok: false, hint: 'Now turn the other way' };
  }
  if (far < TURN_MIN_DEG) {
    return { ok: false, hint: far >= TURN_MIN_DEG / 2 ? 'A little further' : null };
  }
  return { ok: true, progress: { ...progress, firstTurn: progress.firstTurn ?? side } };
}
