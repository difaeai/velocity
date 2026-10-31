/**
 * Ad spend is read with the Ads page's own connection when there is one: the
 * WhatsApp token it used to fall back to cannot see the ad account, and Meta
 * said so with "(#200) … NOT grant ads_management or ads_read" every night.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMetaCosts } from '../sources';

afterEach(() => vi.unstubAllGlobals());

const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z'), label: '2026-10' };

describe('Meta ad spend', () => {
  it('asks for the ad account with the ad token, not the WhatsApp one', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, json: async () => ({ data: [{ spend: '1200', account_currency: 'PKR' }] }) } as unknown as Response;
      }),
    );

    const out = await fetchMetaCosts({ token: 'wa-token', wabaId: null, adAccountId: 'act_1', adToken: 'ads-token' }, october);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('access_token=ads-token');
    expect(out['social-ad-spend']).toEqual({ amount: 1200, currency: 'PKR' });
  });
});
