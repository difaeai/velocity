/**
 * The token vault.
 *
 * Two properties matter and neither is obvious from reading the code: a sealed
 * token must come back byte-identical, and the vault must refuse to operate at
 * all without a key rather than quietly storing a page token in the clear.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { fingerprint, open, seal, tokenVaultReady } from '../secrets';

const originalKey = process.env.SOCIAL_TOKEN_KEY;

/** A real 32-byte key, base64 — the shape `openssl rand -base64 32` produces. */
const KEY = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  if (originalKey === undefined) delete process.env.SOCIAL_TOKEN_KEY;
  else process.env.SOCIAL_TOKEN_KEY = originalKey;
});

describe('token vault readiness', () => {
  it('is not ready with no key', () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    expect(tokenVaultReady()).toBe(false);
  });

  it('is not ready with a key of the wrong length', () => {
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(tokenVaultReady()).toBe(false);
  });

  it('accepts base64 and hex forms of a 32-byte key', () => {
    process.env.SOCIAL_TOKEN_KEY = KEY;
    expect(tokenVaultReady()).toBe(true);
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('hex');
    expect(tokenVaultReady()).toBe(true);
  });
});

describe('sealing', () => {
  it('round-trips a token exactly', () => {
    process.env.SOCIAL_TOKEN_KEY = KEY;
    const token = 'EAAG9ZBx0-a_very_long_page_access_token_with_symbols/+=';
    expect(open(seal(token))).toBe(token);
  });

  it('never produces the same ciphertext twice', () => {
    process.env.SOCIAL_TOKEN_KEY = KEY;
    const a = seal('same-token');
    const b = seal('same-token');
    expect(a.c).not.toBe(b.c);
    expect(a.iv).not.toBe(b.iv);
    // …and both still open. A fresh IV per seal is what stops two accounts
    // sharing a token from being identifiable as such from the stored rows.
    expect(open(a)).toBe('same-token');
    expect(open(b)).toBe('same-token');
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    process.env.SOCIAL_TOKEN_KEY = KEY;
    const sealed = seal('original');
    const flipped = Buffer.from(sealed.c, 'base64');
    flipped[0] ^= 0xff;
    expect(() => open({ ...sealed, c: flipped.toString('base64') })).toThrow();
  });

  it('cannot be opened with a different key', () => {
    process.env.SOCIAL_TOKEN_KEY = KEY;
    const sealed = seal('original');
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(() => open(sealed)).toThrow();
  });

  it('fails closed with no key configured', () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    // Not "store it in the clear", not "skip encryption" — refuse.
    expect(() => seal('token')).toThrow(/SOCIAL_TOKEN_KEY/);
  });
});

describe('fingerprint', () => {
  it('shows only the last four characters', () => {
    expect(fingerprint('abcdefghijkl')).toBe('••••ijkl');
  });

  it('reveals nothing at all about a short value', () => {
    expect(fingerprint('abc')).toBe('••••');
  });
});
