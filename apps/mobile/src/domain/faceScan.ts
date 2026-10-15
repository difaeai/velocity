/**
 * The driver's live face scan, as the app needs to know it.
 *
 * Deliberately thin. The scoring, the poses and the wording all live on the
 * server (backend/functions/src/domain/faceScan.ts) and arrive with the
 * `startFaceScan` response — the handset is told what to ask for and never
 * decides it, because an applicant who knows the poses in advance can prepare
 * for them, and that is the one thing this check exists to prevent.
 *
 * So what is here is only what the UI genuinely needs: the names of the poses
 * (to draw the right little diagram), and how long the driver has.
 *
 * TWO implementations exist and this one is the follower:
 *   · backend/functions/src/domain/faceScan.ts — the real one;
 *   · here — types and presentation only.
 */

/** The poses the server may ask for. Mirrors FACE_CHALLENGES on the backend. */
export const FACE_CHALLENGES = [
  'look_straight',
  'turn_left',
  'turn_right',
  'look_up',
  'smile',
  'open_mouth',
] as const;

export type FaceChallenge = (typeof FACE_CHALLENGES)[number];

export type FaceScanStatus = 'pending' | 'passed' | 'failed' | 'review';

/** How the face scan looks on `drivers/{uid}`, written only by the backend. */
export interface FaceScanState {
  scanId?: string;
  status?: FaceScanStatus;
  matchesDocuments?: 'match' | 'mismatch' | 'unclear';
  posesMatched?: number;
  posesAsked?: number;
  passedAt?: { seconds: number } | null;
  checkedAt?: { seconds: number };
  reasons?: string[];
}

/**
 * A hint drawn under the instruction, so a driver who cannot read the English
 * prompt still knows which way to turn. Kept as an arrow rather than a word on
 * purpose — the app's text is English (see the i18n rule) and an arrow is not
 * text.
 */
export const CHALLENGE_GLYPH: Record<FaceChallenge, string> = {
  look_straight: '•',
  turn_left: '←',
  turn_right: '→',
  look_up: '↑',
  smile: '◡',
  open_mouth: '○',
};

/** Seconds a driver is given to settle into each pose before the shutter fires. */
export const POSE_COUNTDOWN_SECONDS = 3;
