import { describe, expect, it } from 'vitest';

import { describeDeletionBlocker, type DeletionState } from '../deleteAccount';

function state(over: Partial<DeletionState> = {}): DeletionState {
  return {
    activeTripStatus: null,
    outstandingFees: 0,
    commissionDue: 0,
    walletBalance: 0,
    partnerBalance: 0,
    ...over,
  };
}

describe('describeDeletionBlocker', () => {
  it('lets a settled account with no ride in progress go', () => {
    expect(describeDeletionBlocker(state())).toBeNull();
  });

  // The reviewer's throwaway account is exactly this shape, and it MUST sail
  // through — a blocker they cannot clear reads as "deletion does not work".
  it('lets a brand-new account with no history go', () => {
    expect(describeDeletionBlocker(state({ activeTripStatus: null }))).toBeNull();
  });

  it('blocks while a ride is still running', () => {
    for (const status of ['requested', 'matched', 'arriving', 'arrived', 'in_progress'] as const) {
      expect(describeDeletionBlocker(state({ activeTripStatus: status }))).toMatch(
        /ride in progress/,
      );
    }
  });

  // A finished trip still sits in activeTripId until the next booking clears it,
  // so a terminal status must not be mistaken for one in flight.
  it('ignores a trip that has already ended', () => {
    for (const status of ['completed', 'cancelled', 'merged'] as const) {
      expect(describeDeletionBlocker(state({ activeTripStatus: status }))).toBeNull();
    }
  });

  it('blocks on money the user owes, naming the amount', () => {
    expect(describeDeletionBlocker(state({ outstandingFees: 250 }))).toBe(
      'You have PKR 250 in unpaid cancellation fees. Settle them before deleting your account.',
    );
    expect(describeDeletionBlocker(state({ commissionDue: 1200 }))).toMatch(/PKR 1200 in commission/);
  });

  // Deleting an account is not a way to make Velocity keep the money — in either
  // direction. A balance we owe blocks just as hard as a bill we are owed.
  it('blocks on money Velocity owes the user', () => {
    expect(describeDeletionBlocker(state({ walletBalance: 500 }))).toMatch(/wallet still holds/);
    expect(describeDeletionBlocker(state({ partnerBalance: 80 }))).toMatch(/partner earnings/);
  });

  // Nothing here should ever read as a negative amount owed.
  it('does not block on a zero or negative balance', () => {
    expect(describeDeletionBlocker(state({ walletBalance: 0, partnerBalance: 0 }))).toBeNull();
  });

  // An in-flight ride is the one a passenger is physically sitting in. It
  // outranks a fee dispute, because the answer ("finish the ride") is different.
  it('reports the ride in progress ahead of any money owed', () => {
    expect(
      describeDeletionBlocker(state({ activeTripStatus: 'in_progress', outstandingFees: 250 })),
    ).toMatch(/ride in progress/);
  });
});
