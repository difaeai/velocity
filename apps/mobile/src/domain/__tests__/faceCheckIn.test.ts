/**
 * The daily face-check rule, as the app computes it.
 *
 * Worth testing directly for the same reason as the car photo beside it: three
 * separate implementations have to agree — this one, `firestore.rules`, and the
 * backend guard — and the cost of them disagreeing is a driver pressing Online
 * into a write Firestore silently refuses, or being sent to a camera for a check
 * nobody is asking for.
 *
 * The two answers this file is responsible for are deliberately different:
 * `due` is "should they be asked", `blocking` is "may they be stopped". Only the
 * server decides the second one, and it says so on the driver document.
 */
import { describe, expect, it } from 'vitest';

import { evaluateFaceCheckIn, pktDayKey, type FaceCheckIn } from '../faceCheckIn';

/** 15 October 2026, 09:00 in Pakistan (04:00 UTC). */
const MORNING = Date.UTC(2026, 9, 15, 4, 0);
const TODAY = '2026-10-15';

const check = (over: Partial<FaceCheckIn> = {}): { faceCheckIn: FaceCheckIn } => ({
  faceCheckIn: { day: TODAY, status: 'passed', required: true, ...over },
});

describe('evaluateFaceCheckIn', () => {
  it('asks a driver who has never done one', () => {
    expect(evaluateFaceCheckIn(null, MORNING)).toMatchObject({ due: true, reason: 'never' });
    expect(evaluateFaceCheckIn({}, MORNING)).toMatchObject({ due: true, reason: 'never' });
  });

  it('asks nothing more once today is done', () => {
    expect(evaluateFaceCheckIn(check(), MORNING)).toMatchObject({ due: false, blocking: false });
  });

  it('asks again the next morning', () => {
    expect(evaluateFaceCheckIn(check({ day: '2026-10-14' }), MORNING).reason).toBe('new_day');
  });

  it('treats an undecided check as done', () => {
    // The server let them through and flagged it. Asking again would be asking
    // the driver to fix something that is not theirs to fix.
    expect(evaluateFaceCheckIn(check({ status: 'review' }), MORNING).due).toBe(false);
  });

  it('keeps asking after a failed check', () => {
    const s = evaluateFaceCheckIn(check({ status: 'failed' }), MORNING);
    expect(s).toMatchObject({ due: true, reason: 'failed', blocking: true });
  });

  it('never blocks a driver the check is not enforced for', () => {
    // `required` is absent on every driver until the business switches the
    // check on. An app build that has the screen must not nag them, and must
    // never gate the Online toggle on it: the rules would let that write
    // through, so the button would work and the screen would be a lie.
    const s = evaluateFaceCheckIn(check({ day: '2026-10-14', required: false }), MORNING);
    expect(s.due).toBe(true);
    expect(s.blocking).toBe(false);
  });

  it('counts the day in Pakistan, not on the handset', () => {
    // A phone set to UTC would otherwise disagree with the server about when
    // today started and ask for a second check at an hour that makes no sense.
    expect(pktDayKey(new Date(Date.UTC(2026, 9, 15, 20, 0)))).toBe('2026-10-16');
    expect(evaluateFaceCheckIn(check(), Date.UTC(2026, 9, 15, 20, 0)).due).toBe(true);
    expect(evaluateFaceCheckIn(check(), Date.UTC(2026, 9, 15, 17, 0)).due).toBe(false);
  });
});
