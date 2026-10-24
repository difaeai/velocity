/**
 * The AI check on a Velocity Studio payment, run the moment it is sent.
 *
 * The customer uploads the receipt screenshot and types the transaction ID.
 * Velocity's own OCR engine (Tesseract on the function's CPU — no paid model,
 * nothing leaves the project) reads the receipt, and the reading is compared
 * with what was typed and what the plan costs. The result lands on the payment
 * document, so the admin queue shows it live, before anyone opens the picture.
 *
 * It advises; it never approves. The one thing that proves a payment is the
 * money in the account, and that check is the admin's. What it does catch is
 * the cheap lies: a receipt for less than the plan, a transaction ID that is not
 * the one on the receipt, and a screenshot that was already sent once.
 */
import { createHash } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { readImageText } from '../lib/localVision';
import { foldRef, readReceipt, refKey, type ReceiptFields, type VelocityAccounts } from '../domain/topupProof';
import { loadProof } from '../payments/manualTopup';
import { pricePkr, type Billing, type PlanId } from './plans';

export type PaymentVerdict = 'match' | 'check' | 'mismatch';

export interface PaymentCheckLine {
  key: 'readable' | 'receipt' | 'txn' | 'amount' | 'recipient' | 'fresh';
  /** true agrees, false contradicts, null could not tell. */
  ok: boolean | null;
  label: string;
}

export interface PaymentAnalysis {
  verdict: PaymentVerdict;
  summary: string;
  checks: PaymentCheckLine[];
  read: { amount: number | null; transactionRef: string | null; sourceApp: string | null; ocrConfidence: number | null };
  imageSha: string | null;
  atMs: number;
}

/** A receipt may show a little under the asked rupees: the rate moves and wallets round. */
export const AMOUNT_SLACK = 0.05;
/** Below this Tesseract is guessing, and nothing it read counts either way. */
const READABLE_CONFIDENCE = 55;

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/** Turn one receipt reading into the lines the admin sees. Pure. */
export function judgePayment(input: {
  /** Null when the screenshot could not be opened or read at all. */
  fields: ReceiptFields | null;
  text: string;
  ocrConfidence: number | null;
  typedTxn: string;
  expectedPkr: number;
  accountsKnown: boolean;
  imageReused: boolean;
}): Omit<PaymentAnalysis, 'imageSha' | 'atMs'> {
  const { fields, text, typedTxn, expectedPkr } = input;
  const readable = fields !== null && (input.ocrConfidence ?? 0) >= READABLE_CONFIDENCE;
  const checks: PaymentCheckLine[] = [];

  checks.push({
    key: 'fresh',
    ok: !input.imageReused,
    label: input.imageReused ? 'This exact screenshot was already sent with another payment' : 'Screenshot not seen before',
  });
  checks.push({
    key: 'readable',
    ok: readable,
    label: readable ? `Screenshot read (${Math.round(input.ocrConfidence ?? 0)}% sure)` : 'Could not read the screenshot clearly',
  });

  if (readable && fields) {
    checks.push({
      key: 'receipt',
      ok: fields.looksLikeReceipt,
      label: fields.looksLikeReceipt ? 'Looks like a payment receipt' : 'Does not look like a payment receipt',
    });

    const typed = refKey(typedTxn);
    const onReceipt = fields.refKey;
    const inText = typed !== null && foldRef(text).includes(typed);
    checks.push(
      inText || (typed !== null && typed === onReceipt)
        ? { key: 'txn', ok: true, label: 'Transaction ID found on the receipt' }
        : onReceipt
          ? { key: 'txn', ok: false, label: `Receipt shows a different transaction ID (${fields.transactionRef})` }
          : { key: 'txn', ok: null, label: 'No transaction ID could be read off the receipt' },
    );

    checks.push(
      fields.amount === null
        ? { key: 'amount', ok: null, label: `Amount not readable — the plan needs ${rs(expectedPkr)}` }
        : fields.amount >= expectedPkr * (1 - AMOUNT_SLACK)
          ? { key: 'amount', ok: true, label: `${rs(fields.amount)} paid — the plan needs ${rs(expectedPkr)}` }
          : { key: 'amount', ok: false, label: `Only ${rs(fields.amount)} paid — the plan needs ${rs(expectedPkr)}` },
    );

    // A receipt that masks our number is common and honest, so "not found" is unknown, never a lie.
    checks.push(
      !input.accountsKnown
        ? { key: 'recipient', ok: null, label: 'No receiving accounts on file to compare' }
        : fields.recipientMatch
          ? { key: 'recipient', ok: true, label: 'Paid to one of our accounts' }
          : { key: 'recipient', ok: null, label: 'Our account number is not visible on the receipt' },
    );
  }

  const against = checks.filter((c) => c.ok === false && c.key !== 'readable');
  const unsure = checks.filter((c) => c.ok !== true);
  const verdict: PaymentVerdict = against.length ? 'mismatch' : unsure.length ? 'check' : 'match';
  const summary =
    verdict === 'mismatch'
      ? against.map((c) => c.label).join('. ')
      : verdict === 'match'
        ? 'Everything on the receipt agrees. Confirm the money arrived, then approve.'
        : `Could not confirm everything: ${unsure.map((c) => c.label.toLowerCase()).join('; ')}.`;

  return {
    verdict,
    summary,
    checks,
    read: {
      amount: fields?.amount ?? null,
      transactionRef: fields?.transactionRef ?? null,
      sourceApp: fields?.sourceApp ?? null,
      ocrConfidence: input.ocrConfidence === null ? null : Math.round(input.ocrConfidence),
    },
  };
}

