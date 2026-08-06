#!/usr/bin/env node
/**
 * Publishes `config/appVersion` — the document that decides whether installed
 * apps show the "update available" prompt (see apps/mobile/src/lib/appUpdate.ts
 * and appUpdateRules.ts).
 *
 * Why this exists: the version and the build number are only knowable at release
 * time, and the build number is the part everyone forgets. `expo-constants` no
 * longer reports it on SDK 56, so the app compares against `latestBuild` from this
 * document — publish a version without it and nobody is prompted at all.
 *
 * RUN THIS **AFTER** THE PLAY ROLLOUT IS LIVE, NOT AT BUILD TIME.
 * The prompt sends people to the Play Store. Publish it while the rollout is still
 * in review or staged at 0% and every user who taps "Update" arrives at the
 * version they already have.
 *
 * Usage (from backend/functions):
 *   npm run publish:version -- --dry-run
 *   npm run publish:version                            # version from app.json, build from EAS
 *   npm run publish:version -- --build 19
 *   npm run publish:version -- --version 1.4.0 --build 19
 *   npm run publish:version -- --min-version 1.4.0     # forces the update (drops Cancel)
 *   npm run publish:version -- --disable               # switch the prompt off
 *
 * Credentials: the repo service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// backend/functions/scripts → repo root. Lives here because this is the one place
// in the repo that already has firebase-admin installed.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICE_ACCOUNT = 'velocity-fe379-firebase-adminsdk-fbsvc-2efeecd69a.json';
const STORE_URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

/** The version humans see, straight from the app config that built the AAB. */
function versionFromAppJson() {
  const p = path.join(REPO, 'apps/mobile/app.json');
  const v = JSON.parse(fs.readFileSync(p, 'utf8'))?.expo?.version;
  if (!v) throw new Error(`No expo.version in ${p}`);
  return v;
}

/**
 * The versionCode EAS actually assigned. `appVersionSource: remote` means the
 * lockstep truth lives on EAS, not in app.json — reading it from anywhere else is
 * how the build number ends up wrong.
 */
function buildFromEas() {
  const out = execFileSync(
    'npx',
    ['eas-cli', 'build:version:get', '--platform', 'android', '--non-interactive'],
    { cwd: path.join(REPO, 'apps/mobile'), encoding: 'utf8', shell: true },
  );
  const m = out.match(/versionCode\s*-\s*(\d+)/i);
  if (!m) throw new Error(`Could not read versionCode from eas output:\n${out}`);
  return Number(m[1]);
}

function releaseNotesFor(version) {
  // Reuses the Play Store copy so the in-app prompt and the store listing cannot
  // drift apart. Optional — the prompt reads fine without it.
  const p = path.join(REPO, `PLAYSTORE_RELEASE_NOTES_${version.replace(/\./g, '_')}.txt`);
  if (!fs.existsSync(p)) return null;
  const headline = fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return headline ?? null;
}

async function main() {
  const dryRun = has('dry-run');
  const version = arg('version') ?? versionFromAppJson();
  const build = Number(arg('build') ?? buildFromEas());

  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(`Version "${version}" is not dotted-numeric.`);
  if (!Number.isInteger(build) || build <= 0) throw new Error(`Build "${build}" is not a positive integer.`);

  // Only written when explicitly asked for: minSupportedVersion drops the prompt's
  // Cancel button, which is a decision about breaking interoperability, never a
  // side effect of shipping a release.
  const minVersion = arg('min-version');

  const payload = {
    enabled: !has('disable'),
    latestVersion: version,
    latestBuild: build,
    storeUrl: STORE_URL,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const notes = releaseNotesFor(version);
  if (notes) payload.releaseNotes = notes;
  if (minVersion) payload.minSupportedVersion = minVersion;

  console.log('config/appVersion ←');
  for (const [k, v] of Object.entries(payload)) {
    console.log(`  ${k}: ${k === 'updatedAt' ? '<serverTimestamp>' : JSON.stringify(v)}`);
  }
  if (!minVersion) console.log('  (minSupportedVersion left as-is — pass --min-version to force the update)');

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? path.join(REPO, SERVICE_ACCOUNT);
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `No credentials. Expected ${SERVICE_ACCOUNT} at the repo root, or set GOOGLE_APPLICATION_CREDENTIALS.`,
    );
  }
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) });
  }

  // merge: never clobber fields this script does not own (a minSupportedVersion set
  // by hand in the console must survive an ordinary release).
  await getFirestore().doc('config/appVersion').set(payload, { merge: true });
  console.log(`\n✔ Published. Installs below ${version} (build ${build}) will now be prompted.`);
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
});
