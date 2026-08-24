/**
 * The Velocity mark — GENERATED, do not edit by hand.
 *
 * Traced from apps/mobile/assets/icon.png by scripts/generate-brand-assets.mjs.
 * Re-run that script after any change to the app icon; everything on the web
 * (site header, admin sidebar, sign-in, deep-link page) renders from here, so
 * the logo cannot drift from the one on the Play listing.
 */

/** Brand colours, lifted from the app icon itself. */
export const BRAND_LIME = '#ccff00';
export const BRAND_INK = '#1a1c1c';

/**
 * The bare silhouette. Inherits `currentColor`, so set the colour on it or on
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
      viewBox="0 0 248 248.5"
      width={size}
      height={size}
      role="img"
      aria-label="Velocity"
      className={className}
      style={{ display: 'block', color: 'currentColor', ...style }}
    >
      <path fill="currentColor" fillRule="evenodd" d="M4.5 0L2.5 1L0 4.5L0 8.5L4 17.5L95 173.5L98 177.5L97.5 178.9L92.5 179L90.9 170.5L89 166.5L82.5 160L78.5 158L73.5 157L52.5 157L47.5 158.2L42.5 161L38 165.5L36.2 168.5L35 171.5L34.5 179L28.3 183.5L26 186.5L24 191.5L24 198.5L25 201.5L27 204.5L34 210.5L33 212.5L33 223.5L35.1 230.5L38 235.5L45.5 243L52.5 246.8L56.5 248L62.5 248.5L70.5 247.8L79.5 244L84.5 240L89 234.5L92.9 225.5L93.7 218.5L93 213.5L93.5 211L154.5 211L155 213.5L154.4 219.5L156 228.5L159 234.5L162.1 238.5L168.5 244L177.5 247.8L185.5 248.5L191.5 248L195.5 246.7L202.5 243L210 235.5L212.9 230.5L215 223.5L215 212.5L214 210.5L221.9 203.5L224 198.5L223.9 190.5L219.8 183.5L213.2 178.5L213 171.5L210 165.5L204.5 160.1L200.5 158.2L196.5 157.2L173.5 157.2L169.5 158L165.5 160L159 166.5L157.1 170.5L155.5 179L150.5 178.9L150 177.5L153 173.5L244 17.5L248 8.5L248 4.5L247 2.5L243.5 0L192.5 0L189.5 1L185.1 5.5L128.1 136.5L126 142.5L124.5 145.4L123.5 145.4L62.9 5.5L58.5 1L55.5 0ZM62.3 206.5L67.5 207L69.5 208.1L73 211.5L75 217.5L74.9 219.5L73 224.5L69.5 228L63.5 229.9L58.5 229L55.5 227L52.2 222.5L51.6 218.5L52 214.5L54.1 210.5L58.5 207.3ZM184.1 206.5L189.5 207.3L192.5 209.1L195.6 213.5L196.4 217.5L195.8 222.5L194 225.5L189.5 229L185.5 229.9L178.5 228L175 224.5L173 218.5L175 211.5L178.5 208.1L180.5 207Z" />
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
