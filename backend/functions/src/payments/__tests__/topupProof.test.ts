/**
 * The rules that decide whether a screenshot becomes money.
 *
 * Every case below is an attack, a layout, or a false refusal that would make
 * the feature useless — and all three matter equally. An engine that credits a
 * forgery loses cash; an engine that sends every honest Easypaisa receipt to an
 * admin is just a slower bank transfer with extra steps, and drivers stop using
 * it. Both failures are tested here.
 *
 * The OCR strings are written the way Tesseract actually flattens a phone
 * screenshot: one field per line, labels and values separated by a newline as
 * often as by a colon, and no guarantee the amount carries a label at all.
 * Rules written against tidy text are rules that only work on tidy text.
 *
 * Nothing here touches Firestore or an image. `duplicate` and `imageReplay` are
 * facts the caller looks up and passes in, which is exactly why this file can
 * prove the decision table to the character in milliseconds.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SINGLE,
  MIN_SINGLE,
  OCR_FLOOR,
  decideTopupProof,
  parseAmount,
  parseRecipientMatch,
  parseTransactionRef,
  readReceipt,
  refKey,
  type VelocityAccounts,
} from '../../domain/topupProof';

const ACCOUNTS: VelocityAccounts = {
  easypaisaNumber: '03001234567',
  jazzcashNumber: '03451112223',
  bankIban: 'PK36SCBL0000001123456702',
  accountTitle: 'Berreto Private Limited',
};

/** A clean Easypaisa transfer, the single most common receipt we will see. */
const EASYPAISA = `Easypaisa
Transaction Successful
Rs. 2,500
Sent to
BERRETO PRIVATE LIMITED
03001234567
Transaction ID: 1234567890123
Date: 15 Oct 2026, 10:42 PM
Available Balance Rs. 7,350`;

/** A bank IBFT, which prints an IBAN and labels its amount. */
const BANK_IBFT = `Meezan Bank
Funds Transfer
Transaction Successful
Beneficiary: BERRETO PRIVATE LIMITED
Account: PK36SCBL0000001123456702
Amount Transferred PKR 5,000
Service Charges Rs. 25
Reference No: FT26101512345678
15/10/2026 22:41`;

const OK = {
  claimed: 2500,
  ocrConfidence: 92,
  duplicate: false,
  imageReplay: false,
  /** Enough owed that a clean receipt clears on its own; the cap has its own case. */
  commissionDue: 5000,
};

describe('parseAmount', () => {
  it('reads the unlabelled headline figure and ignores the balance below it', () => {
    // The whole point: 7,350 is the biggest number on an Easypaisa receipt and
    // it is the driver's own money. Crediting it would be a free wallet.
    expect(parseAmount(EASYPAISA)).toBe(2500);
  });

  it('prefers a real label over everything else', () => {
    expect(parseAmount(BANK_IBFT)).toBe(5000);
  });

  it('does not mistake the service charge for the transfer', () => {
    expect(parseAmount(BANK_IBFT)).not.toBe(25);
  });

  it('refuses to guess when two unlabelled figures are left', () => {
    expect(parseAmount('Transaction Successful\nRs. 1,000\nRs. 4,000\nSent')).toBeNull();
  });

  it('handles PKR, commas and decimals', () => {
    expect(parseAmount('Amount Paid PKR 12,345.00')).toBe(12345);
  });
});

describe('parseTransactionRef', () => {
  it('finds the reference under each label the local apps use', () => {
    expect(parseTransactionRef('Transaction ID: 1234567890123')).toBe('1234567890123');
    expect(parseTransactionRef('TID 998877665544')).toBe('998877665544');
    expect(parseTransactionRef('Trx ID# A1B2C3D4E5')).toBe('A1B2C3D4E5');
    expect(parseTransactionRef('Reference No: FT26101512345678')).toBe('FT26101512345678');
  });

  it('does not return a word it found sitting after the label', () => {
    expect(parseTransactionRef('Transaction ID Successful')).toBeNull();
  });

  it('returns null when the receipt carries no reference at all', () => {
    expect(parseTransactionRef('Payment sent to Ali. Rs 500.')).toBeNull();
  });
});

describe('refKey', () => {
  it('folds the glyphs Tesseract confuses, so two reads of one receipt collide', () => {
    // This is the replay check's real failure mode: one honest OCR pass reads
    // O, the next reads 0, and the same payment gets credited twice.
    expect(refKey('TXN-OI5B')).toBe(refKey('TXN-015B'));
    expect(refKey('ABC123')).toBe(refKey('A8C123'));
  });

  it('ignores punctuation and case', () => {
    expect(refKey('ft-2610/1512')).toBe(refKey('FT26101512'));
  });

  it('refuses a fragment too short to identify a payment', () => {
    expect(refKey('12')).toBeNull();
    expect(refKey('')).toBeNull();
    expect(refKey(null)).toBeNull();
  });
});

