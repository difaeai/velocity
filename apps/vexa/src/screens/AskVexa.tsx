import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Avatar from '../components/Avatar';
import Glass from '../components/Glass';
import {
  CheckIcon,
  ChevronRight,
  PencilIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  UsersIcon,
} from '../components/Icons';
import {
  Btn,
  Chips,
  Confirm,
  Field,
  IconBtn,
  Lede,
  MarkRow,
  Meter,
  Page,
  PlatformMark,
  Ring,
  SectionTitle,
  Sheet,
  Stagger,
  Steps,
  Tag,
  TypingDots,
  useToast,
} from '../components/kit';
import { useAction, useSteps } from '../net';
import { briefFor, draftMessage, findPeople, postsFor, read, type Mission } from '../intent';
import { CHANNEL_NAME, COST, commit, day, record, uid, useDb, type Channel, type Platform, type Prospect } from '../store';
import { C, R } from '../theme';

const WHO = ['Investors', 'Customers', 'Shops', 'Brands', 'Creators', 'Suppliers', 'People'];
const WHERE: Channel[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'gmail', 'whatsapp'];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Faisalabad', 'Multan', 'Dubai'];

const SEND_TO: Record<string, string> = {
  content: 'Content Team',
  ads: 'Ads Expert',
  research: 'Research Team',
};

