import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { GLASS } from '../theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  /** A lit rim marks the one card on a screen that wants the eye. */
  lit?: boolean;
  onPress?: () => void;
};

/**
 * One frosted pane: blur behind, a diagonal sheen over it, a hairline rim.
 * Give it onPress and it becomes the pressable itself, so nothing is nested twice.
 */
export default function Glass({ children, style, radius = 22, intensity, lit, onPress }: Props) {
  const body = (
    <>
      <BlurView
        intensity={intensity ?? GLASS.intensity}
        tint="dark"
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <LinearGradient
        colors={GLASS.sheen}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: 1, borderColor: lit ? GLASS.rimLit : GLASS.rim },
        ]}
      />
      {children}
    </>
  );

  const shell: StyleProp<ViewStyle> = [{ borderRadius: radius, overflow: 'hidden' }, style];

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [shell, pressed && { opacity: 0.7 }]}>
        {body}
      </Pressable>
    );
  }
  return <View style={shell}>{body}</View>;
}
