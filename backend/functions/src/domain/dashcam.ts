/**
 * The ride dash cam's rules — who may watch which clips, and for how long.
 *
 * Pure, so they can be tested without a bucket, a trip or a clock. The
 * machinery that applies them is trips/dashcam.ts; the camera itself is the
 * driver's phone (apps/mobile/src/ui/DashCam.tsx).
 */

/** How long a ride's video outlives the ride. The promise made to everyone in the car. */
export const DASHCAM_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * The longest stretch one clip can cover. The phone cuts a clip every two
 * minutes; this carries slack for a recording that ran long before it was cut.
 */
export const CLIP_SPAN_MS = 3 * 60 * 1000;

/**
 * Slack around a rider's own time in the car.
 *
 * A clip is named by the DRIVER'S phone clock and a boarding is stamped by OUR
 * server, and the two can disagree by minutes on a phone whose time was set by
 * hand. Too tight and a rider loses the clip of their own drop-off; five minutes
 * costs a co-rider a little of somebody else's ride at the edges.
 */
export const WINDOW_GRACE_MS = 5 * 60 * 1000;

const CLIP_FILE = /^(\d{13})\.mp4$/;

/** A clip's start time, from its object name (`…/{startedAtMs}.mp4`). Null for anything else. */
export function clipStartedAt(objectName: string): number | null {
  const m = CLIP_FILE.exec(objectName.slice(objectName.lastIndexOf('/') + 1));
  return m ? Number(m[1]) : null;
}

/**
 * When a ride's video is deleted: 24 hours after the ride ended.
 *
 * A ride that never formally ended — the driver's phone died, the trip was
 * force-closed — has no end to count from, so its last clip stands in for one:
 * the video still goes, a day after the camera last saw anything. Null only
 * when there is neither, which means there is nothing to delete.
 */
export function dashcamExpiresAt(completedAtMs: number | null, newestClipMs: number | null): number | null {
  const end = completedAtMs ?? newestClipMs;
  return end === null ? null : end + DASHCAM_KEEP_MS;
}

/** One rider's time in a shared car, from the roster on the trip document. */
export interface DashcamSeat {
  uid: string;
  /** 'enroute' riders get in along the road, so only their own start says they did. */
  kind?: string;
  joinedAtMs: number | null;
  /** When the driver started THIS rider's ride (boardPoolRider). */
  boardedAtMs?: number | null;
  droppedAtMs: number | null;
}

/** The parts of a trip that decide who may watch its video. */
export interface DashcamParties {
  driverId: string | null;
  passengerId: string | null;
  poolMembers: string[];
  seats: DashcamSeat[];
  /** Riders the driver never picked up, written when the ride ended. */
  noShows?: string[];
}

/** The stretch of a ride one person may watch. A null end means "from the start" / "to the end". */
export interface ViewWindow {
  from: number | null;
  to: number | null;
}

/**
 * What this person may watch, or null for nothing at all.
 *
 * The driver sees the whole ride: it is their car and their camera. Everybody
 * who rode sees the stretch they were aboard for. In a solo ride that is all of
 * it; in a shared car it runs from when they joined to when they were let out.
 * They shared the car with the others for that stretch and no other, and the
 * woman who got in after they left is not theirs to watch.
 *
 * Where each rider's ride is started on its own, "aboard" runs from that start,
 * and a rider not started yet — or never, a no-show — has not been in the car
 * and sees nothing, the same rule as trips/poolRoster isBoarded.
 */
export function viewerWindow(trip: DashcamParties, uid: string): ViewWindow | null {
  if (trip.driverId && uid === trip.driverId) return { from: null, to: null };
  if (uid !== trip.passengerId && !trip.poolMembers.includes(uid)) return null;
  if (trip.noShows?.includes(uid)) return null;
  const seat = trip.seats.find((s) => s.uid === uid);
  const startedOneByOne = trip.seats.some((s) => s.kind !== 'enroute' && s.boardedAtMs);
  if (seat && !seat.boardedAtMs && !seat.droppedAtMs && (seat.kind === 'enroute' || startedOneByOne)) {
    return null;
  }
  // A zero is the roster's "joined before anybody recorded when", not 1970.
  const from = seat?.boardedAtMs || seat?.joinedAtMs || null;
  return {
    from: from ? from - WINDOW_GRACE_MS : null,
    to: seat?.droppedAtMs ? seat.droppedAtMs + WINDOW_GRACE_MS : null,
  };
}

/** Whether a clip that started at `startedAt` overlaps the window at all. */
export function clipInWindow(startedAt: number, window: ViewWindow): boolean {
  if (window.to !== null && startedAt > window.to) return false;
  if (window.from !== null && startedAt + CLIP_SPAN_MS < window.from) return false;
  return true;
}