describe('parseRecipientMatch', () => {
  it('matches a wallet number however the receipt formatted it', () => {
    expect(parseRecipientMatch('Sent to 0300 1234567', ACCOUNTS)).toBe(true);
    expect(parseRecipientMatch('Sent to +923001234567', ACCOUNTS)).toBe(true);
  });

  it('matches an IBAN on the tail the receipt actually prints', () => {
    expect(parseRecipientMatch('Account ****6702 ... 1123456702', ACCOUNTS)).toBe(true);
  });

  it('is false for a payment to somebody else entirely', () => {
    expect(parseRecipientMatch('Sent to 03339998888 ALI RAZA', ACCOUNTS)).toBe(false);
  });
});

describe('decideTopupProof', () => {
  const decide = (text: string, over: Partial<typeof OK> = {}) =>
    decideTopupProof({ fields: readReceipt(text, ACCOUNTS), ...OK, ...over });

  it('credits a clean receipt for exactly what the receipt says', () => {
    const v = decide(EASYPAISA);
    expect(v.status).toBe('approved');
    expect(v.creditAmount).toBe(2500);
  });

  it('credits a bank IBFT the same way', () => {
    const v = decide(BANK_IBFT, { claimed: 5000 });
    expect(v.status).toBe('approved');
    expect(v.creditAmount).toBe(5000);
  });

  // ── The four attacks the file exists for ──────────────────────────────────

  it('a flawless receipt for more than is owed waits for a person — text cannot prove money arrived', () => {
    // Attack: type up a perfect Easypaisa receipt in an image editor. Every
    // check above passes; only the bank statement could say it is fake. So the
    // engine clears what is owed and nothing beyond it.
    const v = decide(BANK_IBFT, { claimed: 5000, commissionDue: 300 });
    expect(v.status).toBe('pending_review');
    expect(v.creditAmount).toBe(0);
    expect(v.reasons).toContain('above_commission_due');
    expect(decide(EASYPAISA, { commissionDue: 0 }).status).toBe('pending_review');
  });

  it('pay 100, claim 10,000: never credits the claim, sends it to a human', () => {
    const v = decide(EASYPAISA, { claimed: 10000 });
    expect(v.status).toBe('pending_review');
    expect(v.creditAmount).toBe(0);
    expect(v.reasons).toContain('amount_mismatch');
  });

  it('same receipt twice: the second is rejected on the reference', () => {
    const v = decide(EASYPAISA, { duplicate: true });
    expect(v.status).toBe('rejected');
    expect(v.creditAmount).toBe(0);
    expect(v.reasons).toContain('duplicate_reference');
  });

  it('same image file twice: rejected before anything else is even read', () => {
    const v = decide(EASYPAISA, { imageReplay: true });
    expect(v.status).toBe('rejected');
    expect(v.reasons).toContain('image_replay');
  });

  it('a genuine payment to somebody else is never credited', () => {
    const otherPayee = EASYPAISA.replace('03001234567', '03339998888')
      .replace('BERRETO PRIVATE LIMITED', 'ALI RAZA');
    const v = decide(otherPayee);
    expect(v.status).toBe('pending_review');
    expect(v.creditAmount).toBe(0);
    expect(v.reasons).toContain('recipient_unmatched');
  });

  // ── Refusing to guess ─────────────────────────────────────────────────────

  it('sends a blurry read to a human rather than guessing at the digits', () => {
    const v = decide(EASYPAISA, { ocrConfidence: OCR_FLOOR - 1 });
    expect(v.status).toBe('pending_review');
    expect(v.reasons).toContain('low_ocr_confidence');
  });

  it('will not credit a receipt with no reference to spend', () => {
    const v = decide(EASYPAISA.replace('Transaction ID: 1234567890123', ''));
    expect(v.status).toBe('pending_review');
    expect(v.reasons).toContain('no_transaction_reference');
  });

  it('does not treat a random photo as a payment', () => {
    const v = decide('happy birthday\nsee you at 8');
    expect(v.status).toBe('pending_review');
    expect(v.reasons).toContain('not_a_receipt');
  });

  it('caps what it will credit without a human', () => {
    const big = EASYPAISA.replace('Rs. 2,500', `Rs. ${MAX_SINGLE + 1}`);
    const v = decide(big, { claimed: MAX_SINGLE + 1 });
    expect(v.status).toBe('pending_review');
    expect(v.reasons).toContain('above_single_cap');
  });

  it('rejects an amount under the floor outright', () => {
    const tiny = EASYPAISA.replace('Rs. 2,500', `Rs. ${MIN_SINGLE - 1}`)
      .replace('Available Balance Rs. 7,350', '');
    const v = decide(tiny, { claimed: MIN_SINGLE - 1 });
    expect(v.status).toBe('rejected');
    expect(v.reasons).toContain('below_minimum');
  });

  it('never carries a credit amount on anything but an approval', () => {
    for (const over of [
      { duplicate: true },
      { imageReplay: true },
      { claimed: 999999 },
      { ocrConfidence: 10 },
    ]) {
      expect(decide(EASYPAISA, over).creditAmount).toBe(0);
    }
  });
});
