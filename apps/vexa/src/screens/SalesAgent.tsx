import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  ChartUpIcon,
  CheckIcon,
  NoteIcon,
  PhoneIcon,
  SendIcon,
  SparkleIcon,
  TrashIcon,
  UsersIcon,
} from '../components/Icons';
import { WhatsappMark } from '../components/BrandMarks';
import {
  Btn,
  Chips,
  Confirm,
  Empty,
  Field,
  IconBtn,
  Lede,
  LoadingBar,
  Page,
  PlatformMark,
  SectionTitle,
  Segment,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Stat,
  Tag,
  type Tone,
  TypingDots,
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import { commit, db, PLATFORM_NAME, uid, useDb, type Lead } from '../store';
import { C, R } from '../theme';

type Stage = Lead['stage'];

const STAGES: Stage[] = ['new', 'talking', 'quoted', 'won', 'lost'];
const STAGE_NAME: Record<Stage, string> = {
  new: 'New',
  talking: 'Talking',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
};
const STAGE_TONE: Record<Stage, Tone> = { new: 'lime', talking: 'green', quoted: 'warn', won: 'green', lost: 'bad' };

const SOURCES = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'youtube'] as const;

const REPLIES = [
  'Yes, we have it in large. Want me to hold one for you?',
  'Delivery is 2–4 working days anywhere in Pakistan.',
  'I can do PKR 32,000 for four — that is the most we discount.',
  'Thank you! Your order goes out tomorrow morning.',
];

const blank = (): Lead => ({
  id: '',
  name: '',
  phone: '+92 ',
  source: 'whatsapp',
  stage: 'new',
  value: 0,
  city: 'Lahore',
  at: 'Just now',
  notes: [],
  thread: [],
});

