import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Avatar from '../components/Avatar';
import Glass from '../components/Glass';
import { CheckIcon, SendIcon, SparkleIcon } from '../components/Icons';
import {
  Btn,
  Field,
  Lede,
  Meter,
  Page,
  SectionTitle,
  Sheet,
  Stagger,
  Tag,
  TypingDots,
  useToast,
} from '../components/kit';
import { useAction } from '../net';
import { commit, uid, useDb } from '../store';
import { C, R } from '../theme';

type Line = { from: 'me' | 'vexa'; text: string };

const PLAN = [
  { what: 'Three reels a week about how things are made', why: 'Short video is the only thing growing in your trade right now.' },
  { what: 'Answer every comment inside an hour', why: 'Nobody else in Lahore does. It is the cheapest edge you have.' },
  { what: 'PKR 999 a day on Instagram, Lahore only', why: 'Your cheapest reach, and the city that already buys.' },
  { what: 'A Friday evening post, every week', why: 'Your engagement is 2.3× the average in that slot.' },
];

export default function GoalPlan({ goal }: { goal?: string }) {
  const data = useDb();
  const think = useAction();
  const go = useAction();
  const [toast, say] = useToast();

  const asked = goal?.trim() || 'I want more orders from Instagram without spending more.';
  const [lines, setLines] = useState<Line[]>([{ from: 'me', text: asked }]);
  const [planned, setPlanned] = useState(false);
  const [on, setOn] = useState<number[]>([0, 1, 2, 3]);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  // She reads the goal once, then answers.
  useEffect(() => {
    think.run(1800, () => {
      setLines((l) => [...l, { from: 'vexa', text: 'Understood. Here is what I would do for the next four weeks.' }]);
      setPlanned(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flip = (i: number) => setOn((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]));

  return (
    <>
      <Page bottom={26}>
        <Lede text="You said what you want. This is how Vexa means to get there — change anything, then let her start." />

        {lines.map((l, i) => (
          <Stagger key={i} index={i} style={{ marginBottom: 10 }}>
            <View style={[st.row, l.from === 'me' && { justifyContent: 'flex-end' }]}>
              {l.from === 'vexa' ? <Avatar size={30} online={false} /> : null}
              <Glass style={st.bubble} radius={18} lit={l.from === 'me'}>
                <View style={st.bubbleInner}>
                  <Text style={st.bubbleText}>{l.text}</Text>
                </View>
              </Glass>
            </View>
          </Stagger>
        ))}

        {think.busy ? (
          <View style={st.row}>
            <Avatar size={30} online={false} />
            <Glass style={st.bubble} radius={18}>
              <View style={st.bubbleInner}>
                <TypingDots />
                <Text style={st.thinking}>Reading your accounts and last month{'’'}s numbers…</Text>
              </View>
            </Glass>
          </View>
        ) : null}

        {planned ? (
          <>
            <SectionTitle text="THE PLAN" right={<Tag text={`${on.length} of ${PLAN.length} on`} tone="lime" />} />

            {PLAN.map((p, i) => {
              const live = on.includes(i);
              return (
                <Stagger key={p.what} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={live} onPress={() => flip(i)}>
                    <View style={st.plan}>
                      <View style={[st.box, live && st.boxOn]}>{live ? <CheckIcon size={14} color="#0A1206" /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.planWhat}>{p.what}</Text>
                        <Text style={st.planWhy}>{p.why}</Text>
                      </View>
                    </View>
                  </Glass>
                </Stagger>
              );
            })}

            <Stagger>
              <Glass style={{ alignSelf: 'stretch', marginTop: 4 }} radius={R.lg}>
                <View style={st.cost}>
                  <Text style={st.costTitle}>What it costs you</Text>
                  <Text style={st.costLine}>
                    PKR {(999 * 30).toLocaleString('en-US')} a month in ads, about 420 credits a week of her time, and
                    ten minutes of yours.
                  </Text>
                  <Meter pct={0.42} h={6} />
                  <Text style={st.costNote}>42% of your monthly credits, at this plan.</Text>
                </View>
              </Glass>
            </Stagger>

            <Btn
              label={go.busy ? 'Setting it up…' : 'Let her start'}
              icon={<SparkleIcon size={17} color="#0A1206" />}
              busy={go.busy}
              onPress={() =>
                go.run(1900, () => {
                  on.forEach((i) =>
                    data.acts.unshift({
                      id: uid(),
                      agent: i === 2 ? 'Ads' : i === 1 ? 'Sales' : 'Content',
                      text: `Started: ${PLAN[i].what.toLowerCase()}.`,
                      at: 'Just now',
                      day: 'Today',
                    }),
                  );
                  commit();
                  setDone(true);
                  say('Vexa is on it');
                })
              }
              full
              style={{ marginTop: 14 }}
            />
            {go.slow ? <Text style={st.slow}>Slow connection — still setting it up.</Text> : null}

            <View style={st.composer}>
              <Glass style={{ flex: 1 }} radius={R.pill}>
                <View style={st.composerInner}>
                  <Field value={msg} onChangeText={setMsg} placeholder="Change something…" style={{ marginBottom: 0, flex: 1 }} />
                </View>
              </Glass>
              <Pressable
                style={({ pressed }) => [st.send, pressed && { opacity: 0.8 }]}
                onPress={() => {
                  if (!msg.trim()) return;
                  const said = msg.trim();
                  setLines((l) => [...l, { from: 'me', text: said }]);
                  setMsg('');
                  think.run(1500, () =>
                    setLines((l) => [
                      ...l,
                      { from: 'vexa', text: 'Noted. I have folded that into the plan above.' },
                    ]),
                  );
                }}
              >
                <SendIcon size={20} />
              </Pressable>
            </View>
          </>
        ) : null}
      </Page>

      <Sheet open={done} onClose={() => setDone(false)} title="She has started">
        <View style={{ gap: 12 }}>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
            <View style={st.doneCard}>
              <Avatar size={52} />
              <Text style={st.doneTitle}>First reel lands tonight at 19:30</Text>
              <Text style={st.doneLine}>
                Everything she does from here shows up on Activity. You get a message only when she needs you.
              </Text>
            </View>
          </Glass>
          <Btn label="Good" onPress={() => setDone(false)} full />
        </View>
      </Sheet>

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  bubble: { maxWidth: '84%' },
  bubbleInner: { paddingHorizontal: 14, paddingVertical: 11, gap: 6 },
  bubbleText: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  thinking: { color: C.textDim, fontSize: 11.5 },

  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.4,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: C.lime, borderColor: C.lime },
  planWhat: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  planWhy: { color: C.textDim, fontSize: 11.5, marginTop: 4, lineHeight: 16.5 },

  cost: { padding: 14, gap: 8 },
  costTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  costLine: { color: C.textDim, fontSize: 12, lineHeight: 17.5 },
  costNote: { color: C.green, fontSize: 11, fontWeight: '700' },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14 },
  composerInner: { paddingHorizontal: 8, paddingVertical: 2 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },

  doneCard: { padding: 20, alignItems: 'center', gap: 9 },
  doneTitle: { color: C.text, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  doneLine: { color: C.textDim, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  slow: { color: '#FFC24B', fontSize: 11.5, fontWeight: '700', marginTop: 10, textAlign: 'center' },
});
