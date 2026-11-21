import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useEnter, useLoop } from '../anim';
import Avatar from '../components/Avatar';
import Backdrop from '../components/Backdrop';
import { GoogleMark, InstagramMark, MetaMark, TiktokMark, WhatsappMark } from '../components/BrandMarks';
import Glass from '../components/Glass';
import { ChevronRight } from '../components/Icons';
import { Waveform } from '../components/kit';
import { AdsScene, ContentScene, SalesScene } from '../components/Scenes';
import { hush, speak } from '../voice';
import { C, R, TOP_INSET } from '../theme';

const FIGURE = require('../../assets/vexa.png');

const W = Dimensions.get('window').width;
const PAGE_H = Dimensions.get('window').height - TOP_INSET - 150;

const ARENA = Math.min(272, W - 70); // the circle the scene sits in
const ORBIT = ARENA / 2 - 6; // where the platform chips ride

type Part = { t: string; hot?: boolean };

/**
 * Three pages, one job each: a scene, a sentence, her voice. Nothing to read
 * or work out.
 */
const PAGES: Array<{
  key: string;
  title: Part[];
  line: string;
  marks: Array<'instagram' | 'facebook' | 'tiktok' | 'google' | 'whatsapp'>;
  scene: (size: number) => React.ReactNode;
  said: string;
}> = [
  {
    key: 'content',
    title: [{ t: 'I create your ' }, { t: 'content', hot: true }, { t: ' and manage your ' }, { t: 'social media', hot: true }, { t: '.' }],
    line: 'Reels, photos and stories — written and posted on time.',
    marks: ['instagram', 'tiktok', 'facebook'],
    scene: (s) => <ContentScene size={s} />,
    said: 'I create your content and manage your social media. Reels, photos and stories, written and posted on time.',
  },
  {
    key: 'ads',
    title: [{ t: 'I run your ' }, { t: 'ads', hot: true }, { t: ' on Facebook, Instagram and Google.' }],
    line: 'Built, aimed, and kept inside your daily budget.',
    marks: ['facebook', 'instagram', 'google'],
    scene: (s) => <AdsScene size={s} />,
    said: 'I am your Ad Expert. I run your Facebook, Instagram and Google ads, and I never spend past the budget you set.',
  },
  {
    key: 'sales',
    title: [{ t: 'I answer your customers and ' }, { t: 'close your sales', hot: true }, { t: '.' }],
    line: 'Every enquiry replied to in minutes, then followed up.',
    marks: ['whatsapp', 'instagram', 'facebook'],
    scene: (s) => <SalesScene size={s} />,
    said: 'And I manage your sales. I answer every customer in minutes and follow up until the order is yours.',
  },
];

const MARK: Record<string, (size: number) => React.ReactNode> = {
  instagram: (s) => <InstagramMark size={s} />,
  facebook: (s) => <MetaMark size={s} />,
  tiktok: (s) => <TiktokMark size={s} />,
  google: (s) => <GoogleMark size={s} />,
  whatsapp: (s) => <WhatsappMark size={s} />,
};

/** Fade-and-rise that starts when this page becomes the one you are looking at. */
function In({
  delay = 0,
  y = 18,
  scale,
  children,
  style,
}: {
  delay?: number;
  y?: number;
  scale?: number;
  children: React.ReactNode;
  style?: object;
}) {
  const enter = useEnter(delay, { y, scale, duration: 520 });
  return <Animated.View style={[style, enter]}>{children}</Animated.View>;
}

/**
 * The picture: a glass arena with her scene inside it, a signal pushing out,
 * and the platforms she works through riding slowly around the rim.
 */
