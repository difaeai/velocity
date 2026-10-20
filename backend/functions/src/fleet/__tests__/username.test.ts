/**
 * The username rules, pinned.
 *
 * Pure-function test on purpose: the app validates as you type with the same
 * rules (apps/mobile/src/lib/username.ts), so a change here that the app does
 * not match shows up as a name the keyboard accepts and the server refuses.
 */
import { describe, it, expect } from 'vitest';
import { normalizeUsername } from '../index';

describe('normalizeUsername', () => {
  it('accepts 3 to 7 characters', () => {
    expect(normalizeUsername('ali')).toMatchObject({ ok: true, username: 'ali', slug: 'ali' });
    expect(normalizeUsername('abcdefg')).toMatchObject({ ok: true });
    expect(normalizeUsername('ab')).toMatchObject({ ok: false });
    expect(normalizeUsername('abcdefgh')).toMatchObject({ ok: false });
  });

  it('allows special characters — that is the point', () => {
    for (const name of ['a.b', 'x_y', 'ali!', '@@@', 'a-b-c', '$$$']) {
      expect(normalizeUsername(name), name).toMatchObject({ ok: true });
    }
  });

  it('counts an emoji as one character, not two', () => {
    // '🚗🚗' is 4 UTF-16 units but 2 code points, so it is too short, and
    // three of them are exactly long enough.
    expect(normalizeUsername('🚗🚗')).toMatchObject({ ok: false });
    expect(normalizeUsername('🚗🚗🚗')).toMatchObject({ ok: true });
  });

  it('refuses what would break a document path', () => {
    expect(normalizeUsername('a/b')).toMatchObject({ ok: false });
    expect(normalizeUsername('a b')).toMatchObject({ ok: false });
    expect(normalizeUsername('a\tb')).toMatchObject({ ok: false });
    expect(normalizeUsername('..')).toMatchObject({ ok: false });
    expect(normalizeUsername('__x__')).toMatchObject({ ok: false });
  });

  it('is case-insensitive for uniqueness but keeps what was typed', () => {
    expect(normalizeUsername('AliX')).toMatchObject({ ok: true, username: 'AliX', slug: 'alix' });
  });

  it('trims, and rejects anything that is not a string', () => {
    expect(normalizeUsername('  ali  ')).toMatchObject({ ok: true, username: 'ali' });
    expect(normalizeUsername(undefined)).toMatchObject({ ok: false });
    expect(normalizeUsername(42)).toMatchObject({ ok: false });
  });
});
