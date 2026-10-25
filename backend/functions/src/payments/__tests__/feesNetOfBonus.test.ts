/**
 * A driver's bonus pays their cancellation fees first, so the fees gate only
 * blocks on what the bonus cannot cover (owner's rule, 2026-10-26).
 */
import { describe, it, expect } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { assertOutstandingClear, DEFAULT_CANCELLATION } from '../../domain/cancellation';

const wallet = (outstanding: number) =>
  ({ get: (k: string) => (k === 'outstanding' ? outstanding : undefined) }) as unknown as DocumentSnapshot;

describe('assertOutstandingClear with a bonus', () => {
  const limit = DEFAULT_CANCELLATION.outstandingLimit; // 300

  it('lets a driver work while the bonus covers the fees', () => {
    expect(() => assertOutstandingClear(wallet(400), DEFAULT_CANCELLATION, 'driver', 2000)).not.toThrow();
  });

  it('blocks only on the part the bonus cannot pay, and quotes that part', () => {
    expect(() => assertOutstandingClear(wallet(limit + 50), DEFAULT_CANCELLATION, 'driver', 51)).not.toThrow();
    expect(() => assertOutstandingClear(wallet(limit + 50), DEFAULT_CANCELLATION, 'driver', 50)).toThrow(
      `pay ${limit} PKR`,
    );
  });

  it('is unchanged without a bonus', () => {
    expect(() => assertOutstandingClear(wallet(limit), DEFAULT_CANCELLATION, 'passenger')).toThrow();
    expect(() => assertOutstandingClear(wallet(limit - 1), DEFAULT_CANCELLATION, 'driver')).not.toThrow();
  });
});