function Stage({ page }: { page: (typeof PAGES)[number] }) {
  const breathe = useLoop(2800);
  const ping = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const out = Animated.loop(
      Animated.timing(ping, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    const round = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: true }),
    );
    out.start();
    round.start();
    return () => {
      out.stop();
      round.stop();
    };
  }, [ping, spin]);

  const float = breathe.interpolate({ inputRange: [0, 1], outputRange: [5, -7] });
  const halo = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.46] });
  const ringScale = ping.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.3] });
  const ringFade = ping.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.4, 0] });
  const turn = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const unturn = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <Animated.View style={[st.stage, { width: ARENA, height: ARENA, transform: [{ translateY: float }] }]}>
      <Animated.View
        pointerEvents="none"
        style={[st.halo, { width: ARENA, height: ARENA, borderRadius: ARENA / 2, opacity: halo }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          st.ping,
          { width: ARENA, height: ARENA, borderRadius: ARENA / 2, opacity: ringFade, transform: [{ scale: ringScale }] },
        ]}
      />

      <In scale={0.72}>
        <Glass style={{ width: ARENA - 56, height: ARENA - 56 }} radius={(ARENA - 56) / 2} lit>
          <View style={st.sceneInner}>{page.scene(Math.round(ARENA * 0.52))}</View>
        </Glass>
      </In>

      {/* the platforms, riding the rim */}
      <Animated.View
        pointerEvents="none"
        style={[st.orbit, { width: ARENA, height: ARENA, transform: [{ rotate: turn }] }]}
      >
        {page.marks.map((m, i) => {
          const angle = (i / page.marks.length) * 2 * Math.PI - Math.PI / 2;
          return (
            <View
              key={m}
              style={[
                st.chipSlot,
                {
                  left: ARENA / 2 + ORBIT * Math.cos(angle) - 21,
                  top: ARENA / 2 + ORBIT * Math.sin(angle) - 21,
                },
              ]}
            >
              <Animated.View style={{ transform: [{ rotate: unturn }] }}>
                <In delay={360 + i * 130} y={0} scale={0.3}>
                  <Glass style={st.chip} radius={21}>
                    <View style={st.chipInner}>{MARK[m](20)}</View>
                  </Glass>
                </In>
              </Animated.View>
            </View>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

/** One page: the picture and the words drift at different speeds as you swipe. */
function Page({
  p,
  i,
  live,
  scrollX,
  talking,
  onReplay,
}: {
  p: (typeof PAGES)[number];
  i: number;
  live: boolean;
  scrollX: Animated.Value;
  talking: boolean;
  onReplay: () => void;
}) {
  const range = [(i - 1) * W, i * W, (i + 1) * W];
  const picShift = scrollX.interpolate({ inputRange: range, outputRange: [W * 0.22, 0, -W * 0.22], extrapolate: 'clamp' });
  const textShift = scrollX.interpolate({ inputRange: range, outputRange: [W * 0.55, 0, -W * 0.55], extrapolate: 'clamp' });
  const fade = scrollX.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' });

  return (
    <View style={[st.page, { width: W, height: PAGE_H }]}>
      <Animated.View style={{ opacity: fade, transform: [{ translateX: picShift }] }}>
        {/* keyed on `live`, so the scene arrives again every time you land here */}
        <Stage key={`${p.key}-${live ? 'on' : 'off'}`} page={p} />
      </Animated.View>

      <Animated.View style={[st.words, { opacity: fade, transform: [{ translateX: textShift }] }]}>
        <View key={live ? 'live' : 'idle'} style={{ alignItems: 'center' }}>
          <In delay={160}>
            <Text style={st.title}>
              {p.title.map((part, k) => (
                <Text key={k} style={part.hot ? st.hot : undefined}>
                  {part.t}
                </Text>
              ))}
            </Text>
          </In>
          <In delay={280}>
            <Text style={st.line}>{p.line}</Text>
          </In>
          <In delay={400}>
            <Pressable onPress={onReplay} style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
              <Glass style={st.sayPill} radius={R.pill} lit={talking}>
                <View style={st.sayInner}>
                  <Waveform live={talking} height={18} />
                  <Text style={st.sayText}>{talking ? 'Vexa is speaking…' : 'Hear it again'}</Text>
                </View>
              </Glass>
            </Pressable>
          </In>
        </View>
      </Animated.View>
    </View>
  );
}

/** The page dot that stretches when it is yours. */
function Dot({ on }: { on: boolean }) {
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(t, { toValue: on ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [on, t]);

  const width = t.interpolate({ inputRange: [0, 1], outputRange: [7, 24] });
  const backgroundColor = t.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.22)', C.lime] });

  return <Animated.View style={[st.dot, { width, backgroundColor }]} />;
}

export default function StoryScreen({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const [talking, setTalking] = useState(false);
  const scroller = useRef<ScrollView | null>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);

  // She introduces each job as you reach it.
  const say = (i: number) => {
    hush();
    setTalking(true);
    speak(PAGES[i].said, () => setTalking(false));
  };

  useEffect(() => {
    const t = setTimeout(() => !gone.current && say(page), 420);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(
    () => () => {
      gone.current = true;
      hush();
    },
    [],
  );

  const leave = () => {
    gone.current = true;
    hush();
    onDone();
  };

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
    listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / W);
      if (i !== page) setPage(i);
    },
  });

  const next = () => {
    if (page >= PAGES.length - 1) return leave();
    scroller.current?.scrollTo({ x: (page + 1) * W, animated: true });
  };

  const last = page === PAGES.length - 1;

  return (
    <View style={st.root}>
      <Backdrop />
      <Image source={FIGURE} style={st.watermark} resizeMode="contain" />

      {/* Her mark on the left, Skip facing it on the right — straight above
          the Get started button at the other end of the screen. */}
      <View style={st.topRow}>
        <View style={st.her}>
          <Avatar size={30} />
          <Text style={st.herName}>VEXA</Text>
        </View>

        <Pressable onPress={leave} hitSlop={10} style={({ pressed }) => [st.skip, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Text style={st.skipText}>Skip</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={(r) => {
          scroller.current = r as unknown as ScrollView | null;
        }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={st.pager}
      >
        {PAGES.map((p, i) => (
          <Page
            key={p.key}
            p={p}
            i={i}
            live={page === i}
            scrollX={scrollX}
            talking={talking && page === i}
            onReplay={() => say(i)}
          />
        ))}
      </Animated.ScrollView>

      <View style={st.footer}>
        <View style={st.dots}>
          {PAGES.map((p, i) => (
            <Dot key={p.key} on={i === page} />
          ))}
        </View>

        <Pressable onPress={next} style={({ pressed }) => [st.cta, pressed && { transform: [{ scale: 0.96 }] }]}>
          <Text style={st.ctaText}>{last ? 'Get started' : 'Next'}</Text>
          <ChevronRight size={18} color="#0A1206" />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  watermark: { position: 'absolute', right: -94, bottom: -50, width: 320, height: 320, opacity: 0.08 },

  topRow: {
    paddingTop: TOP_INSET,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  her: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  herName: { color: C.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.5 },

  pager: { flex: 1 },
  page: { paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },

  stage: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', backgroundColor: 'rgba(195,255,55,0.13)' },
  ping: { position: 'absolute', borderWidth: 1.3, borderColor: C.lime },
  sceneInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  orbit: { position: 'absolute', left: 0, top: 0 },
  chipSlot: { position: 'absolute', width: 42, height: 42 },
  chip: { width: 42, height: 42 },
  chipInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  words: { alignItems: 'center', marginTop: 30 },
  title: { color: C.text, fontSize: 24, fontWeight: '900', textAlign: 'center', lineHeight: 31, maxWidth: 330 },
  hot: { color: C.lime },
  line: { color: C.textDim, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 11, maxWidth: 300 },

  sayPill: { alignSelf: 'center', marginTop: 18 },
  sayInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, paddingVertical: 9 },
  sayText: { color: C.text, fontSize: 12, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 10,
    gap: 12,
  },
  skip: {
    borderRadius: R.pill,
    borderWidth: 1.3,
    borderColor: 'rgba(195,255,55,0.55)',
    backgroundColor: 'rgba(195,255,55,0.12)',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  skipText: { color: C.lime, fontSize: 13.5, fontWeight: '800' },

  dots: { flexDirection: 'row', gap: 7, flex: 1 },
  dot: { height: 7, borderRadius: 4 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.lime,
    borderRadius: R.pill,
    paddingLeft: 22,
    paddingRight: 16,
    paddingVertical: 14,
  },
  ctaText: { color: '#0A1206', fontSize: 15, fontWeight: '800' },
});
