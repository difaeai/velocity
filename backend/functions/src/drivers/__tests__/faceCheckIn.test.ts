/**
 * The daily face check.
 *
 * Two things are being tested, and the difference between them is the whole
 * design:
 *
 *   · WHEN a driver is asked (evaluateFaceCheckIn) — once per Pakistan day, and
 *     never at all unless the check is actually being enforced for them. Three
 *     implementations have to agree on this answer: this guard, firestore.rules
 *     and apps/mobile/src/domain/faceCheckIn.ts. The cost of them disagreeing is
 *     a driver locked out of work they are entitled to.
 *
 *   · WHAT a completed check decides (scoreFaceCheckIn) — the only face
 *     comparison in this product allowed to stop somebody driving, which is why
 *     the cases below are mostly about what it is NOT allowed to do: refuse on
 *     an undecided measurement, act on a card photograph, or enrol the face of
 *     whoever happened to be holding the phone.
 *
 * Pure: no emulator, no Firestore, no clock of its own.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import {
  FACE_CHECK_IN_FRAMES,
  evaluateFaceCheckIn,
  isFaceCheckedInToday,
  scoreFaceCheckIn,
  type FaceCheckInRecord,
} from '../../domain/faceCheckIn';
import { FACE_SCAN_FRAMES, type FaceScanVerdict } from '../../domain/faceScan';

/** 15 October 2026, 09:00 in Pakistan (04:00 UTC). */
const MORNING = Date.UTC(2026, 9, 15, 4, 0);
const TODAY = '2026-10-15';

/** A driver document that answers `.get('a.b')` the way Firestore does. */
function snap(data: Record<string, unknown>): DocumentSnapshot {
  return {
    get(path: string) {
      return path.split('.').reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
        data,
      );
    },
  } as unknown as DocumentSnapshot;
}

const passed = (over: Partial<FaceCheckInRecord> = {}): FaceCheckInRecord => ({
  day: TODAY,
  status: 'passed',
  required: true,
  ...over,
});

describe('evaluateFaceCheckIn — when a driver is asked', () => {
  it('asks a driver who has never done one', () => {
    const s = evaluateFaceCheckIn({ required: true }, MORNING);
    expect(s).toMatchObject({ due: true, reason: 'never', required: true, today: TODAY });
  });

  it('does not ask again once today is done', () => {
    expect(evaluateFaceCheckIn(passed(), MORNING).due).toBe(false);
  });

  it('asks again on the next day', () => {
    expect(evaluateFaceCheckIn(passed({ day: '2026-10-14' }), MORNING).reason).toBe('new_day');
  });

  it('counts an undecided check as done for the day', () => {
    // UNDECIDED_IS_NOT_A_REFUSAL: the server let them through and told an
    // admin. Asking again would be asking them to fix something that is not
    // theirs to fix.
    expect(evaluateFaceCheckIn(passed({ status: 'review' }), MORNING).due).toBe(false);
  });

  it('keeps asking after a failure', () => {
    expect(evaluateFaceCheckIn(passed({ status: 'failed' }), MORNING).reason).toBe('failed');
  });

  it('asks nothing of a driver the check is not enforced for', () => {
    // The default, and it has to hold: the check needs a build carrying the
    // camera screen, and gating every working driver in the country on a screen
    // their app does not have is the one unrecoverable mistake here.
    const s = evaluateFaceCheckIn({}, MORNING);
    expect(s.due).toBe(true);
    expect(s.required).toBe(false);
    expect(isFaceCheckedInToday(snap({}), MORNING)).toBe(true);
  });

  it('uses the Pakistan day, not the machine the code runs on', () => {
    // 20:00 UTC on the 15th is already 01:00 on the 16th in Karachi, so a check
    // stamped with the 15th is yesterday's by then. A UTC reading would hand
    // that driver a free pass until five in the morning.
    const lateUtc = Date.UTC(2026, 9, 15, 20, 0);
    expect(evaluateFaceCheckIn(passed(), lateUtc).due).toBe(true);
    // And the reverse: 22:00 PKT on the 15th is still the 15th.
    const lateLocal = Date.UTC(2026, 9, 15, 17, 0);
    expect(evaluateFaceCheckIn(passed(), lateLocal).due).toBe(false);
  });

  it('blocks only when the check is both due and enforced', () => {
    expect(isFaceCheckedInToday(snap({ faceCheckIn: passed() }), MORNING)).toBe(true);
    expect(isFaceCheckedInToday(snap({ faceCheckIn: passed({ day: '2026-10-14' }) }), MORNING)).toBe(false);
    expect(
      isFaceCheckedInToday(snap({ faceCheckIn: passed({ day: '2026-10-14', required: false }) }), MORNING),
    ).toBe(true);
  });
});

