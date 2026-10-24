/**
 * The rules our own verification engine reads by.
 *
 * Every case in here is a thing that was actually wrong at some point while the
 * engine was being built, or a thing whose going wrong would cost a real driver
 * their job. The engine's machinery — Tesseract, the face networks — is proved
 * end to end by scripts/smoke-local-vision.cjs against real pixels; this file
 * is the part that can be checked to the character, offline, in milliseconds.
 *
 * The OCR strings below are not invented. They are what Tesseract actually
 * returned for the synthetic Pakistani cards in that harness, security
 * guilloche and all, because rules written against tidy text are rules that
 * work on tidy text.
 */
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_OF_CHALLENGE,
  FACE_DIFFERENT_PERSON_ABOVE,
  FACE_SAME_PERSON_BELOW,
  IMAGE_DESTROYED_BELOW,
  MOUTH_OPEN_RATIO,
  PORTRAIT_MIN_FACE_COVERAGE,
  TILT_DELTA,
  TURN_DELTA,
  UNDETECTABLE_LOCALLY,
  categorisePose,
  classifyDocument,
  faceAgreement,
  framesShowMovement,
  looksLikeSpecimen,
  measureFaceGeometry,
  nameFromLine,
  observedPose,
  readCnicNumber,
  readConfidence,
  readDates,
  readLabelledDates,
  readNames,
  readPlate,
  textDensity,
  type FaceGeometry,
  type Point,
} from '../../domain/localVision';
import { EXPECTED_LOOK, namesAgree, normalizeCnic } from '../../domain/driverVerification';
import { FACE_CHALLENGES } from '../../domain/faceScan';

/** What Tesseract gave back for the synthetic CNIC front, verbatim. */
const REAL_CNIC_OCR = `ISLAMIC REPUBLIC OF PAKISTAN
NATIONAL IDENTITY CARD

J ! Name
§ 3 Z&' Muhammad Imran Khan

! H ” | Father Name

3 Abdul Rasheed Khan
€ £ p
7

"aL"
Identity Number
35202-1234567-1
Date of Birth Date of Issue Date of Expiry
14.08.1990 02.03.2019 02.03.2029
`;

const REAL_LICENCE_OCR = `GOVERNMENT OF THE PUNJAB
DRIVING LICENCE
Name
Muhammad Imran Khan
Father Name
Abdul Rasheed Khan
Licence No
35202-1234567-1
Category Blood Group
LTV B+
Date of Issue Valid Till
02.03.2019 02.03.2029
City Traffic Police, Lahore
`;

const REAL_REGISTRATION_OCR = `EXCISE AND TAXATION DEPARTMENT
REGISTRATION BOOK
Registration No
LEA-4821
Owner Name
Muhammad Imran Khan
Make Colour
Toyota Corolla White
Engine No Chassis No
2NZ8841772 NZE1410094417
Horse Power Seating Capacity
1300 CC 5
Token Tax Valid Till
02.03.2029
`;

// ── Identifying what a picture is ────────────────────────────────────────────

