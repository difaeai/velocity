/**
 * Language rules for passenger voice booking.
 *
 * Every case here is a sentence a Pakistani rider could plausibly say, written
 * the way a speech recogniser would actually transcribe it — mixed scripts,
 * inconsistent Roman spelling, no punctuation. The point is not coverage of the
 * code but coverage of the *language*: if a rule regresses, someone gets the
 * wrong destination or the wrong seat count.
 *
 * Several cases are regressions with real cost attached, marked inline.
 */
import { describe, expect, it } from 'vitest';

import { normalizeText, romanKey } from '../normalize';
import {
  parseBooking,
  parseDestinationAnswer,
  parseRideTypeAnswer,
  parseYesNo,
} from '../parser';

/** The rider's own saved/recent places, which outrank the national gazetteer. */
const KNOWN = ['Office', 'Ammi ka ghar'];

describe('normalizeText', () => {
  it('folds Urdu and Arabic digit forms to ASCII', () => {
    expect(normalizeText('۲ لوگ')).toContain('2');
    expect(normalizeText('٧ مرکز')).toContain('7');
  });

  it('folds letter variants that differ only by codepoint', () => {
    // Arabic ye/kaf/ha vs the Urdu forms — recognisers emit both.
    expect(normalizeText('كراچي')).toBe(normalizeText('کراچی'));
  });

  it('splits hyphenated sector names so "F-7" can match "f 7"', () => {
    expect(normalizeText('F-7 Markaz')).toBe('f 7 markaz');
  });

  it('strips diacritics and Urdu punctuation', () => {
    expect(normalizeText('صَدر۔')).toBe('صدر');
  });
});

describe('romanKey', () => {
  it('collapses Roman Urdu spelling variants onto one key', () => {
    expect(romanKey('chahiye')).toBe(romanKey('chahiyay'));
    expect(romanKey('gari')).toBe(romanKey('gaari'));
    expect(romanKey('teen')).toBe(romanKey('tin'));
  });

  it('leaves non-Latin text alone', () => {
    expect(romanKey('رکشہ')).toBe('رکشہ');
  });

  it('resolves every common spelling of "rickshaw" to the same vehicle', () => {
    // The contract that matters is the resolved ride type, not key equality —
    // these reach `auto` by several different routes through the lexicon.
    for (const spelling of ['rickshaw', 'riksha', 'ricksha', 'rikshaw', 'رکشہ']) {
      expect(parseRideTypeAnswer(spelling)).toBe('auto');
    }
  });
});

describe('parseBooking — the sentence this feature was designed around', () => {
  const SENTENCE =
    'mery liye ride book kro mjhe islamabad f7 Markaz jana hai or pool ride ho k or log bhi ja rahy ho is se mera fare kam aye ga';

  it('extracts destination and pool, and asks only for the vehicle', () => {
    const result = parseBooking(SENTENCE, KNOWN);

    expect(result.destinationText).toBe('F-7 Markaz (Jinnah Super), Islamabad');
    expect(result.pool).toBe(true);
    expect(result.rideType).toBeNull();
    expect(result.missing).toEqual(['rideType']);
    expect(result.understood).toBe(true);
  });

  it('does not invent passengers from "aur log bhi"', () => {
    // Regression: Sindhi "be" (2) folded to the same Roman key as "bhi", and
    // the "log" inside the pool phrase counted as a headcount marker, so this
    // sentence silently booked two seats and changed the fare.
    expect(parseBooking(SENTENCE, KNOWN).seats).toBe(1);
  });

  it('does not treat "is se" as a pickup point', () => {
    // Regression: "se" is an origin marker, but in "is se mera fare kam aye ga"
    // it means "because of this". Treating it as one split the sentence and
    // threw the real destination away.
    expect(parseBooking(SENTENCE, KNOWN).pickupText).toBeNull();
  });
});

describe('parseBooking — languages', () => {
  it('Urdu script, with an explicit pickup', () => {
    const result = parseBooking('مجھے صدر کراچی سے کلفٹن جانا ہے اے سی گاڑی میں');

    expect(result.pickupText).toBe('Saddar, Karachi');
    expect(result.destinationText).toBe('Clifton, Karachi');
    expect(result.rideType).toBe('ac');
    expect(result.missing).toEqual([]);
  });

  it('Punjabi', () => {
    const result = parseBooking('mainu anarkali jana ae sanjha ride');

    expect(result.destinationText).toBe('Anarkali Bazaar, Lahore');
    expect(result.pool).toBe(true);
  });

  it('Pashto', () => {
    expect(parseBooking('زه حیات آباد ته ځم').destinationText).toBe('Hayatabad, Peshawar');
  });

  it('Urdu numerals for the seat count', () => {
    const result = parseBooking('مجھے ۲ لوگ ہیں ایف ۷ مرکز پول');

    expect(result.destinationText).toBe('F-7 Markaz (Jinnah Super), Islamabad');
    expect(result.seats).toBe(2);
    expect(result.pool).toBe(true);
  });

  it('code-switched English and Roman Urdu', () => {
    const result = parseBooking('do banday hain pool kar do liberty market lahore');

    // Regression: the bare city "lahore" sits next to the specific place and
    // used to win, dropping "Liberty Market" from the destination.
    expect(result.destinationText).toBe('Liberty Market, Lahore');
    expect(result.seats).toBe(2);
    expect(result.pool).toBe(true);
  });
});

