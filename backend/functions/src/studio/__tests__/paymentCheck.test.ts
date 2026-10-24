/**
 * The AI check on a Studio payment: what it reads off a receipt, and what it
 * tells the admin. The last case draws a receipt and reads it with the real
 * OCR engine, end to end, the way a customer's screenshot is read in production.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { readReceipt, type ReceiptFields } from '../../domain/topupProof';
import { readImageText } from '../../lib/localVision';
import { judgePayment } from '../paymentCheck';
import { pricePkr } from '../plans';

const CONTENT_PKR = pricePkr('content', 'month');

const FIELDS: ReceiptFields = {
  amount: CONTENT_PKR,
  transactionRef: '41893377201',
  refKey: '41893377201',
  sourceApp: 'easypaisa',
  recipientMatch: true,
  looksLikeReceipt: true,
};

const judge = (over: Partial<Parameters<typeof judgePayment>[0]> = {}) =>
  judgePayment({
    fields: FIELDS,
    text: 'Transaction ID 41893377201',
    ocrConfidence: 88,
    typedTxn: '41893377201',
    expectedPkr: CONTENT_PKR,
    accountsKnown: true,
    imageReused: false,
    ...over,
  });

const line = (r: ReturnType<typeof judgePayment>, key: string) => r.checks.find((c) => c.key === key);

describe('judgePayment', () => {
  it('says match when everything on the receipt agrees', () => {
    const r = judge();
    expect(r.verdict).toBe('match');
    expect(r.checks.every((c) => c.ok === true)).toBe(true);
  });

  it('calls out a receipt for less than the plan', () => {
    const r = judge({ fields: { ...FIELDS, amount: 1000 } });
    expect(r.verdict).toBe('mismatch');
    expect(r.summary).toMatch(/Only Rs 1,000 paid — the plan needs Rs 5,320/);
  });

  it('allows a few percent under the asked rupees', () => {
    expect(judge({ fields: { ...FIELDS, amount: Math.ceil(CONTENT_PKR * 0.96) } }).verdict).toBe('match');
  });

  it('calls out a typed ID that is not the one on the receipt', () => {
    const r = judge({ typedTxn: '99999999999', text: 'Transaction ID 41893377201' });
    expect(r.verdict).toBe('mismatch');
    expect(line(r, 'txn')?.label).toMatch(/different transaction ID \(41893377201\)/);
  });

  it('forgives the OCR swapping O for 0 in the ID', () => {
    expect(judge({ typedTxn: 'EP0S12345', text: 'TID: EPOS12345', fields: { ...FIELDS, refKey: null, transactionRef: null } }).verdict).toBe(
      'match',
    );
  });

  it('calls out a screenshot already sent with another payment', () => {
    const r = judge({ imageReused: true });
    expect(r.verdict).toBe('mismatch');
    expect(r.summary).toMatch(/already sent/);
  });

  it('asks a person to look when the picture cannot be read, without calling it a lie', () => {
    const r = judge({ fields: null, ocrConfidence: null });
    expect(r.verdict).toBe('check');
    expect(r.checks.map((c) => c.key)).toEqual(['fresh', 'readable']);
  });

  it('treats a masked account number as unknown, not as a wrong account', () => {
    const r = judge({ fields: { ...FIELDS, recipientMatch: false } });
    expect(line(r, 'recipient')?.ok).toBeNull();
    expect(r.verdict).toBe('check');
  });
});

/** A plain receipt as a wallet app draws it, rendered to PNG. */
async function receiptPng(lines: string[]): Promise<Buffer> {
  const rows = lines
    .map((t, i) => `<text x="60" y="${140 + i * 90}" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#111">${t}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${200 + lines.length * 90}"><rect width="100%" height="100%" fill="#fff"/>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('reading a real receipt picture', () => {
  it('reads the amount, the ID and our account off the picture and agrees with what was typed', async () => {
    const png = await receiptPng([
      'Transaction Successful',
      'Amount Rs. 5,320',
      'Sent to VELOCITY RIDES',
      'Account 0300 1234567',
      'Transaction ID 41893377201',
      'Fee Rs. 0',
    ]);
    const read = await readImageText(png);
    expect(read).not.toBeNull();
    const fields = readReceipt(read!.text, { easypaisaNumber: '03001234567' });
    const r = judgePayment({
      fields,
      text: read!.text,
      ocrConfidence: read!.ocrConfidence,
      typedTxn: '41893377201',
      expectedPkr: CONTENT_PKR,
      accountsKnown: true,
      imageReused: false,
    });
    expect(fields.amount).toBe(5320);
    expect(r.verdict).toBe('match');
  }, 60_000);
});
