/**
 * A conversation about one business offer — the same screen for both sides.
 *
 *   The customer lands here from "Ask about this offer". The thread id is
 *   `{adId}_{their uid}`, so the conversation may not exist yet: the screen shows
 *   the offer and an empty composer, and the first send creates it.
 *
 *   The business lands here from its Queries section or the push a question
 *   sends. It sees the asker's first name, never more, and replies.
 *
 * Which side you are is read off the thread (owner or not), falling back to the
 * id for a thread that has not been written yet — that can only be the asker.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import type { BusinessAdQueryMessage } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { db } from '../../../src/firebase';
import { useBusinessAdThread } from '../../../src/hooks/businessAds';
import { timeAgo } from '../../../src/lib/timeAgo';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';

const TEXT_MAX = 500;

/** Starters for a customer who has never written to a shop through an app. */
const CUSTOMER_PROMPTS = ['Is this offer still on?', 'Does it include delivery?', 'What are your timings?'];

interface OfferHead {
  title: string;
  businessName: string;
  imageUrl: string | null;
}

export default function OfferQueryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { queryId } = useLocalSearchParams<{ queryId: string }>();
  const { thread, messages, loading } = useBusinessAdThread(queryId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [offer, setOffer] = useState<OfferHead | null>(null);
  const listRef = useRef<FlatList<BusinessAdQueryMessage>>(null);

  const uid = user?.uid ?? '';
  const isBusiness = !!thread && thread.ownerUid === uid;
  // `{adId}_{askerUid}` — the id carries the offer for a thread not yet written.
  const adId = useMemo(() => {
    if (thread) return thread.adId;
    if (!queryId || !uid || !queryId.endsWith(`_${uid}`)) return null;
    return queryId.slice(0, -(uid.length + 1));
  }, [thread, queryId, uid]);

  // The header before the first message: the thread doc does not exist yet, so
  // the offer itself names what the customer is asking about.
  useEffect(() => {
    if (thread || !adId) return;
    return onSnapshot(
      doc(db, 'businessAds', adId),
      (snap) => {
        if (!snap.exists()) return;
        setOffer({
          title: (snap.get('title') as string) ?? '',
          businessName: (snap.get('businessName') as string) ?? '',
          imageUrl: (snap.get('imageUrl') as string | null) ?? null,
        });
      },
      () => {},
    );
  }, [thread, adId]);

  // Opening the conversation reads it. Only asks the server when there is
  // actually something unread on this side, so scrolling costs nothing.
  const myUnread = thread ? (isBusiness ? thread.ownerUnread : thread.askerUnread) : 0;
  useEffect(() => {
    if (!queryId || myUnread <= 0) return;
    api.markBusinessAdQueryRead({ queryId }).catch(() => {});
  }, [queryId, myUnread]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const head: OfferHead | null = thread
    ? { title: thread.adTitle, businessName: thread.businessName, imageUrl: thread.adImageUrl }
    : offer;

  async function send(body = text) {
    const trimmed = body.trim();
    if (!trimmed || sending || !queryId) return;
    setSending(true);
    try {
      if (isBusiness) {
        await api.replyBusinessAdQuery({ queryId, text: trimmed });
      } else {
        if (!adId) throw new Error('This conversation cannot be opened from this account.');
        await api.sendBusinessAdQuery({ adId, text: trimmed });
      }
      setText('');
    } catch (e) {
      Alert.alert('Message not sent', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setSending(false);
    }
  }

  const counterpart = isBusiness ? (thread?.askerName ?? 'Customer') : (head?.businessName ?? 'Business');
  const showPrompts = !isBusiness && !loading && messages.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle} numberOfLines={1}>{counterpart}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {isBusiness ? 'Customer question' : 'Ask the business'}
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      {/* Android runs edge-to-edge on SDK 56 and ignores adjustResize, so the
          composer is lifted with padding on both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {head ? (
          <View style={styles.offerStrip}>
            {head.imageUrl ? <Image source={{ uri: head.imageUrl }} style={styles.offerThumb} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.offerLabel}>ABOUT THIS OFFER</Text>
              <Text style={styles.offerTitle} numberOfLines={1}>{head.title}</Text>
            </View>
            {adId && !isBusiness ? (
              <Pressable onPress={() => router.push(`/passenger/offer/${adId}`)} hitSlop={8}>
                <Text style={styles.offerLink}>View</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>💬</Text>
                <Text style={styles.emptyTitle}>
                  {isBusiness ? 'No messages yet' : `Ask ${head?.businessName || 'the business'} anything`}
                </Text>
                <Text style={styles.emptyBody}>
                  {isBusiness
                    ? 'Messages from this customer appear here.'
                    : 'Your question goes straight to the business. They see your first name and your message — never your phone number.'}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const mine = isBusiness ? item.from === 'business' : item.from === 'customer';
            return (
              <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleTxt, mine ? styles.bubbleTxtMine : null]}>{item.text}</Text>
                  <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>
                    {item.createdAtMs ? timeAgo(item.createdAtMs / 1000) : ''}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {showPrompts ? (
          <View style={styles.prompts}>
            {CUSTOMER_PROMPTS.map((p) => (
              <Pressable key={p} style={styles.prompt} onPress={() => void send(p)} disabled={sending}>
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
            placeholder={isBusiness ? `Reply to ${counterpart}…` : 'Type your question…'}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={TEXT_MAX}
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
            onPress={() => void send()}
            disabled={!text.trim() || sending}
          >
            <Text style={styles.sendTxt}>{sending ? '…' : '➤'}</Text>
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

  offerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offerThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.background },
  offerLabel: { fontSize: 9, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  offerTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 2 },
  offerLink: { fontSize: 13, fontWeight: '900', color: colors.primary },

  list: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 12, fontWeight: '600', color: colors.muted, textAlign: 'center', lineHeight: 18 },

  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  bubbleMine: { backgroundColor: colors.btnBg, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleTxt: { fontSize: 14, fontWeight: '600', color: colors.text, lineHeight: 20 },
  bubbleTxtMine: { color: colors.btnText },
  bubbleTime: { fontSize: 9, fontWeight: '700', color: colors.muted, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: colors.btnText, opacity: 0.6 },

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
    backgroundColor: colors.background,
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
