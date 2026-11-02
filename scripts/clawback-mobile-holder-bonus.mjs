/**
 * One-off: take the mobile-holder bonus back off every driver (owner, 2026-11-02:
 * "the 2,000 given to drivers in the wallet — make it zero, give drivers nothing").
 *
 * Only what is LEFT of the bonus goes. Credits are spent oldest first, so the
 * driver's ledger (drivers/{uid}/commissionCredits) is replayed in order and the
 * bonus lot is used up before anything earned after it; daily-target credits
 * earned since stay. Never takes more than the balance. Written the way
 * adminAdjustCommissionCredit writes a clawback, so the app labels the row
 * "Bonus removed by Velocity Rides". No push is sent.
 *
 *   node scripts/clawback-mobile-holder-bonus.mjs           # count only
 *   node scripts/clawback-mobile-holder-bonus.mjs --apply   # take it back
 *
 * Safe to run again: a driver whose bonus is already gone has nothing left to take.
 * Run on 2026-11-02 (5 drivers, PKR 10,000 back). Run it once more after the
 * deploy that removes grantMobileHolderBonuses, for drivers approved in between.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(new URL('../backend/functions/', import.meta.url));
const admin = require('firebase-admin');

const root = new URL('../', import.meta.url);
const keyFile = readdirSync(root).find((f) => /^velocity-fe379-firebase-adminsdk-.*\.json$/.test(f));
if (!keyFile) throw new Error('No service account key at the repo root.');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(new URL(keyFile, root), 'utf8'))),
});
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const apply = process.argv.includes('--apply');
const REASON = 'The mobile-holder bonus has ended';

const isBonus = (row) => row.type === 'admin_grant' && row.by === 'system' && /mobile holder/i.test(row.reason ?? '');

/** What is left of the bonus after the ledger's spending, oldest credits spent first. */
function bonusLeft(rows) {
  const lots = [];
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (amount > 0) lots.push({ left: amount, bonus: isBonus(r) });
    let spend = -amount;
    for (const lot of lots) {
      if (spend <= 0) break;
      const take = Math.min(lot.left, spend);
      lot.left -= take;
      spend -= take;
    }
  }
  return lots.filter((l) => l.bonus).reduce((s, l) => s + l.left, 0);
}

// Self-check: 2,000 bonus, 1,500 spent, then 300 earned → 500 of bonus left.
console.assert(
  bonusLeft([
    { type: 'admin_grant', by: 'system', reason: 'For a mobile holder in your car', amount: 2000 },
    { type: 'spent', amount: -1500 },
    { type: 'daily_target', amount: 300 },
  ]) === 500,
  'bonusLeft FIFO',
);

const drivers = await db.collection('drivers').where('mobileHolderBonusAt', '!=', null).select().get();
let count = 0;
let total = 0;
for (const d of drivers.docs) {
  const ref = d.ref;
  const taken = await db.runTransaction(async (tx) => {
    const [snap, ledger] = await Promise.all([tx.get(ref), tx.get(ref.collection('commissionCredits').orderBy('createdAt'))]);
    const current = Math.max(0, Math.round(snap.get('commissionCredit') ?? 0));
    const take = Math.min(current, Math.round(bonusLeft(ledger.docs.map((r) => r.data()))));
    if (take <= 0 || !apply) return take;
    tx.set(
      ref,
      { commissionCredit: current - take, commissionCreditUsed: FieldValue.increment(take), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(ref.collection('commissionCredits').doc(), {
      type: 'admin_clawback', amount: -take, reason: REASON, by: 'system', createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('auditLogs').doc(), {
      action: 'commissionCredit.clawback', driverId: d.id, amount: -take, reason: 'mobile_holder_ended', by: 'system',
      createdAt: FieldValue.serverTimestamp(),
    });
    return take;
  });
  if (taken > 0) {
    count += 1;
    total += taken;
  }
}

console.log(`${drivers.size} driver(s) got the bonus; ${count} still hold some of it, PKR ${total.toLocaleString()} in all.`);
console.log(apply ? `Took PKR ${total.toLocaleString()} back from ${count} driver(s).` : 'Dry run. Re-run with --apply to take it back.');
process.exit(0);
