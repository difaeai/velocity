/**
 * Drawer icons — the marks the passenger menu uses instead of emoji.
 *
 * The drawer ran on emoji (🚗 💳 📣 🚗 📦 …) and it showed. Emoji are drawn by
 * the handset, not by us: they are a different shape, weight and palette on
 * every Android skin, two separate features both landed on 🚗, and none of them
 * can take the brand lime on the one detail that identifies the feature. A menu
 * of fifteen rows where several marks look alike is a menu people read as a wall
 * of text and scroll past.
 *
 * So these are flat two-tone marks on a 24×24 grid, the same construction as
 * ServiceIcons/RideIcons: a body stroke in the row's foreground colour and a
 * lime accent on the detail that names the feature. Only icons that did not
 * already exist are drawn here — Couriers, City to City, Wallet, shared rides
 * and city rides keep the marks they already have elsewhere, so the same
 * feature never wears two different faces in one app.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../config';

export interface DrawerIconProps {
  size?: number;
  color?: string;
  accent?: string;
}

const S = 1.6;

/** Find my Customers — a megaphone throwing an offer outward. */
export function MegaphoneIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.2v3.6c0 .9.7 1.6 1.6 1.6h1.7l8.2 3.9V4.7L7.3 8.6H5.6C4.7 8.6 4 9.3 4 10.2Z"
        stroke={color}
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <Path d="M7.3 15.4v2.4c0 .9.7 1.6 1.6 1.6h.6c.9 0 1.6-.7 1.6-1.6v-.9" stroke={color} strokeWidth={1.35} strokeLinejoin="round" />
      <Path d="M18.4 9.3c.8.7 1.3 1.7 1.3 2.7s-.5 2-1.3 2.7" stroke={accent} strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

/** Special Rides — a car wearing a star: the bookings that need paperwork. */
export function SpecialRideIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.6 18v-3c0-.45.13-.9.38-1.28l1.7-2.56A2.2 2.2 0 0 1 7.5 10.2h9a2.2 2.2 0 0 1 1.82.96l1.7 2.56c.25.38.38.83.38 1.28v3"
        stroke={color}
        strokeWidth={S}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4.1 14.6h15.8" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <Circle cx={7.2} cy={18} r={1.6} stroke={color} strokeWidth={1.4} />
      <Circle cx={16.8} cy={18} r={1.6} stroke={color} strokeWidth={1.4} />
      <Path
        d="m12 2.6 1.25 2.6 2.8.4-2.02 2 .48 2.82L12 9.09 9.49 10.4l.48-2.81-2.02-2 2.8-.4L12 2.6Z"
        fill={accent}
      />
    </Svg>
  );
}

/** My routes — a signposted road with the stops a rider saved on it. */
export function RouteIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 19.5c3.2 0 3.2-5 0-5s-3.2-5 0-5h7c3.2 0 3.2-5 0-5"
        stroke={color}
        strokeWidth={S}
        strokeLinecap="round"
        strokeDasharray="0.1 3.4"
      />
      <Circle cx={6.6} cy={19.4} r={2.1} fill={accent} />
      <Path
        d="M14.2 2.2c1.7 0 3.1 1.4 3.1 3.1 0 2.1-3.1 5-3.1 5s-3.1-2.9-3.1-5c0-1.7 1.4-3.1 3.1-3.1Z"
        stroke={accent}
        strokeWidth={S}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Travel Partner — two people meeting, the community side of the app. */
export function PartnerIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={8.6} cy={7.6} r={3} stroke={color} strokeWidth={S} />
      <Path d="M3.2 19.2c0-2.9 2.4-5.2 5.4-5.2 1.3 0 2.5.4 3.4 1.1" stroke={color} strokeWidth={S} strokeLinecap="round" />
      <Circle cx={16.4} cy={10.2} r={2.5} stroke={accent} strokeWidth={S} />
      <Path d="M11.8 20.4c0-2.5 2-4.6 4.6-4.6s4.6 2.1 4.6 4.6" stroke={accent} strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

