/**
 * Driver verification, decided on our own machine.
 *
 * Two jobs, the same two the engine has always had, with the vision-model call
 * taken out of both:
 *
 *   · readDriverDocuments() — every paper one applicant submitted, read and
 *     compared against the others. The comparisons are the point: "is the name
 *     on the licence the name on the CNIC" is the question that catches a
 *     borrowed identity, and it cannot be asked of one document alone.
 *   · readFaceScan() — the three live frames, against the poses the SERVER
 *     asked for, and against the photograph on the card.
 *
 * Both return null rather than a guess when an image will not load or the
 * engine will not start. Null means "a human decides" everywhere it is
 * consumed — never "approved", and never "rejected" either.
 *
 * WHAT THIS ENGINE CAN AND CANNOT SEE. It reads text, finds faces, measures how
 * alike two faces are, and compares what it read with what the applicant typed.
 * It does not and will not report tampering, photocopies, screen captures or
 * stock photographs: there is no honest local test for any of them, and a
 * guessed `suspected` would quietly block every application in the country.
 * The list is in domain/localVision.ts as UNDETECTABLE_LOCALLY, and the summary
 * written onto every report says so in words, so that nobody reading a clean
 * report mistakes it for a clean bill of health.
 *
 * WHAT STILL CATCHES FRAUD. The strongest checks here never needed a model:
 * whether this CNIC is already on somebody else's account (findDuplicates, in
 * drivers/verification.ts), whether the card's number is the number on the
 * form, whether anything has expired, and whether the live face is the face on
 * the card. The pose sequence is chosen by the server after the applicant has
 * started, so a set of photographs prepared in advance cannot answer it.
 */
import { logger } from 'firebase-functions';

import { storage } from './firebase';
import {
  faceDistance,
  faceEngineReady,
  localVisionReady,
  readFace,
  readImageText,
  type FaceRead,
} from './localVision';
import {
  EXPECTED_LOOK,
  namesAgree,
  normalizeCnic,
  type Agreement,
  type Confidence,
  type DocumentFinding,
  type DocumentKind,
  type DriverVerificationReport,
  type FraudSignal,
  type LooksLike,
} from '../domain/driverVerification';
import {
  FACE_DIFFERENT_PERSON_ABOVE,
  FACE_SAME_PERSON_BELOW,
  OCR_CONFIDENCE_FLOOR,
  SAME_IMAGE_DISTANCE,
  categorisePose,
  classifyDocument,
  faceAgreement,
  framesShowMovement,
  looksLikeSpecimen,
  observedPose,
  readCnicNumber,
  readConfidence,
  readLabelledDates,
  readNames,
  readPlate,
  slotLabel,
  summarise,
} from '../domain/localVision';
import { combineIdentity, type FaceChallenge, type FaceScanIdentity, type FaceScanReport } from '../domain/faceScan';

/** Per-image ceiling. A phone photo at quality 0.6 is a tenth of this. */
const MAX_IMAGE_BYTES = 12_000_000;

/** Which slots carry a photograph of a person we can compare. */
const FACE_SLOTS: DocumentKind[] = ['selfie', 'cnicFront', 'license'];

/**
 * Slots that hold a photograph rather than a paper.
 *
 * They are judged on different evidence, and conflating the two is how every
 * honest applicant ended up with an illegible document on their file: there is
 * no text on a selfie, so "could we read the text" is not a question about it.
 * A portrait is legible when a face can be found in it; a photograph of a car
 * is legible when it is in focus.
 */
const PHOTO_SLOTS: DocumentKind[] = ['selfie', 'vehiclePhoto'];

/**
 * True when the engine can run. There is no key to check, so this actually
 * loads the models and the OCR worker and reports whether they came up.
 *
 * Named for what it answers rather than for what it used to replace: the old
 * `verificationAIConfigured()` tested whether a secret existed, which is a
 * different question from whether anything works, and the gap between the two
 * is exactly how this engine once spent weeks sending every single applicant to
 * a human while looking like it was being careful.
 */
export const verificationEngineReady = localVisionReady;

