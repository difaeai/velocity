/**
 * How a fellow rider's standing is shown.
 *
 * Most surfaces get this already decided: the callables that list a shared ride
 * (`getPoolJoinInfo`, `getSuggestedRides`, the nearby-pools feed) run the
 * backend's `coRiderStanding()` and send `coRiderRating: null` when there is
 * not enough of an average to show. This module exists for the one surface that
 * does NOT go through a callable — the live trip document, whose `poolRoster`
 * stores the raw snapshot on purpose so a stored roster does not bake in a
 * threshold that may change.
 *
 * The threshold is duplicated from the backend rather than fetched, which is a
 * deliberate and bounded piece of drift: it is a display rule, both copies are
 * commented, and the alternative is a round trip to render a card. If it moves,
 * it moves in ratings/coRiders.ts and here.
 */

/** Keep in step with RATINGS_BEFORE_SHOWN in backend/functions/src/ratings/coRiders.ts. */
export const RATINGS_BEFORE_SHOWN = 3;

/**
 * The line to put under a rider's name, or null to say nothing at all.
 *
 * Returns "New" rather than a number below the threshold, and never renders a
 * zero: a rider nobody has rated has no rating, which is not the same as a bad
 * one, and the whole point of the threshold is that one opinion is not a
 * reputation.
 */
export function coRiderStandingLabel(
  rating?: number | null,
  count?: number | null,
): string | null {
  const n = typeof count === 'number' ? count : 0;
  if (typeof rating !== 'number' || n < RATINGS_BEFORE_SHOWN) {
    // Only worth saying on a rider who could have had a rating. Said about
    // everybody it would be noise on every card in the app.
    return n > 0 ? 'New to ride sharing' : null;
  }
  return `${rating.toFixed(1)} ★ · ${n} rider${n === 1 ? '' : 's'}`;
}
