/**
 * Reading a payment receipt and deciding whether it may become credit — ours,
 * with no model and no account with anybody.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * Until a gateway merchant account exists, a driver funds their balance the way
 * everybody in Pakistan already pays everybody: they open Easypaisa, JazzCash
 * or their bank's app, send the money to Velocity's account, and upload the
 * screenshot. This file is the engine that decides whether that screenshot is
 * worth real credit.
 *
 * ── WHY IT IS HARDER THAN THE SETTLEMENT CHECK ───────────────────────────────
 *
 * lib/paymentProofAI.ts already checks screenshots, but for a *settlement*,
 * where the only question is "did they pay at least the PKR 420 they owed?".
 * The amount is known in advance, so a forged number can only ever buy the
 * forger the thing they already owed.
 *
 * A top-up inverts that. **The screenshot decides the amount**, so every rupee
 * of credit is whatever the engine believed it read. That changes which attacks
 * matter, and all four of the ones that matter are about reuse and arithmetic
 * rather than about whether a picture "looks real":
 *
 *   1. Pay 100, edit the digits to 10,000.
 *   2. Pay 1,000 once, upload the same screenshot ten times.
 *   3. Upload a genuine receipt for a payment made to somebody else.
 *   4. Upload a genuine, already-credited receipt from three months ago.
 *
 * Only the first is a forgery-detection problem. The other three are settled by
 * bookkeeping — one transaction reference may be spent exactly once, ever — and
 * bookkeeping is something a rule can do perfectly and a model cannot do at
 * all. So the weight of this engine sits on the reference number, not on the
 * pixels.
 *
 * ── WHY NO MODEL ─────────────────────────────────────────────────────────────
 *
 * A vision model costs money per screenshot, forever, on a path every driver
 * uses several times a month. Tesseract is already in this backend for driver
 * verification (lib/localVision.ts), it runs on the function's own CPU, and a
 * payment screenshot is the easiest thing OCR ever gets handed: rendered text,
 * high contrast, no perspective, no handwriting. The reading is the easy half.
 *
 * ── WHAT IT REFUSES TO GUESS ─────────────────────────────────────────────────
 *
 * The engine has three verdicts, not two, and the middle one is the point. A
 * receipt it cannot read confidently is NOT rejected and NOT credited — it goes
 * to an admin, who looks at it and decides. Being strict costs an admin thirty
 * seconds; being lenient costs real money to anyone with an image editor. Every
 * ambiguity in this file resolves toward the human.
 *
 * Nothing here does any I/O. It takes OCR text and returns a verdict, which is
 * why it can be tested exhaustively against real receipt layouts with no
 * emulator, no worker and no image — see __tests__/topupProof.test.ts.
 */

/** Accounts Velocity receives money into, from `config/settlementAccounts`. */
export interface VelocityAccounts {
  easypaisaNumber?: string;
  jazzcashNumber?: string;
  bankName?: string;
  bankIban?: string;
  accountTitle?: string;
}

/** The fields an engine run managed to pull off a receipt. */
export interface ReceiptFields {
  /** Transferred amount in whole PKR, or null if it could not be read. */
  amount: number | null;
  /** The transaction/reference number as printed, or null. */
  transactionRef: string | null;
  /** The reference reduced to a collision-safe key — see `refKey`. */
  refKey: string | null;
  /**
   * Which app the receipt appears to be from, lower-case, or null.
   *
   * Best-effort, and null more often than you would expect: every one of these
   * apps prints its name in white on a saturated brand bar at the top of the
   * screen, and that is the first thing greyscaling loses — measured, Tesseract
   * returns the whole of an Easypaisa receipt except the word "Easypaisa".
   *
   * So it is a label for the admin queue and nothing else. **No rule in this
   * file reads it**, deliberately: a check that fires on a field which is null
   * on honest receipts is a check that only ever punishes honest drivers.
   */
  sourceApp: string | null;
  /** True when one of Velocity's own accounts appears in the text. */
  recipientMatch: boolean;
  /** True when the text carries the furniture of a real payment receipt. */
  looksLikeReceipt: boolean;
}

export type TopupProofStatus = 'approved' | 'pending_review' | 'rejected';

export interface TopupProofVerdict {
  status: TopupProofStatus;
  /** What may be credited, in whole PKR. Always 0 unless `approved`. */
  creditAmount: number;
  fields: ReceiptFields;
  /** Machine-readable reasons, for logs and the admin queue. */
  reasons: string[];
  /** One line the driver reads. Never names an internal rule. */
  message: string;
}

/**
 * Limits.
 *
 * `MAX_SINGLE` caps the damage a single successful forgery can do; it is not a
 * limit anyone honest will meet, because a driver tops up a few thousand
 * rupees of commission float, not a salary. `MIN_SINGLE` matches the gateway's
 * own floor so the two paths cannot disagree about what a top-up is.
 */
