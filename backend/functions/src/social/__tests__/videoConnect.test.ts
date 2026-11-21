/**
 * The header on the token exchange.
 *
 * Node's fetch labels a URLSearchParams body
 * "application/x-www-form-urlencoded;charset=UTF-8", and TikTok answers that
 * with "The request parameters are malformed" — the identical body with the
 * plain type is read fine. Proved against TikTok on 21 Nov 2026 with a real
 * authorization code: plain type returned a token, the charset one did not.
 * No TikTok account could ever be connected until this was fixed, so the
 * header is worth a test of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchange } from '../videoConnect';

const saved = process.env.SOCIAL_TOKEN_KEY;

/** Every request the code under test made. */
let sent: { url: string; headers: Record<string, string>; body: string }[] = [];

beforeEach(() => {
  sent = [];
  process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
    sent.push({ url: String(input), headers, body: String(init?.body ?? '') });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
      json: async () => ({}),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.SOCIAL_TOKEN_KEY = saved;
});

describe('the token exchange', () => {
  it('names the form type without a charset, which is the only way TikTok reads it', async () => {
    // Whatever the connect then makes of the answer, the request is what matters.
    await exchange('https://open.tiktokapis.com/v2/oauth/token/', {
      grant_type: 'authorization_code',
      code: 'a-code*with!the-characters-TikTok-sends',
      client_key: 'k',
      client_secret: 's',
      redirect_uri: 'https://velocityrides.app/connect/video',
    }).catch(() => undefined);

    expect(sent).toHaveLength(1);
    expect(sent[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(sent[0].headers['content-type']).not.toMatch(/charset/i);
    // And the code goes out intact, * and ! included.
    expect(decodeURIComponent(sent[0].body)).toContain('a-code*with!the-characters-TikTok-sends');
  });
});
