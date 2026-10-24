/**
 * What the phone accepts as each pose of the face scan.
 *
 * Worth pinning because the two ways this goes wrong look identical to a
 * driver — the screen never moves on. Too strict and an honest turn is never
 * captured (the bug this replaced: a scan that "detected nothing"); too loose
 * and a frame the server will refuse is sent off as done.
 */
import { describe, expect, it } from 'vitest';

import {
  FACE_MIN_WIDTH,
  NO_PROGRESS,
  STRAIGHT_MAX_DEG,
  TURN_MIN_DEG,
  judgeFrame,
  type PoseProgress,
} from '../faceLiveness';
import type { FaceReading } from '../../../modules/velocity-face';

const face = (yaw: number, width = 0.4): FaceReading => ({
  count: 1,
  yaw,
  box: { x: 0.3, y: 0.2, width, height: width * 1.3 },
});

/** The driver has looked straight at the camera, slightly off centre as people do. */
const afterStraight: PoseProgress = { straightYaw: 4, firstTurn: null };

describe('judgeFrame — finding the face', () => {
  it('asks for a face when there is none', () => {
    expect(judgeFrame('look_straight', { count: 0 }, NO_PROGRESS)).toEqual({
      ok: false,
      hint: 'Fit your face inside the oval',
    });
  });

  it('refuses a second person in the picture', () => {
    expect(judgeFrame('look_straight', { ...face(0), count: 2 }, NO_PROGRESS)).toMatchObject({ ok: false });
  });

  it('asks a driver holding the phone far away to come closer', () => {
    const verdict = judgeFrame('look_straight', face(0, FACE_MIN_WIDTH - 0.05), NO_PROGRESS);
    expect(verdict).toEqual({ ok: false, hint: 'Bring the phone a little closer' });
  });
});

describe('judgeFrame — looking straight', () => {
  it('takes a frontal face and remembers its angle', () => {
    expect(judgeFrame('look_straight', face(STRAIGHT_MAX_DEG - 1), NO_PROGRESS)).toEqual({
      ok: true,
      progress: { straightYaw: STRAIGHT_MAX_DEG - 1, firstTurn: null },
    });
  });

  it('waits for a face that is already turned', () => {
    expect(judgeFrame('look_straight', face(25), NO_PROGRESS)).toEqual({
      ok: false,
      hint: 'Look straight at the camera',
    });
  });
});

describe('judgeFrame — turning', () => {
  it('captures a slight turn, measured from the driver own straight frame', () => {
    const verdict = judgeFrame('turn_right', face(4 + TURN_MIN_DEG), afterStraight);
    expect(verdict).toEqual({ ok: true, progress: { straightYaw: 4, firstTurn: 1 } });
  });

  it('does not count the angle the driver started at', () => {
    // 4° off straight already: an absolute 18° is only a 14° turn.
    expect(judgeFrame('turn_right', face(TURN_MIN_DEG), afterStraight)).toMatchObject({ ok: false });
  });

  it('accepts either direction for the first turn — mirroring is unknowable', () => {
    expect(judgeFrame('turn_right', face(4 - TURN_MIN_DEG), afterStraight)).toEqual({
      ok: true,
      progress: { straightYaw: 4, firstTurn: -1 },
    });
  });

  it('says "a little further" for a turn that has started but not arrived', () => {
    expect(judgeFrame('turn_left', face(4 + TURN_MIN_DEG * 0.6), afterStraight)).toEqual({
      ok: false,
      hint: 'A little further',
    });
  });

  it('says nothing extra while the driver has not started — the prompt already does', () => {
    expect(judgeFrame('turn_left', face(5), afterStraight)).toEqual({ ok: false, hint: null });
  });

  it('sends the second turn the other way', () => {
    const turnedOnce: PoseProgress = { straightYaw: 4, firstTurn: 1 };
    // Still turned the first way: that is not the second turn.
    expect(judgeFrame('turn_left', face(4 + TURN_MIN_DEG + 5), turnedOnce)).toEqual({
      ok: false,
      hint: 'Now turn the other way',
    });
    expect(judgeFrame('turn_left', face(4 - TURN_MIN_DEG), turnedOnce)).toEqual({
      ok: true,
      progress: turnedOnce,
    });
  });
});
