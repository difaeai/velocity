import React, { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useEnter } from '../anim';
import Glass from '../components/Glass';
import {
  BulbIcon,
  ChevronRight,
  CopyIcon,
  DocIcon,
  PencilIcon,
  SearchIcon,
  SparkleIcon,
  TrashIcon,
} from '../components/Icons';
import {
  Bars,
  Btn,
  Chips,
  Confirm,
  Empty,
  ErrorNote,
  Field,
  IconBtn,
  Lede,
  LoadingBar,
  Page,
  Ring,
  Row,
  SectionTitle,
  Sheet,
  SkeletonList,
  SlowNote,
  Stat,
  Steps,
  Stagger,
  Tag,
  useToast,
} from '../components/kit';
import { useLoad, useSteps } from '../net';
import { commit, db, uid, useDb, type Report } from '../store';
import { C, R } from '../theme';

const IDEAS = ['What my competitors posted this week', 'Best posting times for Lahore', 'Why my reach dropped', 'What my customers complain about'];

const JOB = [
  'Reading competitor pages',
  'Collecting comments and replies',
  'Comparing prices and offers',
  'Writing your brief',
];

const FOUND: Record<string, Array<{ head: string; body: string }>> = {
  default: [
    { head: 'Short video is winning this week', body: 'Reels under 15 seconds got 3× the saves of anything longer. Two of your rivals stopped posting photos entirely.' },
    { head: 'Your price is in the middle', body: 'Two sell cheaper and look it. One sells dearer with better photographs. There is room for you to raise prices 8% with better pictures.' },
    { head: 'Nobody replies to comments', body: 'The average reply in your trade takes 14 hours. Answering in under one would make you the fastest in Lahore.' },
  ],
};

