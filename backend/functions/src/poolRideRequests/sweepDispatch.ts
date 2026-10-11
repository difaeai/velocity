/**
 * The backstop behind the offer ladder.
 * ----------------------------------------------------------------------------
 * Three things advance a pool's ladder, and they cover different failures:
 *
 *  1. `createPoolRideRequest` makes the first offer.
 *  2. A refusal advances it immediately — the common case, and the fast one.
 *  3. A driver's feed poll advances any lapsed ladder it reads past, which is
 *     what makes an IGNORED offer hand over in about as long as it takes the
 *     next driver to poll.
 *
 * None of those fire when the offered driver simply closes the app in a zone
 * where nobody else is looking at their feed. That pool holds an offer nobody
 * will ever answer until it ages out at `openToAllAfterSec` — four minutes of a
 * rider watching a screen that says a driver is considering their ride.
 *
 * So: once a minute, every pool whose offer has run out gets moved on. Worst
 * case a hand-off waits 60s for this instead of 25s, and that worst case needs
 * the offered driver to vanish AND no other driver in the city to be polling.
 *
 * WHY IT IS NOT FOLDED INTO `sweepStaleSharedRides`
 * ------------------------------------------------
 * That one runs every ten minutes, which is the right cadence for expiring
 * rides that have sat for hours and far too slow for a 25-second offer. Putting
 * them together would mean either paying for a ten-times-faster expiry sweep or
 * making the ladder ten times slower than its own offer window.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { sweepLapsedPoolOffers } from './dispatch';

export const sweepPoolDispatch = onSchedule('every 1 minutes', async () => {
  try {
    const { scanned, advanced } = await sweepLapsedPoolOffers();
    // Only worth a line when it actually did something. A quiet minute is the
    // expected state — the feed polls usually get there first.
    if (advanced > 0) logger.info('sweepPoolDispatch: ladders advanced', { scanned, advanced });
  } catch (e) {
    // Never rethrow: a failed sweep must not retry-storm the collection, and
    // the next minute's run is the retry.
    logger.error('sweepPoolDispatch: sweep failed', { error: e });
  }
});