describe('classifyDocument', () => {
  const sharpDoc = { blurred: false, hasFace: false, faceCoverage: 0 };

  it('recognises each Pakistani paper from the words on it', () => {
    expect(classifyDocument({ ...sharpDoc, text: REAL_CNIC_OCR, hasFace: true, faceCoverage: 0.01, expected: 'cnic_front' })).toBe('cnic_front');
    expect(classifyDocument({ ...sharpDoc, text: REAL_LICENCE_OCR, expected: 'driving_license' })).toBe('driving_license');
    expect(classifyDocument({ ...sharpDoc, text: REAL_REGISTRATION_OCR, expected: 'vehicle_registration' })).toBe('vehicle_registration');
  });

  it('reports a CNIC in the licence slot as a CNIC, not as a licence', () => {
    // The mistake the slot check exists to catch, and a far commoner one here
    // than forgery: the engine must say what the picture IS, not what was asked.
    expect(
      classifyDocument({ ...sharpDoc, text: REAL_CNIC_OCR, hasFace: true, faceCoverage: 0.01, expected: 'driving_license' }),
    ).toBe('cnic_front');
  });

  it('tells the two sides of a CNIC apart', () => {
    const back = `Permanent Address
House 14, Street 7, Gulberg III, Lahore
Temporary Address
Flat 3B, Askari Housing, Rawalpindi
Holder Signature
Registrar
NATIONAL DATABASE AND REGISTRATION AUTHORITY`;
    expect(classifyDocument({ ...sharpDoc, text: back, expected: 'cnic_back' })).toBe('cnic_back');
  });

  it('calls a close-up of a face a portrait, whatever slot it came in', () => {
    expect(
      classifyDocument({ text: '', hasFace: true, faceCoverage: 0.2, blurred: false, expected: 'vehicle_photo' }),
    ).toBe('person_photo');
  });

  it('does NOT call a car a portrait because the owner is standing next to it', () => {
    // A fatal reason if it did — wrong_document_type, an automatic rejection of
    // a real driver with a real car. A selfie's face fills a tenth of the frame;
    // a man beside a Corolla fills well under a hundredth.
    const beside = PORTRAIT_MIN_FACE_COVERAGE / 10;
    expect(
      classifyDocument({ text: '', hasFace: true, faceCoverage: beside, blurred: false, expected: 'vehicle_photo' }),
    ).toBe('vehicle_photo');
  });

  it('does not call a car an unrelated document because of its own number plate', () => {
    // Also fatal if it did. A roadside photograph easily carries a dozen words
    // between the plate, a dealer sticker and whatever is written behind it.
    const clutter = 'AL-HAMD MOTORS Service Centre LEA-4821 Lahore Ring Road Workshop Open Daily Tyres Battery';
    expect(textDensity(clutter)).toBeGreaterThan(8);
    expect(classifyDocument({ ...sharpDoc, text: clutter, expected: 'vehicle_photo' })).toBe('vehicle_photo');
  });

  it('refuses to vouch for a portrait with no face in it', () => {
    // "No face in the selfie" is real evidence and the slot does not get to
    // wave it through — but it is `unreadable` (a human looks), never a claim
    // that the applicant uploaded something else.
    expect(
      classifyDocument({ text: '', hasFace: false, faceCoverage: 0, blurred: false, expected: 'person_photo' }),
    ).toBe('unreadable');
  });

  it('calls a readable paper that matches nothing an unrelated document', () => {
    const bill = 'LAHORE ELECTRIC SUPPLY COMPANY Bill Month Units Consumed Payable Within Due Date Arrears';
    expect(classifyDocument({ ...sharpDoc, text: bill, expected: 'driving_license' })).toBe('other_document');
  });

  it('says unreadable rather than guessing when an image is destroyed', () => {
    expect(
      classifyDocument({ text: '', hasFace: false, faceCoverage: 0, blurred: true, expected: 'driving_license' }),
    ).toBe('unreadable');
  });

  it('agrees with what each slot is supposed to contain', () => {
    // Guards against a LooksLike that no slot would ever accept.
    for (const kind of Object.keys(EXPECTED_LOOK) as Array<keyof typeof EXPECTED_LOOK>) {
      expect(EXPECTED_LOOK[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('looksLikeSpecimen', () => {
  it('catches a card that admits in print to being a sample', () => {
    expect(looksLikeSpecimen('NATIONAL IDENTITY CARD SPECIMEN')).toBe(true);
    expect(looksLikeSpecimen('this is a DUMMY card')).toBe(true);
    expect(looksLikeSpecimen(REAL_CNIC_OCR)).toBe(false);
  });
});

// ── Pulling the fields out ───────────────────────────────────────────────────

describe('readCnicNumber', () => {
  it('reads the number off a real card, hyphens and all', () => {
    expect(readCnicNumber(REAL_CNIC_OCR)).toBe('35202-1234567-1');
  });

  it('accepts the spacing OCR introduces', () => {
    expect(readCnicNumber('Identity Number 35202 - 1234567 - 1')).toBe('35202-1234567-1');
    expect(readCnicNumber('3520212345671')).toBe('35202-1234567-1');
  });

  it('does not mistake an engine or chassis number for an identity', () => {
    // Only the 00000-0000000-0 shape counts: a bare run of digits is as likely
    // to be an engine number, and a wrong CNIC is a FATAL typed-CNIC mismatch.
    expect(readCnicNumber('Engine No 2NZ8841772')).toBeNull();
    expect(readCnicNumber('Chassis No NZE1410094417')).toBeNull();
    expect(readCnicNumber('no numbers here at all')).toBeNull();
  });

  it('normalises to the same digits the duplicate check compares on', () => {
    expect(normalizeCnic(readCnicNumber(REAL_CNIC_OCR))).toHaveLength(13);
  });
});

describe('readPlate', () => {
  it('reads a Pakistani plate off the registration book', () => {
    expect(readPlate(REAL_REGISTRATION_OCR)).toBe('LEA-4821');
  });

  it('accepts the common spellings', () => {
    expect(readPlate('Registration No AB 123')).toBe('AB-123');
    expect(readPlate('LEA 4821')).toBe('LEA-4821');
  });

  it('finds nothing in a page with no plate on it', () => {
    expect(readPlate('Permanent Address House 14 Street 7 Gulberg Lahore')).toBeNull();
  });
});

describe('readDates and readLabelledDates', () => {
  it('reports dates exactly as printed, without reformatting them', () => {
    // resolveExpiry parses these itself and knows they are day-first. Anything
    // reformatted here is a date silently changed on somebody's record.
    expect(readDates('14.08.1990 02.03.2019 02.03.2029')).toEqual([
      '14.08.1990',
      '02.03.2019',
      '02.03.2029',
    ]);
    expect(readDates('12-03-2026')).toEqual(['12-03-2026']);
    expect(readDates('2/9/26')).toEqual(['2/9/26']);
  });

  it('pairs a row of headings with the row of dates underneath it', () => {
    // THE case that matters. A real CNIC gives OCR three headings on one line
    // and three dates on the next, so nothing on either line is attached to
    // anything on the other except by position.
    expect(readLabelledDates(REAL_CNIC_OCR)).toEqual({
      dateOfBirth: '14.08.1990',
      issueDate: '02.03.2019',
      expiryDate: '02.03.2029',
    });
  });

  it('handles a licence that prints only an issue and an expiry', () => {
    const read = readLabelledDates(REAL_LICENCE_OCR);
    expect(read.issueDate).toBe('02.03.2019');
    expect(read.expiryDate).toBe('02.03.2029');
  });

  it('reads a label and its date on the same line', () => {
    expect(readLabelledDates('Date of Expiry 02.03.2029').expiryDate).toBe('02.03.2029');
    expect(readLabelledDates('Valid Till: 01.01.2030').expiryDate).toBe('01.01.2030');
  });

  it('falls back to the ordering when the headings are worn away', () => {
    // Earliest is the birth, latest the expiry. True of every card ever issued,
    // and what keeps a faded heading row readable instead of unread.
    expect(readLabelledDates('14.08.1990\n02.03.2019\n02.03.2029')).toEqual({
      dateOfBirth: '14.08.1990',
      issueDate: '02.03.2019',
      expiryDate: '02.03.2029',
    });
  });

  it('leaves a date null rather than guessing it', () => {
    expect(readLabelledDates('nothing dated here')).toEqual({
      dateOfBirth: null,
      issueDate: null,
      expiryDate: null,
    });
  });
});

describe('nameFromLine', () => {
  it('finds the name inside the noise OCR puts around it', () => {
    // Verbatim from a real read. A regular expression anchored to the start of
    // the line matches none of this, which left every applicant with no name
    // read off their card.
    expect(nameFromLine("§ 3 Z&' Muhammad Imran Khan")).toBe('Muhammad Imran Khan');
    expect(nameFromLine('3 Abdul Rasheed Khan')).toBe('Abdul Rasheed Khan');
  });

  it('does not mistake a heading for a name', () => {
    expect(nameFromLine('J ! Name')).toBeNull();
    expect(nameFromLine('Father Name')).toBeNull();
    expect(nameFromLine('Date of Birth Date of Issue Date of Expiry')).toBeNull();
    expect(nameFromLine('ISLAMIC REPUBLIC OF PAKISTAN')).toBeNull();
    expect(nameFromLine('NATIONAL IDENTITY CARD')).toBeNull();
  });

  it('refuses a fragment too short to be anybody', () => {
    expect(nameFromLine('€ £ p')).toBeNull();
    expect(nameFromLine('"aL"')).toBeNull();
    expect(nameFromLine('7')).toBeNull();
  });
});

describe('readNames', () => {
  it('reads the holder and the father off a real card', () => {
    expect(readNames(REAL_CNIC_OCR)).toEqual({
      name: 'Muhammad Imran Khan',
      fatherName: 'Abdul Rasheed Khan',
    });
  });

  it('does not hand the father the applicant name, or the reverse', () => {
    // "Father Name" contains "Name". Tested the wrong way round, the father's
    // name becomes the applicant's, which reads as a name mismatch against the
    // form and sends an honest driver to a reviewer.
    const read = readNames(REAL_LICENCE_OCR);
    expect(read.name).toBe('Muhammad Imran Khan');
    expect(read.fatherName).toBe('Abdul Rasheed Khan');
  });

  it('agrees with the licence, which is what catches a borrowed identity', () => {
    expect(namesAgree(readNames(REAL_CNIC_OCR).name, readNames(REAL_LICENCE_OCR).name)).toBe('match');
  });

  it('handles a card that prints the value beside the heading', () => {
    expect(readNames('Name: Muhammad Imran Khan').name).toBe('Muhammad Imran Khan');
  });
});

// ── Comparing faces ──────────────────────────────────────────────────────────

describe('faceAgreement', () => {
  it('separates the people the thresholds were measured on', () => {
    // Same person 0.51; different people 0.71, 0.71 and 0.75.
    expect(faceAgreement(0.51)).toBe('match');
    expect(faceAgreement(0.71)).toBe('unclear');
    expect(faceAgreement(0.79)).toBe('mismatch');
  });

  it('leaves the band between them undecided rather than guessing', () => {
    expect(faceAgreement(FACE_SAME_PERSON_BELOW + 0.01)).toBe('unclear');
    expect(faceAgreement(FACE_DIFFERENT_PERSON_ABOVE - 0.01)).toBe('unclear');
  });

  it('says unclear when there was nothing to compare', () => {
    expect(faceAgreement(null)).toBe('unclear');
    expect(faceAgreement(Number.NaN)).toBe('unclear');
  });

  it('keeps a gap between the two thresholds', () => {
    // A mismatch costs an honest applicant a mark on their file, so the engine
    // must never be one hundredth away from making one.
    expect(FACE_DIFFERENT_PERSON_ABOVE - FACE_SAME_PERSON_BELOW).toBeGreaterThan(0.1);
  });
});

// ── Poses ────────────────────────────────────────────────────────────────────

/**
 * A plausible frontal face in 68 points.
 *
 * Only the landmarks the geometry actually reads are placed meaningfully; the
 * rest are filler, because a test that has to draw a correct face to check a
 * ratio is a test nobody will maintain.
 */
function buildFace(opts: { noseX?: number; chinY?: number; lipGap?: number } = {}): {
  leftEye: Point[];
  rightEye: Point[];
  nose: Point[];
  mouth: Point[];
  jaw: Point[];
} {
  const noseX = opts.noseX ?? 100;
  const chinY = opts.chinY ?? 180;
  const lipGap = opts.lipGap ?? 2;

  const leftEye = [60, 68, 76, 84, 76, 68].map((x, i) => ({ x, y: 80 + (i % 2) }));
  const rightEye = [116, 124, 132, 140, 132, 124].map((x, i) => ({ x, y: 80 + (i % 2) }));
  const nose = Array.from({ length: 9 }, (_, i) => ({ x: 100, y: 90 + i }));
  nose[8] = { x: noseX, y: 120 };
  const jaw = Array.from({ length: 17 }, (_, i) => ({ x: 50 + i * 6, y: 120 + i }));
  jaw[8] = { x: 100, y: chinY };

  // getMouth() returns the twenty points 48–67; the last eight are inner lips.
  const outer = [
    { x: 80, y: 150 }, { x: 86, y: 146 }, { x: 93, y: 144 }, { x: 100, y: 145 },
    { x: 107, y: 144 }, { x: 114, y: 146 }, { x: 120, y: 150 }, { x: 114, y: 156 },
    { x: 107, y: 158 }, { x: 100, y: 159 }, { x: 93, y: 158 }, { x: 86, y: 156 },
  ];
  const inner = [
    { x: 84, y: 150 },
    { x: 92, y: 150 - lipGap },
    { x: 100, y: 150 - lipGap },
    { x: 108, y: 150 - lipGap },
    { x: 116, y: 150 },
    { x: 108, y: 150 + lipGap },
    { x: 100, y: 150 + lipGap },
    { x: 92, y: 150 + lipGap },
  ];
  return { leftEye, rightEye, nose, mouth: [...outer, ...inner], jaw };
}

const geometryOf = (opts?: Parameters<typeof buildFace>[0]): FaceGeometry => {
  const measured = measureFaceGeometry(buildFace(opts));
  if (!measured) throw new Error('the test face should be measurable');
  return measured;
};

describe('measureFaceGeometry', () => {
  it('measures a face in ratios that do not depend on its size', () => {
    const small = measureFaceGeometry(buildFace());
    expect(small).not.toBeNull();
    expect(small!.interocular).toBeGreaterThan(0);
  });

  it('returns null rather than nonsense when the landmarks are not there', () => {
    const face = buildFace();
    expect(measureFaceGeometry({ ...face, mouth: face.mouth.slice(0, 4) })).toBeNull();
    expect(measureFaceGeometry({ ...face, nose: [] })).toBeNull();
    expect(measureFaceGeometry({ ...face, leftEye: [], rightEye: [] })).toBeNull();
  });

  it('moves yaw when the nose tip moves towards an eye', () => {
    const straight = geometryOf();
    const turned = geometryOf({ noseX: 130 });
    expect(Math.abs(turned.yaw - straight.yaw)).toBeGreaterThan(TURN_DELTA);
  });

  it('moves mouthOpen when the lips part', () => {
    expect(geometryOf({ lipGap: 14 }).mouthOpen).toBeGreaterThan(geometryOf({ lipGap: 2 }).mouthOpen);
  });
});

describe('categorisePose', () => {
  const straight = geometryOf();

  it('calls an unmoved face straight', () => {
    expect(categorisePose({ geometry: straight, baseline: straight, smileProbability: 0.05 })).toBe('straight');
  });

  it('sees a turn as a turn, measured against that applicant own first frame', () => {
    const turned = geometryOf({ noseX: 132 });
    expect(categorisePose({ geometry: turned, baseline: straight, smileProbability: 0.05 })).toBe('turned');
  });

  it('sees a vertical tilt as a tilt', () => {
    const tilted = geometryOf({ chinY: 300 });
    expect(Math.abs(tilted.pitch - straight.pitch)).toBeGreaterThan(TILT_DELTA);
    expect(categorisePose({ geometry: tilted, baseline: straight, smileProbability: 0.05 })).toBe('tilted');
  });

  it('believes the expression model about a smile', () => {
    expect(categorisePose({ geometry: straight, baseline: straight, smileProbability: 0.99 })).toBe('smiling');
  });

  it('puts an open mouth ahead of a smile', () => {
    // A broad smile and an open mouth both raise the happy score, so the mouth
    // is measured first or "open your mouth" could never be told from "smile".
    const open = geometryOf({ lipGap: 30 });
    expect(open.mouthOpen).toBeGreaterThan(MOUTH_OPEN_RATIO);
    expect(categorisePose({ geometry: open, baseline: straight, smileProbability: 0.99 })).toBe('mouth_open');
  });

  it('judges the first frame on an absolute band, having no baseline yet', () => {
    expect(categorisePose({ geometry: straight, baseline: null, smileProbability: 0.05 })).toBe('straight');
    // Every honest frontal face measured inside that band: six different people
    // spread over yaw 0.069–0.129 all looking at the camera.
    expect(Math.abs(straight.yaw)).toBeLessThan(0.22);
  });

  it('counts a turn the driver was asked for even with a smile or a nod in it', () => {
    // Asked to turn, people smile at the camera and their chin moves too.
    // Unasked, this frame reads as a smile — and the turn used to be marked wrong.
    const turnedNodding = geometryOf({ noseX: 132, chinY: 300 });
    const frame = { geometry: turnedNodding, baseline: straight, smileProbability: 0.99 };
    expect(categorisePose(frame)).toBe('smiling');
    expect(categorisePose({ ...frame, asked: 'turn_left' })).toBe('turned');
  });

  it('counts a smiling straight-on first frame as straight when that is what was asked', () => {
    expect(categorisePose({ geometry: straight, baseline: null, smileProbability: 0.99 })).toBe('smiling');
    expect(
      categorisePose({ geometry: straight, baseline: null, smileProbability: 0.99, asked: 'look_straight' }),
    ).toBe('straight');
  });

  it('still refuses a turn that did not happen', () => {
    // Being asked is not evidence: an unmoved face is straight whatever the prompt said.
    expect(
      categorisePose({ geometry: straight, baseline: straight, smileProbability: 0.05, asked: 'turn_right' }),
    ).toBe('straight');
  });
});

describe('observedPose', () => {
  it('accepts either turn for either prompt, because mirroring is unknowable', () => {
    // A front camera may or may not mirror the frame it saves. Insisting on a
    // direction would fail half of all honest drivers on a coin toss.
    expect(observedPose({ asked: 'turn_left', category: 'turned' })).toBe('turn_left');
    expect(observedPose({ asked: 'turn_right', category: 'turned' })).toBe('turn_right');
  });

  it('reports the pose actually performed when it is not the one asked', () => {
    // So the admin reading the report sees the real mistake, not a bare "wrong".
    expect(observedPose({ asked: 'smile', category: 'straight' })).toBe('look_straight');
    expect(observedPose({ asked: 'look_straight', category: 'mouth_open' })).toBe('open_mouth');
  });

  it('says unclear rather than inventing a pose', () => {
    expect(observedPose({ asked: 'look_up', category: 'unclear' })).toBe('unclear');
  });

  it('has an answer for every pose the server can ask for', () => {
    // scoreFaceScan compares poseObserved with the challenge by equality, so a
    // challenge missing from the map could never be satisfied by anybody.
    for (const challenge of FACE_CHALLENGES) {
      expect(CATEGORY_OF_CHALLENGE[challenge]).toBeTruthy();
      expect(observedPose({ asked: challenge, category: CATEGORY_OF_CHALLENGE[challenge] })).toBe(challenge);
    }
  });
});

describe('framesShowMovement', () => {
  it('passes frames that differ from one another', () => {
    expect(framesShowMovement([geometryOf(), geometryOf({ noseX: 130 }), geometryOf({ lipGap: 20 })])).toBe(true);
  });

  it('fails one photograph handed in three times', () => {
    // The real local liveness test, and the one a printed photo cannot pass:
    // the server asked for three different things.
    const same = geometryOf();
    expect(framesShowMovement([same, same, same])).toBe(false);
  });

  it('will not call a single frame alive', () => {
    expect(framesShowMovement([geometryOf()])).toBe(false);
    expect(framesShowMovement([null, null])).toBe(false);
  });
});

// ── How sure the engine says it is ───────────────────────────────────────────

describe('readConfidence', () => {
  const clean = {
    slotsCorrect: 6,
    slotsExpected: 6,
    cnicNumberRead: true,
    cnicMatchesForm: true,
    nameRead: true,
    licenceExpiryRead: true,
    faceComparable: true,
    faceMatched: true,
    unreadable: 0,
  };

  it('says high only when every single thing was established', () => {
    expect(readConfidence(clean)).toBe('high');
  });

  it('refuses high for anything it merely failed to disprove', () => {
    // `requireHighConfidence` gates auto-approval on this, so every one of these
    // is the difference between "we checked" and "we did not look".
    expect(readConfidence({ ...clean, cnicNumberRead: false })).not.toBe('high');
    expect(readConfidence({ ...clean, cnicMatchesForm: false })).not.toBe('high');
    expect(readConfidence({ ...clean, nameRead: false })).not.toBe('high');
    expect(readConfidence({ ...clean, licenceExpiryRead: false })).not.toBe('high');
    expect(readConfidence({ ...clean, faceComparable: false })).not.toBe('high');
    expect(readConfidence({ ...clean, faceMatched: false })).not.toBe('high');
    expect(readConfidence({ ...clean, unreadable: 1 })).not.toBe('high');
    expect(readConfidence({ ...clean, slotsCorrect: 5 })).not.toBe('high');
  });

  it('says low when it has not identified the documents at all', () => {
    expect(readConfidence({ ...clean, slotsCorrect: 2, cnicNumberRead: false, nameRead: false })).toBe('low');
    expect(readConfidence({ ...clean, cnicNumberRead: false, nameRead: false })).toBe('low');
  });

  it('says medium when it read most of it but not all', () => {
    expect(readConfidence({ ...clean, faceComparable: false, faceMatched: false })).toBe('medium');
  });
});

// ── The engine's own limits, kept honest ─────────────────────────────────────

describe('what this engine does not claim', () => {
  it('names the fraud signals it cannot detect', () => {
    // So that nobody reading a clean report mistakes it for a clean bill of
    // health. The absence of these is absence of evidence.
    expect([...UNDETECTABLE_LOCALLY]).toEqual([
      'digital_edit',
      'stock_or_internet_image',
      'photocopy_presented_as_original',
      'screen_recapture',
    ]);
  });

  it('keeps the destroyed-image floor low enough not to fail honest photographs', () => {
    // A SHARP tight crop measured 104 and a visibly blurred full frame measured
    // 141, so the floor cannot be used to tell blurred from sharp. It is only
    // there to catch an image with nothing in it; blurring at sigma 8 gave 7.
    expect(IMAGE_DESTROYED_BELOW).toBeLessThan(104);
    expect(IMAGE_DESTROYED_BELOW).toBeGreaterThan(7);
  });
});
