/**
 * The Velocity Rides logo on the web: the owner's glowing lime V on wheels
 * (2026-11-06). Both images are made by scripts/generate-brand-assets.mjs from
 * apps/mobile/assets/brand-render.png, the same master as the app icon, so the
 * site, the admin console and the phone can never show different logos.
 */
/* eslint-disable @next/next/no-img-element -- a fixed-size logo, not content worth next/image's loader */

/** Brand colours, from the logo itself. */
export const BRAND_LIME = '#ccff00';
export const BRAND_INK = '#1a1c1c';

/** The logo alone, glow and all, on a transparent background. */
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
    <img
      src="/brand/velocity-logo.png"
      alt="Velocity Rides"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', objectFit: 'contain', ...style }}
    />
  );
}

/** The logo on its dark tile — the app icon, at any size. */
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
    <img
      src="/app/icon.png"
      alt="Velocity Rides"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flex: 'none', borderRadius: size * radius, ...style }}
    />
  );
}