// ── What a completed check decides ───────────────────────────────────────────

const live: FaceScanVerdict = {
  status: 'passed',
  posesMatched: FACE_CHECK_IN_FRAMES,
  posesAsked: FACE_CHECK_IN_FRAMES,
  reasons: [],
  message: 'Face scan complete.',
};

const notLive: FaceScanVerdict = {
  status: 'failed',
  posesMatched: 0,
  posesAsked: FACE_CHECK_IN_FRAMES,
  reasons: ['face_not_visible'],
  message: 'Your face was not clearly visible.',
};

describe('scoreFaceCheckIn — what a completed check decides', () => {
  it('passes the driver whose face matches the enrolled one', () => {
    const v = scoreFaceCheckIn({ liveness: live, reference: 'match', card: 'match' });
    expect(v).toMatchObject({ status: 'passed', allowed: true, enrol: true });
  });

  it('stops the day — not the account — when it is somebody else', () => {
    // The one face comparison allowed to refuse anything. It refuses TODAY: no
    // ban, no role change, nothing on their file, and they can retry at once.
    const v = scoreFaceCheckIn({ liveness: live, reference: 'mismatch', card: 'match' });
    expect(v).toMatchObject({ status: 'failed', allowed: false, enrol: false });
    expect(v.reasons).toContain('face_check_not_the_driver');
  });

  it('lets an undecided measurement through, and tells an admin', () => {
    // UNDECIDED_IS_NOT_A_REFUSAL. A mask pulled down, a streetlight behind the
    // head: blocking on "not sure" costs an honest driver a day's income on a
    // number that says nothing about them.
    const v = scoreFaceCheckIn({ liveness: live, reference: 'unclear', card: 'match' });
    expect(v).toMatchObject({ status: 'review', allowed: true, enrol: false });
  });

  it('asks again when it was not a live person following the prompts', () => {
    // Nothing was compared, so nothing is decided about identity: it is the
    // camera that failed, and the answer to that is another go.
    const v = scoreFaceCheckIn({ liveness: notLive, reference: 'match', card: 'match' });
    expect(v).toMatchObject({ status: 'failed', allowed: false, enrol: false });
    expect(v.reasons).toEqual(notLive.reasons);
    expect(v.message).toBe(notLive.message);
  });

  it('falls back to the CNIC for a driver who was never enrolled', () => {
    // Approved before enrolment existed. Their first check both proves them
    // against the card on file and becomes the reference from then on.
    const v = scoreFaceCheckIn({ liveness: live, reference: null, card: 'match' });
    expect(v).toMatchObject({ status: 'passed', allowed: true, enrol: true });
    expect(v.reasons).toContain('face_check_matched_card');
  });

  it('never blocks a working driver on a card photograph', () => {
    // A laminated CNIC portrait from 2009 is the hard comparison this system
    // refuses nobody on — so an unenrolled driver keeps working and a human
    // looks at it.
    const v = scoreFaceCheckIn({ liveness: live, reference: null, card: 'mismatch' });
    expect(v).toMatchObject({ status: 'review', allowed: true });
    // …and that face does not become the account's reference, which would be
    // this very substitution performed by us.
    expect(v.enrol).toBe(false);
  });

  it('enrols a first check that nothing contradicts', () => {
    const v = scoreFaceCheckIn({ liveness: live, reference: null, card: 'unclear' });
    expect(v).toMatchObject({ status: 'review', allowed: true, enrol: true });
  });
});

describe('the daily check is shorter than the onboarding one', () => {
  it('asks for fewer frames', () => {
    // Every frame costs a driver four seconds of a morning they are trying to
    // start earning in, every single day. The question here is "same person,
    // live", not "can this applicant follow three instructions".
    expect(FACE_CHECK_IN_FRAMES).toBeLessThan(FACE_SCAN_FRAMES);
    expect(FACE_CHECK_IN_FRAMES).toBeGreaterThanOrEqual(2);
  });
});
