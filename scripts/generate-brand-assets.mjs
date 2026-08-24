/**
 * Regenerates every web brand asset from the one master file:
 * `apps/mobile/assets/icon.png` — the exact artwork Play Store and the phone
 * home screen show.
 *
 * The web used to draw its own idea of the logo (a letter "V" in a green box,
 * a lightning bolt) which matched neither the app nor the store listing, and
 * the tab still carried the stock Next.js favicon. Everything visual now comes
 * from here so the site, the admin console and the browser tab can never drift
 * from the app icon again.
 *
 * The mark is traced out of the PNG with marching squares, so the SVG is the
 * real silhouette rather than a hand-approximation. Run it after any change to
 * the app icon:
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Requires `sharp`, which ships with Next.js — no extra install.
 *
 * Writes:
 *   components/BrandMark.tsx         the traced path as a React component
 *   public/brand/velocity-mark.svg   transparent lime mark (for <img>/OG use)
 *   public/brand/velocity-icon.svg   mark on the dark brand tile
 *   public/app/icon.png              512px tile, referenced by OpenGraph/schema.org
 *   app/icon.png                     Next.js file-convention favicon (512px)
 *   app/apple-icon.png               180px, un-rounded (iOS masks it itself)
 *   app/favicon.ico                  16/32/48 for browsers that still ask for it
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'apps/mobile/assets/icon.png');

/** Brand colours, read back out of the source icon rather than hard-coded. */
const LIME = '#ccff00';
const INK = '#1a1c1c';

/** Trace resolution. The source is 1024²; 512 keeps the path small and exact. */
const GRID = 512;
/** Douglas–Peucker tolerance, in grid units. 0.45 ≈ invisible at any real size. */
const EPSILON = 0.45;

// ── trace ───────────────────────────────────────────────────────────────────

/**
 * Marching squares over the "limeness" field of the icon. Returns closed
 * loops — outer silhouette first, then the holes (the two wheel centres),
 * which an even-odd fill knocks back out.
 */
async function traceMark() {
  const { data, info } = await sharp(SOURCE)
    .resize(GRID, GRID)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H } = info;
  const field = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    field[i] = b < 150 ? Math.max(0, Math.min(1, (g - 90) / 100)) : 0;
  }

  const T = 0.5;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : field[y * W + x]);
  const lerp = (x1, y1, v1, x2, y2, v2) => {
    const t = (T - v1) / (v2 - v1);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  };

  const segments = [];
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const v0 = at(x, y);
      const v1 = at(x + 1, y);
      const v2 = at(x + 1, y + 1);
      const v3 = at(x, y + 1);
      const code = (v0 > T ? 8 : 0) | (v1 > T ? 4 : 0) | (v2 > T ? 2 : 0) | (v3 > T ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = () => lerp(x, y, v0, x + 1, y, v1);
      const right = () => lerp(x + 1, y, v1, x + 1, y + 1, v2);
      const bottom = () => lerp(x + 1, y + 1, v2, x, y + 1, v3);
      const left = () => lerp(x, y + 1, v3, x, y, v0);
      const add = (a, b) => segments.push([a, b]);

      // Cases 5 and 10 are the ambiguous saddles; both diagonals are emitted,
      // which is correct for a shape this size (no thin one-pixel bridges).
      switch (code) {
        case 1: add(bottom(), left()); break;
        case 2: add(right(), bottom()); break;
        case 3: add(right(), left()); break;
        case 4: add(top(), right()); break;
        case 5: add(top(), left()); add(bottom(), right()); break;
        case 6: add(top(), bottom()); break;
        case 7: add(top(), left()); break;
        case 8: add(left(), top()); break;
        case 9: add(bottom(), top()); break;
        case 10: add(left(), bottom()); add(right(), top()); break;
        case 11: add(right(), top()); break;
        case 12: add(left(), right()); break;
        case 13: add(bottom(), right()); break;
        case 14: add(left(), bottom()); break;
      }
    }
  }

  // Stitch the segments head-to-tail into closed loops.
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const startingAt = new Map();
  segments.forEach((s, i) => {
    const k = key(s[0]);
    if (!startingAt.has(k)) startingAt.set(k, []);
    startingAt.get(k).push(i);
  });

  const used = new Array(segments.length).fill(false);
  const loops = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [segments[i][0], segments[i][1]];
    let cursor = segments[i][1];
    for (;;) {
      const next = (startingAt.get(key(cursor)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = true;
      cursor = segments[next][1];
      loop.push(cursor);
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

/** Ramer–Douglas–Peucker on an open polyline. */
function simplify(points, eps) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let far = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      far = i;
    }
  }
  if (max <= eps) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, far + 1), eps).slice(0, -1), ...simplify(points.slice(far), eps)];
}

/**
 * A closed loop has a degenerate first→last baseline, so cut it at the point
 * farthest from the start and simplify the two halves separately.
 */
