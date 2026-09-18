/**
 * The share card — what WhatsApp, Facebook, Instagram and X draw when someone
 * pastes a velocityrides.app link.
 *
 * Without one, every share of the site is a bare grey rectangle, which for an
 * app whose distribution *is* people forwarding a link matters more than most
 * of the on-page SEO around it. Rendered rather than hand-drawn so the headline
 * can never drift from the hero it mirrors, and so a copy change is a one-line
 * edit instead of a trip through a design tool.
 *
 * The typeface is the one `next/og` bundles (Geist). The site's own Outfit is
 * not on disk, and fetching it from Google at build time would make the image —
 * and therefore the build — depend on a network round trip. Size and colour
 * carry the hierarchy instead of weight.
 */
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#04120C';
const LIME = '#ccff00';

/**
 * The traced mark, as a data URI.
 *
 * Read from the generated file rather than re-declared here, so re-running
 * scripts/generate-brand-assets.mjs updates the share card too. A missing file
 * drops the mark instead of failing the build — a card without the logo still
 * beats no card at all.
 */
async function markDataUri(): Promise<string | null> {
  try {
    const svg = await readFile(path.join(process.cwd(), 'public/brand/velocity-mark.svg'), 'utf8');
    // The file inherits `currentColor`, which means nothing to a bare <img>.
    return `data:image/svg+xml;base64,${Buffer.from(svg.replaceAll('currentColor', LIME)).toString('base64')}`;
  } catch {
    return null;
  }
}

const SERVICES = ['City rides', 'Pooled seats', 'Intercity', 'Couriers'];

export async function renderShareCard() {
  const mark = await markDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: INK,
          color: '#ffffff',
          position: 'relative',
        }}
      >
        {/* The hero's aurora, flattened to one glow. Full-bleed on purpose: a
            smaller box leaves its own rectangular edge visible in the render,
            since the rasteriser does not round a gradient-filled corner. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            background:
              'radial-gradient(60% 85% at 88% 6%, rgba(204,255,0,0.22) 0%, rgba(204,255,0,0.06) 45%, rgba(4,18,12,0) 72%)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image
              does not exist inside an ImageResponse; satori only reads <img>. */}
          {mark ? <img src={mark} width={54} height={54} alt="" /> : null}
          <div style={{ display: 'flex', fontSize: 27, letterSpacing: 6, color: '#ffffff' }}>
            VELOCITY RIDES
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 82, letterSpacing: -2.5, lineHeight: 1.12 }}>
            Name your fare.
          </div>
          <div style={{ display: 'flex', fontSize: 82, letterSpacing: -2.5, lineHeight: 1.12 }}>
            Split the ride.
          </div>
          <div
            style={{ display: 'flex', fontSize: 82, letterSpacing: -2.5, lineHeight: 1.12, color: LIME }}
          >
            Keep the change.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {SERVICES.map((s) => (
              <div
                key={s}
                style={{
                  display: 'flex',
                  padding: '11px 22px',
                  borderRadius: 999,
                  border: '1px solid rgba(204,255,0,0.32)',
                  color: 'rgba(255,255,255,0.86)',
                  fontSize: 25,
                }}
              >
                {s}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 27, color: LIME }}>velocityrides.app</div>
        </div>
      </div>
    ),
    size,
  );
}
