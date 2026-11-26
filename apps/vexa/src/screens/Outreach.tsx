import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  CheckIcon,
  ChevronRight,
  NoteIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  TrashIcon,
  UsersIcon,
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
  MarkRow,
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
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import { CHANNEL_NAME, commit, db, record, timeAgo, uid, useDb, type Channel, type Prospect, type Template } from '../store';
import { C, R } from '../theme';

type Tab = 'people' | 'messages' | 'runs';

const STATE_NAME: Record<Prospect['state'], string> = {
  found: 'Found',
  queued: 'Queued',
  sent: 'Written to',
  replied: 'Replied',
  won: 'Won',
  skipped: 'Skipped',
};

const STATE_TONE: Record<Prospect['state'], Tone> = {
  found: 'dim',
  queued: 'warn',
  sent: 'lime',
  replied: 'green',
  won: 'green',
  skipped: 'bad',
};

const STATES: Prospect['state'][] = ['found', 'queued', 'sent', 'replied', 'won', 'skipped'];
const CHANNELS: Channel[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'gmail', 'whatsapp'];

const blankPerson = (): Prospect => ({
  id: '',
  name: '',
  handle: '',
  channel: 'instagram',
  who: 'Investor',
  city: 'Lahore',
  reach: 0,
  why: '',
  state: 'found',
  at: Date.now(),
});

const blankTemplate = (): Template => ({ id: '', name: '', channel: 'gmail', subject: '', body: '', used: 0 });

