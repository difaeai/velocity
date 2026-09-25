/**
 * The window helper is two lines, and both of them are load-bearing.
 *
 * Every chat screen now reads its messages newest-first (the only direction
 * Firestore can limit from) and flips them for display. If `oldestFirst` ever
 * stopped flipping, five screens would render every conversation backwards; if
 * it reversed in place, the order would depend on how many times a component
 * happened to re-render, which is the kind of bug that only shows up on a slow
 * phone. So both properties are pinned.
 */
import { describe, it, expect } from 'vitest';

import { CHAT_WINDOW, oldestFirst } from '../chatWindow';

describe('CHAT_WINDOW', () => {
  it('is a sane ceiling — big enough to be invisible, small enough to bound a read', () => {
    expect(CHAT_WINDOW).toBeGreaterThanOrEqual(50);
    expect(CHAT_WINDOW).toBeLessThanOrEqual(500);
  });
});

describe('oldestFirst', () => {
  it('flips a newest-first window into reading order', () => {
    expect(oldestFirst(['newest', 'middle', 'oldest'])).toEqual(['oldest', 'middle', 'newest']);
  });

  it('does not mutate its input', () => {
    // The input is usually derived straight from a snapshot and sometimes goes
    // on to become state; reversing it in place would corrupt both.
    const snapshot = ['c', 'b', 'a'];
    oldestFirst(snapshot);
    expect(snapshot).toEqual(['c', 'b', 'a']);
  });

  it('returns a different array, so callers cannot alias the source', () => {
    const snapshot = ['c', 'b', 'a'];
    expect(oldestFirst(snapshot)).not.toBe(snapshot);
  });

  it('handles the empty and single-message threads', () => {
    expect(oldestFirst([])).toEqual([]);
    expect(oldestFirst(['only'])).toEqual(['only']);
  });

  it('accepts a readonly array', () => {
    const frozen: readonly number[] = Object.freeze([3, 2, 1]);
    expect(oldestFirst(frozen)).toEqual([1, 2, 3]);
  });
});
