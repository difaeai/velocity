import React from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { useEnter } from '../anim';
import Glass from '../components/Glass';
import { SparkleIcon } from '../components/Icons';
import { C, R } from '../theme';

const FIGURE = require('../../assets/vexa.png');

/**
 * The stand-in behind every destination that has no screen designed yet, so
 * the drawer and the tabs really navigate somewhere.
 */
export default function Pane({ title, line }: { title: string; line: string }) {
  const card = useEnter(60, { y: 18 });

  return (
    <View style={st.root}>
      <Image source={FIGURE} style={st.watermark} resizeMode="contain" />
      <Animated.View style={[st.wrap, card]}>
        <Glass style={st.card} radius={R.xl} lit>
          <View style={st.inner}>
            <View style={st.badge}>
              <SparkleIcon size={20} />
            </View>
            <Text style={st.title}>{title}</Text>
            <Text style={st.line}>{line}</Text>
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  watermark: { position: 'absolute', right: -70, bottom: -30, width: 320, height: 320, opacity: 0.16 },
  wrap: {},
  card: {},
  inner: { padding: 24, alignItems: 'flex-start', gap: 10 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(120,255,140,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.text, fontSize: 22, fontWeight: '900', marginTop: 4 },
  line: { color: C.textDim, fontSize: 13.5, lineHeight: 20 },
});