/** Pull one Storage object into memory, refusing anything that is not an image. */
async function loadBytes(path: string): Promise<Buffer | null> {
  try {
    const file = storage.bucket().file(path);
    const [meta] = await file.getMetadata();
    const contentType = (meta.contentType as string | undefined) ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      logger.warn('Driver document is not an image', { path, contentType });
      return null;
    }
    const size = Number(meta.size ?? 0);
    if (size > MAX_IMAGE_BYTES) {
      logger.warn('Driver document too large to verify', { path, size });
      return null;
    }
    const [buf] = await file.download();
    return buf;
  } catch (e) {
    logger.error('Failed to load driver document from Storage', { path, e });
    return null;
  }
}

// ── Reading the papers ───────────────────────────────────────────────────────

/** Everything one image gave us, before any of it is compared with anything. */
interface Examined {
  kind: DocumentKind;
  looksLike: LooksLike;
  legible: boolean;
  blurred: boolean;
  /** Enough text, read confidently enough, to rely on what it says. */
  textTrusted: boolean;
  specimen: boolean;
  text: string;
  ocrConfidence: number;
  face: FaceRead | null;
  cnicNumber: string | null;
  plate: string | null;
  dates: { dateOfBirth: string | null; issueDate: string | null; expiryDate: string | null };
  names: { name: string | null; fatherName: string | null };
  notes: string;
}

/**
 * Look at one upload.
 *
 * Every slot gets both treatments — the text AND a look for a face — because
 * the mistake worth catching is a paper in the wrong slot, and that can only be
 * spotted by reading what the image actually is rather than what it was filed
 * as. It costs about a second and a half per image.
 */
async function examine(kind: DocumentKind, bytes: Buffer): Promise<Examined | null> {
  const [read, face] = await Promise.all([readImageText(bytes), readFace(bytes)]);
  if (!read) return null;

  const text = read.text;
  const looksLike = classifyDocument({
    text,
    hasFace: face !== null,
    faceCoverage: face?.coverage ?? 0,
    blurred: read.blurred,
    expected: EXPECTED_LOOK[kind][0],
  });

  const notes: string[] = [
    `uploaded into the ${slotLabel(kind)} slot`,
    `read as ${looksLike}`,
    `sharpness ${Math.round(read.sharpness)}`,
    `text confidence ${Math.round(read.ocrConfidence)}`,
  ];
  if (face) {
    notes.push(`one face found, detector score ${face.score.toFixed(2)}`);
  } else if (FACE_SLOTS.includes(kind)) {
    notes.push('no face found in a slot that should carry one');
  }

  return {
    kind,
    looksLike,
    legible: legibleFor(kind, { blurred: read.blurred, textTrusted: read.textTrusted, hasFace: face !== null }),
    blurred: read.blurred,
    textTrusted: read.textTrusted,
    specimen: looksLikeSpecimen(text),
    text,
    ocrConfidence: read.ocrConfidence,
    face,
    cnicNumber: readCnicNumber(text),
    // Only the registration book. See PLATE_IS_ONLY_READ_FROM_THE_DOCUMENT.
    plate: kind === 'vehicleRegistration' ? readPlate(text) : null,
    dates: readLabelledDates(text),
    names: readNames(text),
    notes: notes.join('; '),
  };
}

/**
 * Is there enough in this image to judge it?
 *
 * Each slot is held to the evidence it can actually produce, which is not the
 * same evidence for all of them:
 *
 *   · a portrait is legible when a face can be found in it — that is the whole
 *     use we have for it, and it is a direct test of exactly that;
 *   · a paper is legible when its text came off confidently;
 *   · a photograph of a car has neither, so all that is left is whether the
 *     image has any detail in it at all.
 *
 * Sharpness is NOT a gate on the first two. It cannot be: the measure is not
 * comparable between a tight crop and a full frame, so a floor high enough to
 * catch real blur also caught honest closely-framed selfies. See
 * IMAGE_DESTROYED_BELOW. It stays in the notes for the admin to read.
 */
function legibleFor(
  kind: DocumentKind,
  image: { blurred: boolean; textTrusted: boolean; hasFace: boolean },
): boolean {
  if (kind === 'selfie') return image.hasFace;
  if (kind === 'vehiclePhoto') return !image.blurred;
  return image.textTrusted;
}

