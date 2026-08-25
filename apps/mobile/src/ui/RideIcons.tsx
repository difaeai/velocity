/**
 * Icon set for the ride-booking flow (route entry → Solo/Pool → options).
 *
 * Same visual grammar as ServiceIcons: flat two-tone strokes on a 24×24 grid,
 * a body in the surface's foreground colour and one lime accent on the detail
 * that identifies the mark. These replace the emoji (🚗🏍️❄️⭐💵💳⚡🎟️…) that
 * rendered differently on every Android skin and dated the whole flow.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../config';

export interface RideIconProps {
  size?: number;
  color?: string;
  accent?: string;
}

/* ── Vehicle categories ────────────────────────────────────────────────────── */

/** Mini — compact hatchback, the everyday ride. */
export function MiniIcon({ size = 28, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 16.2v-2.7c0-.5.15-1 .44-1.4l1.5-2.15a2.4 2.4 0 0 1 1.97-1.03h7.36c.7 0 1.38.31 1.84.85l2.24 2.6c.37.44.58 1 .58 1.58v2.25"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4.5 12.9h15" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={7.6} cy={16.4} r={1.85} stroke={accent} strokeWidth={1.6} />
      <Circle cx={16.4} cy={16.4} r={1.85} stroke={accent} strokeWidth={1.6} />
      <Path d="M11.2 12.9V9.1" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/** Moto — bike silhouette, beats the traffic. */
export function MotoIcon({ size = 28, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={6} cy={16.4} r={3.1} stroke={color} strokeWidth={1.6} />
      <Circle cx={18} cy={16.4} r={3.1} stroke={color} strokeWidth={1.6} />
      <Path
        d="M6 16.4 9 10.6h4.2l4.8 5.8"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M13.2 10.6 15 7.3" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M13.8 7.3h2.8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M6.6 10.6h3.6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Ride A/C — car body with a snowflake burst. */
export function AcIcon({ size = 28, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.6 17v-2.8c0-.5.15-1 .43-1.4l1.62-2.4a2.4 2.4 0 0 1 2-1.06h6.9c.8 0 1.55.4 2 1.06l1.66 2.4c.28.4.43.9.43 1.4V17"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4.1 13.6h14" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={7.1} cy={17.2} r={1.75} stroke={color} strokeWidth={1.6} />
      <Circle cx={15.1} cy={17.2} r={1.75} stroke={color} strokeWidth={1.6} />
      <Path d="M19.4 3.2v5.2" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M17.2 4.5l4.4 2.6" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M21.6 4.5l-4.4 2.6" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  );
}

/** Premium — sedan with a star. */
export function PremiumIcon({ size = 28, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.6 17.4v-2.9c0-.5.15-1 .43-1.42l1.7-2.55a2.5 2.5 0 0 1 2.08-1.12h7.5c.84 0 1.62.42 2.08 1.12l1.7 2.55c.28.42.43.92.43 1.42v2.9"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4.1 13.9h15.8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={7.4} cy={17.6} r={1.8} stroke={color} strokeWidth={1.6} />
      <Circle cx={16.6} cy={17.6} r={1.8} stroke={color} strokeWidth={1.6} />
      <Path
        d="m19 2.4.78 1.58 1.74.25-1.26 1.23.3 1.73L19 6.37l-1.56.82.3-1.73-1.26-1.23 1.74-.25L19 2.4Z"
        fill={accent}
      />
    </Svg>
  );
}

/* ── Ride modes ────────────────────────────────────────────────────────────── */

/** Solo — one rider. */
export function SoloIcon({ size = 24, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7.8} r={3.4} stroke={color} strokeWidth={1.7} />
      <Path
        d="M5.4 19.6a6.6 6.6 0 0 1 13.2 0"
        stroke={accent}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Pool — two riders sharing. */
export function PoolIcon({ size = 24, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8.4} r={3} stroke={color} strokeWidth={1.7} />
      <Path d="M3.4 18.8a5.6 5.6 0 0 1 11.2 0" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={16.8} cy={9} r={2.5} stroke={accent} strokeWidth={1.6} />
      <Path d="M15.2 13.6a4.8 4.8 0 0 1 5.4 4.6" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/* ── Map marks ─────────────────────────────────────────────────────────────── */
/*
 * The icons above are line art on a 24×24 grid, which is right at 28px in a
 * card and mush at the 12–15px a map legend and a marker actually get. These
 * are the same subjects drawn as SOLID silhouettes: no interior detail to lose,
 * no stroke to thin out, legible down to about 10px. They replace the 🚗 and
 * 🏍️ emoji, which rendered as a different cartoon on every Android skin.
 *
 * No window cut-outs on purpose — a hole would have to be filled with whatever
 * is behind the icon, and these sit on a marker chip, on a legend, and on the
 * map itself. A silhouette is the one thing that reads correctly on all three.
 */

/** Car — solid side profile for map markers and legends. */
export function CarMarkIcon({ size = 16, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.4 16.2v-2.5c0-.62.38-1.18.96-1.4l1.3-.5 1.94-3.2A2.7 2.7 0 0 1 8.9 7.3h6.2c.78 0 1.52.34 2.03.93l2.4 2.8 1.45.55c.58.22.96.78.96 1.4v2.72a.62.62 0 0 1-.62.62H19.9a2.7 2.7 0 0 0-5.4 0h-5a2.7 2.7 0 0 0-5.4 0H3.02a.62.62 0 0 1-.62-.62Z"
        fill={color}
      />
      <Circle cx={7.2} cy={16.9} r={2.1} fill={accent} />
      <Circle cx={16.8} cy={16.9} r={2.1} fill={accent} />
    </Svg>
  );
}

/** Motorbike — solid side profile, same weight as the car mark. */
export function BikeMarkIcon({ size = 16, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13.4 6.2h3.1a.85.85 0 0 1 0 1.7h-1.6l-1.1 2.05 3.5 3.95h-1.9l-3.25-3.4H8.6l-1.2 2.1H5.3l2.1-3.7c.3-.53.86-.85 1.47-.85h3.02l.9-1.6a.9.9 0 0 1 .61-.25Z"
        fill={color}
      />
      <Circle cx={6} cy={16.4} r={3.05} fill={accent} />
      <Circle cx={18} cy={16.4} r={3.05} fill={accent} />
    </Svg>
  );
}

/** A person nearby — solid, so it stays a person at legend size. */
export function RiderMarkIcon({ size = 16, color = '#ffffff' }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7.4} r={3.6} fill={color} />
      <Path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0 .9.9 0 0 1-.9.9H5.5a.9.9 0 0 1-.9-.9Z" fill={color} />
    </Svg>
  );
}

/* ── Route points ──────────────────────────────────────────────────────────── */

/** Pickup — a live-location ring. */
export function PickupDotIcon({ size = 18, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={7.2} stroke={color} strokeWidth={1.7} />
      <Circle cx={12} cy={12} r={3.1} fill={accent} />
    </Svg>
  );
}

/** Destination — map pin. */
export function DestinationPinIcon({ size = 18, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21.2s-6.6-5.4-6.6-10.4a6.6 6.6 0 0 1 13.2 0c0 5-6.6 10.4-6.6 10.4Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10.8} r={2.2} fill={accent} />
    </Svg>
  );
}

/** Finish flag — used where a route "ends". */
export function FlagIcon({ size = 18, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 21.5V3.5" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path
        d="M6 4h10.8l-2.4 3.9 2.4 3.9H6"
        stroke={accent}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ── Payment & extras ──────────────────────────────────────────────────────── */

/** Cash — banknote. */
export function CashIcon({ size = 20, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.8} y={6.4} width={18.4} height={11.2} rx={2} stroke={color} strokeWidth={1.6} />
      <Circle cx={12} cy={12} r={2.7} stroke={accent} strokeWidth={1.6} />
      <Path d="M6.1 9.6v.01M17.9 14.4v.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Wallet / card. */
export function WalletIcon({ size = 20, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={5.6} width={18} height={12.8} rx={2.4} stroke={color} strokeWidth={1.6} />
      <Path d="M3 9.6h18" stroke={color} strokeWidth={1.6} />
      <Path d="M6.4 14.6h4.2" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Auto-accept bolt. */
export function BoltIcon({ size = 18, color = colors.primary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13.2 2.8 5.8 13h4.4l-1.4 8.2L16.2 11h-4.4l1.4-8.2Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Promo ticket. */
export function TicketIcon({ size = 18, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.4} y={6} width={17.2} height={12} rx={2.4} stroke={color} strokeWidth={1.6} />
      <Path d="M14.8 6v12" stroke={accent} strokeWidth={1.6} strokeDasharray="2.6 2.6" />
    </Svg>
  );
}

/** Schedule calendar. */
export function CalendarIcon({ size = 20, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={2.4} stroke={color} strokeWidth={1.6} />
      <Path d="M3.5 9.6h17" stroke={color} strokeWidth={1.6} />
      <Path d="M8 3v3.6M16 3v3.6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={8.6} cy={13.8} r={1.4} fill={accent} />
    </Svg>
  );
}

/** Public pool — globe. */
export function GlobeIcon({ size = 20, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.4} stroke={color} strokeWidth={1.6} />
      <Path d="M3.6 12h16.8" stroke={color} strokeWidth={1.6} />
      <Path
        d="M12 3.6c2.5 2.3 3.8 5.1 3.8 8.4s-1.3 6.1-3.8 8.4c-2.5-2.3-3.8-5.1-3.8-8.4S9.5 5.9 12 3.6Z"
        stroke={accent}
        strokeWidth={1.6}
      />
    </Svg>
  );
}

/** Private pool — padlock. */
export function LockIcon({ size = 20, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5.4} y={10.4} width={13.2} height={9.6} rx={2.2} stroke={color} strokeWidth={1.6} />
      <Path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={12} cy={15.2} r={1.5} fill={accent} />
    </Svg>
  );
}

/** Invite link — chain. */
export function LinkIcon({ size = 18, color = '#ffffff', accent = colors.primary }: RideIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.2 13.8a4.2 4.2 0 0 0 6.2.4l2.4-2.4a4.2 4.2 0 1 0-5.9-5.9l-1.1 1.1"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path
        d="M13.8 10.2a4.2 4.2 0 0 0-6.2-.4l-2.4 2.4a4.2 4.2 0 1 0 5.9 5.9l1.1-1.1"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
