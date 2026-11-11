/**
 * The card webhook is a public, unauthenticated endpoint: the signature on the
 * request is the ONLY thing standing between a stranger's POST and a free plan.
 * These are the cases that matter — no database, pure crypto.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyStripeEvent } from '../stripeSignature';

const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000_000;
const BODY = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_abcdefgh' } } });

const sign = (body: string, secret = SECRET, atMs = NOW): string => {
  const t = Math.floor(atMs / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
};

describe('verifyStripeEvent', () => {
  it('accepts a request Stripe really signed', () => {
    const event = verifyStripeEvent(BODY, sign(BODY), SECRET, NOW);
    expect(event?.type).toBe('checkout.session.completed');
  });

  it('refuses a forged signature', () => {
    expect(verifyStripeEvent(BODY, sign(BODY, 'whsec_someone_elses'), SECRET, NOW)).toBeNull();
  });

  it('refuses a body changed after it was signed', () => {
    const header = sign(BODY);
    const tampered = BODY.replace('cs_test_abcdefgh', 'cs_test_zzzzzzzz');
    expect(verifyStripeEvent(tampered, header, SECRET, NOW)).toBeNull();
  });

  it('refuses a replay of yesterday’s genuine request', () => {
    const header = sign(BODY, SECRET, NOW - 86_400_000);
    expect(verifyStripeEvent(BODY, header, SECRET, NOW)).toBeNull();
  });

  it('refuses a missing header, a missing secret and a body that was not kept', () => {
    expect(verifyStripeEvent(BODY, undefined, SECRET, NOW)).toBeNull();
    expect(verifyStripeEvent(undefined, sign(BODY), SECRET, NOW)).toBeNull();
    expect(verifyStripeEvent('', sign(''), SECRET, NOW)).toBeNull();
    expect(verifyStripeEvent(BODY, 'v1=deadbeef', SECRET, NOW)).toBeNull();
    expect(verifyStripeEvent(BODY, sign(BODY), '', NOW)).toBeNull();
  });

  it('accepts the second signature during a secret rotation', () => {
    // Stripe signs with every live secret: ours may be either one.
    const t = Math.floor(NOW / 1000);
    const mine = createHmac('sha256', SECRET).update(`${t}.${BODY}`).digest('hex');
    const header = `t=${t},v1=${'0'.repeat(64)},v1=${mine}`;
    expect(verifyStripeEvent(BODY, header, SECRET, NOW)?.type).toBe('checkout.session.completed');
  });

  it('refuses a signature of the wrong length rather than throwing', () => {
    expect(verifyStripeEvent(BODY, `t=${Math.floor(NOW / 1000)},v1=ab`, SECRET, NOW)).toBeNull();
  });

  it('refuses a body that is signed but not an event', () => {
    const body = '{"no":"type"}';
    expect(verifyStripeEvent(body, sign(body), SECRET, NOW)).toBeNull();
    const broken = 'not json at all';
    expect(verifyStripeEvent(broken, sign(broken), SECRET, NOW)).toBeNull();
  });
});
