import Svg, { Defs, Mask, Rect, Circle, Path, G } from 'react-native-svg';

/**
 * Velocity brand mark: a bold "V" (hood/windshield) merged with a car
 * chassis + wheels. Glyph-only (transparent) — wrap in a colored badge
 * View for contexts that previously used a filled square/circle.
 */
export function LogoMark({ size = 60, color = '#ccff00' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Defs>
        <Mask id="hubs">
          <Rect x={0} y={0} width={200} height={200} fill="#ffffff" />
          <Circle cx={66} cy={152} r={6.5} fill="#000000" />
          <Circle cx={134} cy={152} r={6.5} fill="#000000" />
        </Mask>
      </Defs>
      <G mask="url(#hubs)" fill={color}>
        <Rect x={50} y={118} width={32} height={22} rx={11} />
        <Rect x={118} y={118} width={32} height={22} rx={11} />
        <Rect x={44} y={130} width={112} height={18} rx={9} />
        <Circle cx={66} cy={152} r={17} />
        <Circle cx={134} cy={152} r={17} />
        <Path d="M 36,30 L 60,30 Q 65,30 67,36 L 100,112 L 133,36 Q 135,30 140,30 L 164,30 Q 172,30 168,38 L 112,134 Q 108,142 100,142 Q 92,142 88,134 L 32,38 Q 28,30 36,30 Z" />
      </G>
    </Svg>
  );
}
