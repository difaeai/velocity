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

/**
 * What a scan is for.
 *
 *   · `onboarding` — the last step of an application, after every document has
 *     been uploaded. The live face is compared with the photographs on the CNIC
 *     and the licence that were just submitted, which is the whole reason it
 *     comes last and not first.
 *   · `daily` — the first time an approved driver opens the app each day,
 *     compared against the face enrolled when they were approved. See
 *     ./faceCheckIn.ts.
 */
export type FaceScanPurpose = 'onboarding' | 'daily';

export type FaceAgreement = 'match' | 'mismatch' | 'unclear';

/** How the face scan looks on `drivers/{uid}`, written only by the backend. */
export interface FaceScanState {
  scanId?: string;
  status?: FaceScanStatus;
  /** The two cards combined: a match means both of them. */
  matchesDocuments?: FaceAgreement;
  /** Against the CNIC portrait on its own. */
  matchesCnic?: FaceAgreement;
  /** Against the licence portrait on its own. */
  matchesLicense?: FaceAgreement;
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

/**
 * Seconds before the shutter fires on a pose the phone cannot read for itself
 * (no reader on the build, or a pose outside ./faceLiveness.ts JUDGED_ON_PHONE).
 * Every other pose is captured the moment it is seen.
 */
export const POSE_COUNTDOWN_SECONDS = 3;