/** A slot we could not get a look at. Reported as such, never silently absent. */
function unreadable(kind: DocumentKind): Examined {
  return {
    kind,
    looksLike: 'unreadable',
    legible: false,
    blurred: true,
    textTrusted: false,
    specimen: false,
    text: '',
    ocrConfidence: 0,
    face: null,
    cnicNumber: null,
    plate: null,
    dates: { dateOfBirth: null, issueDate: null, expiryDate: null },
    names: { name: null, fatherName: null },
    notes: `uploaded into the ${slotLabel(kind)} slot; could not be downloaded or decoded`,
  };
}

/** Per-document confidence: did this one image give up what it was supposed to? */
function documentConfidence(doc: Examined): Confidence {
  const rightKind = EXPECTED_LOOK[doc.kind].includes(doc.looksLike);
  if (!rightKind || !doc.legible) return 'low';
  // A photograph has no text to be confident about; being in focus, the right
  // kind of picture, and — for the selfie — having a findable face, is all the
  // evidence there is to have.
  if (PHOTO_SLOTS.includes(doc.kind)) return 'high';
  if (doc.ocrConfidence >= OCR_CONFIDENCE_FLOOR + 20) return 'high';
  return 'medium';
}

function toFinding(doc: Examined): DocumentFinding {
  return {
    kind: doc.kind,
    looksLike: doc.looksLike,
    legible: doc.legible,
    // Never anything else. This engine has no test for editing, and a guessed
    // "suspected" is a major reason on an honest driver's file. See
    // UNDETECTABLE_LOCALLY in domain/localVision.ts.
    tampering: 'none',
    specimen: doc.specimen,
    fields: {
      name: doc.names.name,
      fatherName: doc.names.fatherName,
      // The licence carries its own number and the CNIC carries the identity
      // number; both land in idNumber, which is what the duplicate check reads.
      idNumber: doc.cnicNumber,
      dateOfBirth: doc.dates.dateOfBirth,
      issueDate: doc.dates.issueDate,
      expiryDate: doc.dates.expiryDate,
      plate: doc.plate,
      // No local test exists for either. Left null rather than guessed, so the
      // decision treats them as unread instead of as agreeing.
      vehicleMake: null,
      vehicleColor: null,
    },
    confidence: documentConfidence(doc),
    notes: doc.notes,
  };
}

/**
 * Inspect everything one applicant submitted.
 *
 * `documents` is already filtered to the slots that have an upload; a slot
 * missing entirely is caught by the decision logic before this is ever called.
 */
