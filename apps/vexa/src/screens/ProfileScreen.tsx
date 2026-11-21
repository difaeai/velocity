import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Avatar from '../components/Avatar';
import Glass from '../components/Glass';
import {
  BellIcon,
  CapIcon,
  CardIcon,
  ChevronRight,
  ClockIcon,
  GlobeIcon,
  ImageIcon,
  LogoutIcon,
  MegaphoneIcon,
  PencilIcon,
  PersonIcon,
  PhoneIcon,
  PlugIcon,
  ShieldIcon,
  SparkleIcon,
  TrashIcon,
  UsersIcon,
} from '../components/Icons';
import {
  Btn,
  Confirm,
  Field,
  IconBtn,
  Lede,
  Page,
  Row,
  SectionTitle,
  Segment,
  Sheet,
  Stagger,
  Tag,
  ToggleRow,
  useToast,
} from '../components/kit';
import { useAction } from '../net';
import { commit, useDb } from '../store';
import { C, R } from '../theme';

const FIGURE = require('../../assets/vexa.png');

const TRADES = ['Clothing brand', 'Restaurant', 'Salon', 'Gym', 'Property', 'Shop'];

export default function ProfileScreen({
  onOpen,
  onLogout,
}: {
  onOpen?: (title: string) => void;
  onLogout?: () => void;
}) {
  const data = useDb();
  const save = useAction();
  const [toast, say] = useToast();

  const [biz, setBiz] = useState(false);
  const [name, setName] = useState(data.me.business);
  const [trade, setTrade] = useState(data.me.trade);
  const [city, setCity] = useState(data.me.city);
  const [about, setAbout] = useState(data.me.about);
  const [hours, setHours] = useState(data.me.hours);

  const [who, setWho] = useState(false);
  const [myName, setMyName] = useState(data.me.name);
  const [phone, setPhone] = useState(data.me.phone);

  const [lang, setLang] = useState<'en' | 'ur'>('en');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [help, setHelp] = useState(false);
  const [bye, setBye] = useState(false);
  const [wipe, setWipe] = useState(false);

  const notify = data.me.notify;
  const flip = (k: keyof typeof notify) => (v: boolean) => {
    notify[k] = v;
    commit();
  };

  return (
    <>
      <Page bottom={26}>
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
            <View style={st.head}>
              <Image source={FIGURE} style={st.figure} resizeMode="contain" />
              <Avatar size={64} />
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{data.me.name}</Text>
                <Text style={st.email}>{data.me.email}</Text>
                <View style={st.tagRow}>
                  <Tag text={`Vexa ${data.me.plan}`} tone="lime" />
                  <Tag text={`${data.accounts.filter((a) => a.state === 'connected').length} accounts`} tone="green" />
                </View>
              </View>
              <IconBtn size={34} onPress={() => setWho(true)}>
                <PencilIcon size={15} />
              </IconBtn>
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="YOUR BUSINESS" right={<IconBtn size={30} onPress={() => setBiz(true)}><PencilIcon size={14} /></IconBtn>} />
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg}>
            <View style={st.biz}>
              <View style={st.bizHead}>
                <View style={st.logo}>
                  <SparkleIcon size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.bizName}>{data.me.business}</Text>
                  <Text style={st.bizSub}>
                    {data.me.trade} · {data.me.city}
                  </Text>
                </View>
              </View>
              <Text style={st.bizAbout}>{data.me.about}</Text>
              <View style={st.bizRow}>
                <ClockIcon size={15} color={C.textDim} />
                <Text style={st.bizMeta}>{data.me.hours}</Text>
              </View>
              <View style={st.bizRow}>
                <PhoneIcon size={15} color={C.textDim} />
                <Text style={st.bizMeta}>{data.me.phone}</Text>
              </View>
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="HOW SHE SOUNDS" />
        <Stagger>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} onPress={() => onOpen?.('Make me Learn')}>
            <View style={st.voice}>
              <CapIcon size={20} />
              <View style={{ flex: 1 }}>
                <Text style={st.voiceText}>{data.me.voice}</Text>
                <Text style={st.voiceLink}>Teach her more in Make me Learn</Text>
              </View>
              <ChevronRight size={18} />
            </View>
          </Glass>
        </Stagger>

        <SectionTitle text="WHAT SHE MAY DO ON HER OWN" />
        <View style={{ gap: 8 }}>
          <ToggleRow
            icon={<SparkleIcon size={18} />}
            label="Post without asking"
            sub="Off means everything waits for your approval"
            value={data.me.autoPost}
            onChange={(v) => {
              data.me.autoPost = v;
              commit();
              say(v ? 'She posts on her own' : 'Everything waits for you');
            }}
          />
          <ToggleRow icon={<UsersIcon size={18} />} label="Answer customers" sub="Simple questions only; the rest come to you" value={notify.leads} onChange={flip('leads')} />
          <ToggleRow icon={<MegaphoneIcon size={18} />} label="Adjust ad budgets" sub="Inside the daily budget you set" value={notify.ads} onChange={flip('ads')} />
        </View>

        <SectionTitle text="TELL ME ABOUT" />
        <View style={{ gap: 8 }}>
          <ToggleRow icon={<BellIcon size={18} />} label="Posts going out" value={notify.posts} onChange={flip('posts')} />
          <ToggleRow icon={<BellIcon size={18} />} label="A weekly summary" sub="Sunday evening, one message" value={notify.weekly} onChange={flip('weekly')} />
        </View>

        <SectionTitle text="LANGUAGE" />
        <Segment
          items={[
            { key: 'en', label: 'English' },
            { key: 'ur', label: 'اردو' },
          ]}
          value={lang}
          onChange={(k) => {
            setLang(k);
            say(k === 'ur' ? 'Urdu is coming next' : 'English');
          }}
        />

        <SectionTitle text="LOOK" />
        <Segment
          items={[
            { key: 'dark', label: 'Dark' },
            { key: 'light', label: 'Light — soon' },
          ]}
          value={theme}
          onChange={(k) => {
            setTheme(k);
            if (k === 'light') say('The light theme is being drawn');
          }}
        />

        <SectionTitle text="ACCOUNT" />
        <Row icon={<PlugIcon size={19} />} label="Connected accounts" sub={`${data.accounts.filter((a) => a.state === 'connected').length} of ${data.accounts.length} live`} right={<ChevronRight size={18} />} onPress={() => onOpen?.('Connected Accounts')} index={0} />
        <Row icon={<CardIcon size={19} />} label="Billing & invoices" sub="Card, bank transfer, receipts" right={<ChevronRight size={18} />} onPress={() => onOpen?.('Billing')} index={1} />
        <Row icon={<GlobeIcon size={19} />} label="Help & support" sub="A human answers inside a day" right={<ChevronRight size={18} />} onPress={() => setHelp(true)} index={2} />
        <Row icon={<ShieldIcon size={19} />} label="Privacy" sub="What Vexa keeps, and for how long" right={<ChevronRight size={18} />} onPress={() => setHelp(true)} index={3} />
        <Row icon={<LogoutIcon size={19} />} label="Log out" right={null} onPress={() => setBye(true)} index={4} />

        <Btn label="Delete my account" kind="danger" icon={<TrashIcon size={16} />} onPress={() => setWipe(true)} full style={{ marginTop: 14 }} />
        <Text style={st.version}>Vexa v2.0.5 · Berreto (Private) Limited</Text>
      </Page>

      {/* update the business */}
      <Sheet open={biz} onClose={() => setBiz(false)} title="Your business" full>
        <Field label="BUSINESS NAME" value={name} onChangeText={setName} />
        <Text style={st.lab}>WHAT YOU DO</Text>
        <View style={{ marginBottom: 14 }}>
          <Segment
            items={TRADES.slice(0, 3).map((t) => ({ key: t, label: t }))}
            value={TRADES.slice(0, 3).includes(trade) ? trade : TRADES[0]}
            onChange={setTrade}
          />
        </View>
        <Field label="CITY" value={city} onChangeText={setCity} />
        <Field label="ABOUT" value={about} onChangeText={setAbout} multiline lines={3} />
        <Field label="OPENING HOURS" value={hours} onChangeText={setHours} />
        <Btn
          label="Choose a logo"
          kind="ghost"
          icon={<ImageIcon size={16} />}
          onPress={() => say('Logo picker is next')}
          full
          small
          style={{ marginBottom: 14 }}
        />
        <Btn
          label="Save business"
          busy={save.busy}
          onPress={() =>
            save.run(1200, () => {
              data.me.business = name.trim() || data.me.business;
              data.me.trade = trade;
              data.me.city = city.trim() || data.me.city;
              data.me.about = about;
              data.me.hours = hours;
              commit();
              setBiz(false);
              say('Business saved');
            })
          }
          full
        />
      </Sheet>

      {/* update me */}
      <Sheet open={who} onClose={() => setWho(false)} title="Your details">
        <Field label="NAME" value={myName} onChangeText={setMyName} />
        <Field label="PHONE" value={phone} onChangeText={setPhone} keyboard="phone-pad" />
        <Field label="EMAIL" value={data.me.email} onChangeText={() => {}} />
        <Btn
          label="Save"
          onPress={() => {
            data.me.name = myName.trim() || data.me.name;
            data.me.phone = phone.trim() || data.me.phone;
            commit();
            setWho(false);
            say('Saved');
          }}
          full
        />
      </Sheet>

      <Sheet open={help} onClose={() => setHelp(false)} title="Help & privacy">
        <View style={{ gap: 12 }}>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
            <View style={st.helpRow}>
              <PhoneIcon size={18} />
              <View style={{ flex: 1 }}>
                <Text style={st.helpTitle}>Talk to a person</Text>
                <Text style={st.helpSub}>business@velocityrides.app · answered inside a day</Text>
              </View>
            </View>
          </Glass>
          <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
            <View style={st.helpRow}>
              <ShieldIcon size={18} />
              <View style={{ flex: 1 }}>
                <Text style={st.helpTitle}>What Vexa keeps</Text>
                <Text style={st.helpSub}>
                  Your posts, your customers{'’'} messages and what you teach her. Nothing is sold, nothing trains
                  anyone else{'’'}s Vexa. Delete your account and it all goes within 30 days.
                </Text>
              </View>
            </View>
          </Glass>
          <Btn label="Close" kind="ghost" onPress={() => setHelp(false)} full />
        </View>
      </Sheet>

      <Confirm
        open={bye}
        title="Log out?"
        line="Vexa keeps working while you are away. You will need your number to sign back in."
        cta="Log out"
        onCancel={() => setBye(false)}
        onConfirm={() => {
          setBye(false);
          onLogout?.();
        }}
      />

      <Confirm
        open={wipe}
        title="Delete your account?"
        line="Everything goes: posts, enquiries, what she learned. It cannot be undone."
        cta="Delete it all"
        danger
        onCancel={() => setWipe(false)}
        onConfirm={() => {
          setWipe(false);
          say('Request sent — a person will call you first');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, overflow: 'hidden' },
  figure: { position: 'absolute', right: -54, bottom: -40, width: 190, height: 190, opacity: 0.12 },
  name: { color: C.text, fontSize: 17, fontWeight: '900' },
  email: { color: C.textDim, fontSize: 12, marginTop: 2 },
  tagRow: { flexDirection: 'row', gap: 7, marginTop: 7 },

  biz: { padding: 15, gap: 10 },
  bizHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(120,255,140,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizName: { color: C.text, fontSize: 15.5, fontWeight: '900' },
  bizSub: { color: C.textDim, fontSize: 11.5, marginTop: 2 },
  bizAbout: { color: C.textDim, fontSize: 12.5, lineHeight: 18 },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  bizMeta: { color: C.textDim, fontSize: 12 },

  voice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  voiceText: { color: C.text, fontSize: 12.5, lineHeight: 18 },
  voiceLink: { color: C.lime, fontSize: 11, fontWeight: '800', marginTop: 5 },

  helpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 13 },
  helpTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  helpSub: { color: C.textDim, fontSize: 12, marginTop: 4, lineHeight: 17.5 },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  version: { color: C.textFaint, fontSize: 10.5, textAlign: 'center', marginTop: 16 },
});
