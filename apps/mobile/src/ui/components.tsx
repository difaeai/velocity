import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Text } from './Text';
import { colors } from '../config';
import { SUPPORT_EMAIL } from '../share/links';
import { themed } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger';

/** Friendly placeholder so secondary buttons never feel dead while a feature lands. */
export function comingSoon(feature = 'This feature') {
  Alert.alert(feature, "It's coming soon — we're still building this part.");
}

/** Opens the device mail composer to contact support. */
export function contactSupport() {
  Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
    Alert.alert('Support', `Email us at ${SUPPORT_EMAIL}`),
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
}) {
  // Primary buttons take their fill/label from theme tokens: lime with BLACK
  // text in dark mode (white-on-lime was unreadable), black with white text
  // in light mode. Danger/secondary fills keep white labels in both themes.
  const bg =
    variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.secondary : colors.btnBg;
  const fg = variant === 'primary' ? colors.btnText : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, color = colors.primary }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * The soft edge that tells a rider a horizontal row keeps going.
 *
 * A row of chips that runs off the screen looks identical to a row that ends
 * in a chip the designer clipped — the payment methods were reading as
 * "Cash, EasyPaisa, JazzCash, E" — and nothing on a flat edge says "scroll me".
 * A fade does, because the content dissolving into the surface is the one cue
 * that cannot be mistaken for a layout mistake.
 *
 * Sits on top of the list and takes no touches, so a chip half under it is
 * still tappable. `colour` must be the surface behind the row, opaque: a
 * translucent one fades to the map instead of to the sheet.
 */
export function EdgeFade({
  side = 'right', width = 28, colour, style,
}: {
  side?: 'left' | 'right';
  width?: number;
  /** The opaque background this fades into. */
  colour: string;
  style?: ViewStyle;
}) {
  // The gradient runs from transparent at the content edge to the surface
  // colour at the screen edge, so `x1`/`x2` flip with the side.
  const solidFirst = side === 'left';
  return (
    <View
      pointerEvents="none"
      style={[styles.edgeFade, side === 'left' ? { left: 0 } : { right: 0 }, { width }, style]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`edge-${side}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colour} stopOpacity={solidFirst ? 1 : 0} />
            <Stop offset="1" stopColor={colour} stopOpacity={solidFirst ? 0 : 1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#edge-${side})`} />
      </Svg>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  edgeFade: { position: 'absolute', top: 0, bottom: 0 },
  btn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
    // Glass depth — soft drop shadow on iOS; Android relies on the alpha border
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
}));
