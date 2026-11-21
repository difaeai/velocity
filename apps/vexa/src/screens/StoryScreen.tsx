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
import { GoogleMark, InstagramMark, MetaMark, TiktokMark } from '../components/BrandMarks';
import Glass from '../components/Glass';
import { ChartUpIcon, ChevronRight, DocPenIcon, MegaphoneIcon } from '../components/Icons';
import { Waveform } from '../components/kit';
import { hush, speak } from '../voice';
import { C, R, TOP_INSET } from '../theme';

const FIGURE = require('../../assets/vexa.png');

const W = Dimensions.get('window').width;
const PAGE_H = Dimensions.get('window').height - TOP_INSET - 150;

/**
 * Three pages, one job each. One picture, one line, her voice — nothing on
 * these screens to read or work out.
 */
const PAGES = [
  {
    key: 'content',
    title: 'I post for you.',
    line: 'Reels, photos and stories — written and put out on time.',
    icon: (size: number) => <DocPenIcon size={size} />,
    marks: ['instagram', 'tiktok'] as const,
    said: 'I handle your content. I write your reels, photos and stories, and I post them when your customers are awake.',
  },
  {
    key: 'ads',
    title: 'I run your ads.',
    line: 'Facebook, Instagram and Google — inside your daily budget.',
    icon: (size: number) => <MegaphoneIcon size={size} />,
    marks: ['facebook', 'instagram', 'google'] as const,
    said: 'I am your Ad Expert. I run your Facebook, Instagram and Google ads, and I never spend past the budget you set.',
  },
  {
    key: 'sales',
    title: 'I sell for you.',
    line: 'Every customer answered, every order followed up.',
    icon: (size: number) => <ChartUpIcon size={size} />,
    marks: [] as const,
    said: 'And I manage your sales. I answer every customer in minutes and follow up until the order is yours.',
  },
];

const MARK: Record<string, (size: number) => React.ReactNode> = {
  instagram: (s) => <InstagramMark size={s} />,
  facebook: (s) => <MetaMark size={s} />,
  tiktok: (s) => <TiktokMark size={s} />,
  google: (s) => <GoogleMark size={s} />,
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

/** The one picture on the page: her icon, breathing, with a signal going out. */
function Medallion({ icon, marks }: { icon: (size: number) => React.ReactNode; marks: readonly string[] }) {
  const t = useLoop(2800);
  const ping = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ping, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [ping]);

  const float = t.interpolate({ inputRange: [0, 1], outputRange: [5, -7] });
  const glow = t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] });
  const ringScale = ping.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ringFade = ping.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] });

  return (
    <View style={st.medalWrap}>
      <Animated.View style={{ transform: [{ translateY: float }] }}>
        <Animated.View pointerEvents="none" style={[st.ping, { opacity: ringFade, transform: [{ scale: ringScale }] }]} />
        <Animated.View pointerEvents="none" style={[st.halo, { opacity: glow }]} />

        <In scale={0.7}>
          <Glass style={st.medal} radius={76} lit>
            <View style={st.medalInner}>{icon(52)}</View>
          </Glass>
        </In>
      </Animated.View>

      {marks.length ? (
        <View style={st.marks}>
          {marks.map((m, i) => (
            <In key={m} delay={420 + i * 130} y={0} scale={0.3}>
              <Glass style={st.markChip} radius={R.pill}>
                <View style={st.markInner}>{MARK[m](20)}</View>
              </Glass>
            </In>
          ))}
        </View>
      ) : (
        <View style={st.marks}>
          <In delay={420} y={0} scale={0.3}>
            <Glass style={st.markChip} radius={R.pill}>
              <View style={st.markInner}>
                <Avatar size={22} online={false} />
              </View>
            </Glass>
          </In>
        </View>
      )}
    </View>
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
  const picShift = scrollX.interpolate({ inputRange: range, outputRange: [W * 0.25, 0, -W * 0.25], extrapolate: 'clamp' });
  const textShift = scrollX.interpolate({ inputRange: range, outputRange: [W * 0.55, 0, -W * 0.55], extrapolate: 'clamp' });
  const fade = scrollX.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' });

  return (
    <View style={[st.page, { width: W, height: PAGE_H }]}>
      <Animated.View style={{ opacity: fade, transform: [{ translateX: picShift }] }}>
        {/* keyed on `live`, so the picture arrives again every time you land here */}
        <Medallion key={`${p.key}-${live ? 'on' : 'off'}`} icon={p.icon} marks={p.marks} />
      </Animated.View>

      <Animated.View style={[st.words, { opacity: fade, transform: [{ translateX: textShift }] }]}>
        <View key={live ? 'live' : 'idle'} style={{ alignItems: 'center' }}>
          <In delay={160}>
            <Text style={st.title}>{p.title}</Text>
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

      {/* Only her mark up here. Skip sits by the dots, clear of whatever the
          phone (or a dev build) floats into the top corner. */}
      <View style={st.topRow}>
        <Avatar size={30} />
        <Text style={st.herName}>VEXA</Text>
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
        <Pressable onPress={leave} hitSlop={10} style={({ pressed }) => [st.skip, pressed && { opacity: 0.6 }]}>
          <Text style={st.skipText}>Skip</Text>
        </Pressable>

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
  watermark: { position: 'absolute', right: -90, bottom: -46, width: 320, height: 320, opacity: 0.09 },

  topRow: { paddingTop: TOP_INSET, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 9 },
  herName: { color: C.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.5 },

  pager: { flex: 1 },
  page: { paddingHorizontal: 26, justifyContent: 'center', alignItems: 'center' },

  medalWrap: { alignItems: 'center', justifyContent: 'center' },
  medal: { width: 152, height: 152 },
  medalInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    left: -14,
    top: -14,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(195,255,55,0.16)',
  },
  ping: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 152,
    height: 152,
    borderRadius: 76,
    borderWidth: 1.4,
    borderColor: C.lime,
  },

  marks: { flexDirection: 'row', gap: 10, marginTop: 22 },
  markChip: {},
  markInner: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  words: { alignItems: 'center', marginTop: 34 },
  title: { color: C.text, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  line: { color: C.textDim, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 12, maxWidth: 300 },

  sayPill: { alignSelf: 'center', marginTop: 20 },
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
  skip: { paddingVertical: 10, paddingRight: 6 },
  skipText: { color: C.textDim, fontSize: 13.5, fontWeight: '700' },

  dots: { flexDirection: 'row', gap: 7, flex: 1, justifyContent: 'center' },
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
