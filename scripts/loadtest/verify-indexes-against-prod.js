// Runs every composite-needing query shape against PROD Firestore with limit(1).
// Read-only. A missing index surfaces as FAILED_PRECONDITION "requires an index".
const fs = require('fs');
const admin = require(require('path').resolve(__dirname, '../../backend/functions/node_modules/firebase-admin'));

// Point GOOGLE_APPLICATION_CREDENTIALS at a service-account key with Firestore
// read access, or set VELOCITY_SA_KEY to the key file's path. Nothing here
// writes, but it does run every query shape against the live database, so it
// wants a credential you are willing to read production with.
const keyPath = process.env.VELOCITY_SA_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('Set VELOCITY_SA_KEY (or GOOGLE_APPLICATION_CREDENTIALS) to a service-account key path.');
  process.exit(2);
}
admin.initializeApp({ credential: admin.credential.cert(require(require('path').resolve(keyPath))) });
const db = admin.firestore();

const shapes = JSON.parse(fs.readFileSync(__dirname + '/all-queries.json', 'utf8'));

// Sentinel values. Index planning happens before any read, so values are irrelevant
// to whether Firestore demands an index -- only the operators and fields matter.
function val(op, field) {
  const multi = op === 'in' || op === 'not-in' || op === 'array-contains-any';
  if (multi) return ['__probe__'];
  if (/geohash/i.test(field)) return '__probe__';
  if (/At$|Time$|^created|^updated|^expires|^matures|^departure/i.test(field)) return new Date(0);
  if (/count|Count|price|fare|population|amount|radius|seats/i.test(field)) return 0;
  if (op === '==' && /^(active|online|revoked|resolved|pool|byCustomer|optIn)/i.test(field)) return true;
  return '__probe__';
}

function build(s) {
  let q = s.isCG ? db.collectionGroup(s.coll) : db.collection(s.coll);
  for (const w of s.wheres) q = q.where(w.f, w.op, val(w.op, w.f));
  for (const o of s.orders) q = q.orderBy(o.f, o.dir === 'desc' ? 'desc' : 'asc');
  return q.limit(1);
}

function label(s) {
  return s.coll + (s.isCG ? ' [CG]' : '') + '  WHERE ' +
    (s.wheres.map(w => w.f + ' ' + w.op).join(' AND ') || '-') +
    '  ORDER BY ' + (s.orders.map(o => o.f + ' ' + o.dir).join(', ') || '-');
}

(async () => {
  const needsIndex = [], ok = [], errored = [];
  for (const s of shapes) {
    try {
      await build(s).get();
      ok.push(s);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/requires an index|FAILED_PRECONDITION/i.test(msg)) {
        const url = (msg.match(/https:\/\/console\.firebase\.google\.com\S+/) || [''])[0];
        needsIndex.push({ s, url });
      } else {
        errored.push({ s, msg: msg.slice(0, 160) });
      }
    }
  }
  console.log('shapes probed      :', shapes.length);
  console.log('served fine (OK)   :', ok.length);
  console.log('REQUIRE AN INDEX   :', needsIndex.length);
  console.log('other errors       :', errored.length);

  console.log('\n============ GENUINELY MISSING INDEXES (prod-verified) ============');
  for (const n of needsIndex) {
    console.log('\n* ' + label(n.s));
    n.s.sites.slice(0, 5).forEach(x => console.log('    at ' + x));
    if (n.url) console.log('    create: ' + n.url.slice(0, 150));
  }
  if (errored.length) {
    console.log('\n---- shapes that errored for another reason (inspect) ----');
    for (const e of errored) console.log('* ' + label(e.s) + '\n    ' + e.msg);
  }
  fs.writeFileSync(__dirname + '/prod-missing.json', JSON.stringify(needsIndex.map(n => ({ ...n.s, url: n.url })), null, 2));
  process.exit(0);
})();
