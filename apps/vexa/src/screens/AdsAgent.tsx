import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  BulbIcon,
  CoinIcon,
  MegaphoneIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TargetIcon,
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
  MarkRow,
  Meter,
  Page,
  PlatformMark,
  Ring,
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
import {
  audienceOf,
  COST,
  commit,
  costPerLead,
  cpmPkr,
  db,
  PLATFORMS,
  PLATFORM_NAME,
  record,
  uid,
  useDb,
  type Campaign,
  type Platform,
} from '../store';
import { C, R } from '../theme';

type View_ = 'live' | 'all' | 'ended';

const VIEWS: Array<{ key: View_; label: string }> = [
  { key: 'live', label: 'Running' },
  { key: 'all', label: 'All' },
  { key: 'ended', label: 'Finished' },
];

const GOALS: Array<Campaign['goal']> = ['Leads', 'Sales', 'Reach', 'Followers'];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Faisalabad', 'All Pakistan'];
const AGES = ['18 – 24', '22 – 38', '25 – 45', '30 – 55'];
const INTERESTS = ['Fashion', 'Shopping', 'Weddings', 'Gifting', 'Menswear', 'Eid'];
const BUDGETS = ['500', '999', '1500', '2500'];

const STATUS: Record<Campaign['status'], { text: string; tone: Tone }> = {
  live: { text: 'Running', tone: 'green' },
  paused: { text: 'Paused', tone: 'warn' },
  draft: { text: 'Draft', tone: 'dim' },
  ended: { text: 'Finished', tone: 'dim' },
};

const STEP_NAMES = ['What for', 'Who sees it', 'What it costs', 'Which creative'];

const blank = (): Campaign => ({
  id: '',
  name: '',
  goal: 'Sales',
  status: 'draft',
  platforms: ['instagram', 'facebook'],
  budget: 999,
  city: 'Lahore',
  age: '22 – 38',
  interests: ['Fashion'],
  creative: '',
  spend: 0,
  reach: 0,
  leads: 0,
  roas: 0,
  days: [0, 0, 0, 0, 0, 0, 0],
});

