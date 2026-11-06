/**
 * Every brand image, app and web, from ONE master: the owner's logo render,
 * `apps/mobile/assets/brand-render.png` (2026-11-06: the glowing lime V on
 * wheels). Replace that file and re-run:
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Two forms come out of it:
 *   - ICON: the render itself, square, dark background and all — app icon,
 *     favicons, the schema.org/OpenGraph logo.
 *   - LOGO: the V alone, cut out of the dark background with its glow kept and
 *     the floor reflection dropped — for putting the logo ON a screen.
 *
 * Never writes public/brand/whatsapp-qr.*: that QR is printed on posters.
 *
 * Requires `sharp`, which ships with Next.js — no extra install.
 *
 * Writes:
 *   apps/mobile/assets/icon.png                     1024 icon, no alpha (App Store refuses alpha)
 *   apps/mobile/assets/logo.png                     512 logo, in-app (LogoMark)
 *   apps/mobile/assets/splash-icon.png              1024 logo, native splash
 *   apps/mobile/assets/android-icon-foreground.png  512 logo inside the adaptive safe zone
 *   apps/mobile/assets/android-icon-background.png  512 the render's own dark
 *   apps/mobile/assets/android-icon-monochrome.png  432 white silhouette (themed icons)
 *   apps/mobile/assets/favicon.png                  48 icon (web build of the app)
 *   public/brand/velocity-logo.png                  512 logo (site header, share card)
 *   public/app/icon.png                             512 icon (schema.org / OpenGraph)
 *   app/icon.png                                    512 rounded icon (Next.js favicon)
 *   app/apple-icon.png                              180 icon (iOS masks it itself)
 *   app/favicon.ico                                 16/32/48 rounded icon
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = path.join(ROOT, 'apps/mobile/assets/brand-render.png');
const out = (p) => path.join(ROOT, p);

/** The logo's own lime: bright, green-dominant, little blue. */
const isLime = (r, g, b) => g > 180 && r > 120 && b < 120;

// ── the logo, cut out ───────────────────────────────────────────────────────

/**
 * The V on a transparent background. Against a near-black render, how bright a
 * pixel is says how much logo is in it, so brightness becomes alpha and the
 * colour is divided back out of the black — the glow survives as a soft green
 * halo. Everything from the first empty row under the wheels down is the floor
 * reflection, and goes.
 */
async function cutLogo() {
  const { data, info } = await sharp(MASTER).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const lime = (x, y) => {
    const i = (y * W + x) * 3;
    return isLime(data[i], data[i + 1], data[i + 2]);
  };
  const rowHasLime = (y) => {
    for (let x = 0; x < W; x += 1) if (lime(x, y)) return true;
    return false;
  };

  // The body, top to the gap above the reflection.
  let top = 0;
  while (top < H && !rowHasLime(top)) top += 1;
  let cut = top;
  while (cut < H && rowHasLime(cut)) cut += 1;
  let left = W;
  let right = 0;
  for (let y = top; y < cut; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (lime(x, y)) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (cut - top < H * 0.2) throw new Error('Could not find the logo in the master render.');

  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      const o = (y * W + x) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const a = y >= cut ? 0 : Math.min(1, Math.max(0, (Math.max(r, g, b) - 24) / 200)) ** 0.75;
      rgba[o] = a ? Math.min(255, r / a) : 0;
      rgba[o + 1] = a ? Math.min(255, g / a) : 0;
      rgba[o + 2] = a ? Math.min(255, b / a) : 0;
      rgba[o + 3] = Math.round(a * 255);
    }
  }

  // Square around the body, with room for the glow.
  const side = Math.round(Math.max(right - left, cut - top) * 1.14);
  const cx = Math.round((left + right) / 2);
  const cy = Math.round((top + cut) / 2);
  const x0 = Math.max(0, cx - Math.round(side / 2));
  const y0 = Math.max(0, cy - Math.round(side / 2));
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: Math.min(side, W - x0), height: Math.min(side, H - y0) })
    .png()
    .toBuffer();
}

// ── icons ───────────────────────────────────────────────────────────────────

const icon = (size) => sharp(MASTER).removeAlpha().resize(size, size).png().toBuffer();

/** The icon with rounded corners, for browser tabs. */
async function roundedIcon(size) {
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}"/></svg>`);
  return sharp(await icon(size)).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/** `logo` centred on a transparent square, at `scale` of its side. */
async function placed(logo, size, scale) {
  const inner = Math.round(size * scale);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp(logo).resize(inner, inner).png().toBuffer(), gravity: 'center' }])
    .png()
    .toBuffer();
}

/** The render's background, averaged off its bottom-right corner (the left one carries a light). */
async function backgroundColour() {
  const { data } = await sharp(MASTER).removeAlpha().extract({ left: 1154, top: 1154, width: 100, height: 100 })
    .raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c += 1) sum[c] += data[i + c];
  const n = data.length / 3;
  return { r: Math.round(sum[0] / n), g: Math.round(sum[1] / n), b: Math.round(sum[2] / n) };
}

/**
 * A minimal multi-image ICO: a 6-byte header, a 16-byte directory entry per
 * image, then the PNG payloads verbatim. Every browser since Vista accepts PNG
 * frames, so there is no need to emit legacy BMP data.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ── build ───────────────────────────────────────────────────────────────────

async function main() {
  const logo = await cutLogo();
  const logoAt = (size) => sharp(logo).resize(size, size).png().toBuffer();
  const bg = await backgroundColour();

  // Adaptive icons show the middle 66% of the layer; the logo sits inside that.
  const silhouette = await sharp(await placed(logo, 432, 0.62))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      for (let i = 0; i < data.length; i += 4) {
        const solid = data[i + 3] > 70;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = solid ? 255 : 0;
      }
      return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    });

  const files = {
    'apps/mobile/assets/icon.png': await icon(1024),
    'apps/mobile/assets/logo.png': await logoAt(512),
    'apps/mobile/assets/splash-icon.png': await logoAt(1024),
    'apps/mobile/assets/android-icon-foreground.png': await placed(logo, 512, 0.62),
    'apps/mobile/assets/android-icon-background.png': await sharp({ create: { width: 512, height: 512, channels: 3, background: bg } }).png().toBuffer(),
    'apps/mobile/assets/android-icon-monochrome.png': silhouette,
    'apps/mobile/assets/favicon.png': await icon(48),
    'public/brand/velocity-logo.png': await logoAt(512),
    'public/app/icon.png': await icon(512),
    'app/icon.png': await roundedIcon(512),
    'app/apple-icon.png': await icon(180),
    'app/favicon.ico': buildIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await roundedIcon(size) })))),
  };
  for (const [file, buf] of Object.entries(files)) await writeFile(out(file), buf);
  console.log(`Wrote ${Object.keys(files).length} brand images from ${path.relative(ROOT, MASTER)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
