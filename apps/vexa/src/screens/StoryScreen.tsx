import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Backdrop from '../components/Backdrop';
import Glass from '../components/Glass';
import { ChevronRight } from '../components/Icons';
import { C, R, TOP_INSET } from '../theme';

const W = Dimensions.get('window').width;
// Pages need a resolved height for the film to flex into the space left over.
const PAGE_H = Dimensions.get('window').height - TOP_INSET - 142;

/**
 * "The shop is closed. Your team isn't." — the site's film, told in three
 * screens with the same clips that play on the Vexa home page.
 */
const PAGES = [
  {
    kicker: 'After hours',
    title: 'The shop is closed.\nYour team isn’t.',
    body: 'Vexa plans thirty days of reels, posts and stories for your business and puts them out at your time — while the shutter is down.',
    film: require('../../assets/story1.mp4'),
  },
  {
    kicker: 'While you sleep',
    title: 'Your ads go out\nand find the buyers.',
    body: 'She runs your Facebook and Instagram ads inside the daily limit you set, keeps what works and stops what does not.',
    film: require('../../assets/story2.mp4'),
  },
  {
    kicker: 'By morning',
    title: 'The order is\nalready on its way.',
    body: 'Comments answered, leads written to, replies drafted. You open the shop to orders, not to a to-do list.',
    film: require('../../assets/story3.mp4'),
  },
];

function Film({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // No blur pane around the film: on the web a backdrop filter over a video
  // layer smears the video itself, so this frame is border and tint only.
  return (
    <View style={st.filmFrame}>
      <VideoView player={player} style={st.film} contentFit="cover" nativeControls={false} />
    </View>
  );
}

export default function StoryScreen({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / W);
    if (i !== page) setPage(i);
  };

  const next = () => {
    if (page >= PAGES.length - 1) return onDone();
    scroller.current?.scrollTo({ x: (page + 1) * W, animated: true });
  };

  const last = page === PAGES.length - 1;

  return (
    <View style={st.root}>
      <Backdrop />

      <View style={st.skipRow}>
        <Glass style={st.skip} radius={R.pill} onPress={onDone}>
          <Text style={st.skipText}>Skip</Text>
        </Glass>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={st.pager}
      >
        {PAGES.map((p) => (
          <View key={p.kicker} style={[st.page, { width: W, height: PAGE_H }]}>
            <Film source={p.film} />
            <View style={st.kicker}>
              <Text style={st.kickerText}>{p.kicker}</Text>
            </View>
            <Text style={st.title}>{p.title}</Text>
            <Text style={st.body}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={st.footer}>
        <View style={st.dots}>
          {PAGES.map((p, i) => (
            <View key={p.kicker} style={[st.dot, i === page && st.dotOn]} />
          ))}
        </View>

        <Pressable onPress={next} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}>
          <Text style={st.ctaText}>{last ? 'Get started' : 'Next'}</Text>
          <ChevronRight size={18} color="#0A1206" />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  skipRow: { paddingTop: TOP_INSET, paddingHorizontal: 16, alignItems: 'flex-end' },
  skip: { alignSelf: 'flex-end' },
  skipText: { color: C.text, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8 },

  pager: { flex: 1 },
  page: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },

  filmFrame: {
    flex: 1,
    minHeight: 300,
    maxHeight: 470,
    padding: 6,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  film: { flex: 1, borderRadius: R.lg, backgroundColor: '#05100A' },

  kicker: {
    alignSelf: 'flex-start',
    marginTop: 22,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: 'rgba(195,255,55,0.4)',
    backgroundColor: 'rgba(120,255,120,0.08)',
  },
  kickerText: { color: C.lime, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },

  title: { color: C.text, fontSize: 28, fontWeight: '900', lineHeight: 34, marginTop: 14 },
  body: { color: C.textDim, fontSize: 14, lineHeight: 21, marginTop: 12 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 10,
  },
  dots: { flexDirection: 'row', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { width: 22, backgroundColor: C.lime },

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
