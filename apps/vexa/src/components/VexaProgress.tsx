import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Glass from './Glass';
import { C, R } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RADIUS = 20;
const CIRC = 2 * Math.PI * RADIUS;
const PERCENT = 0.68;
const BAR_WIDTH = 150;

/**
 * "Vexa Progress": how far through today's work she is. The ring draws itself
 * every time the drawer opens, the glow breathes and a shimmer runs the bar,
 * so the box reads as work happening rather than a static number.
 */
export default function VexaProgress({ open }: { open: boolean }) {
  const draw = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) {
      draw.setValue(0);
      return;
    }
    const a = Animated.timing(draw, {
      toValue: 1,
      duration: 1100,
      delay: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [open, draw]);

  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const shimmer = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
    );
    breathe.start();
    shimmer.start();
    return () => {
      breathe.stop();
      shimmer.stop();
    };
  }, [pulse, sweep]);

  const offset = draw.interpolate({ inputRange: [0, 1], outputRange: [CIRC, CIRC * (1 - PERCENT)] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] });
  const fill = draw.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${PERCENT * 100}%`] });
  const shine = sweep.interpolate({ inputRange: [0, 1], outputRange: [-70, BAR_WIDTH + 20] });

  return (
    <Glass style={st.card} radius={R.lg} lit>
      <View style={st.inner}>
        <View style={st.ringWrap}>
          <Animated.View style={[st.ringGlow, { opacity: glow }]} />
          <Svg width={52} height={52} viewBox="0 0 52 52">
            <Circle cx="26" cy="26" r={RADIUS} stroke="rgba(255,255,255,0.12)" strokeWidth={4} fill="none" />
            <AnimatedCircle
              cx="26"
              cy="26"
              r={RADIUS}
              stroke={C.lime}
              strokeWidth={4}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC} ${CIRC}`}
              strokeDashoffset={offset}
              transform="rotate(-90 26 26)"
            />
          </Svg>
          <Text style={st.ringText}>68%</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={st.titleRow}>
            <Text style={st.title}>Vexa Progress</Text>
            <Animated.View style={[st.liveDot, { transform: [{ scale: dotScale }] }]} />
          </View>
          <Text style={st.sub}>3 of 5 jobs done today</Text>

          <View style={st.track}>
            <Animated.View style={[st.fill, { width: fill }]} />
            <Animated.View style={[st.shine, { transform: [{ translateX: shine }] }]}>
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    </Glass>
  );
}

const st = StyleSheet.create({
  card: { alignSelf: 'stretch', marginTop: 11 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, paddingHorizontal: 13 },

  ringWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  ringGlow: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(195,255,55,0.22)',
  },
  ringText: { position: 'absolute', color: C.text, fontSize: 12.5, fontWeight: '800' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 14.5, fontWeight: '800' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.lime },
  sub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },

  track: {
    width: BAR_WIDTH,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 9,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: C.lime },
  shine: { position: 'absolute', top: 0, bottom: 0, width: 60 },
});