export default function AdsAgent() {
  const data = useDb();
  const load = useLoad(1000, true); // first attempt fails on purpose: the retry path is real
  const launch = useAction();
  const [toast, say] = useToast();

  const [view, setView] = useState<View_>('live');
  const [open, setOpen] = useState<Campaign | null>(null);
  const [wizard, setWizard] = useState<Campaign | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [kill, setKill] = useState<Campaign | null>(null);

  const rows = data.campaigns.filter((c) =>
    view === 'all' ? true : view === 'live' ? c.status !== 'ended' : c.status === 'ended',
  );

  const spendToday = data.campaigns.filter((c) => c.status === 'live').reduce((n, c) => n + c.days[6], 0);
  const budgetToday = data.campaigns.filter((c) => c.status === 'live').reduce((n, c) => n + c.budget, 0);
  const totalLeads = data.campaigns.reduce((n, c) => n + c.leads, 0);
  const blended =
    data.campaigns.reduce((n, c) => n + c.roas * c.spend, 0) / Math.max(1, data.campaigns.reduce((n, c) => n + c.spend, 0));

  const set = <K extends keyof Campaign>(k: K, v: Campaign[K]) => setWizard((c) => (c ? { ...c, [k]: v } : c));

  const next = () => {
    if (!wizard) return;
    if (step === 0 && !wizard.name.trim()) return setErr('Name it, so you know which one is which.');
    if (step === 1 && wizard.interests.length === 0) return setErr('Pick at least one interest.');
    if (step === 2 && (!wizard.budget || wizard.budget < 200)) return setErr('PKR 200 a day is the smallest Meta will run.');
    if (step === 3 && !wizard.creative) return setErr('Choose which piece of content runs as the ad.');
    setErr('');
    if (step < 3) return setStep(step + 1);

    launch.run(1700, () => {
      const made = { ...wizard, id: uid(), status: 'live' as const };
      data.campaigns.unshift(made);
      record({
        agent: 'Ads',
        text: `Launched “${made.name}” at PKR ${made.budget.toLocaleString('en-US')} a day in ${made.city}.`,
        credits: COST.campaign,
        what: made.name,
        notice: {
          title: `“${made.name}” is live`,
          line: `PKR ${made.budget.toLocaleString('en-US')} a day, ${made.city}. She stops at the budget.`,
        },
      });
      setWizard(null);
      setStep(0);
      say('Campaign is live');
    });
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Vexa runs your Facebook, Instagram and Google ads to a daily budget you set. She never spends past it, and she pauses anything that stops paying." />

        <SlowNote visible={load.slow} line="Slow connection — fetching today's spend" />
        {load.failed ? <ErrorNote onRetry={load.retry} line="Could not read today's ad spend. Meta did not answer." /> : null}

        {load.loading ? (
          <SkeletonList rows={1} />
        ) : load.failed ? null : (
          <Stagger>
            <Glass style={st.hero} radius={R.xl} lit>
              <View style={st.heroInner}>
                <Ring
                  pct={budgetToday ? spendToday / budgetToday : 0}
                  size={96}
                  label={`${Math.round(budgetToday ? (spendToday / budgetToday) * 100 : 0)}%`}
                  sub="of today"
                />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={st.heroLabel}>SPENT TODAY</Text>
                  <Text style={st.heroValue}>PKR {spendToday.toLocaleString('en-US')}</Text>
                  <Text style={st.heroSub}>
                    Daily budget PKR {budgetToday.toLocaleString('en-US')} · hard cap on the account
                  </Text>
                  <Meter pct={budgetToday ? spendToday / budgetToday : 0} />
                </View>
              </View>
            </Glass>
          </Stagger>
        )}

        <View style={st.statRow}>
          <Stat label="Leads" value={totalLeads} index={0} />
          <Stat label="Blended ROAS" value={Math.round(blended * 10) / 10} suffix="×" decimals={1} index={1} />
          <Stat label="Running" value={data.campaigns.filter((c) => c.status === 'live').length} index={2} />
        </View>

        <View style={{ marginTop: 14 }}>
          <Segment items={VIEWS} value={view} onChange={setView} />
        </View>

        <SectionTitle text="CAMPAIGNS" right={<Tag text={`${rows.length}`} tone="lime" />} />

        {load.loading ? (
          <SkeletonList rows={2} />
        ) : rows.length === 0 ? (
          <Empty
            icon={<MegaphoneIcon size={24} />}
            title="No campaigns here"
            line="Vexa can build one from any post you have already written."
            cta="Build a campaign"
            onCta={() => {
              setWizard(blank());
              setStep(0);
            }}
          />
        ) : (
          rows.map((c, i) => (
            <Stagger key={c.id} index={i} style={{ marginBottom: 10 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={c.status === 'live'} onPress={() => setOpen(c)}>
                <View style={st.card}>
                  <View style={st.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>{c.name}</Text>
                      <View style={st.cardMeta}>
                        <MarkRow list={c.platforms} size={13} />
                        <Text style={st.cardMetaText}>
                          {c.goal} · {c.city}
                        </Text>
                      </View>
                    </View>
                    <Tag text={STATUS[c.status].text} tone={STATUS[c.status].tone} />
                  </View>

                  <View style={st.numbers}>
                    <View>
                      <Text style={st.numLabel}>Budget / day</Text>
                      <Text style={st.numValue}>PKR {c.budget.toLocaleString('en-US')}</Text>
                    </View>
                    <View>
                      <Text style={st.numLabel}>Spent</Text>
                      <Text style={st.numValue}>PKR {c.spend.toLocaleString('en-US')}</Text>
                    </View>
                    <View>
                      <Text style={st.numLabel}>Leads</Text>
                      <Text style={st.numValue}>{c.leads}</Text>
                    </View>
                    <View>
                      <Text style={st.numLabel}>ROAS</Text>
                      <Text style={[st.numValue, { color: C.lime }]}>{c.roas}×</Text>
                    </View>
                  </View>

                  <Bars data={c.days} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} height={54} />

                  <View style={st.actions}>
                    {c.status === 'ended' ? (
                      <Tag text="Report only" />
                    ) : (
                      <Btn
                        label={c.status === 'live' ? 'Pause' : 'Resume'}
                        icon={c.status === 'live' ? <PauseIcon size={15} color="#0A1206" /> : <PlayIcon size={15} color="#0A1206" />}
                        small
                        onPress={() => {
                          c.status = c.status === 'live' ? 'paused' : 'live';
                          record({
                            agent: 'Ads',
                            text: `${c.status === 'live' ? 'Restarted' : 'Paused'} “${c.name}”.`,
                          });
                          say(c.status === 'live' ? 'Back on' : 'Paused — no further spend');
                        }}
                      />
                    )}
                    <IconBtn
                      size={34}
                      onPress={() => {
                        setWizard({ ...c });
                        setStep(0);
                      }}
                    >
                      <PencilIcon size={16} />
                    </IconBtn>
                    <IconBtn size={34} tone="bad" onPress={() => setKill(c)}>
                      <TrashIcon size={16} />
                    </IconBtn>
                  </View>
                </View>
              </Glass>
            </Stagger>
          ))
        )}

        <Btn
          label="Build a campaign"
          icon={<TargetIcon size={17} color="#0A1206" />}
          onPress={() => {
            setWizard(blank());
            setStep(0);
            setErr('');
          }}
          full
          style={{ marginTop: 14 }}
        />
      </Page>

      {/* read one campaign */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} full>
        {open ? (
          <View style={{ gap: 14 }}>
            <View style={st.statRow}>
              <Stat label="Reach" value={open.reach} index={0} />
              <Stat label="Leads" value={open.leads} index={1} />
              <Stat label="ROAS" value={open.roas} suffix="×" decimals={1} index={2} />
            </View>

            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
              <View style={st.block}>
                <Text style={st.blockTitle}>Spend, last 7 days</Text>
                <Bars data={open.days} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} />
                <Text style={st.blockNote}>
                  Daily budget PKR {open.budget.toLocaleString('en-US')}. The account also carries a hard spending
                  limit, so a runaway day is impossible.
                </Text>
              </View>
            </Glass>

            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
              <View style={st.block}>
                <Text style={st.blockTitle}>Who sees it</Text>
                <Text style={st.blockLine}>
                  {open.city} · {open.age} · {open.interests.join(', ')}
                </Text>
                <Text style={st.blockTitle}>Running as</Text>
                <Text style={st.blockLine}>{open.creative || 'Winter drop teaser (reel)'}</Text>
              </View>
            </Glass>

            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit>
              <View style={st.block}>
                <View style={st.whyHead}>
                  <BulbIcon size={18} />
                  <Text style={st.blockTitle}>Why it costs what it costs</Text>
                </View>
                <Text style={st.blockNote}>
                  You are paying PKR {cpmPkr().toLocaleString('en-US')} per thousand people reached, and PKR{' '}
                  {costPerLead().toLocaleString('en-US')} for each enquiry that comes of it. The evening rise is everyone
                  else bidding for the same hours — she moves the spend to the morning if it stays expensive.
                </Text>
              </View>
            </Glass>

            <Btn
              label={open.status === 'live' ? 'Pause this campaign' : 'Resume this campaign'}
              kind="ghost"
              onPress={() => {
                open.status = open.status === 'live' ? 'paused' : 'live';
                commit();
                setOpen(null);
                say('Updated');
              }}
              full
            />
          </View>
        ) : null}
      </Sheet>

      {/* create / update, four steps */}
      <Sheet
        open={!!wizard}
        onClose={() => {
          setWizard(null);
          setStep(0);
        }}
        title={wizard?.id ? 'Edit campaign' : 'New campaign'}
        full
      >
        {wizard ? (
          <View>
            <View style={st.wizHead}>
              <Text style={st.wizStep}>
                Step {step + 1} of 4 · {STEP_NAMES[step]}
              </Text>
              <Meter pct={(step + 1) / 4} />
            </View>

            {step === 0 ? (
              <>
                <Field label="NAME" value={wizard.name} onChangeText={(v) => set('name', v)} placeholder="Winter drop — Lahore" />
                <Text style={st.lab}>WHAT IS IT FOR</Text>
                <View style={{ marginBottom: 14 }}>
                  <Chips items={GOALS} on={[wizard.goal]} onToggle={(g) => set('goal', g as Campaign['goal'])} />
                </View>
                <Text style={st.lab}>WHERE IT RUNS</Text>
                <Chips
                  items={PLATFORMS.map((p) => PLATFORM_NAME[p])}
                  on={wizard.platforms.map((p) => PLATFORM_NAME[p])}
                  icons={Object.fromEntries(PLATFORMS.map((p) => [PLATFORM_NAME[p], <PlatformMark key={p} k={p} size={14} />]))}
                  onToggle={(name) => {
                    const k = PLATFORMS.find((p) => PLATFORM_NAME[p] === name) as Platform;
                    const on = wizard.platforms.includes(k);
                    set('platforms', on ? wizard.platforms.filter((p) => p !== k) : [...wizard.platforms, k]);
                  }}
                />
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Text style={st.lab}>CITY</Text>
                <View style={{ marginBottom: 14 }}>
                  <Chips items={CITIES} on={[wizard.city]} onToggle={(c) => set('city', c)} />
                </View>
                <Text style={st.lab}>AGE</Text>
                <View style={{ marginBottom: 14 }}>
                  <Chips items={AGES} on={[wizard.age]} onToggle={(a) => set('age', a)} />
                </View>
                <Text style={st.lab}>INTERESTS</Text>
                <Chips
                  items={INTERESTS}
                  on={wizard.interests}
                  onToggle={(i) =>
                    set('interests', wizard.interests.includes(i) ? wizard.interests.filter((x) => x !== i) : [...wizard.interests, i])
                  }
                />
                <Text style={st.hint}>
                  Vexa estimates {audienceOf(wizard.city, wizard.interests).toLocaleString('en-US')} people match this in{' '}
                  {wizard.city}.
                </Text>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Field
                  label="DAILY BUDGET"
                  value={String(wizard.budget)}
                  onChangeText={(v) => set('budget', Number(v.replace(/\D/g, '')) || 0)}
                  keyboard="number-pad"
                  prefix="PKR"
                  suffix="/ day"
                />
                <Chips items={BUDGETS} on={[String(wizard.budget)]} onToggle={(b) => set('budget', Number(b))} />
                <Glass style={{ alignSelf: 'stretch', marginTop: 16 }} radius={R.md}>
                  <View style={st.block}>
                    <Text style={st.blockTitle}>What that buys</Text>
                    <Text style={st.blockNote}>
                      About {Math.round((wizard.budget / cpmPkr()) * 1000).toLocaleString('en-US')} people reached a day, and
                      roughly {Math.max(1, Math.round(wizard.budget / Math.max(1, costPerLead())))} enquiries. PKR{' '}
                      {(wizard.budget * 30).toLocaleString('en-US')} a month at this rate.
                    </Text>
                    <Text style={st.blockNote}>
                      The daily budget is the cap. Vexa also keeps an account spending limit, so nothing can overrun it.
                    </Text>
                  </View>
                </Glass>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Text style={st.lab}>RUN WHICH PIECE</Text>
                <View style={{ gap: 8 }}>
                  {data.posts.slice(0, 5).map((p) => {
                    const on = wizard.creative === `${p.title} (${p.kind})`;
                    return (
                      <Glass
                        key={p.id}
                        style={{ alignSelf: 'stretch' }}
                        radius={R.md}
                        lit={on}
                        onPress={() => set('creative', `${p.title} (${p.kind})`)}
                      >
                        <View style={st.pick}>
                          <MarkRow list={p.platforms} size={14} />
                          <View style={{ flex: 1 }}>
                            <Text style={st.pickTitle}>{p.title}</Text>
                            <Text style={st.pickSub} numberOfLines={1}>
                              {p.caption}
                            </Text>
                          </View>
                          {on ? <Tag text="Chosen" tone="lime" /> : null}
                        </View>
                      </Glass>
                    );
                  })}
                </View>

                <Glass style={{ alignSelf: 'stretch', marginTop: 16 }} radius={R.md} lit>
                  <View style={st.block}>
                    <Text style={st.blockTitle}>Before it goes live</Text>
                    <Text style={st.blockNote}>
                      {wizard.goal} · {wizard.city} · {wizard.age} · PKR {wizard.budget.toLocaleString('en-US')} a day ·{' '}
                      {wizard.platforms.map((p) => PLATFORM_NAME[p]).join(', ')}
                    </Text>
                  </View>
                </Glass>
              </>
            ) : null}

            {err ? <Text style={st.err}>{err}</Text> : null}
            {launch.slow ? <Text style={st.slow}>Meta is slow right now — still submitting.</Text> : null}

            <View style={st.wizBtns}>
              {step > 0 ? <Btn label="Back" kind="ghost" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
              <Btn
                label={step < 3 ? 'Next' : wizard.id ? 'Save changes' : 'Launch campaign'}
                busy={launch.busy}
                onPress={next}
                style={{ flex: 1.4 }}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Confirm
        open={!!kill}
        title="Delete this campaign?"
        line="Spend already made stays on your invoice. Nothing further is spent."
        cta="Delete"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.campaigns = data.campaigns.filter((c) => c.id !== kill?.id);
          commit();
          setKill(null);
          say('Campaign deleted');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  hero: { alignSelf: 'stretch' },
  heroInner: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  heroLabel: { color: C.textDim, fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  heroValue: { color: C.text, fontSize: 23, fontWeight: '900' },
  heroSub: { color: C.textDim, fontSize: 11.5, lineHeight: 16 },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },

  card: { padding: 14, gap: 11 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  cardMetaText: { color: C.textDim, fontSize: 11.5, fontWeight: '600' },

  numbers: { flexDirection: 'row', justifyContent: 'space-between' },
  numLabel: { color: C.textFaint, fontSize: 10, fontWeight: '700' },
  numValue: { color: C.text, fontSize: 13, fontWeight: '800', marginTop: 2 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  block: { padding: 14, gap: 8 },
  blockTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  blockLine: { color: C.textDim, fontSize: 12.5 },
  blockNote: { color: C.textDim, fontSize: 12, lineHeight: 18 },
  whyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  wizHead: { gap: 8, marginBottom: 16 },
  wizStep: { color: C.lime, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4 },
  wizBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },

  pick: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 },
  pickTitle: { color: C.text, fontSize: 13.5, fontWeight: '700' },
  pickSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  hint: { color: C.green, fontSize: 11.5, fontWeight: '600', marginTop: 10 },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginTop: 14 },
  slow: { color: '#FFC24B', fontSize: 11.5, fontWeight: '700', marginTop: 14 },
});