export default function AskVexa({ goal, onOpen }: { goal?: string; onOpen?: (title: string) => void }) {
  const data = useDb();
  const think = useAction();
  const send = useAction();
  const [toast, say] = useToast();

  const asked = goal?.trim() || 'Find me investors on Instagram and email them.';
  const first = useMemo(() => read(asked), [asked]);

  const [m, setM] = useState<Mission>(first);
  const [understood, setUnderstood] = useState(false);
  const [edit, setEdit] = useState<null | 'who' | 'where' | 'count' | 'city'>(null);
  const [countText, setCountText] = useState(String(first.count));

  const [found, setFound] = useState<Prospect[] | null>(null);
  const [off, setOff] = useState<string[]>([]); // ids she should leave out
  const [draft, setDraft] = useState(draftMessage(first, data.me.business, data.me.trade, first.city));
  const [writing, setWriting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<{ sent: number; channels: Channel[] } | null>(null);

  const job = useSteps(m.steps, 1000);

  // She reads it once, then says what she understood.
  useEffect(() => {
    think.run(1500, () => setUnderstood(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof Mission>(k: K, v: Mission[K]) => setM((x) => ({ ...x, [k]: v }));

  const start = () => {
    job.start(() => {
      job.reset();
      if (m.kind === 'outreach') {
        const people = findPeople(m, Math.min(12, m.count)); // she shows the first dozen
        data.prospects.unshift(...people);
        record({
          agent: 'Sales',
          text: `Found ${people.length} ${m.who.toLowerCase()} in ${m.city} on ${m.channels.map((c) => CHANNEL_NAME[c]).join(' and ')}.`,
          credits: COST.search,
          what: `${m.who} search`,
        });
        setFound(people);
        setDraft(draftMessage(m, data.me.business, data.me.trade, m.city));
        say(`${m.count} ${m.who.toLowerCase()} found — ${people.length} worth your time`);
      } else if (m.kind === 'content' || m.kind === 'plan') {
        const made = postsFor(m, data.me.business, data.me.trade).map((p, i) => ({
          id: uid(),
          title: p.title,
          caption: p.caption,
          kind: p.kind,
          platforms: m.channels.filter((c) => c !== 'gmail' && c !== 'whatsapp') as Platform[],
          day: day(i + 1),
          time: '19:30',
          status: 'draft' as const,
          hashtags: [],
        }));
        data.posts.unshift(...made);
        record({
          agent: 'Content',
          text: `Wrote ${made.length} pieces for the days ahead, from what you asked.`,
          credits: COST.reel + 2 * COST.post,
          what: m.raw || 'Content from your ask',
        });
        setDone({ sent: 0, channels: m.channels });
        say(`${made.length} drafts in your calendar`);
      } else if (m.kind === 'ads') {
        const made = {
          id: uid(),
          name: `${m.who === 'People' ? data.me.trade : m.who} — ${m.city}`,
          goal: 'Sales' as const,
          status: 'draft' as const,
          platforms: m.channels.filter((c) => c !== 'gmail' && c !== 'whatsapp') as Platform[],
          budget: m.budget,
          city: m.city,
          age: '22 – 38',
          interests: ['Fashion', 'Shopping'],
          creative: data.posts[0]?.title ?? 'Your newest piece',
          spend: 0,
          reach: 0,
          leads: 0,
          roas: 0,
          days: [0, 0, 0, 0, 0, 0, 0],
        };
        data.campaigns.unshift(made);
        record({
          agent: 'Ads',
          text: `Built “${made.name}” as a draft at PKR ${made.budget.toLocaleString('en-US')} a day — it waits for your word.`,
          credits: COST.campaign,
          what: made.name,
        });
        setDone({ sent: 0, channels: m.channels });
        say('Campaign drafted — open Ads Expert to launch it');
      } else {
        const b = briefFor(m);
        data.reports.unshift({ id: uid(), topic: m.raw || m.understood, at: Date.now(), sources: b.sources, findings: b.findings });
        record({
          agent: 'Research',
          text: `Read ${b.sources} sources and wrote a brief on “${m.raw || m.understood}”.`,
          credits: COST.brief,
          what: m.raw || 'Research',
          notice: { title: 'Your brief is ready', line: `${b.sources} sources read, ${b.findings.length} findings.` },
        });
        setDone({ sent: 0, channels: m.channels });
        say('Brief ready in the Research Team');
      }
    });
  };

  const keep = (found ?? []).filter((p) => !off.includes(p.id));

  const reallySend = () => {
    send.run(2100, () => {
      const kept = new Set(keep.map((p) => p.id));
      (found ?? []).forEach((p) => {
        const row = data.prospects.find((x) => x.id === p.id);
        if (row) row.state = kept.has(p.id) ? 'sent' : 'skipped';
      });
      const stamped = keep;
      data.runs.unshift({
        id: uid(),
        title: `${m.who} on ${m.channels.map((c) => CHANNEL_NAME[c]).join(' + ')}`,
        who: m.who,
        channels: m.channels,
        city: m.city,
        asked: m.raw,
        found: m.count,
        sent: stamped.length,
        replied: 0,
        at: Date.now(),
        state: 'done',
        message: draft.body,
        subject: draft.subject,
      });
      commit();
      record({
        agent: 'Sales',
        text: `Wrote to ${stamped.length} ${m.who.toLowerCase()} on ${m.channels.map((c) => CHANNEL_NAME[c]).join(' and ')}.`,
        credits: stamped.length * COST.outreach,
        what: `${m.who} outreach`,
        notice: {
          title: `${stamped.length} ${m.who.toLowerCase()} written to`,
          line: 'Replies land in your Sales Team screen as they come in.',
        },
      });
      setConfirm(false);
      setDone({ sent: stamped.length, channels: m.channels });
    });
  };

  return (
    <>
      <Page bottom={28}>
        <Lede text="Say it the way you would say it to a person. She works out what it means, shows you her plan, and does nothing until you say go." />

        {/* what you asked */}
        <Stagger style={{ marginBottom: 10 }}>
          <View style={[st.row, { justifyContent: 'flex-end' }]}>
            <Glass style={st.bubble} radius={18} lit>
              <View style={st.bubbleInner}>
                <Text style={st.bubbleText}>{asked}</Text>
              </View>
            </Glass>
          </View>
        </Stagger>

        {think.busy ? (
          <View style={st.row}>
            <Avatar size={30} online={false} />
            <Glass style={st.bubble} radius={18}>
              <View style={st.bubbleInner}>
                <TypingDots />
                <Text style={st.thinking}>Working out what you mean…</Text>
              </View>
            </Glass>
          </View>
        ) : null}

        {/* what she made of it */}
        {understood ? (
          <>
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
                <View style={st.card}>
                  <View style={st.cardHead}>
                    <SparkleIcon size={18} />
                    <Text style={st.cardTitle}>Here is what I understood</Text>
                  </View>
                  <Text style={st.understood}>{m.understood}</Text>

                  <View style={st.facts}>
                    <Fact label="Who" value={m.who} onPress={() => setEdit('who')} />
                    <Fact label="Where" value={m.channels.map((c) => CHANNEL_NAME[c]).join(' + ')} onPress={() => setEdit('where')} />
                    <Fact label="How many" value={String(m.count)} onPress={() => setEdit('count')} />
                    <Fact label="City" value={m.city} onPress={() => setEdit('city')} />
                  </View>
                  <Text style={st.hint}>Tap any of those to change it.</Text>
                </View>
              </Glass>
            </Stagger>

            {/* the plan, and the work */}
            <SectionTitle text={job.running ? 'WORKING' : found || done ? 'WHAT SHE DID' : 'WHAT SHE WILL DO'} />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.plan}>
                  {job.running ? (
                    <View style={st.working}>
                      <Ring
                        pct={(job.at + 1) / (m.steps.length + 1)}
                        size={78}
                        label={`${Math.round(((job.at + 1) / (m.steps.length + 1)) * 100)}%`}
                      />
                      <View style={{ flex: 1 }}>
                        <Steps steps={m.steps} at={job.at} />
                      </View>
                    </View>
                  ) : (
                    <Steps steps={m.steps} at={found || done ? m.steps.length : -1} />
                  )}
                </View>
              </Glass>
            </Stagger>

            {!job.running && !found && !done ? (
              <Btn
                label={m.kind === 'outreach' ? `Find the ${m.who.toLowerCase()}` : 'Let her start'}
                icon={<SearchIcon size={17} color="#0A1206" />}
                onPress={start}
                full
                style={{ marginTop: 14 }}
              />
            ) : null}
          </>
        ) : null}

        {/* who she found */}
        {found ? (
          <>
            <SectionTitle
              text="WHO SHE FOUND"
              right={<Tag text={`${keep.length} of ${found.length} picked`} tone="lime" />}
            />
            {found.map((p, i) => {
              const live = !off.includes(p.id);
              return (
                <Stagger key={p.id} index={i} style={{ marginBottom: 9 }}>
                  <Glass
                    style={{ alignSelf: 'stretch' }}
                    radius={R.lg}
                    lit={live}
                    onPress={() => setOff((v) => (live ? [...v, p.id] : v.filter((x) => x !== p.id)))}
                  >
                    <View style={st.person}>
                      <View style={[st.box, live && st.boxOn]}>{live ? <CheckIcon size={13} color="#0A1206" /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <View style={st.personHead}>
                          <Text style={st.personName}>{p.name}</Text>
                          <PlatformMark k={p.channel} size={14} />
                        </View>
                        <Text style={st.handle}>
                          {p.handle}
                          {p.reach ? ` · ${p.reach.toLocaleString('en-US')} followers` : ''}
                        </Text>
                        <Text style={st.why}>{p.why}</Text>
                      </View>
                    </View>
                  </Glass>
                </Stagger>
              );
            })}
            <Text style={st.more}>
              She has {Math.max(0, m.count - found.length)} more like these; these are the ones worth your time first.
            </Text>

            {/* what she would send */}
            <SectionTitle
              text="WHAT SHE WILL SEND"
              right={
                <Pressable onPress={() => setWriting(true)}>
                  <View style={st.editLink}>
                    <PencilIcon size={14} />
                    <Text style={st.editText}>Edit</Text>
                  </View>
                </Pressable>
              }
            />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
                <View style={st.msg}>
                  <MarkRow list={m.channels} size={15} />
                  {draft.subject ? <Text style={st.subject}>{draft.subject}</Text> : null}
                  <Text style={st.body}>{draft.body}</Text>
                  <Text style={st.tokenNote}>{'{name}'} becomes each person&apos;s name.</Text>
                </View>
              </Glass>
            </Stagger>

            {!done ? (
              <Btn
                label={`Send to ${keep.length} ${keep.length === 1 ? 'person' : 'people'}`}
                icon={<SendIcon size={17} color="#0A1206" />}
                onPress={() => setConfirm(true)}
                disabled={keep.length === 0}
                full
                style={{ marginTop: 14 }}
              />
            ) : null}
          </>
        ) : null}

        {/* done */}
        {done ? (
          <Stagger style={{ marginTop: 16 }}>
            <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
              <View style={st.done}>
                <Avatar size={52} />
                <Text style={st.doneTitle}>
                  {done.sent ? `${done.sent} on their way` : 'She has started'}
                </Text>
                <Text style={st.doneLine}>
                  {done.sent
                    ? 'Replies arrive in your Sales Team screen, and anyone who answers becomes an enquiry you can work.'
                    : 'Everything she does from here shows up on Activity. You are told only when she needs you.'}
                </Text>
                <Meter pct={1} h={5} />
                <View style={st.doneBtns}>
                  {done.sent ? (
                    <Btn label="Open Outreach" kind="ghost" small onPress={() => onOpen?.('Outreach')} style={{ flex: 1 }} />
                  ) : (
                    <Btn
                      label={`Open ${SEND_TO[m.kind] ?? 'Activity'}`}
                      kind="ghost"
                      small
                      onPress={() => onOpen?.(SEND_TO[m.kind] ?? 'Activity')}
                      style={{ flex: 1 }}
                    />
                  )}
                  <Btn label="Sales Team" small onPress={() => onOpen?.('Sales Team')} style={{ flex: 1 }} />
                </View>
              </View>
            </Glass>
          </Stagger>
        ) : null}
      </Page>

      {/* change what she understood */}
      <Sheet open={edit === 'who'} onClose={() => setEdit(null)} title="Who should she go after?">
        <Chips items={WHO} on={[m.who]} onToggle={(v) => { set('who', v); setEdit(null); }} />
      </Sheet>

      <Sheet open={edit === 'where'} onClose={() => setEdit(null)} title="Where should she look?">
        <Chips
          items={WHERE.map((c) => CHANNEL_NAME[c])}
          on={m.channels.map((c) => CHANNEL_NAME[c])}
          icons={Object.fromEntries(
            WHERE.map((c) => [CHANNEL_NAME[c], <PlatformMark key={c} k={c} size={14} />]),
          )}
          onToggle={(name) => {
            const k = WHERE.find((c) => CHANNEL_NAME[c] === name) as Channel;
            const on = m.channels.includes(k);
            if (on && m.channels.length === 1) return; // she needs somewhere to look
            set('channels', on ? m.channels.filter((c) => c !== k) : [...m.channels, k]);
          }}
        />
        <Btn label="Done" onPress={() => setEdit(null)} full style={{ marginTop: 16 }} />
      </Sheet>

      <Sheet open={edit === 'count'} onClose={() => setEdit(null)} title="How many people?">
        <Field
          label="HOW MANY"
          value={countText}
          onChangeText={(v) => setCountText(v.replace(/\D/g, '').slice(0, 3))}
          keyboard="number-pad"
        />
        <Chips items={['25', '50', '100', '250']} on={[countText]} onToggle={setCountText} />
        <Btn
          label="Save"
          onPress={() => {
            set('count', Math.max(5, Number(countText) || 50));
            setEdit(null);
          }}
          full
          style={{ marginTop: 16 }}
        />
      </Sheet>

      <Sheet open={edit === 'city'} onClose={() => setEdit(null)} title="Which city?">
        <Chips items={CITIES} on={[m.city]} onToggle={(v) => { set('city', v); setEdit(null); }} />
      </Sheet>

      {/* edit the message */}
      <Sheet open={writing} onClose={() => setWriting(false)} title="What she will send" full>
        {draft.subject !== undefined && m.channels.includes('gmail') ? (
          <Field label="SUBJECT" value={draft.subject ?? ''} onChangeText={(v) => setDraft({ ...draft, subject: v })} />
        ) : null}
        <Field
          label="MESSAGE"
          value={draft.body}
          onChangeText={(v) => setDraft({ ...draft, body: v })}
          multiline
          lines={8}
        />
        <Btn
          label="Let Vexa rewrite it"
          icon={<SparkleIcon size={16} color="#0A1206" />}
          onPress={() => setDraft(draftMessage(m, data.me.business, data.me.trade, m.city))}
          full
          small
          style={{ marginBottom: 10 }}
        />
        <Btn label="Save" onPress={() => setWriting(false)} full />
      </Sheet>

      <Confirm
        open={confirm}
        title={`Send to ${keep.length} ${keep.length === 1 ? 'person' : 'people'}?`}
        line={`She writes to each one on ${m.channels.map((c) => CHANNEL_NAME[c]).join(' and ')}, a few minutes apart so it reads like you. Replies come to your Sales Team.`}
        cta="Send them"
        busy={send.busy}
        onCancel={() => setConfirm(false)}
        onConfirm={reallySend}
      />

      {toast}
    </>
  );
}

/** One thing she understood, tap to change. */
function Fact({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
      <Glass style={st.fact} radius={R.md}>
        <View style={st.factInner}>
          <Text style={st.factLabel}>{label}</Text>
          <Text style={st.factValue} numberOfLines={1}>
            {value}
          </Text>
          <ChevronRight size={14} />
        </View>
      </Glass>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, marginBottom: 10 },
  bubble: { maxWidth: '86%' },
  bubbleInner: { paddingHorizontal: 14, paddingVertical: 11, gap: 6 },
  bubbleText: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  thinking: { color: C.textDim, fontSize: 11.5 },

  card: { padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  understood: { color: C.text, fontSize: 13.5, lineHeight: 20 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  fact: {},
  factInner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  factLabel: { color: C.textFaint, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  factValue: { color: C.lime, fontSize: 12.5, fontWeight: '800', maxWidth: 150 },
  hint: { color: C.textFaint, fontSize: 11 },

  plan: { padding: 14 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 14 },

  person: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
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
  personHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personName: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  handle: { color: C.green, fontSize: 11.5, fontWeight: '700', marginTop: 3 },
  why: { color: C.textDim, fontSize: 11.5, lineHeight: 16.5, marginTop: 4 },
  more: { color: C.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 2 },

  editLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editText: { color: C.lime, fontSize: 11.5, fontWeight: '800' },
  msg: { padding: 15, gap: 9 },
  subject: { color: C.text, fontSize: 14, fontWeight: '800' },
  body: { color: C.textDim, fontSize: 12.5, lineHeight: 19 },
  tokenNote: { color: C.textFaint, fontSize: 10.5 },

  done: { padding: 20, alignItems: 'center', gap: 10 },
  doneTitle: { color: C.text, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  doneLine: { color: C.textDim, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  doneBtns: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
});
