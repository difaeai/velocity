import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { ActivityIcon, ChartUpIcon, CoinIcon, DocPenIcon, MegaphoneIcon, SearchIcon } from '../components/Icons';
import {
  Bars,
  Btn,
  Confirm,
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
import { commit, useDb } from '../store';
import { C, R } from '../theme';

const BY_AGENT = [
  { name: 'Content Team', used: 1180, icon: <DocPenIcon size={18} /> },
  { name: 'Sales Team', used: 640, icon: <ChartUpIcon size={18} /> },
  { name: 'Ads Expert', used: 380, icon: <MegaphoneIcon size={18} /> },
  { name: 'Research Team', used: 200, icon: <SearchIcon size={18} /> },
];

const COSTS = [
  ['A written post with hashtags', '4 credits'],
  ['A reel script + its edit', '12 credits'],
  ['An answer to a customer', '1 credit'],
  ['A research brief', '25 credits'],
  ['A campaign built and launched', '15 credits'],
];

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
  const [auto, setAuto] = useState(false);

  const { used, total } = data.me.credits;
  const left = Math.max(0, total - used);
  const share = total ? used / total : 0;

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
                    <Text style={st.heroSub}>{left.toLocaleString('en-US')} credits left · refills on 1 Dec</Text>
                    <Meter pct={share} />
                    <Text style={st.heroNote}>At this rate they last another 9 days.</Text>
                  </View>
                </View>
              </Glass>
            </Stagger>

            <View style={st.statRow}>
              <Stat label="Today" value={168} suffix=" cr" index={0} />
              <Stat label="This week" value={1140} suffix=" cr" index={1} />
              <Stat label="Per day avg" value={163} suffix=" cr" index={2} />
            </View>

            <SectionTitle text="LAST 7 DAYS" />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.block}>
                  <Bars
                    data={[120, 190, 140, 210, 260, 162, 168]}
                    labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
                  />
                </View>
              </Glass>
            </Stagger>

            <SectionTitle text="WHERE THEY WENT" />
            {BY_AGENT.map((a, i) => (
              <Stagger key={a.name} index={i} style={{ marginBottom: 9 }}>
                <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                  <View style={st.agent}>
                    <View style={st.agentIcon}>{a.icon}</View>
                    <View style={{ flex: 1, gap: 7 }}>
                      <View style={st.agentHead}>
                        <Text style={st.agentName}>{a.name}</Text>
                        <Text style={st.agentNo}>{a.used} cr</Text>
                      </View>
                      <Meter pct={a.used / used} h={5} />
                    </View>
                  </View>
                </Glass>
              </Stagger>
            ))}

            <SectionTitle text="WHAT THINGS COST" />
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
                <View style={st.costs}>
                  {COSTS.map(([what, cost]) => (
                    <View key={what} style={st.costRow}>
                      <Text style={st.costWhat}>{what}</Text>
                      <Tag text={cost} tone="lime" />
                    </View>
                  ))}
                </View>
              </Glass>
            </Stagger>

            <View style={{ marginTop: 14 }}>
              <ToggleRow
                icon={<ActivityIcon size={19} color={C.green} />}
                label="Top up on its own"
                sub="Buy 1,500 credits whenever fewer than 200 are left"
                value={auto}
                onChange={(v) => {
                  setAuto(v);
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
                    <Text style={st.packSub}>About {Math.round(p.credits / 4)} written posts</Text>
                  </View>
                  <Text style={st.packPrice}>${p.price}</Text>
                </View>
              </Glass>
            </Stagger>
          ))}
          <Text style={st.packNote}>Charged to the card on your Billing screen. In Pakistan you are billed in PKR.</Text>
        </View>
      </Sheet>

      <Confirm
        open={!!pick}
        title={`Buy ${pick?.credits.toLocaleString('en-US') ?? ''} credits?`}
        line={`$${pick?.price ?? 0} goes to the card ending 4242. The credits are there at once.`}
        cta="Buy now"
        busy={buy.busy}
        onCancel={() => setPick(null)}
        onConfirm={() =>
          buy.run(1500, () => {
            data.me.credits.total += pick?.credits ?? 0;
            commit();
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

  pack: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  packTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  packSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },
  packPrice: { color: C.lime, fontSize: 17, fontWeight: '900' },
  packNote: { color: C.textFaint, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
});
