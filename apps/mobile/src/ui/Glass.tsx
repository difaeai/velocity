/**
 * Apple's Liquid Glass look (owner, 2026-11-06) for buttons, bars, cards and
 * feature tiles.
 *
 * On iOS 26 `Glass` IS Apple's: expo-glass-effect's GlassView, which is in the
 * native build already because expo-router depends on it. Android and older
 * iOS have no such view, so there the look is drawn — a light edge along the
 * top and a sheen fading down the face (`GlassSheen`). Nothing native is added,
 * so this ships over the air.
 */
import { useId, type ComponentType, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type GlassViewProps = {
  style?: StyleProp<ViewStyle>;
  glassEffectStyle?: 'regular' | 'clear';
  tintColor?: string;
  children?: ReactNode;
};

/** Apple's glass where the phone has it; null on Android, older iOS, or a build without the module. */
const NativeGlass: ComponentType<GlassViewProps> | null = (() => {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const g = require('expo-glass-effect') as {
      GlassView: ComponentType<GlassViewProps>;
      isLiquidGlassAvailable: () => boolean;
    };
    return g.isLiquidGlassAvailable() ? g.GlassView : null;
  } catch {
    return null;
  }
})();

/**
 * The drawn half of the effect: light along the top fading down the face.
 * Put it first inside a box with its own fill; it takes no touches.
 */
export function GlassSheen({ radius = 0, strength = 1 }: { radius?: number; strength?: number }) {
  const id = `sheen${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.3 * strength} />
            <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0.07 * strength} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** The glass edge: a thin light rim, brighter along the top where the light hits. */
export const glassEdge: ViewStyle = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.18)',
  borderTopColor: 'rgba(255,255,255,0.45)',
};

/** A glass panel: Apple's on iOS 26, drawn everywhere else. `style` carries the shape and fill. */
export function Glass({ style, radius = 0, children }: { style?: StyleProp<ViewStyle>; radius?: number; children?: ReactNode }) {
  if (NativeGlass) {
    return (
      <NativeGlass style={[style, { backgroundColor: 'transparent', borderRadius: radius, overflow: 'hidden' }]} glassEffectStyle="regular">
        {children}
      </NativeGlass>
    );
  }
  return (
    <View style={[style, glassEdge, { borderRadius: radius }]}>
      <GlassSheen radius={radius} />
      {children}
    </View>
  );
}
