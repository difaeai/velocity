/**
 * Queries, as a demo — asking a business about an offer, and answering.
 *
 * Deliberately NOT `offer-query/[queryId]`: that screen reads and writes a real
 * conversation and pushes to a real person. This one is local state only.
 * Nothing leaves the phone, nobody is notified, nothing is counted. Expo Router
 * prefers the static segment, so `/passenger/offer-query/demo` lands here, and a
 * real thread id (`{adId}_{uid}`) can never be the word "demo".
 *
 * Two sides, because the person looking at this is usually a business owner
 * deciding whether to buy: "As a customer" shows what their customers can do,
 * "As the business" shows the inbox they would be answering from.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_OFFER } from '../../../src/ads/demoOffer';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';
import { Segmented } from '../../../src/ui/partner';

type Side = 'customer' | 'business';

interface DemoMessage {
  id: string;
  from: Side;
  text: string;
}

const PROMPTS = ['Is this offer still on?', 'Does it include delivery?', 'What are your timings?'];

/** The made-up branch's answers. Keyed loosely so a typed question still gets one. */
function cannedReply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes('deliver')) return 'Dine-in and takeaway only for this one — show the offer at the counter before you pay.';
  if (q.includes('time') || q.includes('when') || q.includes('open')) return 'Every Sunday, 1 PM to 4 PM. We are open till midnight otherwise.';
  if (q.includes('still') || q.includes('valid')) return 'Yes! Running every Sunday this month. See you soon 🍗';
  return 'Thanks for asking! Drop by the Gulberg Greens branch on Sunday between 1 and 4 PM for 25% off.';
}

const BUSINESS_SEED: DemoMessage[] = [
  { id: 'seed-1', from: 'customer', text: 'Hi, is the 25% off on family buckets too?' },
];

export default function DemoQueryScreen() {
  const router = useRouter();
  const [side, setSide] = useState<Side>('customer');
  const [customerMsgs, setCustomerMsgs] = useState<DemoMessage[]>([]);
  const [businessMsgs, setBusinessMsgs] = useState<DemoMessage[]>(BUSINESS_SEED);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<FlatList<DemoMessage>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const messages = side === 'customer' ? customerMsgs : businessMsgs;

  useEffect(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, [messages.length, typing]);

  function send(body = text) {
    const trimmed = body.trim();
    if (!trimmed) return;
    setText('');
    nextId.current += 1;
    const id = `m${nextId.current}`;

    if (side === 'customer') {
      setCustomerMsgs((m) => [...m, { id, from: 'customer', text: trimmed }]);
      setTyping(true);
      setNote(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setTyping(false);
        setCustomerMsgs((m) => [...m, { id: `${id}-r`, from: 'business', text: cannedReply(trimmed) }]);
        setNote('In the real thing, this reply arrives as a notification — even with Velocity Rides closed.');
      }, 1400);
    } else {
      setBusinessMsgs((m) => [...m, { id, from: 'business', text: trimmed }]);
      setNote('Sent (demo). Ayesha would get your answer as a notification on her phone.');
    }
  }

  const title = side === 'customer' ? `${DEMO_OFFER.businessName} ${DEMO_OFFER.branch}` : 'Ayesha';
  const sub = side === 'customer' ? 'Ask the business' : 'Customer question';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/business-ads'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.headerSub}>{sub}</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.top}>
          <View style={styles.banner}>
            <Text style={styles.bannerTxt}>
              DEMO · Nothing here is sent to anyone. Try both sides.
            </Text>
          </View>
          <Segmented<Side>
            options={[
              { key: 'customer', label: 'As a customer' },
              { key: 'business', label: 'As the business' },
            ]}
            value={side}
            onChange={(next) => {
              setSide(next);
              setNote(null);
              setTyping(false);
            }}
          />
          <View style={styles.offerStrip}>
            <View style={{ flex: 1 }}>
              <Text style={styles.offerLabel}>ABOUT THIS OFFER</Text>
              <Text style={styles.offerTitle} numberOfLines={1}>{DEMO_OFFER.title}</Text>
            </View>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Ask KFC anything</Text>
              <Text style={styles.emptyBody}>
                This is what your customers see under your offer. Tap a question below.
              </Text>
            </View>
          }
          ListFooterComponent={
            <>
              {typing ? (
                <View style={[styles.row, styles.rowTheirs]}>
                  <View style={[styles.bubble, styles.bubbleTheirs]}>
                    <Text style={styles.typing}>KFC is typing…</Text>
                  </View>
                </View>
              ) : null}
              {note ? <Text style={styles.note}>{note}</Text> : null}
            </>
          }
          renderItem={({ item }) => {
            const mine = item.from === side;
            return (
              <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleTxt, mine ? { color: colors.btnText } : null]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />

        {side === 'customer' && customerMsgs.length === 0 ? (
          <View style={styles.prompts}>
            {PROMPTS.map((p) => (
              <Pressable key={p} style={styles.prompt} onPress={() => send(p)}>
                <Text style={styles.promptTxt}>{p}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={side === 'customer' ? 'Type your question…' : 'Reply to Ayesha…'}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={500}
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || typing) && { opacity: 0.4 }]}
            onPress={() => send()}
            disabled={!text.trim() || typing}
          >
            <Text style={styles.sendTxt}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  back: { fontSize: 22, color: colors.text },
  headerMid: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  headerSub: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 1 },

  top: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  banner: {
    borderRadius: 10,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerTxt: { fontSize: 11, fontWeight: '800', color: colors.text },
  offerStrip: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offerLabel: { fontSize: 9, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  offerTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 2 },

  list: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  emptyBody: { fontSize: 12, fontWeight: '600', color: colors.muted, textAlign: 'center', lineHeight: 18 },

  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.btnBg, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleTxt: { fontSize: 14, fontWeight: '600', color: colors.text, lineHeight: 20 },
  typing: { fontSize: 12, fontWeight: '700', color: colors.muted, fontStyle: 'italic' },
  note: { fontSize: 11, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 10 },

  prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  prompt: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    backgroundColor: colors.glassLime,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  promptTxt: { fontSize: 12, fontWeight: '800', color: colors.text },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 14,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.btnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { fontSize: 18, fontWeight: '900', color: colors.btnText },
}));