export default function ResearchAgent() {
  const data = useDb();
  const load = useLoad(900);
  const [toast, say] = useToast();

  const [topic, setTopic] = useState('');
  const [open, setOpen] = useState<Report | null>(null);
  const [rename, setRename] = useState<Report | null>(null);
  const [name, setName] = useState('');
  const [kill, setKill] = useState<Report | null>(null);
  const job = useSteps(JOB, 950);

  const head = useEnter(40, { y: 14 });

  const run = () => {
    const asked = topic.trim() || IDEAS[0];
    job.start(() => {
      const made: Report = {
        id: uid(),
        topic: asked,
        at: 'Just now',
        sources: 18 + Math.floor(Math.random() * 20),
        findings: FOUND.default,
      };
      data.reports.unshift(made);
      commit();
      job.reset();
      setTopic('');
      say('Brief ready — 3 findings');
      setOpen(made);
    });
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Vexa reads your market every morning: what rivals post, what customers ask, what it costs. Ask her anything and she comes back with a brief." />

        <SlowNote visible={load.slow} />
        {load.failed ? <ErrorNote onRetry={load.retry} /> : null}

        <Animated.View style={head}>
          <Glass style={st.ask} radius={R.xl} lit>
            <View style={st.askInner}>
              <View style={st.askHead}>
                <SearchIcon size={19} />
                <Text style={st.askTitle}>Ask Vexa to look into something</Text>
              </View>

              {job.running ? (
                <View style={st.job}>
                  <Ring pct={(job.at + 1) / (JOB.length + 1)} size={74} label={`${Math.round(((job.at + 1) / (JOB.length + 1)) * 100)}%`} />
                  <View style={{ flex: 1 }}>
                    <Steps steps={JOB} at={job.at} />
                  </View>
                </View>
              ) : (
                <>
                  <Field
                    value={topic}
                    onChangeText={setTopic}
                    placeholder="e.g. who is undercutting me in Lahore?"
                    multiline
                    lines={2}
                    style={{ marginTop: 10, marginBottom: 8 }}
                  />
                  <Chips items={IDEAS} on={topic ? [topic] : []} onToggle={(v) => setTopic(v === topic ? '' : v)} />
                  <Btn label="Start research" icon={<SparkleIcon size={17} color="#0A1206" />} onPress={run} full style={{ marginTop: 12 }} />
                </>
              )}
            </View>
          </Glass>
        </Animated.View>

        <SectionTitle text="THIS WEEK IN YOUR MARKET" />
        {load.loading ? (
          <SkeletonList rows={1} />
        ) : (
          <Stagger>
            <Glass style={st.watch} radius={R.lg}>
              <View style={st.watchInner}>
                <View style={st.statRow}>
                  <Stat label="Rival posts" value={126} delta="+18 vs last week" index={0} />
                  <Stat label="Avg discount" value={22} suffix="%" index={1} />
                  <Stat label="Your share of voice" value={14} suffix="%" index={2} />
                </View>
                <Text style={st.watchNote}>Posts your four closest rivals put out, day by day</Text>
                <Bars data={[14, 18, 11, 22, 26, 19, 16]} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} />
              </View>
            </Glass>
          </Stagger>
        )}

        <SectionTitle text="SAVED BRIEFS" right={<Tag text={`${data.reports.length}`} tone="lime" />} />

        {load.loading ? (
          <SkeletonList rows={2} />
        ) : data.reports.length === 0 ? (
          <Empty
            icon={<DocIcon size={24} />}
            title="No briefs yet"
            line="Ask Vexa something above and the answer is saved here."
            cta="Research competitors"
            onCta={() => setTopic(IDEAS[0])}
          />
        ) : (
          data.reports.map((r, i) => (
            <Row
              key={r.id}
              index={i}
              icon={<BulbIcon size={20} />}
              label={r.topic}
              sub={`${r.at} · ${r.sources} sources · ${r.findings.length} findings`}
              right={<ChevronRight size={18} />}
              onPress={() => setOpen(r)}
            />
          ))
        )}
      </Page>

      {/* read one brief, then rename / copy / delete it */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.topic ?? ''} full>
        {open ? (
          <View style={{ gap: 12 }}>
            <View style={st.sheetMeta}>
              <Tag text={`${open.sources} sources`} tone="green" />
              <Tag text={open.at} />
            </View>

            {open.findings.map((f, i) => (
              <Stagger key={f.head} index={i}>
                <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                  <View style={st.finding}>
                    <View style={st.findHead}>
                      <View style={st.findNo}>
                        <Text style={st.findNoText}>{i + 1}</Text>
                      </View>
                      <Text style={st.findTitle}>{f.head}</Text>
                    </View>
                    <Text style={st.findBody}>{f.body}</Text>
                  </View>
                </Glass>
              </Stagger>
            ))}

            <Btn
              label="Turn this into a content plan"
              icon={<SparkleIcon size={17} color="#0A1206" />}
              onPress={() => {
                setOpen(null);
                say('Sent to the Content Agent');
              }}
              full
            />

            <View style={st.sheetActions}>
              <IconBtn
                onPress={() => {
                  setRename(open);
                  setName(open.topic);
                }}
              >
                <PencilIcon size={17} />
              </IconBtn>
              <IconBtn onPress={() => say('Brief copied')}>
                <CopyIcon size={17} />
              </IconBtn>
              <IconBtn tone="bad" onPress={() => setKill(open)}>
                <TrashIcon size={17} />
              </IconBtn>
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* update */}
      <Sheet open={!!rename} onClose={() => setRename(null)} title="Rename brief">
        <Field label="TITLE" value={name} onChangeText={setName} placeholder="Brief title" />
        <Btn
          label="Save"
          onPress={() => {
            if (!rename) return;
            const row = data.reports.find((r) => r.id === rename.id);
            if (row) row.topic = name.trim() || row.topic;
            commit();
            setRename(null);
            setOpen(null);
            say('Renamed');
          }}
          full
        />
      </Sheet>

      {/* delete */}
      <Confirm
        open={!!kill}
        title="Delete this brief?"
        line="It goes for good. Vexa keeps what she learned from it."
        cta="Delete"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.reports = data.reports.filter((r) => r.id !== kill?.id);
          commit();
          setKill(null);
          setOpen(null);
          say('Brief deleted');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  ask: { alignSelf: 'stretch' },
  askInner: { padding: 16 },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  askTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  job: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },

  watch: { alignSelf: 'stretch' },
  watchInner: { padding: 14, gap: 12 },
  statRow: { flexDirection: 'row', gap: 8 },
  watchNote: { color: C.textDim, fontSize: 11.5 },

  sheetMeta: { flexDirection: 'row', gap: 8 },
  finding: { padding: 14, gap: 8 },
  findHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  findNo: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(195,255,55,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  findNoText: { color: C.lime, fontSize: 12, fontWeight: '900' },
  findTitle: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  findBody: { color: C.textDim, fontSize: 12.5, lineHeight: 18.5 },

  sheetActions: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 4 },
});