export const MIN_SINGLE = 100;
export const MAX_SINGLE = 50_000;

/**
 * How old a receipt may be, in hours.
 *
 * Long enough that a driver who paid last night and uploaded in the morning is
 * fine; short enough that a stack of genuine old receipts is not a wallet. A
 * receipt older than this is not refused — it goes to an admin, because the
 * honest version of it (a driver who paid on Friday and only opened the app on
 * Monday) is common and must not be called fraud.
 */
export const MAX_RECEIPT_AGE_HOURS = 72;

/** The amount read and the amount claimed may differ by this much, in PKR. */
export const AMOUNT_TOLERANCE = 0;

/**
 * OCR confidence below which nothing is auto-approved.
 *
 * Deliberately well above the floor used for identity documents. A misread
 * digit on a CNIC is a name an admin fixes; a misread digit here is money.
 */
export const OCR_FLOOR = 75;

/** Words that only appear on a real payment confirmation. */
const RECEIPT_MARKERS = [
  'transaction successful', 'transfer successful', 'payment successful',
  'successful', 'completed', 'transaction id', 'trx id', 'txn id', 'tid',
  'reference', 'ref no', 'receipt', 'sent to', 'beneficiary', 'transferred to',
  'money sent', 'funds transfer', 'ibft', 'raast', 'account title',
];

/** Receipt layouts we know, and the strings that identify them. */
const SOURCE_APPS: ReadonlyArray<{ app: string; markers: string[] }> = [
  { app: 'easypaisa', markers: ['easypaisa', 'easy paisa', 'telenor microfinance'] },
  { app: 'jazzcash',  markers: ['jazzcash', 'jazz cash', 'mobilink microfinance'] },
  { app: 'sadapay',   markers: ['sadapay', 'sada pay'] },
  { app: 'nayapay',   markers: ['nayapay', 'naya pay'] },
  { app: 'hbl',       markers: ['hbl', 'habib bank'] },
  { app: 'meezan',    markers: ['meezan'] },
  { app: 'ubl',       markers: ['ubl', 'united bank'] },
  { app: 'mcb',       markers: ['mcb', 'muslim commercial'] },
  { app: 'allied',    markers: ['allied bank', 'abl '] },
  { app: 'bankalfalah', markers: ['alfalah'] },
  { app: 'faysal',    markers: ['faysal'] },
  { app: 'askari',    markers: ['askari'] },
  { app: 'bop',       markers: ['bank of punjab'] },
  { app: 'nbp',       markers: ['national bank'] },
  { app: 'standardchartered', markers: ['standard chartered'] },
];

/** The folding alone, for any length of text — `refKey` adds the length rules. */
export function foldRef(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6');
}

/**
 * Reduce a reference to a key two OCR reads of the same receipt will agree on.
 *
 * Tesseract confuses the same handful of glyph pairs on every font it has ever
 * seen — O/0, I/l/1, S/5, B/8, Z/2 — so two honest reads of one receipt can
 * differ by a character and sail straight past an exact-match replay check,
 * which is the one check that has to hold. Folding the ambiguous pairs onto
 * one side makes those reads collide on purpose.
 *
 * It also makes a *different* reference collide occasionally. That is the
 * trade, and it is the right way round: a false collision sends an honest
 * driver to an admin who credits them in thirty seconds, while a missed
 * collision lets one payment be spent twice. Only an exact image match is ever
 * treated as proven reuse — see the caller.
 */
export function refKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const folded = foldRef(raw);
  // Shorter than this is not a transaction reference, it is a fragment —
  // crediting on a four-character key would collide across unrelated payments.
  return folded.length >= 6 ? folded.slice(0, 40) : null;
}

