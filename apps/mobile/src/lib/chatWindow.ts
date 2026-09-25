/**
 * How much of a conversation a screen loads, and in which order.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Every chat and comment thread in the app used to subscribe to its whole
 * collection — `orderBy('sentAt', 'asc')` with no limit. That is fine for a
 * three-message trip chat and progressively worse for everything else: a Travel
 * Partner group a few months old costs its every member a full read of every
 * message it has ever held, on every open, and then re-renders the entire list
 * each time somebody types. The bill and the jank both grow with the age of the
 * conversation, which is the wrong thing for them to grow with.
 *
 * So each thread loads a window of the most recent messages instead.
 *
 * WHY THE ORDER IS AWKWARD
 * Firestore can only limit from the *front* of an ordered query, so asking for
 * the newest N means ordering `desc` and limiting — which hands back the messages
 * backwards. The screens all render oldest-at-top, so they flip the window with
 * `oldestFirst` before rendering. Ordering `asc` with a limit would return the
 * OLDEST N messages, which in a chat is precisely the wrong end.
 *
 * PICKING THE NUMBER
 * 200 is far past what anyone scrolls back through in a ride-hailing chat, and
 * small enough that the read cost of opening a thread stops growing. A thread
 * with fewer than 200 messages behaves exactly as it did before this existed —
 * which is nearly all of them, and why this change is invisible in normal use.
 */

/** Messages (or comments) a thread loads. */
export const CHAT_WINDOW = 200;

/**
 * Flip a newest-first window into the oldest-first order screens render.
 *
 * Returns a new array rather than reversing in place: the input is usually
 * derived straight from a Firestore snapshot and, in some screens, is about to
 * become state. Mutating it would make the render order depend on how many times
 * a component happened to re-run.
 */
export function oldestFirst<T>(newestFirst: readonly T[]): T[] {
  return newestFirst.slice().reverse();
}