export async function readDriverDocuments(
  documents: Array<{ kind: DocumentKind; path: string }>,
  /** What the applicant typed, so the card can be checked against the form. */
  submitted?: { cnic?: string | null },
): Promise<DriverVerificationReport | null> {
  if (documents.length === 0) return null;
  if (!(await localVisionReady())) {
    logger.error('Local verification engine did not start; sending to a human');
    return null;
  }

  const examined: Examined[] = [];
  // Sequentially, not in parallel: each image is a Tesseract page and a pass
  // through three networks, and six at once in one 1 GiB instance is how a
  // function runs out of memory and fails all six instead of finishing one.
  for (const doc of documents) {
    const bytes = await loadBytes(doc.path);
    const result = bytes ? await examine(doc.kind, bytes) : null;
    // An upload that would not download or would not decode is REPORTED, never
    // dropped. Left out of the report it becomes invisible: the decision logic
    // counts a missing document from the paths on the driver record, so a
    // present-but-unreadable one would raise nothing at all, and the applicant
    // would be judged on five papers as though they had submitted five.
    examined.push(result ?? unreadable(doc.kind));
  }
  if (examined.length === 0) {
    logger.warn('No driver documents could be read for verification');
    return null;
  }

  const byKind = new Map<DocumentKind, Examined>(examined.map((d) => [d.kind, d]));
  const cnicFront = byKind.get('cnicFront');
  const cnicBack = byKind.get('cnicBack');
  const licence = byKind.get('license');
  const selfie = byKind.get('selfie');

  // ── Is the applicant's face the face on their papers?
  //
  // Measured against each card SEPARATELY, and reported that way. The two
  // answers are not interchangeable: the decision engine requires the applicant
  // to be on the CNIC *and* on the licence before it will approve anybody (see
  // IDENTITY_MUST_BE_PROVEN), because either card on its own can be borrowed —
  // a licence handed over at a checkpoint, a CNIC left with a landlord — and
  // being on both of them at once is what makes a borrowed set visible.
  //
  // The combined `faceConsistency` below is kept as the best of the two, for
  // older stored reports and for the admin's first glance.
  const selfieDescriptor = selfie?.face?.descriptor ?? null;
  const faceToCnic = faceDistance(selfieDescriptor, cnicFront?.face?.descriptor ?? null);
  const faceToLicence = faceDistance(selfieDescriptor, licence?.face?.descriptor ?? null);
  const measured = [faceToCnic, faceToLicence].filter((d): d is number => d !== null);
  const faceToCard = measured.length > 0 ? Math.min(...measured) : null;

  // ── Do the papers agree with each other?
  const cnicName = cnicFront?.names.name ?? cnicBack?.names.name ?? null;
  const licenceName = licence?.names.name ?? null;

  const cnicOnCard = normalizeCnic(cnicFront?.cnicNumber ?? cnicBack?.cnicNumber);
  const cnicOnLicence = normalizeCnic(licence?.cnicNumber);
  const idNumberConsistency: Agreement =
    cnicOnCard.length === 13 && cnicOnLicence.length === 13
      ? cnicOnCard === cnicOnLicence
        ? 'match'
        : 'mismatch'
      : 'unclear';


  // ── What the engine managed to establish, for its own confidence.
  const slotsCorrect = examined.filter((d) => EXPECTED_LOOK[d.kind].includes(d.looksLike)).length;
  const typedCnic = normalizeCnic(submitted?.cnic ?? null);
  const confidence = readConfidence({
    slotsCorrect,
    // What was ASKED for, not what came back. Counting only the documents that
    // were examined would let `slotsCorrect === slotsExpected` stay true after
    // one of them failed to load — high confidence on an application the engine
    // never finished looking at.
    slotsExpected: documents.length,
    cnicNumberRead: cnicOnCard.length === 13,
    // When the form left the CNIC blank there is nothing to agree with, so this
    // cannot be claimed as established.
    cnicMatchesForm: typedCnic.length === 13 && typedCnic === cnicOnCard,
    nameRead: Boolean(cnicName),
    licenceExpiryRead: Boolean(licence?.dates.expiryDate),
    faceComparable: faceToCard !== null,
    faceMatched: faceToCard !== null && faceToCard <= FACE_SAME_PERSON_BELOW,
    unreadable: examined.filter((d) => !d.legible).length,
  });

  // ── Only the signals this engine can actually stand behind.
  const fraudSignals: FraudSignal[] = [];
  if (examined.some((d) => d.specimen)) fraudSignals.push('specimen_document');
  if (examined.some((d) => !d.legible)) fraudSignals.push('unreadable_document');
  if (slotsCorrect < examined.length) fraudSignals.push('wrong_document_type');
  if (namesAgree(cnicName, licenceName) === 'mismatch') fraudSignals.push('name_mismatch');
  if (idNumberConsistency === 'mismatch') fraudSignals.push('id_number_mismatch');
  if (faceAgreement(faceToCard) === 'mismatch') fraudSignals.push('face_mismatch');

  const report: DriverVerificationReport = {
    documents: examined.map(toFinding),
    crossChecks: {
      faceConsistency: faceAgreement(faceToCard),
      selfieVsCnic: faceAgreement(faceToCnic),
      selfieVsLicense: faceAgreement(faceToLicence),
      nameConsistency: namesAgree(cnicName, licenceName),
      idNumberConsistency,
      // Undecided, always: reading the plate off a photograph of the car is
      // not something this engine can do to the character, and guessing it
      // accuses honest drivers. See PLATE_IS_ONLY_READ_FROM_THE_DOCUMENT.
      plateConsistency: 'unclear',
      // Whether the car photographed is the car described would need the make,
      // model and colour read off a photograph. Nothing here can do that, so it
      // is reported as undecided — which the decision logic weighs as nothing,
      // rather than as agreement.
      vehicleConsistency: 'unclear',
    },
    fraudSignals,
    overallConfidence: confidence,
    summary: summarise({
      documents: documents.length,
      slotsCorrect,
      cnicNumberRead: cnicOnCard.length === 13,
      faceAgreement: faceAgreement(faceToCard),
      faceDistance: faceToCard,
      confidence,
    }),
  };

  logger.info('Driver documents read locally', {
    documents: report.documents.length,
    slotsCorrect,
    signals: fraudSignals,
    faceToCnic,
    faceToLicence,
    confidence,
  });
  return report;
}

