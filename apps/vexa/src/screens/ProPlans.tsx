import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { CheckIcon, CrownIcon, SparkleIcon, StarIcon } from '../components/Icons';
import {
  Btn,
  Confirm,
  Lede,
  Page,
  SectionTitle,
  Segment,
  Sheet,
  Stagger,
  Tag,
  useToast,
} from '../components/kit';
import { useAction } from '../net';
import { commit, PLANS, record, useDb, type Plan } from '../store';
import { C, R } from '../theme';

const FAQ = [
  ['Can I stop whenever I like?', 'Yes. It runs to the end of the month you have paid for, then stops.'],
  ['What happens to my posts if I stop?', 'Anything already scheduled still goes out. Nothing new is written.'],
  ['Do you bill in rupees?', 'In Pakistan, yes — the card is charged in PKR at the day’s rate.'],
];

export default function ProPlans() {
  const data = useDb();
  const swap = useAction();
  const [toast, say] = useToast();

  const [yearly, setYearly] = useState(data.me.yearly);
  const [pick, setPick] = useState<Plan | null>(null);
  const [cancel, setCancel] = useState(false);
  const [why, setWhy] = useState<string[] | null>(null);

  const rate = (p: (typeof PLANS)[number]) => (yearly ? p.month - 3 : p.month);

  return (
    <>
      <Page bottom={30}>
        <Lede text="One price, everything included, no per-post charges. Change or stop it from this screen whenever you like." />

        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
            <View style={st.now}>
              <CrownIcon size={24} />
              <View style={{ flex: 1 }}>
                <Text style={st.nowTitle}>You are on Vexa {data.me.plan}</Text>
                <Text style={st.nowSub}>
                  ${PLANS.find((p) => p.key === data.me.plan)?.month ?? 26} a month · renews{' '}
                  {new Date(data.me.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Tag text="Active" tone="green" />
            </View>
          </Glass>
        </Stagger>

        <View style={{ marginTop: 16 }}>
          <Segment
            items={[
              { key: 'month', label: 'Monthly' },
              { key: 'year', label: 'Yearly — $3/mo off' },
            ]}
            value={yearly ? 'year' : 'month'}
            onChange={(k) => setYearly(k === 'year')}
          />
        </View>

        <SectionTitle text="PLANS" />

        {PLANS.map((p, i) => {
          const mine = p.key === data.me.plan;
          return (
            <Stagger key={p.key} index={i} style={{ marginBottom: 11 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit={p.key === 'Pro'}>
                <View style={st.plan}>
                  <View style={st.planHead}>
                    <View style={{ flex: 1 }}>
                      <View style={st.nameRow}>
                        <Text style={st.planName}>Vexa {p.key}</Text>
                        {p.key === 'Pro' ? <Tag text="Most taken" tone="lime" /> : null}
                        {mine ? <Tag text="Your plan" tone="green" /> : null}
                      </View>
                      <Text style={st.planLine}>{p.line}</Text>
                    </View>
                  </View>

                  <View style={st.priceRow}>
                    <Text style={st.price}>${rate(p)}</Text>
                    <Text style={st.per}>/ month</Text>
                    {yearly ? <Tag text={`billed $${rate(p) * 12} a year`} /> : null}
                  </View>

                  <View style={{ gap: 7 }}>
                    {p.has.map((h) => (
                      <View key={h} style={st.hasRow}>
                        <CheckIcon size={15} />
                        <Text style={st.hasText}>{h}</Text>
                      </View>
                    ))}
                  </View>

                  {mine ? (
                    <Btn label="This is your plan" kind="ghost" onPress={() => setWhy(p.has)} full style={{ marginTop: 4 }} />
                  ) : (
                    <Btn
                      label={PLANS.findIndex((x) => x.key === p.key) > PLANS.findIndex((x) => x.key === data.me.plan) ? `Move up to ${p.key}` : `Move down to ${p.key}`}
                      icon={<SparkleIcon size={16} color="#0A1206" />}
                      onPress={() => setPick(p.key)}
                      full
                      style={{ marginTop: 4 }}
                    />
                  )}
                </View>
              </Glass>
            </Stagger>
          );
        })}

        <SectionTitle text="WHAT PEOPLE ASK" />
        {FAQ.map(([q, a], i) => (
          <Stagger key={q} index={i} style={{ marginBottom: 9 }}>
            <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
              <View style={st.faq}>
                <View style={st.faqHead}>
                  <StarIcon size={15} />
                  <Text style={st.faqQ}>{q}</Text>
                </View>
                <Text style={st.faqA}>{a}</Text>
              </View>
            </Glass>
          </Stagger>
        ))}

        <Btn label="Cancel my plan" kind="danger" onPress={() => setCancel(true)} full style={{ marginTop: 14 }} />
      </Page>

      <Confirm
        open={!!pick}
        title={`Move to Vexa ${pick ?? ''}?`}
        line={
          pick
            ? `$${rate(PLANS.find((p) => p.key === pick)!)} a month from today. The change is instant and the difference is worked out on your next invoice.`
            : ''
        }
        cta="Change plan"
        busy={swap.busy}
        onCancel={() => setPick(null)}
        onConfirm={() =>
          swap.run(1600, () => {
            if (pick) data.me.plan = pick;
            data.me.yearly = yearly;
            commit();
            record({
              agent: 'Vexa',
              text: `You moved to Vexa ${data.me.plan}${yearly ? ', billed yearly' : ''}.`,
            });
            setPick(null);
            say(`You are on Vexa ${data.me.plan}`);
          })
        }
      />

      <Confirm
        open={cancel}
        title="Cancel your plan?"
        line={`Vexa finishes what is already scheduled, then stops writing, answering and running ads on ${new Date(data.me.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`}
        cta="Cancel plan"
        danger
        onCancel={() => setCancel(false)}
        onConfirm={() => {
          setCancel(false);
          record({ agent: 'Vexa', text: 'You cancelled the plan — she works to the end of the month you paid for.' });
          say('Cancelled — she works to the end of the month');
        }}
      />

      <Sheet open={!!why} onClose={() => setWhy(null)} title="What your plan includes">
        <View style={{ gap: 9 }}>
          {(why ?? []).map((h, i) => (
            <Stagger key={h} index={i}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                <View style={st.whyRow}>
                  <CheckIcon size={16} />
                  <Text style={st.hasText}>{h}</Text>
                </View>
              </Glass>
            </Stagger>
          ))}
        </View>
      </Sheet>

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  now: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  nowTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  nowSub: { color: C.textDim, fontSize: 12, marginTop: 3 },

  plan: { padding: 16, gap: 12 },
  planHead: { flexDirection: 'row', alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planName: { color: C.text, fontSize: 17, fontWeight: '900' },
  planLine: { color: C.textDim, fontSize: 12, marginTop: 5, lineHeight: 17 },

  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  price: { color: C.lime, fontSize: 30, fontWeight: '900' },
  per: { color: C.textDim, fontSize: 12.5, fontWeight: '700', marginBottom: 5 },

  hasRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hasText: { color: C.text, fontSize: 12.5, flex: 1 },

  faq: { padding: 13, gap: 7 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faqQ: { color: C.text, fontSize: 13, fontWeight: '800', flex: 1 },
  faqA: { color: C.textDim, fontSize: 12, lineHeight: 17.5 },

  whyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
});
