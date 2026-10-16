/**
 * Proving there is a live person holding the phone.
 *
 * An uploaded selfie proves nothing: the easiest fake driver account in
 * Pakistan is built from somebody else's CNIC and a photo of that somebody
 * pulled off Facebook. So before a driver's papers are judged at all, they are
 * asked to look into the front camera and do three things — turn left, smile,
 * look up — and we check that the three frames that come back actually show
 * those three things, in that order, on one face.
 *
 * WHY THE SERVER PICKS THE POSES. The whole scheme rests on the applicant not
 * knowing what they will be asked until they are asked. If the handset chose
 * the sequence, a patched build would choose the one sequence it already has
 * frames for and replay it forever. So `startFaceScan` mints the challenge
 * list server-side, stores it under a scan id, and `submitFaceScan` checks the
 * frames against the stored list — never against anything the client sends
 * back. The client is told the poses and nothing else.
 *
 * WHAT THIS CATCHES, honestly:
 *   · a photograph of a photograph, a printed card, a face on a laptop screen —
 *     none of which can turn their head between frames;
 *   · one person scanning on behalf of another, once the frames are compared
 *     with the CNIC (that comparison lives in the verification engine, not here);
 *   · the same three frames submitted twice (each scan id is single-use).
 *
 * WHAT IT DOES NOT CATCH: a determined attacker with a video deepfake and a
 * second screen. That is a real limit and the reason a failed scan routes to a
 * human rather than an automatic ban — see driverVerification.ts.
 *
 * WHEN IT HAPPENS, and why that is the whole trick. The scan is the LAST step
 * of an application, after every document has been uploaded and stored — never
 * before. A scan taken first can only prove that somebody live was holding the
 * phone; a scan taken last is compared, frame against card, with the CNIC and
 * the licence that were just submitted, and answers the question that actually
 * matters: are these papers this person's papers? The sequence is enforced in
 * drivers/faceScan.ts (`startFaceScan` refuses an onboarding scan before the
 * documents are there) and mirrored in the app's checklist.
 *
 * Pure functions only; the Firestore and vision halves live in
 * drivers/faceScan.ts and lib/driverVerificationLocal.ts.
 */
import type { Agreement } from './driverVerification';

/**
 * Poses that are unambiguous in a single still frame.
 *
 * Blinking is deliberately absent: it is the classic liveness challenge and it
 * is invisible in a photograph taken a moment later, so it would be a check we
 * could not actually score.
 */
export const FACE_CHALLENGES = [
  'look_straight',
  'turn_left',
  'turn_right',
  'look_up',
  'smile',
  'open_mouth',
] as const;

export type FaceChallenge = (typeof FACE_CHALLENGES)[number];

/** What the driver is told to do, on screen, in English (see the i18n rule). */
export const CHALLENGE_PROMPT: Record<FaceChallenge, string> = {
  look_straight: 'Look straight at the camera',
  turn_left: 'Slowly turn your head to the left',
  turn_right: 'Slowly turn your head to the right',
  look_up: 'Tilt your head up a little',
  smile: 'Smile',
  open_mouth: 'Open your mouth',
};

/** How the model is asked to describe what it sees, so poses can be compared. */
export const CHALLENGE_DESCRIPTION: Record<FaceChallenge, string> = {
  look_straight: 'facing the camera directly, head not turned or tilted',
  turn_left: "head turned towards the person's own left (the viewer sees their right cheek)",
  turn_right: "head turned towards the person's own right (the viewer sees their left cheek)",
  look_up: 'head tilted upwards, chin raised',
  smile: 'clearly smiling, teeth or raised cheeks visible',
  open_mouth: 'mouth open',
};

/** Frames per scan. Three is enough to break a still photo and short enough to finish. */
export const FACE_SCAN_FRAMES = 3;

/** A scan must be completed soon after it is issued, or the poses leak. */
export const FACE_SCAN_TTL_SECONDS = 180;

/** How long a passed scan stands before the driver is asked to do it again. */
export const FACE_SCAN_VALID_DAYS = 180;

/** Attempts a driver gets per hour before they have to wait. */
export const FACE_SCAN_ATTEMPTS_PER_HOUR = 8;

export type FaceScanStatus = 'pending' | 'passed' | 'failed' | 'review';

/**
 * What a scan is for. The two uses share the camera, the server-chosen poses
 * and the scoring, and differ in what the face is compared against:
 *
 *   · `onboarding` — against the CNIC and the licence that were just uploaded.
 *     Answers "are these papers yours?"
 *   · `daily`      — against the face enrolled when the application was
 *     approved. Answers "are you the driver whose account this is?" Asked once
 *     per Pakistan day, the first time the app is opened. See ./faceCheckIn.ts.
 */
