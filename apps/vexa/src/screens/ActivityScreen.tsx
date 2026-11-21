import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { ActivityIcon, ChartUpIcon, DocPenIcon, MegaphoneIcon, RefreshIcon, SearchIcon, SparkleIcon } from '../components/Icons';
import {
  Btn,
  Chips,
  Empty,
  Lede,
  LoadingBar,
  Meter,
  Page,
  SectionTitle,
  SkeletonList,
  SlowNote,
  Stagger,
  Stat,
  Tag,
  TypingDots,
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import { commit, uid, useDb, type Act, type Agent } from '../store';
import { C, R } from '../theme';

const AGENTS: Agent[] = ['Content', 'Sales', 'Ads', 'Research'];

const ICON: Record<Agent, React.ReactNode> = {
  Content: <DocPenIcon size={17} />,
  Sales: <ChartUpIcon size={17} />,
  Ads: <MegaphoneIcon size={17} />,
  Research: <SearchIcon size={17} />,
  Vexa: <SparkleIcon size={17} />,
};

const EARLIER: Act[] = [
  { id: uid(), agent: 'Ads', text: 'Moved PKR 400 from Facebook to Instagram — cheaper reach.', at: '16:20', day: 'Yesterday' },
  { id: uid(), agent: 'Content', text: 'Wrote three captions for the winter drop and kept the best.', at: '14:02', day: 'Yesterday' },
  { id: uid(), agent: 'Sales', text: 'Chased two enquiries that had gone quiet for a day.', at: '11:15', day: 'Yesterday' },
  { id: uid(), agent: 'Research', text: 'Found a rival cutting prices 25% in Karachi.', at: '09:40', day: 'Yesterday' },
];

export default function ActivityScreen() {
  const data = useDb();
  const load = useLoad(800);
  const more = useAction();
  const sync = useAction();
  const [toast, say] = useToast();

  const [only, setOnly] = useState<Agent | null>(null);
  const [loadedMore, setLoadedMore] = useState(false);

  const rows = data.acts.filter((a) => (only ? a.agent === only : true));
  const today = rows.filter((a) => a.day === 'Today');
  const yesterday = rows.filter((a) => a.day === 'Yesterday');

  const group = (label: string, list: Act[], from: number) =>
    list.length === 0 ? null : (
      <View>
        <SectionTitle text={label.toUpperCase()} right={<Tag text={`${list.length}`} tone="lime" />} />
        {list.map((a, i) => (
          <Stagger key={a.id} index={from + i} style={st.line}>
            <View style={st.rail}>
              <View style={st.railDot} />
              <View style={st.railLine} />
            </View>
            <Glass style={{ flex: 1 }} radius={R.md}>
              <View style={st.act}>
                <View style={st.actIcon}>{ICON[a.agent]}</View>
                <View style={{ flex: 1 }}>
                  <View style={st.actHead}>
                    <Text style={st.actAgent}>{a.agent} Agent</Text>
                    <Text style={st.actAt}>{a.at}</Text>
                  </View>
                  <Text style={st.actText}>{a.text}</Text>
                </View>
              </View>
            </Glass>
          </Stagger>
        ))}
      </View>
    );

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={26}>
        <Lede text="Everything Vexa did, newest first. Nothing happens on this account that is not on this list." />

        <SlowNote visible={load.slow} />

        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
            <View style={st.live}>
              <View style={st.liveIcon}>
                <ActivityIcon size={20} color={C.lime} />
              </View>
              <View style={{ flex: 1, gap: 7 }}>
                <View style={st.liveHead}>
                  <Text style={st.liveTitle}>Working now</Text>
                  <View style={st.liveDot} />
                </View>
                <Text style={st.liveText}>{'Writing tomorrow’s reel script and answering two comments.'}</Text>
                <TypingDots />
                <Meter pct={0.68} h={5} />
              </View>
            </View>
          </Glass>
        </Stagger>

        <View style={st.statRow}>
          <Stat label="Jobs today" value={data.acts.filter((a) => a.day === 'Today').length} index={0} />
          <Stat label="Answers sent" value={13} index={1} />
          <Stat label="Hours saved" value={6} index={2} />
        </View>

        <View style={{ marginTop: 14 }}>
          <Chips
            items={AGENTS}
            on={only ? [only] : []}
            onToggle={(v) => setOnly(v === only ? null : (v as Agent))}
            icons={Object.fromEntries(AGENTS.map((a) => [a, ICON[a]]))}
          />
        </View>

        {load.loading ? (
          <View style={{ marginTop: 16 }}>
            <SkeletonList rows={4} />
          </View>
        ) : rows.length === 0 ? (
          <Empty
            icon={<ActivityIcon size={24} color={C.lime} />}
            title="Nothing from this agent yet"
            line="Clear the filter to see everything Vexa has done."
            cta="Show everything"
            onCta={() => setOnly(null)}
          />
        ) : (
          <>
            {group('Today', today, 0)}
            {group(loadedMore ? 'Yesterday' : 'Earlier', yesterday, today.length)}

            {!loadedMore ? (
              <Btn
                label={more.busy ? 'Loading…' : 'Load earlier'}
                kind="ghost"
                busy={more.busy}
                onPress={() =>
                  more.run(1400, () => {
                    data.acts.push(...EARLIER);
                    commit();
                    setLoadedMore(true);
                    say('Four more jobs loaded');
                  })
                }
                full
                style={{ marginTop: 14 }}
              />
            ) : (
              <Text style={st.end}>That is everything Vexa keeps on the phone.</Text>
            )}
            {more.slow ? <SlowNote visible line="Slow connection — still loading the older jobs" /> : null}

            <Btn
              label={sync.busy ? 'Refreshing…' : 'Refresh'}
              icon={<RefreshIcon size={16} />}
              kind="ghost"
              busy={sync.busy}
              onPress={() => sync.run(1200, () => say('Up to date'))}
              full
              style={{ marginTop: 10 }}
            />
          </>
        )}
      </Page>

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, padding: 16 },
  liveIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(195,255,55,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.lime },
  liveText: { color: C.textDim, fontSize: 12, lineHeight: 17 },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },

  line: { flexDirection: 'row', gap: 11, marginBottom: 9 },
  rail: { width: 14, alignItems: 'center', paddingTop: 16 },
  railDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.lime },
  railLine: { flex: 1, width: 1.5, backgroundColor: 'rgba(195,255,55,0.22)', marginTop: 3 },

  act: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 },
  actIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actAgent: { color: C.lime, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },
  actAt: { color: C.textFaint, fontSize: 10.5, fontWeight: '700' },
  actText: { color: C.text, fontSize: 12.5, lineHeight: 17.5, marginTop: 3 },

  end: { color: C.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 14 },
});
