import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { ActivityIcon, ChartUpIcon, CoinIcon, DocPenIcon, MegaphoneIcon, SearchIcon, SparkleIcon } from '../components/Icons';
import {
  Bars,
  Btn,
  Confirm,
  Empty,
  Lede,
  LoadingBar,
  Meter,
  Page,
  Ring,
  SectionTitle,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Stat,
  Tag,
  ToggleRow,
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import {
  COST,
  COST_LIST,
  DAY,
  TEAM,
  commit,
  creditsLeft,
  creditsTotal,
  creditsUsed,
  daysOfCreditsLeft,
  record,
  spendByAgent,
  spendWeek,
  spentSince,
  useDb,
  type Agent,
} from '../store';
import { C, R } from '../theme';

const ICON: Record<Agent, React.ReactNode> = {
  Content: <DocPenIcon size={18} />,
  Sales: <ChartUpIcon size={18} />,
  Ads: <MegaphoneIcon size={18} />,
  Research: <SearchIcon size={18} />,
  Vexa: <SparkleIcon size={18} />,
};

const PACKS = [
  { credits: 500, price: 5 },
  { credits: 1500, price: 12 },
  { credits: 5000, price: 35 },
];

export default function UsageScreen() {
  const data = useDb();
  const load = useLoad(800);
  const buy = useAction();
  const [toast, say] = useToast();
  const [top, setTop] = useState(false);
  const [pick, setPick] = useState<(typeof PACKS)[number] | null>(null);

  // Everything on this screen is counted out of the ledger.
  const used = creditsUsed();
  const total = creditsTotal();
  const left = creditsLeft();
  const share = total ? used / total : 0;
  const week = spendWeek();
  const byAgent = spendByAgent();
  const topAgent = byAgent[0]?.credits ?? 1;
  const lasts = daysOfCreditsLeft();
  const perDay = Math.round(spentSince(7 * DAY) / 7);

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Credits are what Vexa spends to write, answer and research. Your plan refills them on the 1st; nothing stops working when they run out — she just slows to the essentials." />

        <SlowNote visible={load.slow} />

        {load.loading ? (
          <SkeletonList rows={2} />
        ) : (
          <>
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
                <View style={st.hero}>
                  <Ring pct={share} size={104} label={`${Math.round(share * 100)}%`} sub="used" />
                  <View style={{ flex: 1, gap: 7 }}>
                    <Text style={st.heroTitle}>
                      {used.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
                    </Text>
                    <Text style={st.heroSub}>
                      {left.toLocaleString('en-US')} left · refills{' '}
                      {new Date(data.me.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </Text>
                    <Meter pct={share} />
                    <Text style={st.heroNote}>
                      {lasts === Infinity
                        ? 'Nothing spent this week.'
                        : `At this week's rate they last another ${lasts} ${lasts === 1 ? 'day' : 'days'}.`}
                    </Text>
                  </View>
                </View>
              </Glass>
            </Stagger>

            <View style={st.statRow}>
              <Stat label="Today" value={spentSince(DAY)} suffix=" cr" index={0} />
              <Stat label="This week" value={spentSince(7 * DAY)} suffix=" cr" index={1} />
              <Stat label="Per day avg" value={perDay} suffix=" cr" index={2} />
            </View>

            <SectionTitle text="LAST 7 DAYS" />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.block}>
                  <Bars data={week.data} labels={week.labels} />
                </View>
              </Glass>
            </Stagger>

            <SectionTitle text="WHERE THEY WENT" right={<Tag text="this month" />} />
            {byAgent.length === 0 ? (
              <Empty icon={<CoinIcon size={24} />} title="Nothing spent yet" line="As soon as she does a piece of work it shows up here." />
            ) : (
              byAgent.map((a, i) => (
                <Stagger key={a.agent} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                    <View style={st.agent}>
                      <View style={st.agentIcon}>{ICON[a.agent]}</View>
                      <View style={{ flex: 1, gap: 7 }}>
                        <View style={st.agentHead}>
                          <Text style={st.agentName}>{TEAM[a.agent]}</Text>
                          <Text style={st.agentNo}>{a.credits.toLocaleString('en-US')} cr</Text>
                        </View>
                        <Meter pct={a.credits / topAgent} h={5} />
                      </View>
                    </View>
                  </Glass>
                </Stagger>
              ))
            )}

            <SectionTitle text="WHAT THINGS COST" />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.costs}>
                  {COST_LIST.map(([what, key]) => (
                    <View key={what} style={st.costRow}>
                      <Text style={st.costWhat}>{what}</Text>
                      <Tag text={`${COST[key]} credit${COST[key] === 1 ? '' : 's'}`} tone="lime" />
                    </View>
                  ))}
                </View>
              </Glass>
            </Stagger>

            <SectionTitle text="LAST FEW THINGS SHE SPENT ON" />
            {data.usage.slice(0, 5).map((u, i) => (
              <Stagger key={u.id} index={i} style={{ marginBottom: 8 }}>
                <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                  <View style={st.spendRow}>
                    <View style={st.agentIcon}>{ICON[u.agent]}</View>
                    <Text style={st.spendWhat} numberOfLines={1}>
                      {u.what}
                    </Text>
                    <Text style={st.spendNo}>{u.credits} cr</Text>
                  </View>
                </Glass>
              </Stagger>
            ))}

            <View style={{ marginTop: 14 }}>
              <ToggleRow
                icon={<ActivityIcon size={19} color={C.green} />}
                label="Top up on its own"
                sub="Buy 1,500 credits whenever fewer than 200 are left"
                value={data.me.autoTopUp}
                onChange={(v) => {
                  data.me.autoTopUp = v;
                  commit();
                  say(v ? 'Auto top-up on' : 'Auto top-up off');
                }}
              />
            </View>

            <Btn
              label="Top up credits"
              icon={<CoinIcon size={17} color="#0A1206" />}
              onPress={() => setTop(true)}
              full
              style={{ marginTop: 14 }}
            />
          </>
        )}
      </Page>

      <Sheet open={top} onClose={() => setTop(false)} title="Top up credits">
        <View style={{ gap: 10 }}>
          {PACKS.map((p, i) => (
            <Stagger key={p.credits} index={i}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={p.credits === 1500} onPress={() => setPick(p)}>
                <View style={st.pack}>
                  <CoinIcon size={22} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.packTitle}>{p.credits.toLocaleString('en-US')} credits</Text>
                    <Text style={st.packSub}>About {Math.round(p.credits / COST.post)} written posts</Text>
                  </View>
                  <Text style={st.packPrice}>${p.price}</Text>
                </View>
              </Glass>
            </Stagger>
          ))}
          <Text style={st.packNote}>
            Charged to the card on your Billing screen. In Pakistan you are billed in PKR.
          </Text>
        </View>
      </Sheet>

      <Confirm
        open={!!pick}
        title={`Buy ${pick?.credits.toLocaleString('en-US') ?? ''} credits?`}
        line={`$${pick?.price ?? 0} goes to the card ending ${data.cards.find((c) => c.primary)?.last4 ?? '—'}. The credits are there at once.`}
        cta="Buy now"
        busy={buy.busy}
        onCancel={() => setPick(null)}
        onConfirm={() =>
          buy.run(1500, () => {
            const bought = pick?.credits ?? 0;
            data.me.extraCredits += bought;
            data.invoices.unshift({
              id: Math.random().toString(36).slice(2, 9),
              no: `VX-${new Date().getFullYear()}-${String(data.invoices.length + 12).padStart(2, '0')}`,
              at: Date.now(),
              amount: pick?.price ?? 0,
              state: 'paid',
            });
            record({
              agent: 'Vexa',
              text: `You topped up ${bought.toLocaleString('en-US')} credits.`,
            });
            setPick(null);
            setTop(false);
            say('Credits added');
          })
        }
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  heroTitle: { color: C.text, fontSize: 19, fontWeight: '900' },
  heroSub: { color: C.textDim, fontSize: 11.5 },
  heroNote: { color: C.green, fontSize: 11, fontWeight: '700' },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  block: { padding: 14 },

  agent: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  agentIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentName: { color: C.text, fontSize: 13.5, fontWeight: '700' },
  agentNo: { color: C.textDim, fontSize: 12, fontWeight: '800' },

  costs: { padding: 14, gap: 11 },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  costWhat: { color: C.textDim, fontSize: 12.5, flex: 1 },

  spendRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 10 },
  spendWhat: { color: C.text, fontSize: 12.5, flex: 1, fontWeight: '600' },
  spendNo: { color: C.lime, fontSize: 12, fontWeight: '800' },

  pack: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  packTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  packSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },
  packPrice: { color: C.lime, fontSize: 17, fontWeight: '900' },
  packNote: { color: C.textFaint, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
});
