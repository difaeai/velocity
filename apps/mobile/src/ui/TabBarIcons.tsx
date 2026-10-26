/**
 * Tab-bar icons for the Travel Partner bottom navigation.
 *
 * Modern rounded-stroke glyphs (react-native-svg) that tint with the
 * active/inactive colour. When a tab is focused the glyph goes "duotone":
 * same outline, slightly heavier stroke, plus a soft fill of the tint colour —
 * livelier than a plain fill-swap and it matches the app's lime-glass theme.
 */
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

interface IconProps {
  color: ColorValue;
  focused: boolean;
  size?: number;
}

interface Shape {
  d: string;
  /** Closed shapes get the soft tint fill when the tab is focused. */
  duo?: boolean;
}

function DuoIcon({
  size = 24,
  color,
  focused,
  shapes,
}: {
  size?: number;
  color: ColorValue;
  focused: boolean;
  shapes: Shape[];
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {shapes.map((p, i) => (
        <Path
          key={i}
          d={p.d}
          stroke={color}
          strokeWidth={focused ? 2 : 1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={focused && p.duo ? color : 'none'}
          fillOpacity={focused && p.duo ? 0.22 : 1}
        />
      ))}
    </Svg>
  );
}

export function HomeIcon({ color, focused, size }: IconProps) {
  return (
    <DuoIcon
      size={size}
      color={color}
      focused={focused}
      shapes={[
        { d: 'M3.5 9.9 12 3.2l8.5 6.7V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z', duo: true },
        { d: 'M9.5 21v-6h5v6' },
      ]}
    />
  );
}

export function FeedIcon({ color, focused, size }: IconProps) {
  return (
    <Svg width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={8.8}
        stroke={color}
        strokeWidth={focused ? 2 : 1.7}
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.22 : 1}
      />
      <Path
        d="M3.6 12h16.8M12 3.3c2.5 2.5 3.8 5.5 3.8 8.7s-1.3 6.2-3.8 8.7c-2.5-2.5-3.8-5.5-3.8-8.7S9.5 5.8 12 3.3Z"
        stroke={color}
        strokeWidth={focused ? 2 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function ProfileIcon({ color, focused, size }: IconProps) {
  return (
    <DuoIcon
      size={size}
      color={color}
      focused={focused}
      shapes={[
        { d: 'M12 11.9a3.95 3.95 0 1 0 0-7.9 3.95 3.95 0 0 0 0 7.9Z', duo: true },
        {
          d: 'M4.5 20.6v-.3c0-2.9 2.4-5.3 5.3-5.3h4.4c2.9 0 5.3 2.4 5.3 5.3v.3Z',
          duo: true,
        },
      ]}
    />
  );
}

/** Two people — the commute Groups tab. */
export function GroupsIcon({ color, focused, size }: IconProps) {
  return (
    <DuoIcon
      size={size}
      color={color}
      focused={focused}
      shapes={[
        { d: 'M9 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z', duo: true },
        { d: 'M2.8 19.8v-.4c0-2.6 2.1-4.7 4.7-4.7h3c2.6 0 4.7 2.1 4.7 4.7v.4Z', duo: true },
        { d: 'M15.5 5.3a3 3 0 0 1 0 5.8' },
        { d: 'M17.6 14.8c2 .4 3.6 2.2 3.6 4.4v.6' },
      ]}
    />
  );
}

/** Envelope, used by the message-requests entry points (not a tab). */
export function MailIcon({ color, size = 24 }: { color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 5.5h13A2.5 2.5 0 0 1 21 8v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V8a2.5 2.5 0 0 1 2.5-2.5Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m3.8 8 7.3 4.8a1.65 1.65 0 0 0 1.8 0L20.2 8"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