// ── Reading the face scan ────────────────────────────────────────────────────

/**
 * Score one completed face scan.
 *
 * `asked` is the sequence the SERVER issued — read from the stored scan, never
 * from anything the handset sent back. `idPhotoPath` is the CNIC front when we
 * have one, so the live face can be compared with the card in the same pass.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. It proves that each frame contains a
 * face, that the faces are the same person, that they are the person on the
 * card, and that the frames answer the poses the server picked AFTER the
 * applicant started — which a set of photographs prepared in advance cannot.
 * It does NOT prove the frames came from a camera rather than from a video
 * played back at it: there is no local test for that, the `recaptured` flag is
 * raised only for the one case that can be proven (the same image handed in
 * twice), and the unpredictable sequence is what carries the weight instead.
 */
export async function readFaceScan(params: {
  frames: Array<{ index: number; path: string }>;
  asked: FaceChallenge[];
  /**
   * The CNIC front and the licence, when they have been uploaded — so the live
   * face can be measured against BOTH cards in the same pass. This is why an
   * onboarding scan is asked for last: before the documents are stored there is
   * nothing here, and the scan can only prove liveness.
   */
  idPhotos?: { cnic?: string | null; license?: string | null };
  /**
   * The face enrolled when this driver was approved, as the 128 numbers a
   * descriptor is. Daily checks measure against this rather than against a card
   * photograph: both sides are then a phone selfie, which is the comparison
   * that is reliable enough to stop somebody driving. See domain/faceCheckIn.ts.
   */
  reference?: number[] | null;
}): Promise<(FaceScanReport & FaceScanIdentity) | null> {
  if (params.frames.length === 0) return null;
  if (!(await faceEngineReady())) {
    logger.error('Local verification engine did not start; face scan goes to a human');
    return null;
  }

  const ordered = [...params.frames].sort((a, b) => a.index - b.index);
  const reads: Array<FaceRead | null> = [];
  for (const frame of ordered) {
    const bytes = await loadBytes(frame.path);
    if (!bytes) {
      // Every frame has to be present: a scan judged on two of three frames is
      // not the scan that was asked for, and a dropped frame must not look
      // like a pass.
      logger.warn('Face scan frame could not be loaded', { path: frame.path });
      return null;
    }
    reads.push(await readFace(bytes));
  }

  const geometries = reads.map((r) => r?.geometry ?? null);
  // Frame 0 is always `look_straight` (pickChallenges guarantees it), which is
  // what gives every later frame something of this applicant's own to be
  // measured against instead of a fixed number that fits nobody.
  const baseline = geometries[0] ?? null;

  const frames = ordered.map((frame, position) => {
    const read = reads[position];
    const geometry = geometries[position];
    const asked = params.asked[frame.index];

    if (!read || !geometry) {
      return {
        index: frame.index,
        faceVisible: false,
        poseObserved: 'unclear' as const,
        recaptured: false,
        notes: read ? 'a face was found but could not be measured' : 'no face found in this frame',
      };
    }

    const category = categorisePose({
      geometry,
      baseline: position === 0 ? null : baseline,
      smileProbability: read.smileProbability,
    });

    // The only recapture this engine claims: the identical image handed in for
    // two different poses. Anything softer would be a guess, and `recaptured`
    // fails a scan outright.
    const duplicateOfAnother = reads.some((other, j) => {
      if (j === position || !other) return false;
      const d = faceDistance(read.descriptor, other.descriptor);
      return d !== null && d < SAME_IMAGE_DISTANCE;
    });

    return {
      index: frame.index,
      faceVisible: true,
      poseObserved: observedPose({ asked, category }),
      recaptured: duplicateOfAnother,
      notes: [
        `asked for ${asked ?? 'an unspecified pose'}`,
        `measured as ${category}`,
        `yaw ${geometry.yaw.toFixed(3)}`,
        `pitch ${geometry.pitch.toFixed(3)}`,
        `mouth ${geometry.mouthOpen.toFixed(3)}`,
        `smile ${read.smileProbability.toFixed(2)}`,
      ].join('; '),
    };
  });

  // Said to be different people only when the engine is sure of it: a head
  // turned away measures further from a frontal frame than two frontal frames
  // do, and `samePersonAcrossFrames: false` fails a scan outright.
  const descriptors = reads.map((r) => r?.descriptor ?? null);
  let samePerson = true;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      const d = faceDistance(descriptors[i], descriptors[j]);
      if (d !== null && d >= FACE_DIFFERENT_PERSON_ABOVE) samePerson = false;
    }
  }

  const everyFrameHasAFace = frames.every((f) => f.faceVisible);
  const livePerson = everyFrameHasAFace && framesShowMovement(geometries);

  // The live face against everything we can compare it with. Frame 0 is the one
  // used throughout: it is the straight-ahead frame, and a face comparison
  // wants a front-on shot.
  //
  // Each comparison degrades to `unclear` on its own rather than failing the
  // scan. A missing card, an unreadable portrait and a driver with no enrolment
  // are all ordinary, and none of them is the applicant's fault — what they
  // cost is an automatic approval, decided in domain/driverVerification.ts.
  const cardDistance = async (path: string | null | undefined): Promise<number | null> => {
    if (!path) return null;
    const bytes = await loadBytes(path);
    const face = bytes ? await readFace(bytes) : null;
    return faceDistance(descriptors[0], face?.descriptor ?? null);
  };

  const cnicDistance = await cardDistance(params.idPhotos?.cnic);
  const licenseDistance = await cardDistance(params.idPhotos?.license);
  const referenceDistance = params.reference?.length
    ? faceDistance(descriptors[0], new Float32Array(params.reference))
    : null;

  const matchesCnic = faceAgreement(cnicDistance);
  const matchesLicense = faceAgreement(licenseDistance);
  // The headline answer, kept in the shape every older record and every admin
  // badge already expects: both cards, combined by the one rule that decides
  // what "both" means.
  const matchesIdPhoto = combineIdentity({ cnic: matchesCnic, license: matchesLicense });

  const posesMatched = params.asked.reduce(
    (n, challenge, i) => (frames.find((f) => f.index === i)?.poseObserved === challenge ? n + 1 : n),
    0,
  );
  const confidence: Confidence = !everyFrameHasAFace
    ? 'low'
    : posesMatched === params.asked.length
      ? 'high'
      : 'medium';

  const report: FaceScanReport & FaceScanIdentity = {
    frames,
    samePersonAcrossFrames: samePerson,
    livePerson,
    matchesIdPhoto,
    matchesCnic,
    matchesLicense,
    matchesReference: faceAgreement(referenceDistance),
    distances: { cnic: cnicDistance, license: licenseDistance, reference: referenceDistance },
    // Frame 0's own descriptor, so a passing scan can become this driver's
    // enrolled face. Kept out of the frame findings on purpose: it is biometric
    // data, it belongs in the one server-only place that holds it, and the
    // caller decides whether this scan earned the right to write it.
    descriptor: descriptors[0] ? Array.from(descriptors[0]) : null,
    confidence,
    summary: [
      `Scored on this machine: ${posesMatched} of ${params.asked.length} poses matched,`,
      `${frames.filter((f) => f.faceVisible).length} of ${frames.length} frames had a face,`,
      livePerson ? 'the frames differ from one another' : 'the frames do not differ from one another',
      `the live face is a ${matchesCnic} against the CNIC and a ${matchesLicense} against the licence`,
      referenceDistance === null
        ? '(no enrolled face to compare with).'
        : `and a ${faceAgreement(referenceDistance)} against the enrolled face.`,
      'Turn direction is not checked, and a video played back at the camera is not detected.',
    ].join(' '),
  };

  logger.info('Face scan read locally', {
    live: report.livePerson,
    samePerson: report.samePersonAcrossFrames,
    matchesCnic,
    matchesLicense,
    matchesReference: report.matchesReference,
    posesMatched,
    confidence,
  });
  return report;
}