/** Digits only, for comparing account numbers the OCR may have spaced oddly. */
function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Pull the transferred amount out of the text.
 *
 * Labelled amounts first, and only labels that mean *this* transfer. A receipt
 * usually shows several figures — the amount, a fee, and very often the
 * remaining balance, which on a driver's wallet is the largest number on the
 * screen. Taking the biggest "Rs" on the page would credit the balance, so the
 * unlabelled fallback is deliberately the only-one-figure case and nothing
 * else; anything busier goes to a human.
 */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase();

  // Labels in priority order. `transferred`/`you sent` beat a bare `amount`,
  // which some layouts also use for the fee line.
  const labels = [
    'amount transferred', 'transferred amount', 'transfer amount',
    'amount sent', 'you sent', 'you have sent', 'total amount',
    'amount paid', 'paid amount', 'amount',
  ];
  for (const label of labels) {
    const i = t.indexOf(label);
    if (i === -1) continue;
    // Look only at the rest of that line plus the next one: on a two-column
    // receipt the figure sits to the right of its label, on a stacked one it
    // sits directly beneath, and anything further away belongs to another row.
    const window = text.slice(i, i + 120);
    const found = firstMoney(window.slice(label.length));
    if (found !== null) return found;
  }

  // No usable label — which is the common case, not the odd one. Easypaisa and
  // most bank apps print the transferred amount as a big unlabelled figure at
  // the top of the receipt and label everything else: the fee, the tax, and
  // the remaining balance. So instead of looking for the amount, rule out the
  // figures that announce what they are, and see what is left.
  //
  // Getting this wrong in the lenient direction credits a driver their own
  // wallet balance, which on a busy day is the largest number on the screen.
  // Hence: exactly one survivor, or nobody is credited without a human.
  const survivors = [...new Set(unlabelledMoney(text))];
  return survivors.length === 1 ? survivors[0] : null;
}

/** Figures that are explicitly something *other* than the transferred amount. */
const NOT_THE_AMOUNT = [
  'balance', 'bal.', 'available', 'remaining', 'fee', 'charges', 'charge',
  'tax', 'wht', 'withholding', 'limit', 'discount', 'cashback', 'previous',
];

/**
 * Every `Rs`/`PKR` figure that is not introduced by a label meaning something
 * else. The window is the text immediately before the figure, which is where
 * a label sits in every receipt layout — above it on a stacked one, to its
 * left on a two-column one, and both read the same once OCR has flattened the
 * page into lines.
 */
