import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Avatar from '../components/Avatar';
import Backdrop from '../components/Backdrop';
import Glass from '../components/Glass';
import { CheckIcon, ChevronRight, ClockIcon, PlayIcon } from '../components/Icons';
import { Bars, MarkRow, Ring, Stagger, Tag, Waveform } from '../components/kit';
import { hush, speak } from '../voice';
import { C, R, TOP_INSET } from '../theme';

const FIGURE = require('../../assets/vexa.png');

const W = Dimensions.get('window').width;
const PAGE_H = Dimensions.get('window').height - TOP_INSET - 150;

/** What she does, one job a page — and she says each one out loud. */
const PAGES = [
  {
    key: 'content',
    kicker: 'Content',
    title: 'I handle your\ncontent.',
    body: 'Reels, photos and stories, written in your voice and put out at the hour your customers are actually awake. Thirty days planned at a time.',
    said: 'I handle your content. I write your reels, photos and stories, and I post them when your customers are awake.',
  },
  {
    key: 'ads',
    kicker: 'Ads',
    title: 'I am your\nAd Expert.',
    body: 'Facebook, Instagram and Google. I build the campaign, choose who sees it, and never spend one rupee past the daily budget you set.',
    said: 'I am your Ad Expert. I run your Facebook, Instagram and Google ads, and I never spend past the budget you set.',
  },
  {
    key: 'sales',
    kicker: 'Sales',
    title: 'I manage\nyour sales.',
    body: 'Every enquiry answered in minutes, followed up until it becomes an order, and handed to you the moment it needs a human.',
    said: 'And I manage your sales. I answer every customer in minutes and follow up until the order is yours.',
  },
];

/** A little mock of the work, so the words have something to point at. */
function Demo({ which }: { which: string }) {
  if (which === 'content') {
    return (
      <View style={st.demo}>
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
            <View style={st.postCard}>
              <View style={st.thumb}>
                <PlayIcon size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.postTitle}>Winter drop teaser</Text>
                <View style={st.postMeta}>
                  <ClockIcon size={13} color={C.textDim} />
                  <Text style={st.postMetaText}>Today · 19:30</Text>
                  <MarkRow list={['instagram', 'tiktok']} size={13} />
                </View>
              </View>
              <Tag text="Scheduled" tone="lime" />
            </View>
          </Glass>
        </Stagger>

        <Stagger index={1}>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
            <View style={st.weekCard}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <View key={i} style={st.dayCell}>
                  <Text style={st.dayName}>{d}</Text>
                  <View style={[st.dayDisc, i < 5 && st.dayDiscOn]}>
                    {i < 5 ? <CheckIcon size={12} color="#0A1206" /> : null}
                  </View>
                </View>
              ))}
            </View>
          </Glass>
        </Stagger>

        <Stagger index={2}>
          <Text style={st.caption}>“The winter drop lands Friday. Three shirts, one coat, nothing repeated.”</Text>
        </Stagger>
      </View>
    );
  }

  if (which === 'ads') {
    return (
      <View style={st.demo}>
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
            <View style={st.adCard}>
              <Ring pct={0.91} size={86} label="91%" sub="of today" />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={st.adLabel}>SPENT TODAY</Text>
                <Text style={st.adValue}>PKR 912</Text>
                <Text style={st.adSub}>Daily budget PKR 999 — she stops there</Text>
                <MarkRow list={['facebook', 'instagram', 'google']} size={16} />
              </View>
            </View>
          </Glass>
        </Stagger>

        <Stagger index={1}>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
            <View style={st.barCard}>
              <Text style={st.barTitle}>Leads this week</Text>
              <Bars data={[4, 7, 6, 9, 12, 8, 15]} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} height={66} />
            </View>
          </Glass>
        </Stagger>
      </View>
    );
  }

  return (
    <View style={st.demo}>
      <Stagger>
        <View style={st.bubbleRow}>
          <Glass style={st.bubble} radius={16}>
            <View style={st.bubbleInner}>
              <Text style={st.bubbleText}>Is the navy shirt available in large?</Text>
              <Text style={st.bubbleAt}>12 min ago</Text>
            </View>
          </Glass>
        </View>
      </Stagger>

      <Stagger index={1}>
        <View style={[st.bubbleRow, { justifyContent: 'flex-end' }]}>
          <Glass style={st.bubble} radius={16} lit>
            <View style={st.bubbleInner}>
              <Text style={st.bubbleText}>It is — large is in stock. Shall I hold one for you?</Text>
              <Text style={st.bubbleAt}>Vexa · 10 min ago</Text>
            </View>
          </Glass>
          <Avatar size={28} online={false} />
        </View>
      </Stagger>

      <Stagger index={2}>
        <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
          <View style={st.wonCard}>
            <View style={st.wonMark}>
              <CheckIcon size={18} color="#0A1206" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.wonTitle}>Ayesha Khan — order placed</Text>
              <Text style={st.wonSub}>PKR 12,000 · answered, followed up, closed</Text>
            </View>
            <Tag text="Won" tone="green" />
          </View>
        </Glass>
      </Stagger>
    </View>
  );
}

