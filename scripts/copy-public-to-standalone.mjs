/**
 * Copies `public/` into the standalone build output.
 *
 * Firebase App Hosting builds this app with Next's `output: 'standalone'`, and
 * standalone deliberately does NOT copy `public/` — Next's own docs say the
 * deployment target has to do it. Nothing was doing it, so every file under
 * public/ answered 404 in production: the three legal documents Play Console
 * and App Store Connect point at, app-ads.txt (which AdMob reads to
 * authorise inventory), the schema.org logo and the demo artwork. The one
 * exception was public/brand/velocity-mark.svg, and only by accident — the
 * share card reads it, so Next's file tracing pulled that single file in.
 *
 * Runs from the `build` script, after `next build`. A no-op when there is no
 * standalone directory, which is every local build, so `npm run build` behaves
 * exactly as before off the App Hosting builder.
 */
import { access, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'public');
const TO = path.join(ROOT, '.next/standalone/public');

const exists = async (p) => access(p).then(() => true, () => false);

if (!(await exists(path.join(ROOT, '.next/standalone')))) {
  console.log('[public] no standalone output — nothing to copy');
} else if (!(await exists(FROM))) {
  console.log('[public] no public/ directory — nothing to copy');
} else {
  await cp(FROM, TO, { recursive: true });
  console.log(`[public] copied public/ -> ${path.relative(ROOT, TO)}`);
}