describe('parseBooking — negation and correction', () => {
  it('a negated vehicle does not become the answer', () => {
    const result = parseBooking('AC nahi chahiye rickshaw bhej do gulshan jana hai');

    expect(result.rideType).toBe('auto');
    expect(result.destinationText).toBe('Gulshan-e-Iqbal, Karachi');
  });

  it('handles mid-sentence self-correction', () => {
    // "nahi nahi" is one emphatic refusal of what came before it, not two
    // separate negations — counting it twice cancelled the correction itself.
    const result = parseBooking('mini gari nahi nahi AC wali F-8 markaz chalo');

    expect(result.rideType).toBe('ac');
    expect(result.destinationText).toBe('F-8 Markaz, Islamabad');
  });

  it('reads "pool nahi" as an explicit request to ride solo', () => {
    expect(parseBooking('pool nahi karna clifton jana hai').pool).toBe(false);
  });

  it('reads an explicit solo request', () => {
    const result = parseBooking('akela jana hai bahria town private gari');
    expect(result.pool).toBe(false);
  });
});

describe('parseBooking — places outside the gazetteer', () => {
  it('keeps the spoken words for autocomplete to resolve', () => {
    const result = parseBooking('mujhe chacha ke ghar wali gali jana hai bike se');

    expect(result.destinationText).toBe('chacha gali');
    expect(result.rideType).toBe('bike');
  });

  it("prefers the rider's own saved places over any landmark", () => {
    const result = parseBooking('mujhe office jana hai ac mein', KNOWN);

    expect(result.destinationText).toBe('Office');
    expect(result.rideType).toBe('ac');
    expect(result.missing).toEqual([]);
  });
});

describe('parseBooking — refusing to guess', () => {
  it('reports nonsense as not understood rather than as an address', () => {
    // Regression: leftover words became a destination even with no "jana hai"
    // marker anywhere, so noise was handed to autocomplete and confirmed back
    // to the rider as if it were a real place.
    const result = parseBooking('aaaa bbb ccc');

    expect(result.understood).toBe(false);
    expect(result.destinationText).toBeNull();
    expect(result.missing).toEqual(['destination', 'rideType']);
  });

  it('handles empty input', () => {
    const result = parseBooking('   ');
    expect(result.understood).toBe(false);
    expect(result.seats).toBe(1);
  });

  it('never returns more seats than a vehicle holds', () => {
    expect(parseBooking('6 log hain clifton jana hai').seats).toBeLessThanOrEqual(4);
  });
});

describe('follow-up answers', () => {
  it('reads a vehicle from a bare reply', () => {
    expect(parseRideTypeAnswer('AC wali')).toBe('ac');
    expect(parseRideTypeAnswer('rickshaw')).toBe('auto');
    expect(parseRideTypeAnswer('ٹھنڈی گاڑی')).toBe('ac');
    expect(parseRideTypeAnswer('bike')).toBe('bike');
    expect(parseRideTypeAnswer('kuch bhi')).toBeNull();
  });

  it('reads a destination from a bare reply', () => {
    expect(parseDestinationAnswer('f7 markaz').text).toBe(
      'F-7 Markaz (Jinnah Super), Islamabad',
    );
    expect(parseDestinationAnswer('صدر کراچی').text).toBe('Saddar, Karachi');
    expect(parseDestinationAnswer('office', KNOWN).text).toBe('Office');
  });

  it('reads yes and no across languages', () => {
    expect(parseYesNo('haan')).toBe(true);
    expect(parseYesNo('ji haan')).toBe(true);
    expect(parseYesNo('ٹھیک ہے')).toBe(true);
    expect(parseYesNo('nahi')).toBe(false);
    expect(parseYesNo('cancel')).toBe(false);
    expect(parseYesNo('galat hai')).toBe(false);
  });

  it('returns null for an ambiguous confirmation rather than assuming yes', () => {
    // This gate sits directly in front of a booking that costs money. An
    // unclear reply must re-ask, never proceed.
    expect(parseYesNo('hmm')).toBeNull();
    expect(parseYesNo('pata nahi kya')).not.toBe(true);
  });
});
