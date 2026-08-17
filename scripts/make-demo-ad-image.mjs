/**
 * Generates the picture used by the "Find your Customers" demo notification.
 *
 *   node scripts/make-demo-ad-image.mjs
 *
 * The output — public/demo/kfc-offer.jpg — is committed, because the push
 * notification needs a public https URL the phone can fetch with the app closed,
 * and App Hosting serves everything under public/. This script exists so the
 * creative can be regenerated or reworded without hand-editing a binary.
 *
 * It is a MOCK creative for a demo button: our own type on a flat red plate,
 * carrying a "DEMO" chip so it can never be mistaken for a real promotion by
 * the brand it names. Nothing here is downloaded from, or endorsed by, anyone.
 *
 * sharp is a devtime-only dependency of this script (it comes in via the web
 * app's toolchain). If it ever disappears, the committed JPEG still works —
 * only regeneration needs it back.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'demo', 'kfc-offer.jpg');

// 2:1 is the aspect ratio Android's big-picture style crops to least, so the
// discount and the branch line both survive the shade.
const W = 1080;
const H = 540;

const FONT = 'Arial, Helvetica, DejaVu Sans, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E4002B"/>
      <stop offset="100%" stop-color="#A6192E"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#plate)"/>

  <!-- Faint diagonal stripes, so the plate does not read as a solid error page. -->
  <g opacity="0.07" fill="#ffffff">
    <rect x="-200" y="-100" width="120" height="900" transform="rotate(20 0 0)"/>
    <rect x="60" y="-100" width="60" height="900" transform="rotate(20 0 0)"/>
    <rect x="820" y="-100" width="200" height="900" transform="rotate(20 0 0)"/>
  </g>

  <!-- Logo plate: white box, red wordmark. Our own type, not anyone's artwork. -->
  <rect x="56" y="48" width="196" height="104" rx="14" fill="#ffffff"/>
  <text x="154" y="126" text-anchor="middle" font-family="${FONT}" font-size="74"
        font-weight="bold" fill="#E4002B" letter-spacing="2">KFC</text>

  <!-- The chip that keeps this honest: it is a demo, and it says so. -->
  <rect x="884" y="56" width="140" height="52" rx="26" fill="#111111" opacity="0.85"/>
  <text x="954" y="91" text-anchor="middle" font-family="${FONT}" font-size="26"
        font-weight="bold" fill="#ffffff" letter-spacing="4">DEMO</text>

  <text x="286" y="98" font-family="${FONT}" font-size="30" font-weight="bold"
        fill="#ffffff" opacity="0.92" letter-spacing="1">GULBERG GREENS</text>
  <text x="286" y="138" font-family="${FONT}" font-size="26" font-weight="bold"
        fill="#ffffff" opacity="0.7" letter-spacing="1">ISLAMABAD</text>

  <text x="56" y="300" font-family="${FONT}" font-size="132" font-weight="bold"
        fill="#ffffff" letter-spacing="-2">25% OFF</text>

  <rect x="56" y="336" width="620" height="66" rx="10" fill="#111111" opacity="0.9"/>
  <text x="82" y="381" font-family="${FONT}" font-size="34" font-weight="bold"
        fill="#ffffff" letter-spacing="2">EVERY SUNDAY · 1 PM – 4 PM</text>

  <text x="56" y="464" font-family="${FONT}" font-size="30" font-weight="bold"
        fill="#ffffff" opacity="0.95">Dine-in &amp; takeaway · Gulberg Greens branch</text>
  <text x="56" y="504" font-family="${FONT}" font-size="26" font-weight="bold"
        fill="#ffffff" opacity="0.7">Main Expressway, Gulberg Greens, Islamabad</text>
</svg>`;

await mkdir(dirname(OUT), { recursive: true });
const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
await writeFile(OUT, jpeg);
console.log(`Wrote ${OUT} — ${(jpeg.length / 1024).toFixed(1)} KB, ${W}x${H}`);
