#!/usr/bin/env node
/**
 * Create an App Store version record, set its "What's New", and attach a build.
 *
 * The companion to scripts/asc-upload-ipa.mjs. That one gets the binary to
 * Apple and deliberately stops there; this one does the three API calls that
 * turn an uploaded build into something a human can submit with one click:
 *
 *   1. POST /v1/appStoreVersions            — the version record, if missing
 *   2. PATCH the version localizations      — the What's New text
 *   3. PATCH /relationships/build           — attach the build (204 = done)
 *
 * It does NOT submit for review. That stays a deliberate human act.
 *
 * Idempotent: an existing version record is reused rather than duplicated (a
 * second POST for the same versionString is rejected by Apple anyway), and
 * re-attaching the same build is harmless.
 *
 * Usage:
 *   node --dns-result-order=ipv4first scripts/asc-attach-build.mjs \
 *     --short 1.15.0 --build 13 --whats-new notes.txt
 *
 * Credentials: the same three as the uploader — ASC_KEY_PATH, ASC_KEY_ID
 * (defaults to the id in the filename), ASC_ISSUER_ID, ASC_APP_ID.
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

const APP = process.env.ASC_APP_ID ?? '6810774199';
const short = arg('short');
const build = arg('build');
const whatsNewPath = arg('whats-new');
const releaseType = arg('release-type', 'AFTER_APPROVAL');
if (!short || !build) {
  console.error('usage: --short <1.15.0> --build <13> [--whats-new <file>] [--release-type AFTER_APPROVAL]');
  process.exit(2);
}

function resolveKey() {
  if (process.env.ASC_KEY_PATH) return process.env.ASC_KEY_PATH;
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
const keyId = process.env.ASC_KEY_ID ?? basename(keyPath).replace(/^AuthKey_|\.p8$/g, '');
const issuer = process.env.ASC_ISSUER_ID;
if (!issuer) throw new Error('ASC_ISSUER_ID is required (App Store Connect → Users and Access → Integrations).');
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
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

// ── The build has to be there and processed before anything can attach it ──
const builds = await api('GET', `/v1/builds?filter[app]=${APP}&filter[version]=${build}&limit=1`);
const theBuild = builds.data?.[0];
if (!theBuild) throw new Error(`Build ${build} is not in App Store Connect yet — upload it first.`);
const state = theBuild.attributes.processingState;
console.log(`build ${build} is ${state} (${theBuild.id})`);
if (state !== 'VALID') {
  throw new Error(
    `Apple is still at "${state}". A build can only be attached once it is VALID; wait and re-run.`,
  );
}

// ── 1. The version record ────────────────────────────────────────────────────
const existing = await api(
  'GET',
  `/v1/apps/${APP}/appStoreVersions?filter[versionString]=${short}&limit=1`,
);
let version = existing.data?.[0];
if (version) {
  console.log(`[1/3] version ${short} already exists (${version.attributes.appStoreState})`);
  if (version.attributes.appStoreState === 'READY_FOR_SALE') {
    throw new Error(
      `${short} is already READY_FOR_SALE. Apple takes no new build against a released version — bump the version.`,
    );
  }
} else {
  console.log(`[1/3] creating version ${short}`);
  const created = await api('POST', '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: short, releaseType },
      relationships: { app: { data: { type: 'apps', id: APP } } },
    },
  });
  version = created.data;
}

// ── 2. What's New, on every localization the version carries ─────────────────
if (whatsNewPath) {
  const whatsNew = readFileSync(whatsNewPath, 'utf8').trim();
  if (whatsNew.length > 4000) throw new Error(`What's New is ${whatsNew.length} chars; Apple's limit is 4000.`);
  const locs = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
  for (const loc of locs.data ?? []) {
    await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
    });
    console.log(`[2/3] What's New set for ${loc.attributes.locale} (${whatsNew.length} chars)`);
  }
  if (!locs.data?.length) console.log('[2/3] no localizations on this version — What\'s New not set');
} else {
  console.log('[2/3] no --whats-new given, leaving the text alone');
}

// ── 3. Attach the build ──────────────────────────────────────────────────────
await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, {
  data: { type: 'builds', id: theBuild.id },
});
console.log(`[3/3] build ${build} attached to ${short}`);

const after = await api('GET', `/v1/appStoreVersions/${version.id}?fields[appStoreVersions]=versionString,appStoreState`);
console.log(
  `\n${after.data.attributes.versionString} is ${after.data.attributes.appStoreState} with build ${build} attached.`,
);
console.log('Remaining step, deliberately left to a human: Submit for Review.');
console.log(`https://appstoreconnect.apple.com/apps/${APP}/appstore`);
