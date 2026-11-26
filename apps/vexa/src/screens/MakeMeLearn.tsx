import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  CapIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
  NoteIcon,
  PencilIcon,
  SparkleIcon,
  TrashIcon,
} from '../components/Icons';
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
  Ring,
  SectionTitle,
  Segment,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Tag,
  TypingDots,
  useToast,
} from '../components/kit';
import { answer } from '../intent';
import { useAction, useLoad, useSteps } from '../net';
import { commit, COST, db, record, timeAgo, uid, useDb, type Lesson } from '../store';
import { C, R } from '../theme';

const JOB = ['Reading what you added', 'Fitting it to your voice', 'Testing her answers', 'Saving what she learned'];

const KINDS: Array<{ key: Lesson['kind']; label: string }> = [
  { key: 'note', label: 'A rule' },
  { key: 'link', label: 'A link' },
  { key: 'file', label: 'A file' },
];

const DOS = ['Short sentences', 'Warm', 'Prices up front', 'Urdu words are fine'];
const DONTS = ['No ALL CAPS', 'Never beg for a sale', 'No emoji storms', 'Never promise next day'];

const blank = (): Lesson => ({ id: '', kind: 'note', title: '', body: '', at: Date.now(), trained: false });

export default function MakeMeLearn() {
  const data = useDb();
  const load = useLoad(800);
  const ask = useAction();
  const [toast, say] = useToast();

  const job = useSteps(JOB, 900);
  const [edit, setEdit] = useState<Lesson | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState('');
  const [kill, setKill] = useState<Lesson | null>(null);
  const [voice, setVoice] = useState(false);
  const [voiceText, setVoiceText] = useState(data.me.voice);
  const [dos, setDos] = useState<string[]>([DOS[0], DOS[2]]);
  const [donts, setDonts] = useState<string[]>([DONTS[0], DONTS[3]]);
  const [q, setQ] = useState('');
  const [said, setSaid] = useState<{ text: string; rule?: string } | null>(null);

  const trained = data.lessons.filter((l) => l.trained).length;
  const pending = data.lessons.length - trained;

  const icon = (k: Lesson['kind']) =>
    k === 'note' ? <NoteIcon size={19} /> : k === 'link' ? <LinkIcon size={19} /> : <FolderIcon size={19} />;

  const save = () => {
    if (!edit) return;
    if (!edit.title.trim()) return setErr('Give it a title.');
    if (!edit.body.trim()) return setErr(edit.kind === 'link' ? 'Paste the link.' : 'Say what she should know.');
    const row: Lesson = { ...edit, id: edit.id || uid() };
    if (isNew) data.lessons.unshift(row);
    else {
      const i = data.lessons.findIndex((l) => l.id === row.id);
      if (i >= 0) data.lessons[i] = { ...row, trained: false };
    }
    commit();
    record({ agent: 'Vexa', text: isNew ? `You taught her: ${row.title}.` : `You changed the rule “${row.title}”.` });
    setEdit(null);
    setErr('');
    say(isNew ? 'Saved — train her when you are ready' : 'Updated');
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Everything you teach her, she keeps. Rules, prices, links, a catalogue — add it here and she works to it from then on." />

        <SlowNote visible={load.slow} />

        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
            <View style={st.hero}>
              <Ring
                pct={data.lessons.length ? trained / data.lessons.length : 0}
                size={92}
                label={`${trained}/${data.lessons.length}`}
                sub="learned"
              />
              <View style={{ flex: 1, gap: 7 }}>
                <Text style={st.heroTitle}>{pending ? `${pending} waiting to be learned` : 'She is up to date'}</Text>
                <Text style={st.heroSub}>
                  {pending
                    ? 'Training takes about a minute. She keeps working while it runs.'
                    : 'Everything you have added is part of how she writes and answers.'}
                </Text>
                {job.running ? (
                  <View style={{ gap: 6, marginTop: 2 }}>
                    <Text style={st.jobStep}>{JOB[Math.min(job.at, JOB.length - 1)]}…</Text>
                    <TypingDots />
                  </View>
                ) : (
                  <Btn
                    label={pending ? 'Train Vexa now' : 'Train again'}
                    icon={<CapIcon size={16} color="#0A1206" />}
                    small
                    onPress={() =>
                      job.start(() => {
                        const learned = data.lessons.filter((l) => !l.trained).length;
                        data.lessons.forEach((l) => {
                          l.trained = true;
                        });
                        job.reset();
                        record({
                          agent: 'Vexa',
                          text: learned
                            ? `Learned ${learned} new ${learned === 1 ? 'thing' : 'things'} you taught her.`
                            : 'Went over everything you have taught her again.',
                          credits: Math.max(1, learned) * COST.lesson,
                          what: 'Training',
                        });
                        say('Vexa has learned it');
                      })
                    }
                    style={{ alignSelf: 'flex-start' }}
                  />
                )}
              </View>
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="HOW SHE SHOULD SOUND" right={<IconBtn size={30} onPress={() => setVoice(true)}><PencilIcon size={15} /></IconBtn>} />
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
            <View style={st.voice}>
              <Text style={st.voiceText}>{data.me.voice}</Text>
              <Text style={st.lab}>ALWAYS</Text>
              <Chips items={DOS} on={dos} onToggle={(v) => setDos(dos.includes(v) ? dos.filter((x) => x !== v) : [...dos, v])} />
              <Text style={st.lab}>NEVER</Text>
              <Chips items={DONTS} on={donts} onToggle={(v) => setDonts(donts.includes(v) ? donts.filter((x) => x !== v) : [...donts, v])} />
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="WHAT SHE KNOWS" right={<Tag text={`${data.lessons.length}`} tone="lime" />} />

        {load.loading ? (
          <SkeletonList rows={3} />
        ) : data.lessons.length === 0 ? (
          <Empty
            icon={<CapIcon size={24} />}
            title="She knows nothing yet"
            line="Start with one rule you repeat to every customer."
            cta="Teach her something"
            onCta={() => {
              setEdit(blank());
              setIsNew(true);
            }}
          />
        ) : (
          data.lessons.map((l, i) => (
            <Stagger key={l.id} index={i} style={{ marginBottom: 9 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.card}>
                  <View style={st.kindIcon}>{icon(l.kind)}</View>
                  <View style={{ flex: 1 }}>
                    <View style={st.nameRow}>
                      <Text style={st.name}>{l.title}</Text>
                      {l.trained ? <Tag text="Learned" tone="green" /> : <Tag text="Waiting" tone="warn" />}
                    </View>
                    <Text style={st.body}>{l.body}</Text>
                    <Text style={st.at}>{timeAgo(l.at)}</Text>
                  </View>
                  <View style={{ gap: 7 }}>
                    <IconBtn
                      size={32}
                      onPress={() => {
                        setEdit({ ...l });
                        setIsNew(false);
                        setErr('');
                      }}
                    >
                      <PencilIcon size={15} />
                    </IconBtn>
                    <IconBtn size={32} tone="bad" onPress={() => setKill(l)}>
                      <TrashIcon size={15} />
                    </IconBtn>
                  </View>
                </View>
              </Glass>
            </Stagger>
          ))
        )}

        <Btn
          label="Teach her something new"
          icon={<SparkleIcon size={17} color="#0A1206" />}
          onPress={() => {
            setEdit(blank());
            setIsNew(true);
            setErr('');
          }}
          full
          style={{ marginTop: 12 }}
        />

        <SectionTitle text="TRY HER OUT" />
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
            <View style={st.try}>
              <Text style={st.trySub}>Ask what a customer would ask. She answers with what you have taught her.</Text>
              <Field
                value={q}
                onChangeText={setQ}
                placeholder="Can I get it by tomorrow?"
                style={{ marginTop: 10, marginBottom: 8 }}
              />
              <Btn
                label={ask.busy ? 'Thinking…' : 'Ask Vexa'}
                busy={ask.busy}
                small
                onPress={() =>
                  ask.run(1400, () => {
                    setSaid(answer(q));
                    record({
                      agent: 'Sales',
                      text: `You tried her out: “${q.trim() || 'a customer question'}”.`,
                      credits: COST.reply,
                      what: 'Practice answer',
                    });
                  })
                }
                style={{ alignSelf: 'flex-start' }}
              />
              {ask.busy ? <View style={{ marginTop: 12 }}><TypingDots /></View> : null}
              {said && !ask.busy ? (
                <Stagger style={{ marginTop: 12 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                    <View style={st.answer}>
                      <Text style={st.answerText}>{said.text}</Text>
                      <Text style={st.answerWhy}>
                        {said.rule ? `Used your rule: ${said.rule.toLowerCase()}.` : 'You have taught her nothing about this yet, so she handed it to you.'}
                      </Text>
                    </View>
                  </Glass>
                </Stagger>
              ) : null}
            </View>
          </Glass>
        </Stagger>
      </Page>

      {/* create / update a lesson */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={isNew ? 'Teach Vexa' : 'Edit what she knows'}>
        {edit ? (
          <View>
            <Text style={st.lab}>WHAT ARE YOU GIVING HER</Text>
            <View style={{ marginBottom: 14 }}>
              <Segment items={KINDS} value={edit.kind} onChange={(k) => setEdit({ ...edit, kind: k })} />
            </View>

            <Field
              label="TITLE"
              value={edit.title}
              onChangeText={(v) => setEdit({ ...edit, title: v })}
              placeholder={edit.kind === 'note' ? 'Our delivery promise' : edit.kind === 'link' ? 'Size guide page' : 'Winter catalogue'}
            />

            {edit.kind === 'file' ? (
              <>
                <Text style={st.lab}>FILE</Text>
                <Btn
                  label={edit.body || 'Choose a file'}
                  kind="ghost"
                  icon={<ImageIcon size={16} />}
                  onPress={() => setEdit({ ...edit, body: 'Winter catalogue.pdf · 14 pages' })}
                  full
                  style={{ marginBottom: 14 }}
                />
              </>
            ) : (
              <Field
                label={edit.kind === 'link' ? 'LINK' : 'THE RULE'}
                value={edit.body}
                onChangeText={(v) => setEdit({ ...edit, body: v })}
                placeholder={edit.kind === 'link' ? 'berreto.com/size-guide' : 'Maximum discount is 10%, and only on three or more.'}
                multiline={edit.kind === 'note'}
                lines={3}
              />
            )}

            {err ? <Text style={st.err}>{err}</Text> : null}
            <Btn label={isNew ? 'Save it' : 'Save changes'} onPress={save} full />
            <Text style={st.saveNote}>Saved things are used at once; training only makes her faster at them.</Text>
          </View>
        ) : null}
      </Sheet>

      {/* update the voice */}
      <Sheet open={voice} onClose={() => setVoice(false)} title="How she should sound">
        <Field value={voiceText} onChangeText={setVoiceText} multiline lines={4} placeholder="Warm, short sentences, never pushy." />
        <Btn
          label="Save voice"
          onPress={() => {
            data.me.voice = voiceText.trim() || data.me.voice;
            commit();
            setVoice(false);
            say('Voice updated');
          }}
          full
        />
      </Sheet>

      <Confirm
        open={!!kill}
        title="Forget this?"
        line="Vexa stops using it from now on. Anything already written stays as it is."
        cta="Forget it"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.lessons = data.lessons.filter((l) => l.id !== kill?.id);
          commit();
          setKill(null);
          say('Forgotten');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  heroTitle: { color: C.text, fontSize: 15.5, fontWeight: '900' },
  heroSub: { color: C.textDim, fontSize: 11.5, lineHeight: 17 },
  jobStep: { color: C.lime, fontSize: 12, fontWeight: '800' },

  voice: { padding: 14, gap: 8 },
  voiceText: { color: C.text, fontSize: 13, lineHeight: 19 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  kindIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  body: { color: C.textDim, fontSize: 12, marginTop: 3, lineHeight: 17 },
  at: { color: C.textFaint, fontSize: 10.5, marginTop: 3 },

  try: { padding: 14 },
  trySub: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  answer: { padding: 13, gap: 8 },
  answerText: { color: C.text, fontSize: 13, lineHeight: 19 },
  answerWhy: { color: C.lime, fontSize: 11, fontWeight: '800' },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, marginTop: 4, letterSpacing: 0.3 },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  saveNote: { color: C.textFaint, fontSize: 11, marginTop: 10, textAlign: 'center' },
});