export default function Outreach({ onAsk, onOpen }: { onAsk?: (text: string) => void; onOpen?: (title: string) => void }) {
  const data = useDb();
  const load = useLoad(850);
  const save = useAction();
  const [toast, say] = useToast();

  const [tab, setTab] = useState<Tab>('people');
  const [only, setOnly] = useState<Prospect['state'] | null>(null);
  const [open, setOpen] = useState<Prospect | null>(null);
  const [make, setMake] = useState<Prospect | null>(null);
  const [tmpl, setTmpl] = useState<Template | null>(null);
  const [newTmpl, setNewTmpl] = useState(false);
  const [kill, setKill] = useState<Prospect | null>(null);
  const [killT, setKillT] = useState<Template | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const people = data.prospects.filter((p) => (only ? p.state === only : true));
  const written = data.prospects.filter((p) => p.state === 'sent' || p.state === 'replied' || p.state === 'won').length;
  const replied = data.prospects.filter((p) => p.state === 'replied' || p.state === 'won').length;

  /** The one place a prospect's state changes. */
  const move = (p: Prospect, to: Prospect['state']) => {
    p.state = to;
    commit();
    if (to === 'replied' || to === 'won') {
      record({ agent: 'Sales', text: `${p.name} ${to === 'won' ? 'became an order' : 'replied to her message'}.` });
    }
    say(STATE_NAME[to]);
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={28}>
        <Lede text="The people she has gone out and found for you, what she wrote to them, and who answered. Ask her for more in your own words and they land here." />

        <SlowNote visible={load.slow} />

        <View style={st.statRow}>
          <Stat label="Found" value={data.prospects.length} index={0} />
          <Stat label="Written to" value={written} index={1} />
          <Stat label="Replied" value={replied} index={2} />
        </View>

        <View style={{ marginTop: 14 }}>
          <Segment
            items={[
              { key: 'people', label: 'People' },
              { key: 'messages', label: 'Messages' },
              { key: 'runs', label: 'Searches' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        {tab === 'people' ? (
          <>
            <View style={{ marginTop: 12 }}>
              <Chips
                items={STATES.map((s) => STATE_NAME[s])}
                on={only ? [STATE_NAME[only]] : []}
                onToggle={(name) => {
                  const k = STATES.find((s) => STATE_NAME[s] === name) ?? null;
                  setOnly(k === only ? null : k);
                }}
              />
            </View>

            <SectionTitle text="PEOPLE" right={<Tag text={`${people.length}`} tone="lime" />} />

            {load.loading ? (
              <SkeletonList rows={3} />
            ) : people.length === 0 ? (
              <Empty
                icon={<UsersIcon size={24} />}
                title="Nobody here yet"
                line="Tell her who you want — investors, shops, customers — and she goes and finds them."
                cta="Ask her to find people"
                onCta={() => onAsk?.('Find me investors on Instagram and email them')}
              />
            ) : (
              people.map((p, i) => (
                <Stagger key={p.id} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={p.state === 'replied'} onPress={() => setOpen(p)}>
                    <View style={st.person}>
                      <View style={st.mark}>
                        <PlatformMark k={p.channel} size={19} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={st.head}>
                          <Text style={st.name}>{p.name}</Text>
                          <Tag text={STATE_NAME[p.state]} tone={STATE_TONE[p.state]} />
                        </View>
                        <Text style={st.handle} numberOfLines={1}>
                          {p.handle}
                        </Text>
                        <Text style={st.why} numberOfLines={2}>
                          {p.why}
                        </Text>
                        <Text style={st.meta}>
                          {p.who} · {p.city} · {timeAgo(p.at)}
                        </Text>
                      </View>
                      <ChevronRight size={18} />
                    </View>
                  </Glass>
                </Stagger>
              ))
            )}

            <Btn
              label="Ask her to find more"
              icon={<SearchIcon size={17} color="#0A1206" />}
              onPress={() =>
                onAsk?.(
                  `Find me more ${(data.runs[0]?.who ?? 'investors').toLowerCase()} on Instagram and email them in ${data.me.city}`,
                )
              }
              full
              style={{ marginTop: 12 }}
            />
            <Btn
              label="Add someone by hand"
              kind="ghost"
              onPress={() => {
                setMake(blankPerson());
                setErr('');
              }}
              full
              small
              style={{ marginTop: 10 }}
            />
          </>
        ) : null}

        {tab === 'messages' ? (
          <>
            <SectionTitle text="WHAT SHE SENDS" right={<Tag text={`${data.templates.length}`} tone="lime" />} />
            {data.templates.length === 0 ? (
              <Empty
                icon={<NoteIcon size={24} />}
                title="No messages saved"
                line="Save the ones that work and she reuses them, with each person's name filled in."
                cta="Write one"
                onCta={() => {
                  setTmpl(blankTemplate());
                  setNewTmpl(true);
                }}
              />
            ) : (
              data.templates.map((t, i) => (
                <Stagger key={t.id} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                    <View style={st.tmpl}>
                      <View style={st.head}>
                        <PlatformMark k={t.channel} size={16} />
                        <Text style={st.name}>{t.name}</Text>
                        <Tag text={`used ${t.used}×`} />
                      </View>
                      {t.subject ? <Text style={st.subject}>{t.subject}</Text> : null}
                      <Text style={st.body} numberOfLines={3}>
                        {t.body}
                      </Text>
                      <View style={st.actions}>
                        <IconBtn
                          size={32}
                          onPress={() => {
                            setTmpl({ ...t });
                            setNewTmpl(false);
                          }}
                        >
                          <PencilIcon size={15} />
                        </IconBtn>
                        <IconBtn size={32} tone="bad" onPress={() => setKillT(t)}>
                          <TrashIcon size={15} />
                        </IconBtn>
                      </View>
                    </View>
                  </Glass>
                </Stagger>
              ))
            )}

            <Btn
              label="Write a new one"
              icon={<SparkleIcon size={17} color="#0A1206" />}
              onPress={() => {
                setTmpl(blankTemplate());
                setNewTmpl(true);
              }}
              full
              style={{ marginTop: 12 }}
            />
          </>
        ) : null}

        {tab === 'runs' ? (
          <>
            <SectionTitle text="SEARCHES SHE HAS RUN" right={<Tag text={`${data.runs.length}`} tone="lime" />} />
            {data.runs.length === 0 ? (
              <Empty
                icon={<SearchIcon size={24} />}
                title="No searches yet"
                line="Every time you ask her to find people, the run is kept here."
                cta="Ask her now"
                onCta={() => onAsk?.('Find me 50 shops in Karachi that could stock us')}
              />
            ) : (
              data.runs.map((r, i) => (
                <Stagger key={r.id} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                    <View style={st.run}>
                      <View style={st.head}>
                        <Text style={st.name}>{r.title}</Text>
                        <Tag text={r.state === 'done' ? 'Done' : 'Sending'} tone={r.state === 'done' ? 'green' : 'warn'} />
                      </View>
                      <Text style={st.asked}>“{r.asked}”</Text>
                      <View style={st.numbers}>
                        <View>
                          <Text style={st.numLabel}>Found</Text>
                          <Text style={st.numValue}>{r.found}</Text>
                        </View>
                        <View>
                          <Text style={st.numLabel}>Written to</Text>
                          <Text style={st.numValue}>{r.sent}</Text>
                        </View>
                        <View>
                          <Text style={st.numLabel}>Replied</Text>
                          <Text style={[st.numValue, { color: C.lime }]}>{r.replied}</Text>
                        </View>
                        <MarkRow list={r.channels} size={14} />
                      </View>
                      <Btn
                        label="Run this again"
                        kind="ghost"
                        small
                        onPress={() => onAsk?.(r.asked)}
                        style={{ alignSelf: 'flex-start' }}
                      />
                    </View>
                  </Glass>
                </Stagger>
              ))
            )}
          </>
        ) : null}
      </Page>

      {/* one person */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} full>
        {open ? (
          <View style={{ gap: 14 }}>
            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
              <View style={st.detail}>
                <PlatformMark k={open.channel} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={st.detailHandle}>{open.handle}</Text>
                  <Text style={st.meta}>
                    {open.who} · {open.city}
                    {open.reach ? ` · ${open.reach.toLocaleString('en-US')} followers` : ''}
                  </Text>
                </View>
              </View>
            </Glass>

            <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
              <View style={st.whyCard}>
                <SparkleIcon size={16} />
                <Text style={st.whyText}>{open.why || 'She picked them for you.'}</Text>
              </View>
            </Glass>

            <View>
              <Text style={st.lab}>WHERE THIS HAS GOT TO</Text>
              <Chips
                items={STATES.map((s) => STATE_NAME[s])}
                on={[STATE_NAME[open.state]]}
                onToggle={(name) => {
                  const k = STATES.find((s) => STATE_NAME[s] === name);
                  if (k) move(open, k);
                }}
              />
            </View>

            <Field
              label="NOTE"
              value={open.note ?? note}
              onChangeText={(v) => {
                open.note = v;
                setNote(v);
                commit();
              }}
              placeholder="Asked for last year's numbers"
              multiline
              lines={3}
            />

            <Btn
              label="Make this an enquiry"
              icon={<CheckIcon size={16} color="#0A1206" />}
              onPress={() => {
                data.leads.unshift({
                  id: uid(),
                  name: open.name,
                  phone: open.channel === 'whatsapp' ? open.handle : '+92 ',
                  source: open.channel === 'gmail' ? 'facebook' : (open.channel as never),
                  stage: 'talking',
                  value: 0,
                  city: open.city,
                  at: Date.now(),
                  notes: [open.why],
                  thread: [],
                });
                open.state = 'replied';
                commit();
                setOpen(null);
                say('Added to your Sales Team');
              }}
              full
            />
            <Btn label="Open Sales Team" kind="ghost" small onPress={() => onOpen?.('Sales Team')} full />
            <Btn
              label="Remove this person"
              kind="danger"
              icon={<TrashIcon size={16} />}
              onPress={() => setKill(open)}
              full
              small
            />
          </View>
        ) : null}
      </Sheet>

      {/* add a person by hand */}
      <Sheet open={!!make} onClose={() => setMake(null)} title="Add someone">
        {make ? (
          <View>
            <Field label="NAME" value={make.name} onChangeText={(v) => setMake({ ...make, name: v })} placeholder="Zafar Iqbal" />
            <Field
              label="HANDLE OR EMAIL"
              value={make.handle}
              onChangeText={(v) => setMake({ ...make, handle: v })}
              placeholder="@zafar.ventures"
            />
            <Text style={st.lab}>WHERE</Text>
            <View style={{ marginBottom: 14 }}>
              <Chips
                items={CHANNELS.map((c) => CHANNEL_NAME[c])}
                on={[CHANNEL_NAME[make.channel]]}
                onToggle={(name) => {
                  const k = CHANNELS.find((c) => CHANNEL_NAME[c] === name);
                  if (k) setMake({ ...make, channel: k });
                }}
              />
            </View>
            <Field label="WHO ARE THEY" value={make.who} onChangeText={(v) => setMake({ ...make, who: v })} placeholder="Investor" />
            <Field label="CITY" value={make.city} onChangeText={(v) => setMake({ ...make, city: v })} />
            <Field
              label="WHY THEM"
              value={make.why}
              onChangeText={(v) => setMake({ ...make, why: v })}
              placeholder="Backs small retail brands"
              multiline
              lines={2}
            />
            {err ? <Text style={st.err}>{err}</Text> : null}
            <Btn
              label="Add"
              busy={save.busy}
              onPress={() => {
                if (!make.name.trim()) return setErr('A name, at least.');
                if (!make.handle.trim()) return setErr('Where should she write to them?');
                save.run(900, () => {
                  data.prospects.unshift({ ...make, id: uid() });
                  commit();
                  setMake(null);
                  setErr('');
                  say('Added');
                });
              }}
              full
            />
          </View>
        ) : null}
      </Sheet>

      {/* write / edit a message */}
      <Sheet open={!!tmpl} onClose={() => setTmpl(null)} title={newTmpl ? 'New message' : 'Edit message'} full>
        {tmpl ? (
          <View>
            <Field label="NAME IT" value={tmpl.name} onChangeText={(v) => setTmpl({ ...tmpl, name: v })} placeholder="Investor first touch" />
            <Text style={st.lab}>SENT ON</Text>
            <View style={{ marginBottom: 14 }}>
              <Chips
                items={CHANNELS.map((c) => CHANNEL_NAME[c])}
                on={[CHANNEL_NAME[tmpl.channel]]}
                onToggle={(name) => {
                  const k = CHANNELS.find((c) => CHANNEL_NAME[c] === name);
                  if (k) setTmpl({ ...tmpl, channel: k });
                }}
              />
            </View>
            {tmpl.channel === 'gmail' ? (
              <Field label="SUBJECT" value={tmpl.subject ?? ''} onChangeText={(v) => setTmpl({ ...tmpl, subject: v })} />
            ) : null}
            <Field
              label="MESSAGE"
              value={tmpl.body}
              onChangeText={(v) => setTmpl({ ...tmpl, body: v })}
              placeholder="Hello {name}, …"
              multiline
              lines={7}
            />
            <Text style={st.tokenNote}>{'{name}'} becomes each person&apos;s name when she sends it.</Text>
            {err ? <Text style={st.err}>{err}</Text> : null}
            <Btn
              label={newTmpl ? 'Save it' : 'Save changes'}
              onPress={() => {
                if (!tmpl.name.trim() || !tmpl.body.trim()) return setErr('It needs a name and something to say.');
                if (newTmpl) data.templates.unshift({ ...tmpl, id: uid() });
                else {
                  const i = data.templates.findIndex((x) => x.id === tmpl.id);
                  if (i >= 0) data.templates[i] = tmpl;
                }
                commit();
                setTmpl(null);
                setErr('');
                say('Saved');
              }}
              full
            />
          </View>
        ) : null}
      </Sheet>

      <Confirm
        open={!!kill}
        title="Remove this person?"
        line="They go from your list. Anything already sent to them stays sent."
        cta="Remove"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.prospects = data.prospects.filter((p) => p.id !== kill?.id);
          commit();
          setKill(null);
          setOpen(null);
          say('Removed');
        }}
      />

      <Confirm
        open={!!killT}
        title="Delete this message?"
        line="She will stop offering it. Anything already sent is untouched."
        cta="Delete"
        danger
        onCancel={() => setKillT(null)}
        onConfirm={() => {
          db.templates = data.templates.filter((t) => t.id !== killT?.id);
          commit();
          setKillT(null);
          say('Deleted');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: 8 },

  person: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  handle: { color: C.green, fontSize: 11.5, fontWeight: '700', marginTop: 3 },
  why: { color: C.textDim, fontSize: 11.5, lineHeight: 16.5, marginTop: 4 },
  meta: { color: C.textFaint, fontSize: 10.5, marginTop: 4 },

  tmpl: { padding: 14, gap: 8 },
  subject: { color: C.text, fontSize: 13, fontWeight: '700' },
  body: { color: C.textDim, fontSize: 12, lineHeight: 17.5 },
  actions: { flexDirection: 'row', gap: 8 },

  run: { padding: 14, gap: 10 },
  asked: { color: C.textDim, fontSize: 12, fontStyle: 'italic' },
  numbers: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  numLabel: { color: C.textFaint, fontSize: 10, fontWeight: '700' },
  numValue: { color: C.text, fontSize: 13.5, fontWeight: '800', marginTop: 2 },

  detail: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  detailHandle: { color: C.text, fontSize: 14, fontWeight: '800' },
  whyCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  whyText: { color: C.textDim, fontSize: 12.5, lineHeight: 18, flex: 1 },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  tokenNote: { color: C.textFaint, fontSize: 11, marginBottom: 10 },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
});
