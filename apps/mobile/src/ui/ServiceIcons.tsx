/**
 * Service icons for the home screen tiles.
 *
 * These replace the emoji that used to sit in the corner of each card (🚗💼,
 * 📦, 🚛). Emoji render differently on every Android skin and never match the
 * brand, which is what made the grid look dated. These are flat two-tone marks
 * drawn on a 24×24 grid: a muted body in the tile's foreground colour and a
 * lime accent on the one detail that identifies the service.
 *
 * Every icon takes the same props so the tiles can swap one for another.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../config';

export interface ServiceIconProps {
  size?: number;
  /** Body colour — tiles pass their own foreground so icons match the label. */
  color?: string;
  /** Accent colour for the identifying detail. Defaults to brand lime. */
  accent?: string;
}

/** City rides — a saloon car, three-quarter side view. */
export function CityRideIcon({ size = 28, color = '#ffffff', accent = colors.primary }: ServiceIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 16.5v-3.2c0-.5.15-1 .43-1.42l1.9-2.85A2.5 2.5 0 0 1 7.91 7.9h8.18c.84 0 1.62.42 2.08 1.12l1.9 2.85c.28.42.43.92.43 1.42v3.2"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4 12.6h16" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx={7.3} cy={16.6} r={1.8} stroke={accent} strokeWidth={1.6} />
      <Circle cx={16.7} cy={16.6} r={1.8} stroke={accent} strokeWidth={1.6} />
      <Path d="M9.5 12.6V8" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/** City to city — a road running to a distant pin. */
export function IntercityIcon({ size = 28, color = '#ffffff', accent = colors.primary }: ServiceIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 20.5c0-5 2.5-7 5-8.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path
        d="M19 20.5c0-5-2.5-7-5-8.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path d="M12 20.5v-1.6M12 16.4v-1.6" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <Path
        d="M12 3c2.1 0 3.8 1.7 3.8 3.8 0 2.6-3.8 6.2-3.8 6.2S8.2 9.4 8.2 6.8C8.2 4.7 9.9 3 12 3Z"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={6.8} r={1.4} fill={accent} />
    </Svg>
  );
}

/** Couriers — a parcel with a taped seam. */
export function CourierIcon({ size = 28, color = '#ffffff', accent = colors.primary }: ServiceIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.2 20 7v10l-8 3.8L4 17V7l8-3.8Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="M4 7l8 3.8L20 7" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M12 10.8v10" stroke={color} strokeWidth={1.6} />
      <Path d="M8 5.1 16 8.9" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Freight — a box truck. */
export function FreightIcon({ size = 28, color = '#ffffff', accent = colors.primary }: ServiceIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.5} y={7} width={11} height={9.5} rx={1.4} stroke={color} strokeWidth={1.6} />
      <Path
        d="M13.5 10h3.6c.5 0 .97.24 1.26.66l2.1 3c.18.26.28.57.28.9v1.94h-7.24V10Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Circle cx={7} cy={17.8} r={1.7} stroke={accent} strokeWidth={1.6} />
      <Circle cx={17} cy={17.8} r={1.7} stroke={accent} strokeWidth={1.6} />
    </Svg>
  );
}

/** The magnifier that fronts the "Where to?" hero. */
export function SearchIcon({ size = 22, color = '#0b0d0c' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M15.4 15.4 20 20" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Clock face for the recent-destination rows. */
export function ClockIcon({ size = 16, color = colors.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.7} />
      <Path d="M12 7.5V12l3 1.8" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
