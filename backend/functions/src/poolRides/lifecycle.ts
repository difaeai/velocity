/**
 * When a shared-ride offer stops being real.
 * ---------------------------------------------------------------------------
 * Two collections hold offers that can simply be abandoned:
 *
 *   `poolRides`        — a driver posts a route for a time and sells the seats.
 *   `poolRideRequests` — riders club together and wait for a driver to take them.
 *
 * Neither has an ending of its own. A driver who posts a 6 PM run and then goes
 * home leaves the document `open` for ever; a pool nobody drove stays `open`
 * past the expiry it was given. Three things then go wrong, in rising order of
 * seriousness: the row keeps appearing in discovery feeds, riders keep a
 * "confirmed" seat on a car that is not coming, and — for the driver —
 * `hasLiveWork` in drivers/vehicles.ts counts the stale ride as live work, so
 * they can never switch cars again.
 *
 * TWO CLOCKS, DELIBERATELY DIFFERENT
 * Hiding a row from a feed costs nobody anything: a driver running 20 minutes
 * late still has their riders and their ride. Cancelling it is a decision about
 * someone's journey. So the feeds stop showing a departed car after
 * `POOL_RIDE_HIDE_AFTER_DEPARTURE_MS`, and the sweep only retires it after
 * `POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS` — much later. The hide window must
 * never grow past the expire window, or feeds would advertise rides the sweep
 * has already killed.
 */

/**
 * How long after its departure time a driver-posted ride still belongs in a
 * discovery feed. Short: a car that left is not a seat, whatever the document
 * says.
 */
export const POOL_RIDE_HIDE_AFTER_DEPARTURE_MS = 15 * 60 * 1000;

/**
 * How long after its departure time a ride that never started boarding is
 * retired outright.
 *
 * Ninety minutes is deliberately generous. A driver stuck in Pindi traffic who
 * has not pressed "Start boarding" still means to drive, and their riders still
 * have seats; the cost of being wrong that way is somebody's ride cancelled
 * under them, which is far worse than a dead row living an hour longer.
 */
export const POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS = 90 * 60 * 1000;

/**
 * A ride with no `departureTime` at all (older documents, and anything written
 * outside the offer screen) has no clock to measure, so it is retired on age.
 * Twelve hours is past the end of any plausible shift that posted it.
 */
export const POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS = 12 * 60 * 60 * 1000;

/**
 * How long past its own `expiresAt` a riders' pool request is left alone.
 *
 * The request is already unjoinable at `expiresAt` — every join call checks it
 * — so this grace buys nothing but safety against a clock skew and a driver
 * accepting in the same minute it lapses.
 */
export const POOL_REQUEST_EXPIRE_GRACE_MS = 15 * 60 * 1000;

/**
 * Only tell people about an expiry that just happened.
 *
 * The first run of a sweep meets every document that was ever abandoned. A
 * rider does not need a push about a pool they tried to join last March, and a
 * driver does not need forty of them. Anything older than this is retired in
 * silence.
 */
export const POOL_EXPIRY_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Epoch-ms of a Firestore Timestamp (or Date), or null when absent/unreadable. */
export function timestampMs(value: unknown): number | null {
  const ms = (value as { toDate?: () => Date } | undefined)?.toDate?.()?.getTime();
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  if (value instanceof Date) return value.getTime();
  return null;
}

/**
 * Should a discovery feed still show this driver-posted ride?
 *
 * Takes the raw `departureTime` field so every feed asks the question the same
 * way. A ride with no departure time is always shown — the sweep retires it on
 * age, but while it is open it is an offer somebody made.
 */
export function rideHasDeparted(departureTime: unknown, now: number): boolean {
  const ms = timestampMs(departureTime);
  return ms !== null && ms + POOL_RIDE_HIDE_AFTER_DEPARTURE_MS < now;
}
