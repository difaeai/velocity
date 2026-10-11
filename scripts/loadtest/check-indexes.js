// Static Firestore query extractor + index coverage checker.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function walk(dir, out) {
  out = out || [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = []
  .concat(walk(path.join(ROOT, 'backend/functions/src')))
  .concat(walk(path.join(ROOT, 'apps/mobile/app')))
  .concat(walk(path.join(ROOT, 'apps/mobile/src')))
  .concat(walk(path.join(ROOT, 'app')))
  .concat(walk(path.join(ROOT, 'lib')))
  .concat(walk(path.join(ROOT, 'components')));

const queries = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  // Pattern A: admin/chain style .collection('x').where(...).orderBy(...)
  const reA = /\.(collection|collectionGroup)\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*\)((?:\s*\.\s*(?:where|orderBy|limit|limitToLast|select|startAfter|startAt|endBefore|endAt|count|offset)\s*\([^()]*(?:\([^()]*\)[^()]*)*\))*)/g;
  let m;
  while ((m = reA.exec(src))) {
    const coll = m[2], tail = m[3] || '';
    if (!/\.\s*(where|orderBy)\s*\(/.test(tail)) continue;
    const wheres = Array.from(tail.matchAll(/\.\s*where\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g)).map(x => ({ f: x[1], op: x[2] }));
    const orders = Array.from(tail.matchAll(/\.\s*orderBy\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*['"`]([^'"`]+)['"`])?/g)).map(x => ({ f: x[1], dir: x[2] || 'asc' }));
    const line = src.slice(0, m.index).split('\n').length;
    queries.push({ coll, wheres, orders, isCG: m[1] === 'collectionGroup', file: rel, line, style: 'chain' });
  }

  // Pattern B: client SDK query(collection(db,'x'), where(...), orderBy(...))
  const reB = /\bquery\(\s*(?:collection|collectionGroup)\(\s*[A-Za-z0-9_.]+\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  while ((m = reB.exec(src))) {
    const open = src.indexOf('(', m.index + 5);
    let depth = 0, end = open;
    for (let k = open; k < src.length; k++) {
      if (src[k] === '(') depth++;
      else if (src[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
    }
    const body = src.slice(open, end);
    const coll = m[1];
    const wheres = Array.from(body.matchAll(/\bwhere\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g)).map(x => ({ f: x[1], op: x[2] }));
    const orders = Array.from(body.matchAll(/\borderBy\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*['"`]([^'"`]+)['"`])?/g)).map(x => ({ f: x[1], dir: x[2] || 'asc' }));
    if (!wheres.length && !orders.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    queries.push({ coll, wheres, orders, isCG: /collectionGroup/.test(src.slice(m.index, m.index + 40)), file: rel, line, style: 'client' });
  }
}

const RANGE = new Set(['<', '<=', '>', '>=', '!=', 'not-in']);
const ARRAY = new Set(['array-contains', 'array-contains-any']);

function needsComposite(q) {
  const eqs = q.wheres.filter(w => w.op === '==' || w.op === 'in');
  const ranges = q.wheres.filter(w => RANGE.has(w.op));
  const arrs = q.wheres.filter(w => ARRAY.has(w.op));
  const orders = q.orders;
  const filterFields = new Set(q.wheres.map(w => w.f));
  if (!q.wheres.length) return orders.length > 1;
  const nonTrivialOrder = orders.length > 1 || orders.some(o => !filterFields.has(o.f));
  if (arrs.length && (q.wheres.length > 1 || orders.length)) return true;
  if (ranges.length && orders.length && !(orders.length === 1 && orders[0].f === ranges[0].f)) return true;
  if (ranges.length > 1 && new Set(ranges.map(r => r.f)).size > 1) return true;
  if (eqs.length >= 1 && nonTrivialOrder) return true;
  if (eqs.length >= 2) return true;
  if (ranges.length && eqs.length) return true;
  return false;
}

const idxFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'));
const indexes = (idxFile.indexes || []).map(i => ({
  coll: i.collectionGroup,
  cg: i.queryScope === 'COLLECTION_GROUP',
  fields: i.fields.map(f => ({ f: f.fieldPath, arr: !!f.arrayConfig, desc: f.order === 'DESCENDING' })),
}));

function satisfied(q) {
  const eqF = q.wheres.filter(w => w.op === '==' || w.op === 'in').map(w => w.f);
  const arrF = q.wheres.filter(w => ARRAY.has(w.op)).map(w => w.f);
  const rangeF = q.wheres.filter(w => RANGE.has(w.op)).map(w => w.f);
  const orderF = q.orders.map(o => o.f);
  const needed = new Set([].concat(eqF, arrF, rangeF, orderF));
  for (const ix of indexes) {
    if (ix.coll !== q.coll) continue;
    if (q.isCG && !ix.cg) continue;
    const ixF = ix.fields.map(f => f.f);
    let all = true;
    for (const n of needed) if (ixF.indexOf(n) === -1) { all = false; break; }
    if (!all) continue;
    const prefixLen = eqF.length + arrF.length;
    const prefix = new Set(ixF.slice(0, prefixLen));
    let okPrefix = true;
    for (const e of [].concat(eqF, arrF)) if (!prefix.has(e)) { okPrefix = false; break; }
    if (!okPrefix) continue;
    const tail = ixF.slice(prefixLen);
    const wanted = Array.from(new Set([].concat(rangeF.filter(r => orderF.indexOf(r) === -1), orderF)));
    let ti = 0, okOrder = true;
    for (const w of wanted) {
      const at = tail.indexOf(w, ti);
      if (at === -1) { okOrder = false; break; }
      ti = at + 1;
    }
    if (!okOrder) continue;
    return ix;
  }
  return null;
}

const need = queries.filter(needsComposite);
const seen = new Map();
for (const q of need) {
  const sig = q.coll + '|' + q.wheres.map(w => w.f + w.op).sort().join(',') + '|' + q.orders.map(o => o.f + o.dir).join(',') + '|' + (q.isCG ? 'CG' : '');
  if (!seen.has(sig)) seen.set(sig, Object.assign({}, q, { sites: [] }));
  seen.get(sig).sites.push(q.file + ':' + q.line);
}

const missing = [], covered = [];
for (const q of seen.values()) (satisfied(q) ? covered : missing).push(q);

function desc(q) {
  return q.coll + (q.isCG ? ' [CG]' : '') + '  WHERE ' +
    (q.wheres.map(w => w.f + ' ' + w.op).join(' AND ') || '-') + '  ORDER BY ' +
    (q.orders.map(o => o.f + ' ' + o.dir).join(', ') || '-');
}

console.log('total query sites parsed  :', queries.length);
console.log('distinct composite-needing:', seen.size);
console.log('  covered by an index     :', covered.length);
console.log('  MISSING an index        :', missing.length);
console.log('\n================ MISSING INDEXES ================');
for (const q of missing) {
  console.log('\n* ' + desc(q));
  q.sites.slice(0, 4).forEach(s => console.log('    at ' + s));
  if (q.sites.length > 4) console.log('    (+' + (q.sites.length - 4) + ' more)');
}
fs.writeFileSync(path.join(__dirname, 'missing.json'), JSON.stringify(missing, null, 2));
fs.writeFileSync(path.join(__dirname, 'all-queries.json'), JSON.stringify(Array.from(seen.values()), null, 2));
