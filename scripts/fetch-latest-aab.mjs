/**
 * Pull the newest finished Android build down to the repo root, and retire the
 * one it replaces.
 *
 *   node scripts/fetch-latest-aab.mjs
 *
 * The rule this exists to enforce: the .aab sitting at the repo root must
 * always be the newest correct build. Two of them side by side is how the wrong
 * one gets uploaded to Play, and an old one left alone is worse than none at
 * all, because it looks current.
 *
 * Deliberately cautious about the deleting half. The old file is removed only
 * after the new one has downloaded AND been checked for size — a truncated
 * download that replaced a good build would be the exact failure this is meant
 * to prevent. Anything that is not a Velocity .aab is left alone entirely.
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');

/** An .aab under about 20 MB is not a real build of this app. */
const MIN_PLAUSIBLE_BYTES = 20 * 1024 * 1024;

function easBuildList() {
  const out = execFileSync(
    'npx',
    ['eas-cli@latest', 'build:list', '--platform', 'android', '--limit', '5', '--non-interactive'],
    { cwd: MOBILE, encoding: 'utf8', shell: true, maxBuffer: 10 * 1024 * 1024 },
  );
  // The CLI prints blocks of "Key   Value" separated by rules. Parse the first
  // block that is both finished and has a real artifact URL.
  const blocks = out.split('———');
  for (const block of blocks) {
    const field = (name) =>
      block.match(new RegExp(`^${name}\\s{2,}(.+)$`, 'm'))?.[1]?.trim() ?? null;
    if (field('Status') !== 'finished') continue;
    const url = field('Application Archive URL');
    if (!url || url === 'null' || url.startsWith('<')) continue;
    return {
      url,
      version: field('Version') ?? '0.0.0',
      versionCode: field('Version code') ?? '0',
      commit: field('Commit') ?? '',
      id: field('ID') ?? '',
    };
  }
  return null;
}

async function main() {
  console.log('Asking EAS for the newest finished Android build…');
  const build = easBuildList();
  if (!build) {
    console.error('No finished Android build with an artifact yet. Is it still running?');
    process.exit(1);
  }

  const filename = `velocity-${build.version}-vc${build.versionCode}.aab`;
  const target = path.join(ROOT, filename);
  console.log(`  build ${build.id}`);
  console.log(`  ${build.version} (versionCode ${build.versionCode}) from commit ${build.commit.slice(0, 7)}`);

  const res = await fetch(build.url);
  if (!res.ok) {
    console.error(`Download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));

  const { size } = await stat(target);
  if (size < MIN_PLAUSIBLE_BYTES) {
    console.error(`Downloaded only ${(size / 1e6).toFixed(1)} MB — that is not a full build.`);
    console.error('Leaving the previous .aab in place. Delete this one and retry.');
    process.exit(1);
  }
  console.log(`Saved ${filename} (${(size / 1e6).toFixed(1)} MB)`);

  // Only now is it safe to retire the others.
  const stale = (await readdir(ROOT)).filter(
    (f) => f.endsWith('.aab') && f !== filename && f.startsWith('velocity-'),
  );
  for (const f of stale) {
    await unlink(path.join(ROOT, f));
    console.log(`Removed old build ${f}`);
  }

  console.log('');
  console.log('Next: upload this to Play, roll it out, and only THEN publish');
  console.log(`  version ${build.version} / build ${build.versionCode}`);
  console.log('in admin → App version. Publishing before the rollout asks people');
  console.log('to fetch an update the store cannot serve them yet.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
