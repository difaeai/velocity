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
import {
  DAY,
  TEAM,
  clockOf,
  dayBucket,
  prettyDay,
  sameDay,
  spentSince,
  todayProgress,
  useDb,
  type Act,
  type Agent,
} from '../store';
import { C, R } from '../theme';

const AGENTS: Agent[] = ['Content', 'Sales', 'Ads', 'Research'];

const ICON: Record<Agent, React.ReactNode> = {
  Content: <DocPenIcon size={17} />,
  Sales: <ChartUpIcon size={17} />,
  Ads: <MegaphoneIcon size={17} />,
  Research: <SearchIcon size={17} />,
  Vexa: <SparkleIcon size={17} />,
};

export default function ActivityScreen() {
  const data = useDb();
  const load = useLoad(800);
  const more = useAction();
  const sync = useAction();
  const [toast, say] = useToast();

  const [only, setOnly] = useState<Agent | null>(null);
  const [back, setBack] = useState(2); // how many days back the list goes

  const rows = data.acts
    .filter((a) => (only ? a.agent === only : true))
    .filter((a) => a.at >= Date.now() - back * DAY)
    .slice()
    .sort((a, b) => b.at - a.at);

  const older = data.acts.filter((a) => a.at < Date.now() - back * DAY).length;

  /** The list, cut into the days it happened on. */
  const groups: Array<{ label: string; items: Act[] }> = [];
  rows.forEach((a) => {
    const label = dayBucket(a.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(a);
    else groups.push({ label, items: [a] });
  });

  // Every number here is counted, not written down.
  const jobsToday = data.acts.filter((a) => sameDay(a.at, Date.now())).length;
  const answersToday = data.leads.reduce(
    (n, l) => n + l.thread.filter((m) => m.from === 'us' && sameDay(m.at, Date.now())).length,
    0,
  );
  const creditsToday = spentSince(DAY);
  const progress = todayProgress();

  // What she is on right now: the next thing due, and what is waiting on her.
  // the soonest piece that has not gone out yet
  const stamp = (p: { day: string; time: string }) => new Date(`${p.day}T${p.time}:00`).getTime();
  const next = data.posts
    .filter((p) => (p.status === 'scheduled' || p.status === 'approve') && stamp(p) >= Date.now())
    .sort((a, b) => stamp(a) - stamp(b))[0];
  const waiting = data.leads.filter((l) => l.stage === 'new').length;
  const workingLine = next
    ? `Finishing “${next.title}” for ${prettyDay(next.day).toLowerCase()} at ${next.time}` +
      (waiting ? `, and ${waiting} ${waiting === 1 ? 'enquiry is' : 'enquiries are'} waiting on her.` : '.')
    : waiting
      ? `Answering ${waiting} ${waiting === 1 ? 'enquiry' : 'enquiries'} that came in.`
      : 'Nothing in hand — she is watching your accounts.';

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
                <Text style={st.liveText}>{workingLine}</Text>
                <TypingDots />
                <Meter pct={progress.pct} h={5} />
                <Text style={st.liveSub}>
                  {progress.done} done today · {progress.waiting} waiting on you
                </Text>
              </View>
            </View>
          </Glass>
        </Stagger>

        <View style={st.statRow}>
          <Stat label="Jobs today" value={jobsToday} index={0} />
          <Stat label="Answers sent" value={answersToday} index={1} />
          <Stat label="Credits today" value={creditsToday} index={2} />
        </View>

        <View style={{ marginTop: 14 }}>
          <Chips
            items={AGENTS.map((a) => TEAM[a])}
            on={only ? [TEAM[only]] : []}
            onToggle={(label) => {
              const k = AGENTS.find((a) => TEAM[a] === label) ?? null;
              setOnly(k === only ? null : k);
            }}
            icons={Object.fromEntries(AGENTS.map((a) => [TEAM[a], ICON[a]]))}
          />
        </View>

        {load.loading ? (
          <View style={{ marginTop: 16 }}>
            <SkeletonList rows={4} />
          </View>
        ) : rows.length === 0 ? (
          <Empty
            icon={<ActivityIcon size={24} color={C.lime} />}
            title={only ? `Nothing from the ${TEAM[only]} yet` : 'Nothing yet today'}
            line="Clear the filter to see everything Vexa has done."
            cta="Show everything"
            onCta={() => {
              setOnly(null);
              setBack(30);
            }}
          />
        ) : (
          <>
            {groups.map((g, gi) => (
              <View key={g.label}>
                <SectionTitle text={g.label.toUpperCase()} right={<Tag text={`${g.items.length}`} tone="lime" />} />
                {g.items.map((a, i) => (
                  <Stagger key={a.id} index={gi * 2 + i} style={st.line}>
                    <View style={st.rail}>
                      <View style={st.railDot} />
                      <View style={st.railLine} />
                    </View>
                    <Glass style={{ flex: 1 }} radius={R.md}>
                      <View style={st.act}>
                        <View style={st.actIcon}>{ICON[a.agent]}</View>
                        <View style={{ flex: 1 }}>
                          <View style={st.actHead}>
                            <Text style={st.actAgent}>{TEAM[a.agent]}</Text>
                            <Text style={st.actAt}>{clockOf(a.at)}</Text>
                          </View>
                          <Text style={st.actText}>{a.text}</Text>
                        </View>
                      </View>
                    </Glass>
                  </Stagger>
                ))}
              </View>
            ))}

            {older ? (
              <Btn
                label={more.busy ? 'Loading…' : `Load ${older} earlier`}
                kind="ghost"
                busy={more.busy}
                onPress={() =>
                  more.run(1200, () => {
                    setBack((d) => d + 5);
                    say('Earlier jobs loaded');
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
  liveSub: { color: C.textFaint, fontSize: 10.5, fontWeight: '700' },

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
