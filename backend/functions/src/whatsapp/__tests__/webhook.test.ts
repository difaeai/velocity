/**
 * The webhook is a public URL that edits driver consent. The signature check is
 * the only thing standing between Meta and anyone who finds it, so it gets its
 * own tests.
 */
import { createHmac } from 'crypto';
import { describe, it, expect } from 'vitest';

import { maskNumber, verifySignature } from '../index';

const SECRET = 'app-secret-value';

function signed(body: string, secret = SECRET) {
  const digest = createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
  return {
    rawBody: Buffer.from(body, 'utf8'),
    headers: { 'x-hub-signature-256': `sha256=${digest}` },
  };
}

describe('verifySignature', () => {
  it('accepts a payload genuinely signed by Meta', () => {
    expect(verifySignature(signed('{"entry":[]}'), SECRET)).toBe(true);
  });

  it('accepts a payload with Urdu in it', () => {
    // The reason the check reads rawBody rather than re-serialising req.body:
    // JSON.stringify of a parsed object is not byte-identical to what arrived,
    // and an Urdu STOP is exactly the payload that exposes the difference.
    const body = JSON.stringify({ text: { body: 'بند' } });
    expect(verifySignature(signed(body), SECRET)).toBe(true);
  });

  it('rejects a body that was altered after signing', () => {
    const req = signed('{"entry":[]}');
    req.rawBody = Buffer.from('{"entry":[{"evil":true}]}', 'utf8');
    expect(verifySignature(req, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifySignature(signed('{}', 'not-our-secret'), SECRET)).toBe(false);
  });

  it('rejects an unsigned request outright', () => {
    expect(verifySignature({ rawBody: Buffer.from('{}'), headers: {} }, SECRET)).toBe(false);
  });

  it('rejects everything when no app secret is configured', () => {
    // Fails closed: an endpoint that cannot tell Meta from a stranger, and
    // accepts anyway, is worse than one that does nothing at all.
    expect(verifySignature(signed('{}'), undefined)).toBe(false);
  });

  it('rejects a truncated digest instead of comparing prefixes', () => {
    const req = signed('{}');
    req.headers['x-hub-signature-256'] = 'sha256=abc';
    expect(verifySignature(req, SECRET)).toBe(false);
  });
});

describe('maskNumber', () => {
  it('shows a driver enough to recognise their number, and no more', () => {
    expect(maskNumber('923001234567')).toBe('+92 300 ****567');
  });
});
