/**
 * The Pakistani documents a real driver actually uploads.
 * ----------------------------------------------------------------------------
 * Every string below is transcribed off a real card, as English-only OCR sees
 * it — not invented, and not cleaned up. They are here because the classifier
 * was rejecting two of them, and the failures were silent: a driver got
 * "wrong document" and no way to tell that his licence was fine and our reader
 * was wrong.
 *
 * WHAT THIS FILE IS GUARDING AGAINST
 * ----------------------------------
 * `document_wrong_type` is FATAL in `decideDriverVerification`. A document
 * classified into the wrong box is not a flag for a human to weigh, it is an
 * automatic rejection. So every format in circulation has to land in its own
 * slot, including the ones that read badly — which is why the degraded cases
 * below matter more than the clean ones.
 *
 * ADDING A FORMAT: transcribe the card as OCR renders it, including the parts
 * that come out wrong. Do not tidy the text. The tidied version passes and
 * tells you nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyDocument,
  looksLikeSpecimen,
  readCnicNumber,
  readLabelledDates,
  readNames,
  textDensity,
} from '../../domain/localVision';

/** A CNIC front, 2019 NADRA layout. The common case. */
const CNIC_FRONT = `PAKISTAN National Identity Card
ISLAMIC REPUBLIC OF PAKISTAN
Name
Shahrukh Korrani
Father Name
Ali Korrani
Gender Country of Stay
M Pakistan
Identity Number Date of Birth
61101-6888351-5 14.02.1994
Date of Issue Date of Expiry
25.07.2019 25.07.2029
Holder's Signature`;

/**
 * The back of the same card. SIX English words.
 *
 * Both addresses, both headings and the lost-card notice are Urdu, and the OCR
 * runs English-only by design. This is what every honest driver's CNIC back
 * looks like to us, and it used to come out `unreadable`.
 */
const CNIC_BACK = `61101-6888351-5
500061797317
Registrar General of Pakistan`;

/** National Highways & Motorway Police permit — valid countrywide. */
const NHMP_PERMIT = `ISLAMIC REPUBLIC OF PAKISTAN
NATIONAL DRIVING PERMIT
NATIONAL HIGHWAYS & MOTORWAY POLICE
Licence No.
Name MUHAMMAD IDREES
Son/Daughter/Wife of MEHTAB UDDIN
Address MOH MULLA KHEL, ZIARAT KAKA SAHIB, WALAI, NOWSHERA
Issue Date Valid Till
CNIC No. Date of Birth
HOLDER SIGNATURE
NATIONAL HIGHWAYS LICENCING AUTHORITY`;

/**
 * THE ONE THAT WAS BEING REJECTED.
 *
 * The same permit with "Valid Till" and "Licence No." lost to a soft focus —
 * which is an ordinary phone photograph of a laminated card under a light. It
 * still opens "ISLAMIC REPUBLIC OF PAKISTAN" and still says "Date of Birth",
 * so the CNIC markers tied with the licence markers and the tie went to the
 * CNIC. Fatal, and on an application where nothing was wrong.
 */
const NHMP_PERMIT_DEGRADED = `ISLAMIC REPUBLlC OF PAKISTAN
NATIONAL DRIVING PERMIT
NATIONAL HIGHWAYS & MOTORWAY POLICE
Name MUHAMMAD IDREES
Son/Daughter/Wife of MEHTAB UDDIN
Address MOH MULLA KHEL, ZIARAT KAKA SAHIB
Issue Date
CNIC No. Date of Birth
HOLDER SIGNATURE`;

/** Islamabad Traffic Police, older blue card. */
const ITP_BLUE = `Islamabad Traffic Police - Pakistan
Traffic Division
DRIVING LICENSE
Name JOHN CITIZEN
Address KHO MEHRA PO SADDA CANTT SIALKOT
ITP License No. 00000000
Date of Birth 00-00-0000
CNIC No. 00000-0000000-0
Issue Date 00-00-0000
Expiry Date 00-00-0000
Licensing Authority`;

/** Islamabad Traffic Police, newer colour card. Abbreviates everything. */
const ITP_COLOUR = `Islamabad Traffic Police - Pakistan
Driving License
DL No.
Name MUHAMMAD IRFAN MUGHAL
CNIC No.
D.O.B.
Issue Date
Expiry Date
Licensing Authority`;

