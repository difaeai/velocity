/**
 * Point the real top-up engine at a real screenshot and watch what it decides.
 *
 *   cd backend/functions && npm run build
 *   node scripts/smoke-topup-proof.cjs ~/Downloads/easypaisa.jpg [more.png ...]
 *
 * WHY THIS EXISTS. The unit tests prove the rules against text somebody typed
 * out; they cannot prove that Tesseract reads a real Easypaisa screenshot well
 * enough for those rules to fire. That gap is where this kind of engine quietly
 * fails: every receipt comes back "pending_review", nobody can tell whether it
 * is being careful or simply blind, and the honest answer only arrives after a
 * hundred drivers have given up on the feature.
 *
 * So this runs the compiled engine — the same readImageText() the callable
 * uses, the same decideTopupProof() — over whatever images you give it, and
 * prints what it read field by field next to the verdict. If it says
 * `amount: null` on a receipt you can read with your own eyes, that is the
 * parser to fix, and the text it dumped is the evidence.
 *
 * No key, no emulator, no network, nothing uploaded anywhere.
 *
 * The accounts it matches against default to placeholders. Point it at the
 * real ones the way production does, so `recipientMatch` means something:
 *
 *   VELOCITY_ACCOUNTS='{"easypaisaNumber":"0300…","accountTitle":"Berreto…"}' \
 *     node scripts/smoke-topup-proof.cjs shot.jpg
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COMPILED = path.join(ROOT, 'lib');

if (!fs.existsSync(COMPILED)) {
  console.error('Run `npm run build` first — this drives the compiled engine, not the sources.');
  process.exit(1);
}

const { readImageText } = require(path.join(COMPILED, 'lib', 'localVision.js'));
const { readReceipt, decideTopupProof } = require(path.join(COMPILED, 'domain', 'topupProof.js'));

const ACCOUNTS = process.env.VELOCITY_ACCOUNTS
  ? JSON.parse(process.env.VELOCITY_ACCOUNTS)
  : {
      easypaisaNumber: '03001234567',
      jazzcashNumber: '03451112223',
      bankIban: 'PK36SCBL0000001123456702',
      accountTitle: 'Berreto Private Limited',
    };

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/smoke-topup-proof.cjs <receipt.jpg> [more…]');
  console.error('Pass the screenshots you actually want checked — real ones beat synthetic ones.');
  process.exit(1);
}

/** The verdict reads as a word, so a wrong one is obvious at a glance. */
function badge(status) {
  if (status === 'approved') return '\x1b[32mCREDITED\x1b[0m';
  if (status === 'rejected') return '\x1b[31mREJECTED\x1b[0m';
  return '\x1b[33mTO A HUMAN\x1b[0m';
}

(async () => {
  console.log('\nMatching receipts against these accounts:');
  console.log(
    `  ${Object.entries(ACCOUNTS).map(([k, v]) => `${k}=${v}`).join('\n  ') || '(none configured)'}\n`,
  );

  for (const file of files) {
    const label = path.basename(file);
    if (!fs.existsSync(file)) {
      console.log(`✗ ${label}: no such file`);
      continue;
    }

    const started = Date.now();
    const read = await readImageText(fs.readFileSync(file));
    const ms = Date.now() - started;

    if (!read) {
      console.log(`✗ ${label}: could not be decoded or OCR is unavailable`);
      continue;
    }

    const fields = readReceipt(read.text, ACCOUNTS);
    // The claim matches what the receipt says, so the run exercises the
    // reading rather than the mismatch rule. Override it to watch that fire.
    const claimed = fields.amount ?? 0;
    const verdict = decideTopupProof({
      fields,
      claimed,
      ocrConfidence: read.ocrConfidence,
      duplicate: false,
      imageReplay: false,
    });

    console.log(`── ${label}  (${read.width}×${read.height}, OCR ${Math.round(read.ocrConfidence)}%, ${ms} ms)`);
    console.log(`   amount          ${fields.amount ?? '— could not read'}`);
    console.log(`   transaction ref ${fields.transactionRef ?? '— could not read'}`);
    console.log(`   dedupe key      ${fields.refKey ?? '— none, so it can never be auto-credited'}`);
    console.log(`   app             ${fields.sourceApp ?? '— unrecognised layout'}`);
    console.log(`   paid to us      ${fields.recipientMatch ? 'yes' : 'NO'}`);
    console.log(`   looks like one  ${fields.looksLikeReceipt ? 'yes' : 'NO'}`);
    console.log(`   verdict         ${badge(verdict.status)}  ${verdict.reasons.join(', ')}`);
    console.log(`   would credit    PKR ${verdict.creditAmount}`);
    console.log(`   driver reads    "${verdict.message}"`);

    if (process.env.DUMP_TEXT === '1') {
      console.log('   ── what Tesseract saw ───────────────────────────────');
      console.log(read.text.split('\n').map((l) => `   │ ${l}`).join('\n'));
    }
    console.log();
  }

  console.log('Set DUMP_TEXT=1 to print the OCR text behind any line above.\n');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
