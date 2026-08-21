/**
 * SVG icon set for the marketing site — stroke icons on a 24×24 grid, sized by
 * the CSS that wraps them. Never emoji: emoji render inconsistently across
 * platforms and are announced as their unicode name by screen readers.
 *
 * Decorative by default (`aria-hidden`), because every icon here sits next to a
 * visible text label. Pass a `title` when an icon is the only content.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ title, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const Bolt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" fill="currentColor" stroke="none" />
  </Icon>
);

export const MapPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 10c0 5.4-8 12-8 12s-8-6.6-8-12a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);

export const Users = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.4" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 5.74" />
  </Icon>
);

export const Route = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="5.5" r="2.5" />
    <path d="M8 18.5h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6" />
  </Icon>
);

export const Package = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 2 8.5 4.6v9.8L12 21l-8.5-4.6V6.6L12 2Z" />
    <path d="M3.7 6.8 12 11.3l8.3-4.5M12 21v-9.7" />
  </Icon>
);

export const Car = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.2 11.5 6.9 6.6A2.4 2.4 0 0 1 9.2 5h5.6a2.4 2.4 0 0 1 2.3 1.6l1.7 4.9" />
    <path d="M3 17.5v-3.2a2.8 2.8 0 0 1 2.8-2.8h12.4a2.8 2.8 0 0 1 2.8 2.8v3.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
    <path d="M6.5 15h1M16.5 15h1M6.5 19v1.5M17.5 19v1.5" />
  </Icon>
);

export const Handshake = (p: IconProps) => (
  <Icon {...p}>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7.1-.9l.5.3a2 2 0 0 0 1.4.2L21 4" />
    <path d="m21 3 1 11h-2" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
    <path d="M3 4h8" />
  </Icon>
);

export const Mic = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
  </Icon>
);

export const Banknote = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 10v4M18 10v4" />
  </Icon>
);

export const Shield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 4.5 5.6v5.7c0 4.6 3.1 8.4 7.5 10.2 4.4-1.8 7.5-5.6 7.5-10.2V5.6L12 2.5Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);

export const BadgeCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 14.4 5l3.4-.3.5 3.4 2.9 1.8-1.6 3 1.6 3-2.9 1.8-.5 3.4-3.4-.3L12 21.5 9.6 19l-3.4.3-.5-3.4-2.9-1.8 1.6-3-1.6-3 2.9-1.8.5-3.4L9.6 5 12 2.5Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);

export const Bell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
    <path d="M10 18a2 2 0 0 0 4 0" />
  </Icon>
);

export const Navigation = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 3.5 3.7 10.2c-.9.4-.8 1.7.2 1.9l7 1.6a1 1 0 0 1 .8.8l1.6 7c.2 1 1.5 1.1 1.9.2l6.7-16.8a1 1 0 0 0-1.4-1.4Z" />
  </Icon>
);

export const TrendingUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 16.5 6-6 3.5 3.5L21 6.5" />
    <path d="M15.5 6.5H21v5.5" />
  </Icon>
);

export const Wallet = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 8.5v-1A2.5 2.5 0 0 0 18 5H5.5A2.5 2.5 0 0 0 3 7.5v9A2.5 2.5 0 0 0 5.5 19H18a2.5 2.5 0 0 0 2.5-2.5v-1" />
    <path d="M21.5 9.5h-4.2a2.5 2.5 0 0 0 0 5h4.2v-5Z" />
  </Icon>
);

export const Clock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.8V12l3.4 2" />
  </Icon>
);

export const Gauge = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 17a9 9 0 1 1 17 0" />
    <path d="m15 9.5-3.4 3.4" />
    <circle cx="12" cy="14" r="1.6" fill="currentColor" stroke="none" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.4 2.4 4.6-4.8" />
  </Icon>
);

export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 5-7 7 7 7" />
  </Icon>
);

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </Icon>
);

export const Menu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const Close = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const Pause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5v14M15 5v14" />
  </Icon>
);

export const Play = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.8v14.4l12-7.2L7 4.8Z" fill="currentColor" stroke="none" />
  </Icon>
);

export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2 10.3 12.4 4.5 10.7 10.3 9 12 3.2Z" />
    <path d="M19 4v3M20.5 5.5h-3" />
  </Icon>
);

export const Megaphone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9v4.5a2 2 0 0 0 2 2h1.5L20 20V4L7.5 8.5H6a2 2 0 0 0-2 2" />
    <path d="M8 15.5V20h3.5v-3.2" />
  </Icon>
);

/** The Google Play triangle — filled, brand-coloured, not on the 24px stroke grid. */
export function GooglePlay(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false" {...props}>
      <path fill="#00D0FF" d="M47 26.6C42.5 31.4 40 38.8 40 48.4v415.2c0 9.6 2.5 17 7 21.8l1.4 1.3 232.6-232.6v-5.5L48.4 25.3 47 26.6Z" />
      <path fill="#FFD400" d="m358.6 333.9-77.6-77.6v-5.5l77.6-77.6 1.8 1 91.9 52.2c26.3 14.9 26.3 39.3 0 54.3l-91.9 52.2-1.8 1Z" />
      <path fill="#FF3A44" d="M360.4 332.9 281 253.5 47 487.4c8.7 9.2 23 10.3 39.2 1.2l274.2-155.7Z" />
      <path fill="#00E676" d="M360.4 174.1 86.2 18.4C70 9.3 55.7 10.5 47 19.7l234 233.8 79.4-79.4Z" />
    </svg>
  );
}

/** Apple mark for the "coming soon" badge. */
export function AppleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.9-.8-3.1-.8-1.6 0-3 .9-3.8 2.4-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3.1-.7 1.4 0 1.8.7 3.1.7 1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.6-3.7ZM14.1 5.9c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z" />
    </svg>
  );
}