const look = (text: string, expected: Parameters<typeof classifyDocument>[0]['expected'], hasFace = true) =>
  classifyDocument({
    text,
    hasFace,
    faceCoverage: hasFace ? 0.05 : 0,
    blurred: false,
    expected,
  });

describe('every licence format in circulation lands in the licence slot', () => {
  it('reads a motorway police National Driving Permit as a licence', () => {
    expect(look(NHMP_PERMIT, 'driving_license')).toBe('driving_license');
  });

  /**
   * The regression this file exists for. Before `DECISIVE_MARKERS`, this
   * returned `cnic_front` and the driver was auto-rejected.
   */
  it('still reads it as a licence when the OCR drops "Valid Till"', () => {
    expect(look(NHMP_PERMIT_DEGRADED, 'driving_license')).toBe('driving_license');
  });

  it('reads both Islamabad Traffic Police layouts as licences', () => {
    expect(look(ITP_BLUE, 'driving_license')).toBe('driving_license');
    expect(look(ITP_COLOUR, 'driving_license')).toBe('driving_license');
  });

  /** The newer ITP card abbreviates to "DL No." and says "D.O.B." */
  it('does not need the words "licence no" spelled out', () => {
    expect(ITP_COLOUR.toLowerCase()).not.toContain('licence no');
    expect(look(ITP_COLOUR, 'driving_license')).toBe('driving_license');
  });
});

describe('a CNIC is a CNIC on both sides', () => {
  it('reads the front, with its number, dates and both names', () => {
    expect(look(CNIC_FRONT, 'cnic_front')).toBe('cnic_front');
    expect(readCnicNumber(CNIC_FRONT)).toBe('61101-6888351-5');
    expect(readLabelledDates(CNIC_FRONT)).toEqual({
      dateOfBirth: '14.02.1994',
      issueDate: '25.07.2019',
      expiryDate: '25.07.2029',
    });
    expect(readNames(CNIC_FRONT)).toEqual({
      name: 'Shahrukh Korrani',
      fatherName: 'Ali Korrani',
    });
  });

  /**
   * The other regression. Six English words is under `MIN_DOCUMENT_WORDS`, so
   * the back of every genuine CNIC in the country was `unreadable` and every
   * honest driver collected a `document_illegible` finding for photographing
   * their card correctly.
   */
  it('reads the Urdu back from its NADRA number alone', () => {
    expect(textDensity(CNIC_BACK)).toBeLessThan(8);
    expect(look(CNIC_BACK, 'cnic_back', false)).toBe('cnic_back');
  });

  /**
   * The number is allowed to say WHICH SIDE, never to vouch for a document in
   * a slot that asked for something else. A licence photographed so badly that
   * only its CNIC line survives must not become a CNIC in the licence slot.
   */
  it('will not let a stray number pass as a CNIC in the licence slot', () => {
    expect(look('CNIC No. 61101-6888351-5', 'driving_license')).not.toBe('cnic_front');
    expect(look('CNIC No. 61101-6888351-5', 'driving_license')).not.toBe('cnic_back');
  });
});

describe('the slot check still catches the mistake it exists for', () => {
  it('reports a CNIC uploaded into the licence slot as a CNIC', () => {
    expect(look(CNIC_FRONT, 'driving_license')).toBe('cnic_front');
  });

  it('reports a licence uploaded into the CNIC slot as a licence', () => {
    expect(look(NHMP_PERMIT, 'cnic_front')).toBe('driving_license');
  });

  /**
   * A driver standing next to his own car. The face is there but tiny, and
   * calling it a portrait would reject a real car photograph.
   */
  it('does not turn a man beside his car into a portrait', () => {
    expect(
      classifyDocument({
        text: 'LEA 4821',
        hasFace: true,
        faceCoverage: 0.004,
        blurred: false,
        expected: 'vehicle_photo',
      }),
    ).toBe('vehicle_photo');
  });
});

describe('specimen cards', () => {
  /**
   * The ITP publish this card as a printing template and it is freely
   * downloadable. It says "specimen" nowhere — what gives it away is that its
   * number and all three dates are zeros.
   */
  it('catches a template by its blanked fields', () => {
    expect(looksLikeSpecimen(ITP_BLUE)).toBe(true);
  });

  it('does not call a real card a specimen', () => {
    expect(looksLikeSpecimen(CNIC_FRONT)).toBe(false);
    expect(looksLikeSpecimen(NHMP_PERMIT)).toBe(false);
    expect(looksLikeSpecimen(ITP_COLOUR)).toBe(false);
  });
});
