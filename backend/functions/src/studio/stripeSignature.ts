/**
 * Is a webhook request really from Stripe?
 *
 * Its own file, importing nothing but crypto, for two reasons: this is the only
 * thing standing between a stranger's POST and a free plan, so it is tested on
 * its own; and `cardPay.ts` pulls in the whole Studio module graph, which a
 * hashing test has no business booting.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Is this request really from Stripe? The header carries a timestamp and one or
 * more signatures over `timestamp.body`; any one of them matching our secret,
 * recently, is proof. Returns the parsed event, or null — a null is a forgery
 * or a stale replay and must change nothing.
 */
export function verifyStripeEvent(
  // A body Cloud Functions did not keep raw cannot be verified, so it is refused rather than thrown over.
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  secret: string,
  nowMs = Date.now(),
  toleranceMs = 300_000,
): Record<string, unknown> | null {
  if (!rawBody || !rawBody.length || !header || !secret) return null;
  const parts = new Map(
    header
      .split(',')
      .map((p) => p.split('=', 2))
      .filter((p): p is [string, string] => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()] as [string, string]),
  );
  const timestamp = parts.get('t');
  if (!timestamp || !/^\d{1,15}$/.test(timestamp)) return null;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > toleranceMs) return null;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  // Every v1 signature in the header, because Stripe sends one per secret during a rotation.
  const signed = header
    .split(',')
    .map((p) => p.split('=', 2))
    .filter((p) => p[0]?.trim() === 'v1' && /^[0-9a-f]+$/i.test(p[1]?.trim() ?? ''))
    .some((p) => {
      const given = Buffer.from(p[1].trim(), 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  if (!signed) return null;
  try {
    const event = JSON.parse(body) as Record<string, unknown>;
    return typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}
