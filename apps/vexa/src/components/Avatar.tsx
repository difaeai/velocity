import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { C } from '../theme';

const FACE = require('../../assets/icon.png');

/** Vexa's own face, the app's mark — round, ringed, with the online dot. */
export default function Avatar({ size = 38, online = true }: { size?: number; online?: boolean }) {
  const dot = Math.max(8, size * 0.2);
  return (
    <View style={{ width: size, height: size }}>
      <View style={[st.ring, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image source={FACE} style={{ width: size, height: size }} resizeMode="cover" />
      </View>
      {online ? <View style={[st.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  ring: {
    overflow: 'hidden',
    borderWidth: 1.6,
    borderColor: 'rgba(130,255,170,0.55)',
    backgroundColor: '#0B1511',
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: C.lime,
    borderWidth: 1.5,
    borderColor: C.bg,
  },
});