export type FaceScanPurpose = 'onboarding' | 'daily';

/**
 * Whether the live face is the face on each of the two identity documents.
 *
 * TWO documents, both of them, deliberately. Either card on its own can be
 * borrowed: a licence is handed over at a checkpoint and photographed, a CNIC
 * is left with a landlord. A person who is on BOTH the CNIC and the licence
 * that were submitted together, in a scan taken seconds ago, is the person the
 * application is for.
 *
 * The vehicle papers are NOT part of this. A registration book in a father's
 * name, a car bought last week and not yet transferred, a brother's Alto driven
 * with permission — those are ordinary life here and have nothing to do with
 * who is driving. They are recorded, shown to an admin, and never allowed to
 * decide an application on their own.
 */
export interface IdentityCheck {
  /** Live face against the photograph on the CNIC front. */
  cnic: Agreement;
  /** Live face against the photograph on the driving licence. */
  license: Agreement;
  /** Live face against the face enrolled at approval. Daily checks only. */
  reference?: Agreement;
  /** Closest distance measured per document, for an admin reading the file. */
  distances?: { cnic: number | null; license: number | null; reference?: number | null };
}

/**
 * Both cards, or it is not settled.
 *
 * `mismatch` wins over everything: one card plainly belonging to somebody else
 * is the finding, whatever the other card says. After that, both have to be a
 * positive match for the identity to count as proven — an `unclear` licence
 * photograph (and plenty of older licences have one that no engine can read)
 * leaves the answer undecided, which means a human looks rather than an
 * automatic approval going through on half the evidence.
 *
 * `requireLicense` is the one concession, admin-switchable: a fleet drowning in
 * reviews caused by unreadable licence photographs can fall back to the CNIC
 * alone. The CNIC match is never optional.
 */
export function combineIdentity(
  identity: Pick<IdentityCheck, 'cnic' | 'license'>,
  requireLicense = true,
): Agreement {
  if (identity.cnic === 'mismatch' || identity.license === 'mismatch') return 'mismatch';
  if (identity.cnic !== 'match') return 'unclear';
  if (requireLicense && identity.license !== 'match') return 'unclear';
  return 'match';
}

/**
 * What a scored scan says about whose face it was, on top of the liveness
 * findings. Produced by lib/driverVerificationLocal.ts and written, minus the
 * descriptor, onto the driver document.
 */
export interface FaceScanIdentity {
  /** Both cards combined — what the admin badge and older records read. */
  matchesIdPhoto: Agreement;
  matchesCnic: Agreement;
  matchesLicense: Agreement;
  /** Against the face enrolled at approval. `unclear` when there is none. */
  matchesReference: Agreement;
  distances: { cnic: number | null; license: number | null; reference: number | null };
  /**
   * Frame 0's own 128 numbers, so a passing scan can become this driver's
   * enrolled face. Null when no face was found in that frame. Biometric data:
   * it is written only to the server-only enrolment document, never to the
   * driver document and never returned to a handset.
   */
  descriptor: number[] | null;
}

/** What the driver is told about the identity half of their scan. */
export function identityMessage(agreement: Agreement): string {
  if (agreement === 'match') return 'Face scan complete — you match your documents.';
  if (agreement === 'mismatch') {
    // Never an accusation, and never a refusal on this screen: a card
    // photograph from 2009 reads like this too. See FACE_MISMATCH_IS_REVIEW_ONLY.
    return 'Your face and the photo on your documents did not look like a match. Our team will check this by hand.';
  }
  return 'Face scan complete. We could not compare it with your document photos, so our team will check.';
}

/** What the model reports about one frame of the scan. */
export interface FaceFrameFinding {
  index: number;
  /** A face is actually present and large enough to judge. */
  faceVisible: boolean;
  /** The pose the model sees — compared against the one we asked for. */
  poseObserved: FaceChallenge | 'other' | 'unclear';
  /** Photographed off a screen, or a print held up to the lens. */
  recaptured: boolean;
  notes: string;
}

