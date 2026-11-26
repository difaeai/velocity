import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  CardIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  CrownIcon,
  DownloadIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
} from '../components/Icons';
import {
  Btn,
  Confirm,
  Empty,
  Field,
  IconBtn,
  Lede,
  LoadingBar,
  Page,
  SectionTitle,
  Segment,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Tag,
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import { BANK, commit, db, PLANS, uid, useDb, type Card } from '../store';
import { C, R } from '../theme';

export default function Billing({ onOpen }: { onOpen?: (title: string) => void }) {
  const data = useDb();
  const load = useLoad(900);
  const save = useAction();
  const paid = useAction();
  const [toast, say] = useToast();

  const [how, setHow] = useState<'card' | 'bank'>('card');
  const [add, setAdd] = useState(false);
  const [no, setNo] = useState('');
  const [name, setName] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [err, setErr] = useState('');
  const [kill, setKill] = useState<Card | null>(null);
  const [bank, setBank] = useState(false);
  const [details, setDetails] = useState(false);
  const [biz, setBiz] = useState(data.me.business);
  const [city, setCity] = useState(data.me.city);

  const digits = no.replace(/\D/g, '');

  const addCard = () => {
    if (digits.length < 16) return setErr('A card number is 16 digits.');
    if (!/^\d{2}\s?\/\s?\d{2}$/.test(exp)) return setErr('Expiry goes in as MM / YY.');
    if (cvc.replace(/\D/g, '').length < 3) return setErr('The CVC is the 3 digits on the back.');

    save.run(1600, () => {
      data.cards.forEach((c) => {
        c.primary = false;
      });
      data.cards.push({
        id: uid(),
        brand: digits.startsWith('5') ? 'Mastercard' : 'Visa',
        last4: digits.slice(-4),
        exp: exp.replace(/\s/g, '').replace('/', ' / '),
        primary: true,
      });
      commit();
      setAdd(false);
      setNo('');
      setName('');
      setExp('');
      setCvc('');
      setErr('');
      say('Card added and made primary');
    });
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="Your plan, how you pay for it, and every invoice Vexa has issued." />

        <SlowNote visible={load.slow} />

        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
            <View style={st.plan}>
              <View style={st.planHead}>
                <CrownIcon size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={st.planName}>Vexa {data.me.plan}</Text>
                  <Text style={st.planSub}>
                    ${PLANS.find((p) => p.key === data.me.plan)?.month ?? 26} a month ·{' '}
                    {data.me.yearly ? 'billed yearly' : 'billed monthly'}
                  </Text>
                </View>
                <Tag text="Active" tone="green" />
              </View>
              <Text style={st.planNote}>Renews {new Date(data.me.renews).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Cancel any time; it runs to the end of the month you paid for.</Text>
              <Btn label="Change plan" kind="ghost" small onPress={() => onOpen?.('Vexa Pro')} full />
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="HOW YOU PAY" />
        <Segment
          items={[
            { key: 'card', label: 'Card' },
            { key: 'bank', label: 'Bank transfer' },
          ]}
          value={how}
          onChange={setHow}
        />

        {how === 'card' ? (
          <View style={{ marginTop: 12 }}>
            {load.loading ? (
              <SkeletonList rows={1} />
            ) : data.cards.length === 0 ? (
              <Empty
                icon={<CardIcon size={24} />}
                title="No card on file"
                line="Add one and Vexa keeps running without a gap."
                cta="Add a card"
                onCta={() => setAdd(true)}
              />
            ) : (
              data.cards.map((c, i) => (
                <Stagger key={c.id} index={i} style={{ marginBottom: 9 }}>
                  <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={c.primary}>
                    <View style={st.card}>
                      <View style={st.cardMark}>
                        <CardIcon size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.cardName}>
                          {c.brand} •••• {c.last4}
                        </Text>
                        <Text style={st.cardSub}>Expires {c.exp}</Text>
                      </View>
                      {c.primary ? (
                        <Tag text="Primary" tone="lime" />
                      ) : (
                        <IconBtn
                          size={32}
                          onPress={() => {
                            data.cards.forEach((x) => {
                              x.primary = x.id === c.id;
                            });
                            commit();
                            say('Made primary');
                          }}
                        >
                          <CheckIcon size={15} />
                        </IconBtn>
                      )}
                      <IconBtn size={32} tone="bad" onPress={() => setKill(c)}>
                        <TrashIcon size={15} />
                      </IconBtn>
                    </View>
                  </Glass>
                </Stagger>
              ))
            )}

            <Btn
              label="Add a card"
              icon={<PlusIcon size={16} />}
              onPress={() => {
                setAdd(true);
                setErr('');
              }}
              full
              style={{ marginTop: 4 }}
            />
          </View>
        ) : (
          <Stagger style={{ marginTop: 12 }}>
            <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
              <View style={st.bank}>
                <Text style={st.bankLede}>Send the amount to this account, then tell Vexa. A human checks it inside a day.</Text>
                {BANK.map(([k, v]) => (
                  <View key={k} style={st.bankRow}>
                    <Text style={st.bankKey}>{k}</Text>
                    <Text style={st.bankVal}>{v}</Text>
                  </View>
                ))}
                <View style={st.bankBtns}>
                  <Btn label="Copy details" kind="ghost" icon={<CopyIcon size={15} />} small onPress={() => say('Copied')} style={{ flex: 1 }} />
                  <Btn label="I have paid" small onPress={() => setBank(true)} style={{ flex: 1 }} />
                </View>
                <Text style={st.bankNote}>Bank transfer only — no easypaisa or JazzCash. Amounts in PKR inside Pakistan.</Text>
              </View>
            </Glass>
          </Stagger>
        )}

        <SectionTitle text="INVOICES" right={<Tag text={`${data.invoices.length}`} tone="lime" />} />
        {load.loading ? (
          <SkeletonList rows={3} />
        ) : (
          data.invoices.map((inv, i) => (
            <Stagger key={inv.id} index={i} style={{ marginBottom: 9 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                <View style={st.inv}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.invNo}>{inv.no}</Text>
                    <Text style={st.invDate}>{new Date(inv.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                  </View>
                  <Text style={st.invAmount}>${inv.amount}</Text>
                  {inv.state === 'paid' ? <CheckCircleIcon size={18} /> : <Tag text="Due" tone="warn" />}
                  <IconBtn size={32} onPress={() => say(`${inv.no} downloaded`)}>
                    <DownloadIcon size={15} />
                  </IconBtn>
                </View>
              </Glass>
            </Stagger>
          ))
        )}

        <SectionTitle text="BILLING DETAILS" />
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} onPress={() => setDetails(true)}>
            <View style={st.detail}>
              <View style={{ flex: 1 }}>
                <Text style={st.detailName}>{data.me.business}</Text>
                <Text style={st.detailSub}>
                  {data.me.city}, Pakistan · {data.me.email}
                </Text>
              </View>
              <Tag text="Edit" tone="lime" />
            </View>
          </Glass>
        </Stagger>

        <Stagger>
          <Glass style={{ alignSelf: 'stretch', marginTop: 12 }} radius={R.md}>
            <View style={st.safe}>
              <ShieldIcon size={19} />
              <Text style={st.safeText}>Card details are held by the payment provider, never by Vexa.</Text>
            </View>
          </Glass>
        </Stagger>
      </Page>

      {/* create a card */}
      <Sheet open={add} onClose={() => setAdd(false)} title="Add a card">
        <Field
          label="CARD NUMBER"
          value={no}
          onChangeText={(v) => setNo(v.replace(/[^\d ]/g, '').slice(0, 19))}
          keyboard="number-pad"
          placeholder="4242 4242 4242 4242"
        />
        <Field label="NAME ON CARD" value={name} onChangeText={setName} placeholder="Hassan Zahir" />
        <View style={st.twoUp}>
          <Field label="EXPIRY" value={exp} onChangeText={setExp} placeholder="09 / 29" style={{ flex: 1 }} />
          <Field
            label="CVC"
            value={cvc}
            onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
            keyboard="number-pad"
            placeholder="123"
            style={{ flex: 1 }}
          />
        </View>
        {err ? <Text style={st.err}>{err}</Text> : null}
        {save.slow ? <Text style={st.slow}>The bank is slow to answer — still checking the card.</Text> : null}
        <Btn label="Save card" busy={save.busy} onPress={addCard} full />
      </Sheet>

      {/* bank transfer told */}
      <Sheet open={bank} onClose={() => setBank(false)} title="Tell us about the transfer">
        <Field label="AMOUNT" value="7,300" onChangeText={() => {}} prefix="PKR" />
        <Field label="REFERENCE / TRANSACTION ID" value="" onChangeText={() => {}} placeholder="e.g. 884512309" />
        <Btn
          label={paid.busy ? 'Sending…' : 'Send for checking'}
          busy={paid.busy}
          onPress={() =>
            paid.run(1500, () => {
              setBank(false);
              say('Sent — someone checks it within a day');
            })
          }
          full
        />
        <Text style={st.slow}>{paid.slow ? 'Slow connection — still sending.' : ''}</Text>
      </Sheet>

      {/* update billing details */}
      <Sheet open={details} onClose={() => setDetails(false)} title="Billing details">
        <Field label="BUSINESS NAME" value={biz} onChangeText={setBiz} />
        <Field label="CITY" value={city} onChangeText={setCity} />
        <Btn
          label="Save details"
          onPress={() => {
            data.me.business = biz.trim() || data.me.business;
            data.me.city = city.trim() || data.me.city;
            commit();
            setDetails(false);
            say('Details saved');
          }}
          full
        />
      </Sheet>

      <Confirm
        open={!!kill}
        title="Remove this card?"
        line={
          kill?.primary
            ? 'It is your primary card. Add another one first, or Vexa cannot renew your plan.'
            : 'You can add it again whenever you like.'
        }
        cta="Remove"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.cards = data.cards.filter((c) => c.id !== kill?.id);
          if (db.cards.length && !db.cards.some((c) => c.primary)) db.cards[0].primary = true;
          commit();
          setKill(null);
          say('Card removed');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  plan: { padding: 16, gap: 10 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planName: { color: C.text, fontSize: 17, fontWeight: '900' },
  planSub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  planNote: { color: C.textDim, fontSize: 11.5, lineHeight: 17 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 },
  cardMark: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardName: { color: C.text, fontSize: 14, fontWeight: '800' },
  cardSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },

  bank: { padding: 15, gap: 9 },
  bankLede: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  bankRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  bankKey: { color: C.textFaint, fontSize: 11.5, fontWeight: '700' },
  bankVal: { color: C.text, fontSize: 12.5, fontWeight: '700', flex: 1, textAlign: 'right' },
  bankBtns: { flexDirection: 'row', gap: 9, marginTop: 6 },
  bankNote: { color: C.textFaint, fontSize: 11, lineHeight: 16 },

  inv: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 12 },
  invNo: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  invDate: { color: C.textDim, fontSize: 11, marginTop: 2 },
  invAmount: { color: C.text, fontSize: 14, fontWeight: '900' },

  detail: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  detailName: { color: C.text, fontSize: 14, fontWeight: '800' },
  detailSub: { color: C.textDim, fontSize: 11.5, marginTop: 3 },

  safe: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 },
  safeText: { color: C.textDim, fontSize: 11.5, flex: 1, lineHeight: 16 },

  twoUp: { flexDirection: 'row', gap: 10 },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  slow: { color: '#FFC24B', fontSize: 11.5, fontWeight: '700', marginBottom: 8 },
});