export default function SalesAgent() {
  const data = useDb();
  const load = useLoad(950);
  const think = useAction();
  const [toast, say] = useToast();

  const [tab, setTab] = useState<'open' | 'all' | 'closed'>('open');
  const [stage, setStage] = useState<Stage | null>(null);
  const [open, setOpen] = useState<Lead | null>(null);
  const [make, setMake] = useState<Lead | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [addNote, setAddNote] = useState(false);
  const [kill, setKill] = useState<Lead | null>(null);

  const rows = data.leads
    .filter((l) => (tab === 'open' ? l.stage !== 'won' && l.stage !== 'lost' : tab === 'closed' ? l.stage === 'won' || l.stage === 'lost' : true))
    .filter((l) => (stage ? l.stage === stage : true));

  const won = data.leads.filter((l) => l.stage === 'won').reduce((n, l) => n + l.value, 0);
  const live = data.leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
  const pipeline = live.reduce((n, l) => n + l.value, 0);

  /** Re-reads the lead out of the store so the sheet shows the latest. */
  const current = open ? data.leads.find((l) => l.id === open.id) ?? open : null;

  const send = (text: string, from: 'us' | 'them' = 'us') => {
    if (!current || !text.trim()) return;
    current.thread.push({ from, text: text.trim(), at: 'Just now' });
    if (current.stage === 'new') current.stage = 'talking';
    commit();
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Every enquiry from your ads, your DMs and your WhatsApp, in one list. Vexa answers the easy ones herself and hands you the rest." />

        <SlowNote visible={load.slow} />

        <View style={st.statRow}>
          <Stat label="Open enquiries" value={live.length} index={0} />
          <Stat label="In the pipeline" value={pipeline} prefix="PKR " index={1} />
          <Stat label="Won this month" value={won} prefix="PKR " index={2} />
        </View>

        <View style={{ marginTop: 14 }}>
          <Segment
            items={[
              { key: 'open', label: 'Open' },
              { key: 'all', label: 'Everyone' },
              { key: 'closed', label: 'Closed' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        <View style={{ marginTop: 12 }}>
          <Chips
            items={STAGES.map((s) => STAGE_NAME[s])}
            on={stage ? [STAGE_NAME[stage]] : []}
            onToggle={(name) => {
              const k = STAGES.find((s) => STAGE_NAME[s] === name) ?? null;
              setStage(k === stage ? null : k);
            }}
          />
        </View>

        <SectionTitle text="ENQUIRIES" right={<Tag text={`${rows.length}`} tone="lime" />} />

        {load.loading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <Empty
            icon={<UsersIcon size={24} />}
            title="No enquiries here"
            line="When someone messages your page or fills an ad form, they land in this list."
            cta="Add one by hand"
            onCta={() => setMake(blank())}
          />
        ) : (
          rows.map((l, i) => (
            <Stagger key={l.id} index={i} style={{ marginBottom: 9 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={l.stage === 'new'} onPress={() => setOpen(l)}>
                <View style={st.card}>
                  <View style={st.who}>
                    <Text style={st.initial}>{l.name.slice(0, 1)}</Text>
                    <View style={st.srcBadge}>
                      {l.source === 'whatsapp' ? <WhatsappMark size={13} /> : <PlatformMark k={l.source} size={13} />}
                    </View>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={st.nameRow}>
                      <Text style={st.name}>{l.name}</Text>
                      <Tag text={STAGE_NAME[l.stage]} tone={STAGE_TONE[l.stage]} />
                    </View>
                    <Text style={st.last} numberOfLines={1}>
                      {l.thread.length ? l.thread[l.thread.length - 1].text : 'No messages yet'}
                    </Text>
                    <Text style={st.meta}>
                      {l.city} · {l.at}
                      {l.value ? ` · PKR ${l.value.toLocaleString('en-US')}` : ''}
                    </Text>
                  </View>
                </View>
              </Glass>
            </Stagger>
          ))
        )}

        <Btn label="Add an enquiry" icon={<UsersIcon size={17} color="#0A1206" />} onPress={() => setMake(blank())} full style={{ marginTop: 14 }} />
      </Page>

      {/* one enquiry: thread, stage, value, notes */}
      <Sheet open={!!current} onClose={() => setOpen(null)} title={current?.name ?? ''} full>
        {current ? (
          <View style={{ gap: 14 }}>
            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
              <View style={st.head}>
                <View style={{ flex: 1 }}>
                  <Text style={st.headLine}>{current.phone}</Text>
                  <Text style={st.headSub}>
                    {current.city} · came from {current.source === 'whatsapp' ? 'WhatsApp' : PLATFORM_NAME[current.source]}
                  </Text>
                </View>
                <IconBtn tone="lime" onPress={() => say('Calling…')}>
                  <PhoneIcon size={17} />
                </IconBtn>
                <IconBtn onPress={() => say('Opening WhatsApp…')}>
                  <WhatsappMark size={18} />
                </IconBtn>
              </View>
            </Glass>

            <View>
              <Text style={st.lab}>STAGE</Text>
              <Chips
                items={STAGES.map((s) => STAGE_NAME[s])}
                on={[STAGE_NAME[current.stage]]}
                onToggle={(name) => {
                  const k = STAGES.find((s) => STAGE_NAME[s] === name);
                  if (!k) return;
                  current.stage = k;
                  commit();
                  say(`Moved to ${STAGE_NAME[k]}`);
                }}
              />
            </View>

            <Field
              label="WHAT IT IS WORTH"
              value={String(current.value)}
              onChangeText={(v) => {
                current.value = Number(v.replace(/\D/g, '')) || 0;
                commit();
              }}
              keyboard="number-pad"
              prefix="PKR"
            />

            <View>
              <SectionTitle
                text="CONVERSATION"
                right={
                  <Pressable onPress={() => think.run(1500, () => send(REPLIES[Math.floor(Math.random() * REPLIES.length)]))}>
                    <View style={st.vexaReply}>
                      <SparkleIcon size={14} />
                      <Text style={st.vexaReplyText}>Let Vexa reply</Text>
                    </View>
                  </Pressable>
                }
              />

              <View style={{ gap: 8 }}>
                {current.thread.map((m, i) => (
                  <Stagger key={i} index={i}>
                    <View style={[st.bubbleRow, m.from === 'us' && { justifyContent: 'flex-end' }]}>
                      <Glass style={st.bubble} radius={16} lit={m.from === 'us'}>
                        <View style={st.bubbleInner}>
                          <Text style={st.bubbleText}>{m.text}</Text>
                          <Text style={st.bubbleAt}>{m.at}</Text>
                        </View>
                      </Glass>
                    </View>
                  </Stagger>
                ))}

                {think.busy ? (
                  <View style={st.bubbleRow}>
                    <Glass style={st.bubble} radius={16}>
                      <View style={st.bubbleInner}>
                        <TypingDots />
                      </View>
                    </Glass>
                  </View>
                ) : null}
              </View>

              <View style={st.composer}>
                <Glass style={{ flex: 1 }} radius={R.pill}>
                  <View style={st.composerInner}>
                    <Field value={msg} onChangeText={setMsg} placeholder="Write a reply…" style={{ marginBottom: 0, flex: 1 }} />
                  </View>
                </Glass>
                <Pressable
                  style={({ pressed }) => [st.sendBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => {
                    if (!msg.trim()) return;
                    send(msg);
                    setMsg('');
                    say('Sent');
                  }}
                >
                  <SendIcon size={20} />
                </Pressable>
              </View>
            </View>

            <View>
              <SectionTitle
                text="NOTES"
                right={
                  <Pressable onPress={() => setAddNote(true)}>
                    <Text style={st.link}>Add note</Text>
                  </Pressable>
                }
              />
              {current.notes.length === 0 ? (
                <Text style={st.noneText}>Nothing noted yet.</Text>
              ) : (
                current.notes.map((n, i) => (
                  <Stagger key={i} index={i} style={{ marginBottom: 8 }}>
                    <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                      <View style={st.noteRow}>
                        <NoteIcon size={16} color={C.textDim} />
                        <Text style={st.noteText}>{n}</Text>
                      </View>
                    </Glass>
                  </Stagger>
                ))
              )}
            </View>

            <View style={st.closeRow}>
              <Btn
                label="Mark won"
                icon={<CheckIcon size={15} color="#0A1206" />}
                small
                style={{ flex: 1 }}
                onPress={() => {
                  current.stage = 'won';
                  commit();
                  setOpen(null);
                  say('Marked won');
                }}
              />
              <Btn
                label="Mark lost"
                kind="ghost"
                small
                style={{ flex: 1 }}
                onPress={() => {
                  current.stage = 'lost';
                  commit();
                  setOpen(null);
                  say('Marked lost');
                }}
              />
              <IconBtn tone="bad" onPress={() => setKill(current)}>
                <TrashIcon size={17} />
              </IconBtn>
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* add a note */}
      <Sheet open={addNote} onClose={() => setAddNote(false)} title="Add a note">
        <Field value={note} onChangeText={setNote} placeholder="Wants it before the 28th" multiline lines={3} />
        <Btn
          label="Save note"
          onPress={() => {
            if (current && note.trim()) {
              current.notes.push(note.trim());
              commit();
            }
            setNote('');
            setAddNote(false);
            say('Note saved');
          }}
          full
        />
      </Sheet>

      {/* create */}
      <Sheet open={!!make} onClose={() => setMake(null)} title="New enquiry">
        {make ? (
          <View>
            <Field label="NAME" value={make.name} onChangeText={(v) => setMake({ ...make, name: v })} placeholder="Ayesha Khan" />
            <Field
              label="PHONE"
              value={make.phone}
              onChangeText={(v) => setMake({ ...make, phone: v })}
              keyboard="phone-pad"
              placeholder="+92 300 0000000"
            />
            <Field label="CITY" value={make.city} onChangeText={(v) => setMake({ ...make, city: v })} />
            <Text style={st.lab}>CAME FROM</Text>
            <View style={{ marginBottom: 14 }}>
              <Chips
                items={SOURCES.map((s) => (s === 'whatsapp' ? 'WhatsApp' : PLATFORM_NAME[s]))}
                on={[make.source === 'whatsapp' ? 'WhatsApp' : PLATFORM_NAME[make.source]]}
                onToggle={(v) => {
                  const k = v === 'WhatsApp' ? 'whatsapp' : SOURCES.find((s) => s !== 'whatsapp' && PLATFORM_NAME[s] === v);
                  if (k) setMake({ ...make, source: k });
                }}
              />
            </View>
            <Field
              label="WORTH"
              value={String(make.value)}
              onChangeText={(v) => setMake({ ...make, value: Number(v.replace(/\D/g, '')) || 0 })}
              keyboard="number-pad"
              prefix="PKR"
            />
            {err ? <Text style={st.err}>{err}</Text> : null}
            <Btn
              label="Add enquiry"
              onPress={() => {
                if (!make.name.trim()) return setErr('A name, at least.');
                data.leads.unshift({ ...make, id: uid() });
                commit();
                setMake(null);
                setErr('');
                say('Enquiry added');
              }}
              full
            />
          </View>
        ) : null}
      </Sheet>

      <Confirm
        open={!!kill}
        title="Delete this enquiry?"
        line="The conversation goes with it."
        cta="Delete"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.leads = data.leads.filter((l) => l.id !== kill?.id);
          commit();
          setKill(null);
          setOpen(null);
          say('Deleted');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: 8 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  who: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(120,255,140,0.12)', alignItems: 'center', justifyContent: 'center' },
  initial: { color: C.lime, fontSize: 17, fontWeight: '900' },
  srcBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#0B1310',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 14.5, fontWeight: '800', flex: 1 },
  last: { color: C.textDim, fontSize: 12, marginTop: 3 },
  meta: { color: C.textFaint, fontSize: 11, marginTop: 3 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  headLine: { color: C.text, fontSize: 14.5, fontWeight: '800' },
  headSub: { color: C.textDim, fontSize: 11.5, marginTop: 3 },

  vexaReply: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vexaReplyText: { color: C.lime, fontSize: 11.5, fontWeight: '800' },

  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%' },
  bubbleInner: { paddingHorizontal: 13, paddingVertical: 10 },
  bubbleText: { color: C.text, fontSize: 13, lineHeight: 18 },
  bubbleAt: { color: C.textFaint, fontSize: 10, marginTop: 4 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  composerInner: { paddingHorizontal: 8, paddingVertical: 2 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },

  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
  noteText: { color: C.textDim, fontSize: 12.5, flex: 1, lineHeight: 18 },
  noneText: { color: C.textFaint, fontSize: 12 },

  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 4 },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  link: { color: C.lime, fontSize: 11.5, fontWeight: '800' },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
});