export interface FaceScanReport {
  frames: FaceFrameFinding[];
  /** All frames show one and the same person. */
  samePersonAcrossFrames: boolean;
  /** Real human being in front of a camera, not a screen, print, mask or render. */
  livePerson: boolean;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

export interface FaceScanVerdict {
  status: FaceScanStatus;
  /** How many of the requested poses were actually performed. */
  posesMatched: number;
  posesAsked: number;
  /** Stable codes, same convention as the verification reasons. */
  reasons: string[];
  /** One line for the driver. */
  message: string;
}

/**
 * Pick the poses for one scan.
 *
 * Always starts with `look_straight` — that frame is the one later compared
 * against the CNIC photograph, and a face comparison wants a front-on shot.
 * The rest are drawn without replacement from the remaining poses, so no scan
 * repeats a pose and no two scans are reliably alike.
 *
 * `random` is injected so the tests can pin the sequence.
 */
export function pickChallenges(
  count: number = FACE_SCAN_FRAMES,
  random: () => number = Math.random,
): FaceChallenge[] {
  const pool = FACE_CHALLENGES.filter((c) => c !== 'look_straight');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return ['look_straight', ...pool.slice(0, Math.max(0, count - 1))];
}

/**
 * Score a completed scan against the poses that were actually asked for.
 *
 * Strict about the things that are objective — was there a face, was it one
 * face, was it a screen — and forgiving by exactly one pose, because "turn your
 * head left" is followed imperfectly by people holding a phone at arm's length
 * in the sun, and failing an honest driver for a shallow turn is the more
 * common error than letting a fraud through on two-out-of-three.
 */
export function scoreFaceScan(params: {
  report: FaceScanReport | null;
  asked: FaceChallenge[];
}): FaceScanVerdict {
  const { report, asked } = params;
  const posesAsked = asked.length;

  // No model verdict at all (no key, a failed call) — a human decides. Never a
  // pass, because a pass here is what lets somebody start driving.
  if (!report) {
    return {
      status: 'review',
      posesMatched: 0,
      posesAsked,
      reasons: ['face_scan_unverified'],
      message: 'Your face scan is being reviewed.',
    };
  }

  const reasons: string[] = [];

  const missingFace = report.frames.filter((f) => !f.faceVisible).length;
  if (missingFace > 0) reasons.push('face_not_visible');

  if (report.frames.some((f) => f.recaptured)) reasons.push('face_scan_recaptured');
  if (!report.livePerson) reasons.push('face_scan_not_live');
  if (!report.samePersonAcrossFrames) reasons.push('face_scan_multiple_people');

  const posesMatched = asked.reduce(
    (n, challenge, i) => (report.frames.find((f) => f.index === i)?.poseObserved === challenge ? n + 1 : n),
    0,
  );
  if (posesMatched < posesAsked) reasons.push('face_scan_pose_mismatch');

  // A screen, a print, or more than one face is a fail on its own: those are
  // not "the driver held the phone badly", they are somebody trying it on.
  const hardFail =
    !report.livePerson ||
    report.frames.some((f) => f.recaptured) ||
    !report.samePersonAcrossFrames ||
    missingFace > 0;

  if (hardFail) {
    return {
      status: 'failed',
      posesMatched,
      posesAsked,
      reasons,
      message: faceScanMessage(reasons),
    };
  }

  // Every pose right, model sure → passed.
  if (posesMatched === posesAsked && report.confidence !== 'low') {
    return { status: 'passed', posesMatched, posesAsked, reasons, message: 'Face scan complete.' };
  }

  // One pose off, or the model hedging → let them try again rather than
  // sending a perfectly honest driver into a queue for a shallow head turn.
  if (posesMatched >= posesAsked - 1) {
    return {
      status: 'failed',
      posesMatched,
      posesAsked,
      reasons: [...reasons, 'face_scan_retry'],
      message: 'We could not follow all the steps. Please try the face scan again in good light.',
    };
  }

  return {
    status: 'review',
    posesMatched,
    posesAsked,
    reasons,
    message: 'Your face scan is being reviewed.',
  };
}

function faceScanMessage(reasons: string[]): string {
  if (reasons.includes('face_scan_recaptured') || reasons.includes('face_scan_not_live')) {
    return 'The face scan has to be of you, live, in front of the camera — not a photo or a screen.';
  }
  if (reasons.includes('face_scan_multiple_people')) {
    return 'The face scan showed more than one person. Please scan again on your own.';
  }
  if (reasons.includes('face_not_visible')) {
    return 'Your face was not clearly visible. Please scan again in good light with nothing covering your face.';
  }
  return 'The face scan did not pass. Please try again.';
}

/** Has this driver got a face scan that still stands? */
export function faceScanIsFresh(passedAtMs: number | null | undefined, now: number): boolean {
  if (!passedAtMs) return false;
  return now - passedAtMs < FACE_SCAN_VALID_DAYS * 24 * 60 * 60 * 1000;
}
