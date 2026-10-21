/**
 * The ride dash cam's rules on the phone — pure, so they can be tested without
 * a camera. The machinery is src/lib/dashcam.ts (queue, speech, checks) and
 * src/ui/DashCam.tsx (the camera); who may watch what is the backend's
 * domain/dashcam.ts.
 */

/** One clip's length. A clip is the unit of loss: a crash costs the clip in progress, not the ride. */
export const CLIP_SECONDS = 120;

/**
 * The first clip of a ride: just long enough to show who is in the car, so
 * "I can't see any passenger" can be said seconds into the ride rather than
 * two minutes into it.
 */
export const FIRST_CLIP_SECONDS = 8;

/**
 * How many times one ride is checked for faces. A camera that still sees
 * nobody after three warnings is either a driver who has heard us, or a car at
 * night the detector cannot see into — and a fourth warning helps neither.
 */
export const MAX_CABIN_CHECKS = 3;

/** How long a ride's video can be watched after it ends. Mirrors the backend's DASHCAM_KEEP_MS. */
export const DASHCAM_KEEP_MS = 24 * 60 * 60 * 1000;

export type CabinView = 'unknown' | 'seen' | 'not_seen';

/** Clip length for a ride that has already started `clipsStarted` clips. */
export function clipSeconds(clipsStarted: number): number {
  return clipsStarted === 0 ? FIRST_CLIP_SECONDS : CLIP_SECONDS;
}

/**
 * Whether an uploaded clip should be checked for faces: until somebody has
 * been seen, and no more than MAX_CABIN_CHECKS times a ride.
 */
export function shouldCheckCabin(cabin: CabinView, checksSent: number): boolean {
  return cabin !== 'seen' && checksSent < MAX_CABIN_CHECKS;
}

/** Whether a ride's video can still be watched: while it runs, and for a day after it ends. */
export function dashcamWatchable(
  trip: { status: string; completedAt?: { seconds: number } | null },
  now: number,
): boolean {
  if (trip.status === 'in_progress') return true;
  const ended = trip.completedAt?.seconds;
  return trip.status === 'completed' && !!ended && now - ended * 1000 < DASHCAM_KEEP_MS;
}