function simplifyLoop(loop, eps) {
  const pts = loop.slice(0, -1);
  let far = 0;
  let max = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > max) {
      max = d;
      far = i;
    }
  }
  const head = simplify(pts.slice(0, far + 1), eps);
  const tail = simplify([...pts.slice(far), pts[0]], eps);
  return [...head.slice(0, -1), ...tail.slice(0, -1)];
}

// ── ico ─────────────────────────────────────────────────────────────────────

/**
 * Pack PNGs into an .ico. Every browser that reads .ico at all has understood
 * PNG-in-ICO since Vista, so there is no need for a BMP encoder here.
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

// ── react component ─────────────────────────────────────────────────────────

/**
 * The mark as a React component, so every surface inlines the same geometry
 * instead of each one inventing a placeholder. Generated rather than
 * hand-written: the path is 1.3KB of traced coordinates nobody should edit.
 */
const brandComponent = ({ w, h, path: d }) => `/**
 * The Velocity mark — GENERATED, do not edit by hand.
 *
 * Traced from apps/mobile/assets/icon.png by scripts/generate-brand-assets.mjs.
 * Re-run that script after any change to the app icon; everything on the web
 * (site header, admin sidebar, sign-in, deep-link page) renders from here, so
 * the logo cannot drift from the one on the Play listing.
 */

/** Brand colours, lifted from the app icon itself. */
export const BRAND_LIME = '${LIME}';
export const BRAND_INK = '${INK}';

/**
 * The bare silhouette. Inherits \`currentColor\`, so set the colour on it or on
 * any parent — lime on dark surfaces, ink on lime ones.
 */
export function VelocityMark({
  size = 24,
  style,
  className,
}: {
  size?: number | string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 ${w} ${h}"
      width={size}
      height={size}
      role="img"
      aria-label="Velocity"
      className={className}
      style={{ display: 'block', color: 'currentColor', ...style }}
    >
      <path fill="currentColor" fillRule="evenodd" d="${d}" />
    </svg>
  );
}

/**
 * The mark on its dark tile — the app icon, at any size. Use this wherever the
 * logo sits on a light background; use {@link VelocityMark} on dark ones.
 */
export function VelocityIcon({
  size = 32,
  radius = 0.22,
  style,
  className,
}: {
  size?: number;
  /** Corner rounding as a fraction of the tile, matching the app icon's mask. */
  radius?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * radius,
        background: BRAND_INK,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        ...style,
      }}
    >
      <VelocityMark size={size * 0.62} style={{ color: BRAND_LIME }} />
    </span>
  );
}
`;

// ── build ───────────────────────────────────────────────────────────────────

const round = (v) => Math.round(v * 10) / 10;

async function main() {
  const loops = await traceMark();
  const simplified = loops.map((l) => simplifyLoop(l, EPSILON)).filter((l) => l.length > 3);

  // Tight bounding box, so the standalone mark has no dead margin to centre against.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of simplified) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const toPath = (loop, ox = 0, oy = 0) =>
    `M${loop.map(([x, y]) => `${round(x - ox)} ${round(y - oy)}`).join('L')}Z`;

  const tiled = simplified.map((l) => toPath(l)).join('');
  const bare = simplified.map((l) => toPath(l, minX, minY)).join('');
  const w = round(maxX - minX);
  const h = round(maxY - minY);

  const markSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none">` +
    `<path fill="currentColor" fill-rule="evenodd" d="${bare}"/></svg>\n`;

  const tileSvg = (radius) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">` +
    `<rect width="${GRID}" height="${GRID}" rx="${radius}" fill="${INK}"/>` +
    `<path fill="${LIME}" fill-rule="evenodd" d="${tiled}"/></svg>`;

  const rounded = tileSvg(112);
  const square = tileSvg(0);

  await mkdir(path.join(ROOT, 'public/brand'), { recursive: true });
  await writeFile(path.join(ROOT, 'public/brand/velocity-mark.svg'), markSvg);
  await writeFile(path.join(ROOT, 'public/brand/velocity-icon.svg'), `${rounded}\n`);
  await writeFile(path.join(ROOT, 'components/BrandMark.tsx'), brandComponent({ w, h, path: bare }));

  const render = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

  await writeFile(path.join(ROOT, 'public/app/icon.png'), await render(square, 512));
  await writeFile(path.join(ROOT, 'app/icon.png'), await render(rounded, 512));
  await writeFile(path.join(ROOT, 'app/apple-icon.png'), await render(square, 180));

  const ico = buildIco(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await render(rounded, size) }))),
  );
  await writeFile(path.join(ROOT, 'app/favicon.ico'), ico);

  console.log(
    `Traced ${simplified.length} contours (${simplified.reduce((n, l) => n + l.length, 0)} points), ` +
      `mark ${w}×${h}. Wrote brand SVGs, icon.png, apple-icon.png and favicon.ico.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