function unlabelledMoney(text: string): number[] {
  const out: number[] = [];
  const re = /(?:rs\.?|pkr)\s*([0-9][0-9,\s]{0,12}(?:\.[0-9]{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (NOT_THE_AMOUNT.some((w) => before.includes(w))) continue;
    const v = toAmount(m[1]);
    if (v !== null) out.push(v);
  }
  return out;
}

/** The first `Rs 1,234` / `PKR 1234.00` / bare `1,234` figure in a fragment. */
function firstMoney(fragment: string): number | null {
  const m = fragment.match(/(?:rs\.?|pkr)?\s*([0-9][0-9,\s]{0,12}(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  return toAmount(m[1]);
}

function toAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Pull the transaction / reference number out of the text.
 *
 * Every Pakistani payment app prints one, under one of a handful of labels.
 * This is the single most important field in the file: it is what makes one
 * payment creditable exactly once.
 */
export function parseTransactionRef(text: string): string | null {
  const patterns = [
    /(?:transaction\s*(?:id|no|number|ref(?:erence)?)|trx\s*(?:id|no)?|txn\s*(?:id|no)?|tid|ref(?:erence)?\s*(?:no|number|id)?|stan)\s*[:#.-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{5,39})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const candidate = m[1].trim();
      // A label followed by a word is a layout we misread, not a reference.
      if (/^[A-Za-z]+$/.test(candidate)) continue;
      return candidate;
    }
  }
  return null;
}

/** Which app the receipt came from, if the layout names itself. */
export function parseSourceApp(text: string): string | null {
  const t = text.toLowerCase();
  for (const { app, markers } of SOURCE_APPS) {
    if (markers.some((m) => t.includes(m))) return app;
  }
  return null;
}

/**
 * Does the receipt name one of Velocity's own accounts?
 *
 * Account numbers are compared digits-only, because OCR spaces and dashes
 * them unpredictably, and an IBAN is matched on its last ten digits — the part
 * a receipt actually prints, since most apps mask the front of it.
 */
export function parseRecipientMatch(text: string, accounts: VelocityAccounts): boolean {
  const textDigits = digits(text);
  const t = text.toLowerCase();

  for (const num of [accounts.easypaisaNumber, accounts.jazzcashNumber]) {
    if (!num) continue;
    const d = digits(num);
    // Drop the leading zero too: receipts print 3001234567 and +923001234567
    // for the same number as often as they print 03001234567.
    if (d.length >= 10 && (textDigits.includes(d) || textDigits.includes(d.slice(1)))) return true;
  }

  if (accounts.bankIban) {
    const d = digits(accounts.bankIban);
    if (d.length >= 10 && textDigits.includes(d.slice(-10))) return true;
  }

  // An account title is the weakest of the three and is only trusted when it
  // is distinctive enough not to appear by accident.
  if (accounts.accountTitle && accounts.accountTitle.trim().length >= 6) {
    if (t.includes(accounts.accountTitle.trim().toLowerCase())) return true;
  }

  return false;
}

/** Does this read like a payment confirmation at all? */
export function parseLooksLikeReceipt(text: string): boolean {
  const t = text.toLowerCase();
  return RECEIPT_MARKERS.filter((m) => t.includes(m)).length >= 2;
}

/** Everything the engine can get off one block of OCR text. */
export function readReceipt(text: string, accounts: VelocityAccounts): ReceiptFields {
  const transactionRef = parseTransactionRef(text);
  return {
    amount: parseAmount(text),
    transactionRef,
    refKey: refKey(transactionRef),
    sourceApp: parseSourceApp(text),
    recipientMatch: parseRecipientMatch(text, accounts),
    looksLikeReceipt: parseLooksLikeReceipt(text),
  };
}

/**
 * Turn the fields into a verdict.
 *
 * `claimed` is what the driver typed before uploading. It is never what gets
 * credited — the receipt is — but a mismatch between the two is a strong
 * signal, because an honest driver types what they just paid and a forger
 * types what they wish they had.
 *
 * `duplicate` and `imageReplay` are decided by the caller against Firestore,
 * since they are the only two facts in here that need the rest of the world.
 */
export function decideTopupProof(params: {
  fields: ReceiptFields;
  claimed: number;
  ocrConfidence: number;
  /** The reference has been credited before, by anyone. */
  duplicate: boolean;
  /** This exact image file has been uploaded before, by anyone. */
  imageReplay: boolean;
  /** What the uploader owes in commission right now; 0 for anyone who is not a driver. */
  commissionDue: number;
}): TopupProofVerdict {
  const { fields, claimed, ocrConfidence, duplicate, imageReplay, commissionDue } = params;
  const reasons: string[] = [];

  const reject = (reason: string, message: string): TopupProofVerdict => {
    reasons.push(reason);
    return { status: 'rejected', creditAmount: 0, fields, reasons, message };
  };
  const review = (reason: string, message: string): TopupProofVerdict => {
    reasons.push(reason);
    return { status: 'pending_review', creditAmount: 0, fields, reasons, message };
  };

  // ── Proven reuse. The only two outright rejections in the file, because
  // these are the only two things it can be certain about.
  if (imageReplay) {
    return reject(
      'image_replay',
      'This exact screenshot has already been used for a top-up. Upload the receipt for a new payment.',
    );
  }
  if (duplicate && fields.refKey) {
    return reject(
      'duplicate_reference',
      'This transaction has already been credited. If you made a second payment, upload that receipt instead.',
    );
  }

  // ── Is it a receipt at all?
  if (!fields.looksLikeReceipt) {
    return review(
      'not_a_receipt',
      'We could not read this as a payment receipt. Upload the full confirmation screen, uncropped.',
    );
  }

  // ── Could we read it well enough to act on money?
  if (ocrConfidence < OCR_FLOOR) {
    return review(
      'low_ocr_confidence',
      'The screenshot was hard to read. Our team will check it shortly — or upload a sharper, full-screen one.',
    );
  }

  // ── The three facts a credit needs: an amount, a reference, and us as the
  // recipient. Any one of them missing is a human's problem, not a refusal.
  if (fields.amount === null) {
    return review('amount_unreadable', 'We could not read the amount. Our team will check it shortly.');
  }
  if (!fields.refKey) {
    return review(
      'no_transaction_reference',
      'We could not find the transaction ID on this receipt. Our team will check it shortly.',
    );
  }
  if (!fields.recipientMatch) {
    return review(
      'recipient_unmatched',
      'We could not confirm this was sent to a Velocity account. Our team will check it shortly.',
    );
  }

  // ── Arithmetic.
  if (Math.abs(fields.amount - claimed) > AMOUNT_TOLERANCE) {
    return review(
      'amount_mismatch',
      `You entered PKR ${claimed.toLocaleString()} but the receipt shows PKR ${fields.amount.toLocaleString()}. Our team will check it.`,
    );
  }
  if (fields.amount < MIN_SINGLE) {
    return reject('below_minimum', `The smallest top-up is PKR ${MIN_SINGLE}.`);
  }
  if (fields.amount > MAX_SINGLE) {
    return review(
      'above_single_cap',
      `Top-ups over PKR ${MAX_SINGLE.toLocaleString()} are checked by our team before they are credited.`,
    );
  }
  // Everything above tells a receipt that looks wrong from one that looks right.
  // None of it tells a real receipt from a good fake — only the bank statement
  // can — so on its own the engine only clears commission owed right now. A
  // fake then buys a few days' grace until the after-check reverses it, never
  // money that can be spent elsewhere.
  if (fields.amount > commissionDue) {
    return review('above_commission_due', 'Our team will check this against our account and add it shortly.');
  }

  reasons.push('auto_approved');
  return {
    status: 'approved',
    creditAmount: fields.amount,
    fields,
    reasons,
    message: `PKR ${fields.amount.toLocaleString()} added to your balance.`,
  };
}