/** Earn with Velocity — a coin stack with the one on top catching the light. */
export function EarnIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 8.4v8.2c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7V8.4"
        stroke={color}
        strokeWidth={S}
        strokeLinecap="round"
      />
      <Path d="M4.5 12.5c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7" stroke={color} strokeWidth={1.35} strokeLinecap="round" />
      <Path
        d="M12 5.2c4.14 0 7.5 1.21 7.5 2.7S16.14 10.6 12 10.6 4.5 9.39 4.5 7.9 7.86 5.2 12 5.2Z"
        stroke={accent}
        strokeWidth={S}
      />
      <Path d="M12 6.9v2.2" stroke={accent} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/** Matches & Groups — overlapping bubbles: more than one conversation. */
export function GroupChatIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 9.4c0-2 1.7-3.6 3.7-3.6h6.1c2 0 3.7 1.6 3.7 3.6v2.9c0 2-1.7 3.6-3.7 3.6H8.2L4.4 19v-3.2A3.63 3.63 0 0 1 3 12.9V9.4Z"
        stroke={color}
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <Path
        d="M18.1 8.3c1.7.3 2.9 1.7 2.9 3.4v2.6c0 1.2-.6 2.2-1.5 2.9v2.4l-2.8-2.1"
        stroke={accent}
        strokeWidth={S}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Messages — a sealed envelope. */
export function EnvelopeIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.8} y={5.2} width={18.4} height={13.6} rx={2.4} stroke={color} strokeWidth={S} />
      <Path d="m3.6 7.4 7.1 5a2.2 2.2 0 0 0 2.6 0l7.1-5" stroke={accent} strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}

/** Safety Centre — a shield with a tick inside it. */
export function ShieldIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.8 19.4 5.5v6.1c0 4.3-3 7.9-7.4 9.6-4.4-1.7-7.4-5.3-7.4-9.6V5.5L12 2.8Z"
        stroke={color}
        strokeWidth={S}
        strokeLinejoin="round"
      />
      <Path d="m8.8 11.9 2.3 2.3 4.1-4.5" stroke={accent} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Settings — a cog. */
export function GearIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.7 3h2.6l.35 2.1c.6.2 1.16.52 1.64.93l2-.77 1.3 2.25-1.63 1.37c.07.3.1.62.1.95s-.03.65-.1.95l1.63 1.37-1.3 2.25-2-.77c-.48.41-1.04.73-1.64.93L13.3 21h-2.6l-.35-2.1c-.6-.2-1.16-.52-1.64-.93l-2 .77-1.3-2.25 1.63-1.37a5.3 5.3 0 0 1 0-1.9L5.41 11.6l1.3-2.25 2 .77c.48-.41 1.04-.73 1.64-.93L10.7 3Z"
        stroke={color}
        strokeWidth={1.45}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={2.6} stroke={accent} strokeWidth={S} />
    </Svg>
  );
}

/** Help & complaints — Rapid Response: a bolt inside a support ring. */
export function RapidHelpIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={S} strokeDasharray="3.6 2.6" />
      <Path d="M12.9 6.6 8.6 12.9h3.1l-.7 4.5 4.4-6.3h-3.2l.7-4.5Z" fill={accent} />
    </Svg>
  );
}

/** Sign out — an arrow leaving through a door. */
export function SignOutIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 4.5H6.8c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2H14"
        stroke={color}
        strokeWidth={S}
        strokeLinecap="round"
      />
      <Path d="M11.2 12h8.3" stroke={accent} strokeWidth={S} strokeLinecap="round" />
      <Path d="m16.6 8.9 3.1 3.1-3.1 3.1" stroke={accent} strokeWidth={S} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Your profile — the head-and-shoulders on the drawer's own header. */
export function ProfileIcon({ size = 22, color = '#ffffff', accent = colors.primary }: DrawerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.6} stroke={accent} strokeWidth={S} />
      <Path d="M4.8 20c0-3.6 3.2-6.4 7.2-6.4s7.2 2.8 7.2 6.4" stroke={color} strokeWidth={S} strokeLinecap="round" />
    </Svg>
  );
}
