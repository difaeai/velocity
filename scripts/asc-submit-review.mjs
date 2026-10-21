#!/usr/bin/env node
/**
 * Submit an App Store version for review.
 *
 * The third script in the chain: asc-upload-ipa.mjs gets the binary to Apple,
 * asc-attach-build.mjs turns it into a version record with a build and What's
 * New, and this one hands that version to review. That used to be left as a
 * human click on purpose; it is a script now because it was asked for, and
 * because a release that stops one click short is how builds 14 and 16 ended
 * up uploaded, attached and never actually released.
 *
 * Three calls, the same shape Apple's console uses:
 *
 *   1. POST /v1/reviewSubmissions       — open a submission for the app
 *   2. POST /v1/reviewSubmissionItems   — put the version in it
 *   3. PATCH /v1/reviewSubmissions/{id} — submitted: true, which is the act
 *
 * It refuses rather than guesses: no version record, no build attached, a
 * build Apple has not finished processing, or a submission already in flight
 * all stop it with the state printed. An existing OPEN submission is reused —
 * Apple allows only one at a time, and a second POST is rejected anyway.
 *
 * Usage:
 *   node --dns-result-order=ipv4first scripts/asc-submit-review.mjs \
 *     --short 1.19.0 --key ~/.appstoreconnect/AuthKey_XXXXXXXX.p8 --issuer <uuid>
 *
 *   --dry-run  does everything except the PATCH, and prints what it would send.
 *
 * Credentials: --key / ASC_KEY_PATH, --key-id / ASC_KEY_ID (defaults to the id
 * in the filename), --issuer / ASC_ISSUER_ID, ASC_APP_ID.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const APP = process.env.ASC_APP_ID ?? '6810774199';
const short = arg('short');
const dryRun = has('dry-run');
if (!short) {
  console.error('usage: --short <1.19.0> [--dry-run]');
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
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${text.slice(0, 1200)}`);
  return text ? JSON.parse(text) : {};
}

// ── The version has to exist, carry a build, and that build has to be VALID ──
const versions = await api(
  'GET',
  `/v1/apps/${APP}/appStoreVersions?filter[versionString]=${short}&limit=1`,
);
const version = versions.data?.[0];
if (!version) {
  throw new Error(`No version record for ${short} — run asc-attach-build.mjs first.`);
}
const state = version.attributes.appStoreState;
console.log(`version ${short} is ${state} (${version.id})`);
if (['READY_FOR_SALE', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE'].includes(state)) {
  console.log(`Nothing to do: ${short} is already ${state}.`);
  process.exit(0);
}

const attached = await api('GET', `/v1/appStoreVersions/${version.id}/build`);
const theBuild = attached.data;
if (!theBuild) {
  throw new Error(`${short} has no build attached — run asc-attach-build.mjs first.`);
}
const buildInfo = await api('GET', `/v1/builds/${theBuild.id}`);
const bAttrs = buildInfo.data.attributes;
console.log(`attached build ${bAttrs.version} is ${bAttrs.processingState}`);
if (bAttrs.processingState !== 'VALID') {
  throw new Error(
    `Apple is still at "${bAttrs.processingState}" on build ${bAttrs.version}. ` +
      'A version can only be submitted once its build is VALID; wait and re-run.',
  );
}

// ── 1. One open submission per app, so reuse before creating ────────────────
const open = await api(
  'GET',
  `/v1/reviewSubmissions?filter[app]=${APP}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`,
);
let submission = open.data?.[0];
if (submission) {
  console.log(`[1/3] reusing open submission ${submission.id}`);
} else {
  console.log('[1/3] opening a review submission');
  if (dryRun) {
    console.log('      (dry run — nothing created)');
  } else {
    const created = await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP } } },
      },
    });
    submission = created.data;
  }
}

// ── 2. The version goes in the submission ───────────────────────────────────
if (submission) {
  const items = await api(
    'GET',
    `/v1/reviewSubmissions/${submission.id}/items?limit=20`,
  );
  const already = (items.data ?? []).some(
    (it) => it.relationships?.appStoreVersion?.data?.id === version.id,
  );
  if (already) {
    console.log(`[2/3] version ${short} is already in the submission`);
  } else if (dryRun) {
    console.log(`[2/3] would add version ${short} to submission ${submission.id}`);
  } else {
    console.log(`[2/3] adding version ${short}`);
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
        },
      },
    });
  }
}

// ── 3. submitted: true is the act itself ────────────────────────────────────
if (dryRun) {
  console.log(`[3/3] would PATCH submitted:true on ${submission?.id ?? '<new submission>'}`);
  console.log('\nDry run only. Nothing was submitted.');
  process.exit(0);
}
console.log('[3/3] submitting for review');
const done = await api('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
  data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
});
console.log(`submission state: ${done.data?.attributes?.state ?? 'unknown'}`);

const after = await api('GET', `/v1/appStoreVersions/${version.id}`);
console.log(`${short} is now ${after.data.attributes.appStoreState}`);
console.log(`\nhttps://appstoreconnect.apple.com/apps/${APP}/appstore`);
