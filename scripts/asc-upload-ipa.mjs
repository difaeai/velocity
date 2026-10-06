#!/usr/bin/env node
/**
 * Upload an .ipa to App Store Connect from Windows.
 *
 * Why this exists: an EAS build never reaches Apple by itself, `eas submit`
 * has stalled IN_QUEUE for over an hour on this account (29 Sep 2026),
 * Transporter is macOS-only, and the App Store Connect web UI has no .ipa
 * upload control at all. This is Apple's own Build Upload API — the same one
 * EAS uses — in three steps: create the upload, register the file, PUT the
 * parts, then commit with a checksum.
 *
 * It uploads ONLY. It does not create a version record, attach the build to a
 * version, or submit anything for review. Those stay deliberate, separate acts.
 *
 * Usage:
 *   node --dns-result-order=ipv4first scripts/asc-upload-ipa.mjs \
 *     --ipa velocity-1.15.0-ios13.ipa --short 1.15.0 --build 13 \
 *     --key ~/.appstoreconnect/AuthKey_XXXXXXXX.p8 --issuer <uuid>
 *
 * Credentials, none of which live in this repo. Either flags or env:
 *   --key    / ASC_KEY_PATH   the .p8 App Store Connect API key (NOT the APNs
 *                             key — mixing the two is the classic mistake here)
 *   --key-id / ASC_KEY_ID     defaults to the id in the AuthKey_<id>.p8 name
 *   --issuer / ASC_ISSUER_ID  required
 *              ASC_APP_ID     numeric app id; defaults to Velocity Rides
 *
 * The flags exist so the whole invocation is one self-contained command line —
 * neither value is a secret (the key PATH is not the key) and a permission
 * allow-rule can then cover the real call rather than a shape nobody uses.
 *
 * With neither given it looks for exactly one AuthKey_*.p8 in
 * ~/.appstoreconnect and refuses to guess when there are several, because that
 * directory holds the APNs key too.
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { createSign, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const APP = process.env.ASC_APP_ID ?? '6810774199';
const ipaPath = arg('ipa');
const short = arg('short');
const build = arg('build');
if (!ipaPath || !short || !build) {
  console.error('usage: --ipa <file> --short <1.14.0> --build <12>');
  process.exit(2);
}

function resolveKey() {
  const given = arg('key', process.env.ASC_KEY_PATH);
  // `~` is the shell's job, and a quoted flag value never reaches the shell.
  if (given) return given.startsWith('~/') ? join(homedir(), given.slice(2)) : given;
  const dir = join(homedir(), '.appstoreconnect');
  if (!existsSync(dir)) throw new Error(`No ASC_KEY_PATH and no ${dir}`);
  const keys = readdirSync(dir).filter((f) => /^AuthKey_.+\.p8$/.test(f));
  if (keys.length !== 1) {
    throw new Error(
      `Found ${keys.length} AuthKey_*.p8 in ${dir} (${keys.join(', ') || 'none'}). ` +
        'Set ASC_KEY_PATH explicitly — one of these is the APNs push key, which ' +
        'is NOT the App Store Connect API key and must never be used here.',
    );
  }
  return join(dir, keys[0]);
}

const keyPath = resolveKey();
const keyId = arg('key-id', process.env.ASC_KEY_ID) ?? basename(keyPath).replace(/^AuthKey_|\.p8$/g, '');
const issuer = arg('issuer', process.env.ASC_ISSUER_ID);
if (!issuer) {
  throw new Error('--issuer (or ASC_ISSUER_ID) is required — App Store Connect → Users and Access → Integrations.');
}
const p8 = readFileSync(keyPath);

/** Minted per call: an upload outlives a single short-lived token. */
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({ iss: issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const s = createSign('sha256');
  s.update(`${head}.${body}`);
  // ieee-p1363, not DER: Apple rejects the default encoding Node would emit.
  return `${head}.${body}.${s.sign({ key: p8, dsaEncoding: 'ieee-p1363' }, 'base64url')}`;
}

async function api(method, path, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

const bytes = readFileSync(ipaPath);
const size = statSync(ipaPath).size;
const md5 = createHash('md5').update(bytes).digest('hex');
console.log(`${ipaPath}: ${size} bytes, md5 ${md5}`);
console.log(`key ${keyId}, app ${APP}, version ${short} build ${build}`);

// Apple keeps every build forever; a duplicate upload is noise at best.
const existing = await api('GET', `/v1/builds?filter[app]=${APP}&filter[version]=${build}&limit=1`);
if (existing.data?.length) {
  console.log(`build ${build} already exists at Apple (${existing.data[0].attributes.processingState}) — nothing to do.`);
  process.exit(0);
}

console.log('[1/4] creating buildUpload');
const bu = await api('POST', '/v1/buildUploads', {
  data: {
    type: 'buildUploads',
    attributes: { cfBundleShortVersionString: short, cfBundleVersion: build, platform: 'IOS' },
    relationships: { app: { data: { type: 'apps', id: APP } } },
  },
});

console.log('[2/4] registering the file');
const bf = await api('POST', '/v1/buildUploadFiles', {
  data: {
    type: 'buildUploadFiles',
    attributes: { assetType: 'ASSET', fileName: basename(ipaPath), fileSize: size, uti: 'com.apple.ipa' },
    relationships: { buildUpload: { data: { type: 'buildUploads', id: bu.data.id } } },
  },
});
const fileId = bf.data.id;
const ops = bf.data.attributes.uploadOperations ?? [];

console.log(`[3/4] uploading ${ops.length} part(s)`);
for (const [i, op] of ops.entries()) {
  const chunk = bytes.subarray(op.offset, op.offset + op.length);
  const headers = {};
  for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
  for (let attempt = 1; ; attempt++) {
    // Pre-signed URLs carry their own auth — never the bearer token.
    const r = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (r.ok) break;
    const t = await r.text();
    if (attempt >= 3) throw new Error(`part ${i + 1} -> ${r.status}\n${t.slice(0, 400)}`);
    console.log(`      part ${i + 1} attempt ${attempt} failed (${r.status}), retrying`);
  }
  console.log(`      part ${i + 1}/${ops.length} ok`);
}

console.log('[4/4] committing with the MD5 checksum');
await api('PATCH', `/v1/buildUploadFiles/${fileId}`, {
  data: {
    type: 'buildUploadFiles',
    id: fileId,
    attributes: { uploaded: true, sourceFileChecksums: { file: { hash: md5, algorithm: 'MD5' } } },
  },
});

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  const st = await api('GET', `/v1/buildUploads/${bu.data.id}`);
  const s = st.data.attributes.state;
  const b = await api('GET', `/v1/builds?filter[app]=${APP}&filter[version]=${build}&limit=1`);
  const found = b.data?.[0];
  console.log(`      upload=${s?.state} errors=${JSON.stringify(s?.errors ?? [])} build=${found ? found.attributes.processingState : 'not visible yet'}`);
  if (found) {
    console.log(`\nbuild ${build} is in App Store Connect (${found.attributes.processingState}).`);
    console.log('Still to do by hand: create the version record, attach this build, submit for review.');
    break;
  }
  if (s?.errors?.length) { console.log('\nApple reported errors — see above.'); process.exitCode = 1; break; }
}