/**
 * Read one payment's receipt and write the verdict onto it. Never throws: a
 * check that cannot run says so on the payment, and the admin decides as before.
 */
export async function checkStudioPayment(paymentId: string): Promise<void> {
  const ref = db.doc(`studioPayments/${paymentId}`);
  try {
    const pay = (await ref.get()).data() as
      | { wid: string; plan: PlanId; billing?: Billing; txnId: string | null; screenshotPath: string | null }
      | undefined;
    if (!pay) return;

    const bytes = pay.screenshotPath ? await loadProof(pay.screenshotPath) : null;
    const imageSha = bytes ? createHash('sha256').update(bytes).digest('hex') : null;

    // One screenshot buys one payment: the first payment to send it claims it.
    let imageReused = false;
    if (imageSha) {
      const claim = db.doc(`studioReceiptHashes/${imageSha}`);
      try {
        await claim.create({ paymentId, wid: pay.wid, atMs: Date.now() });
      } catch {
        imageReused = (await claim.get()).get('paymentId') !== paymentId;
      }
    }

    const read = bytes ? await readImageText(bytes) : null;
    const accounts = ((await db.doc('config/settlementAccounts').get()).data() ?? {}) as VelocityAccounts;
    const result = judgePayment({
      fields: read ? readReceipt(read.text, accounts) : null,
      text: read?.text ?? '',
      ocrConfidence: read?.ocrConfidence ?? null,
      typedTxn: pay.txnId ?? '',
      expectedPkr: pricePkr(pay.plan, pay.billing ?? 'month'),
      accountsKnown: Boolean(accounts.easypaisaNumber || accounts.jazzcashNumber || accounts.bankIban),
      imageReused,
    });
    const analysis: PaymentAnalysis = { ...result, imageSha, atMs: Date.now() };
    await ref.update({ analysis, imageSha });
  } catch (e) {
    logger.error('studio: the payment check failed', { paymentId, message: (e as Error).message });
    await ref
      .update({
        analysis: {
          verdict: 'check',
          summary: 'The AI check could not run on this one. Look at the screenshot yourself.',
          checks: [],
          read: { amount: null, transactionRef: null, sourceApp: null, ocrConfidence: null },
          imageSha: null,
          atMs: Date.now(),
        } satisfies PaymentAnalysis,
      })
      .catch(() => undefined);
  }
}