export default function StoryScreen({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const [talking, setTalking] = useState(false);
  const scroller = useRef<ScrollView>(null);
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

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / W);
    if (i !== page) setPage(i);
  };

  const next = () => {
    if (page >= PAGES.length - 1) return leave();
    scroller.current?.scrollTo({ x: (page + 1) * W, animated: true });
  };

  const last = page === PAGES.length - 1;

  return (
    <View style={st.root}>
      <Backdrop />
      <Image source={FIGURE} style={st.watermark} resizeMode="contain" />

      <View style={st.skipRow}>
        <View style={st.her}>
          <Avatar size={30} />
          <Text style={st.herName}>VEXA</Text>
        </View>
        <Glass style={st.skip} radius={R.pill} onPress={leave}>
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
        {PAGES.map((p, i) => (
          <View key={p.key} style={[st.page, { width: W, height: PAGE_H }]}>
            {/* each page is mounted from the start; the mock animates in anyway */}
            <Demo which={p.key} />

            <View style={st.kicker}>
              <Text style={st.kickerText}>{p.kicker.toUpperCase()}</Text>
            </View>
            <Text style={st.title}>{p.title}</Text>
            <Text style={st.body}>{p.body}</Text>

            <Pressable onPress={() => say(i)} style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
              <Glass style={st.sayPill} radius={R.pill} lit={talking && page === i}>
                <View style={st.sayInner}>
                  <Waveform live={talking && page === i} height={20} />
                  <Text style={st.sayText}>
                    {talking && page === i ? 'Vexa is speaking…' : 'Tap to hear her again'}
                  </Text>
                </View>
              </Glass>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <View style={st.footer}>
        <View style={st.dots}>
          {PAGES.map((p, i) => (
            <View key={p.key} style={[st.dot, i === page && st.dotOn]} />
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

  skipRow: {
    paddingTop: TOP_INSET,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  her: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  herName: { color: C.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.5 },
  skip: {},
  skipText: { color: C.text, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8 },

  pager: { flex: 1 },
  page: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4, justifyContent: 'center' },

  watermark: { position: 'absolute', right: -86, bottom: -40, width: 330, height: 330, opacity: 0.1 },

  demo: { gap: 10, marginBottom: 6 },

  postCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(120,255,140,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  postMetaText: { color: C.textDim, fontSize: 11.5, fontWeight: '600' },

  weekCard: { flexDirection: 'row', paddingVertical: 11, paddingHorizontal: 6 },
  dayCell: { flex: 1, alignItems: 'center', gap: 5 },
  dayName: { color: C.textDim, fontSize: 10.5, fontWeight: '800' },
  dayDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDiscOn: { backgroundColor: C.lime, borderColor: C.lime },

  caption: { color: C.textDim, fontSize: 12.5, fontStyle: 'italic', lineHeight: 18 },

  adCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  adLabel: { color: C.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  adValue: { color: C.text, fontSize: 21, fontWeight: '900' },
  adSub: { color: C.textDim, fontSize: 11.5 },
  barCard: { padding: 14, gap: 8 },
  barTitle: { color: C.text, fontSize: 13, fontWeight: '800' },

  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubble: { maxWidth: '84%' },
  bubbleInner: { paddingHorizontal: 13, paddingVertical: 10 },
  bubbleText: { color: C.text, fontSize: 13, lineHeight: 18 },
  bubbleAt: { color: C.textFaint, fontSize: 10, marginTop: 4 },

  wonCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  wonMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  wonTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  wonSub: { color: C.textDim, fontSize: 11.5, marginTop: 3 },

  kicker: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: 'rgba(195,255,55,0.4)',
    backgroundColor: 'rgba(120,255,120,0.08)',
  },
  kickerText: { color: C.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },

  title: { color: C.text, fontSize: 30, fontWeight: '900', lineHeight: 35, marginTop: 12 },
  body: { color: C.textDim, fontSize: 13.5, lineHeight: 20, marginTop: 10 },

  sayPill: { alignSelf: 'flex-start', marginTop: 14 },
  sayInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
  sayText: { color: C.text, fontSize: 12, fontWeight: '700' },

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
