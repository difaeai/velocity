import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEnter } from '../anim';
import Backdrop from '../components/Backdrop';
import Glass from '../components/Glass';
import { Waveform } from '../components/kit';
import { hush, speak } from '../voice';
import { C, R } from '../theme';

const FIGURE = require('../../assets/vexa.png');

/** The one thing she says, out loud and on screen. */
const LINE = 'I am Vexa, your social media manager and Ad Expert for Facebook, Instagram and Google.';

// She holds the screen for at least this long, and never leaves mid-sentence.
const MIN_HOLD = 5000;
const MAX_HOLD = 13000; // a phone whose voice never reports "done" still moves on
const PER_CHAR = 55;

/** First frame of the app: the mark, the name, Vexa rising — and saying hello. */
export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const word = useEnter(120, { y: 18 });
  const tag = useEnter(320, { y: 12 });
  const figure = useEnter(60, { y: 60, scale: 0.9, duration: 900 });
  const caption = useEnter(700, { y: 14 });
  const bar = useRef(new Animated.Value(0)).current;

  const [said, setSaid] = useState(0); // characters of LINE shown so far
  const [talking, setTalking] = useState(true);
  const [held, setHeld] = useState(false); // the five seconds are up
  const left = useRef(false);

  // Out loud, in her own (always female) voice. On-device, no key, and
  // silence is fine — the caption carries the line either way.
  useEffect(() => {
    const t = setTimeout(() => speak(LINE, () => setTalking(false)), 600);
    return () => {
      clearTimeout(t);
      hush();
    };
  }, []);

  // ...and in writing, a letter at a time, in step with her.
  useEffect(() => {
    const id = setInterval(() => {
      setSaid((n) => {
        if (n >= LINE.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, PER_CHAR);
    return () => clearInterval(id);
  }, []);

  const leave = () => {
    if (left.current) return;
    left.current = true;
    hush();
    onDone();
  };

  // The bar runs the five seconds, then waits on her: the splash never cuts
  // her off mid-sentence, and never outstays MAX_HOLD if a phone forgets to
  // tell us she finished.
  useEffect(() => {
    const a = Animated.timing(bar, {
      toValue: 0.88,
      duration: MIN_HOLD,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false,
    });
    a.start(({ finished }) => finished && setHeld(true));
    const cap = setTimeout(leave, MAX_HOLD);
    return () => {
      a.stop();
      clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar]);

  useEffect(() => {
    if (!held || talking || said < LINE.length) return;
    const a = Animated.timing(bar, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: false });
    a.start(({ finished }) => finished && leave());
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, talking, said]);

  const width = bar.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] });

  return (
    <Pressable style={st.root} onPress={leave}>
      <Backdrop />

      <View style={st.top}>
        <Animated.Text style={[st.word, word]}>
          VE<Text style={{ color: C.lime }}>X</Text>A
        </Animated.Text>
        <Animated.Text style={[st.tag, tag]}>Your Social Media Virtual Assistant</Animated.Text>

        <View style={st.track}>
          <Animated.View style={[st.fill, { width }]} />
        </View>

        <Animated.View style={[st.captionWrap, caption]}>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
            <View style={st.caption}>
              <Waveform live={talking && said < LINE.length} />
              <Text style={st.captionText}>
                {LINE.slice(0, said)}
                {said < LINE.length ? <Text style={{ color: C.lime }}>|</Text> : null}
              </Text>
            </View>
          </Glass>
          <Text style={st.skip}>Tap anywhere to skip</Text>
        </Animated.View>
      </View>

      <Animated.View style={[st.figureWrap, figure]}>
        <Image source={FIGURE} style={st.figure} resizeMode="contain" />
      </Animated.View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  top: { position: 'absolute', top: '11%', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 22 },
  word: { color: C.text, fontSize: 46, fontWeight: '900', letterSpacing: 7 },
  tag: { color: C.textDim, fontSize: 13, letterSpacing: 1.1, marginTop: 10 },
  track: {
    width: 148,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginTop: 22,
  },
  fill: { height: '100%', borderRadius: 2, backgroundColor: C.lime },

  captionWrap: { alignSelf: 'stretch', marginTop: 22, alignItems: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13 },
  captionText: { color: C.text, fontSize: 13.5, lineHeight: 19.5, flex: 1, fontWeight: '600' },
  skip: { color: C.textFaint, fontSize: 10.5, marginTop: 9, letterSpacing: 0.6 },

  // Whole cut-out on screen — nothing clipped by the bottom or the sides.
  figureWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  figure: { width: 380, height: 380, marginRight: 26 },
});
