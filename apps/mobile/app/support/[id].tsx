/**
 * One complaint, from the first message to the resolution.
 *
 * The thread makes the handover visible, because that is the thing people most
 * need to trust. Every message is labelled with who actually said it — the
 * assistant, a named member of the team, or the system — and the banner at the
 * top always says who owns the ticket right now. "Am I still talking to a bot?"
 * should never be a question anyone has to ask.
 *
 * The "Talk to a person" button sits above the composer and stays there while
 * the assistant is handling the ticket. It is not hidden in a menu and it is
 * not a last resort: it is the promise the whole system is built on, so it is
 * one tap from anywhere in the conversation.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Text, TextInput } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useSupportThread, type SupportMessage } from '../../src/hooks/support';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { timeAgo } from '../../src/lib/timeAgo';

export default function SupportThread() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const ticketId = typeof params.id === 'string' ? params.id : undefined;
  const { ticket, messages, loading } = useSupportThread(ticketId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  // Clear the unread badge once, when the thread opens.
  const marked = useRef(false);
  useEffect(() => {
    if (!ticketId || marked.current) return;
    marked.current = true;
    api.markSupportTicketRead({ ticketId }).catch(() => undefined);
  }, [ticketId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !ticketId || sending) return;
    setText('');
    setSending(true);
    try {
      await api.sendSupportMessage({ ticketId, text: trimmed });
    } catch (e) {
      setText(trimmed); // give them their words back
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function askForHuman() {
    if (!ticketId || asking) return;
    setAsking(true);
    try {
      await api.requestHumanAgent({ ticketId });
    } catch (e) {
      Alert.alert('Could not connect', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAsking(false);
    }
  }

  async function rate(helpful: boolean) {
    if (!ticketId) return;
    try {
      await api.rateSupportResolution({ ticketId, helpful });
      if (!helpful) {
        Alert.alert('Thanks — passing it on', 'A member of our team will pick this up and reply here.');
      }
    } catch { /* a rating that fails to save is not worth an error dialog */ }
  }

  const withHuman =
    ticket?.status === 'waiting_human' || ticket?.status === 'human_handling';
  const resolved = ticket?.status === 'resolved';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ticket?.subject ?? 'Support'}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {ticket?.categoryLabel ?? 'Velocity Rapid Response'}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Who owns this right now. Never ambiguous. */}
      {ticket ? (
        <View style={[styles.banner, withHuman && styles.bannerHuman, resolved && styles.bannerDone]}>
          <Text style={[styles.bannerTxt, withHuman && styles.bannerTxtHuman, resolved && styles.bannerTxtDone]}>
            {resolved
              ? '✓ Resolved — write below if it comes back'
              : ticket.status === 'human_handling'
                ? `👤 ${ticket.assignedName ?? 'Our team'} is handling this`
                : ticket.status === 'waiting_human'
                  ? '👤 With our team — a person will reply here shortly'
                  : '⚡ Rapid Response assistant is answering'}
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {loading && messages.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <Bubble msg={item} />}
            ListFooterComponent={
              // "Did that help?" only once the assistant thinks it is done, and
              // only while nobody has answered it yet.
              resolved && !ticket?.satisfaction ? (
                <View style={styles.rateBox}>
                  <Text style={styles.rateTitle}>Did that sort it out?</Text>
                  <View style={styles.rateRow}>
                    <Pressable style={styles.rateBtn} onPress={() => rate(true)}>
                      <Text style={styles.rateBtnTxt}>👍 Yes, thanks</Text>
                    </Pressable>
                    <Pressable style={[styles.rateBtn, styles.rateBtnNo]} onPress={() => rate(false)}>
                      <Text style={styles.rateBtnTxt}>👎 No — get me a person</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* The promise, one tap away, for as long as a machine is answering. */}
        {ticket && !withHuman && !resolved ? (
          <Pressable style={styles.humanBtn} onPress={askForHuman} disabled={asking}>
            <Text style={styles.humanBtnTxt}>
              {asking ? 'Connecting…' : '👤 Talk to a person instead'}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Write a message…"
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color={colors.btnText} size="small" />
            ) : (
              <Text style={styles.sendTxt}>↑</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** One message. The author label is the point — see the file header. */
function Bubble({ msg }: { msg: SupportMessage }) {
  const mine = msg.sender === 'user';
  const system = msg.sender === 'system';

  if (system) {
    return <Text style={styles.systemLine}>{msg.text}</Text>;
  }

  return (
    <View style={[styles.bubbleWrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
      {!mine ? (
        <Text style={styles.author}>
          {msg.sender === 'ai' ? '⚡ ' : '👤 '}
          {msg.senderName}
        </Text>
      ) : null}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleTxt, mine && styles.bubbleTxtMine]}>{msg.text}</Text>
      </View>
      <Text style={styles.time}>{msg.createdAt ? timeAgo(msg.createdAt.seconds) : 'sending…'}</Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8,
    },
    headerMid: { flex: 1 },
    back: { fontSize: 30, color: colors.text, lineHeight: 32 },
    headerTitle: { fontSize: 15.5, fontWeight: '900', color: colors.text },
    headerSub: { fontSize: 11.5, color: colors.muted, marginTop: 1 },

    banner: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary + '16' },
    bannerHuman: { backgroundColor: colors.secondary + '22' },
    bannerDone: { backgroundColor: colors.border },
    bannerTxt: { fontSize: 12, fontWeight: '800', color: colors.primary, textAlign: 'center' },
    bannerTxtHuman: { color: colors.secondary },
    bannerTxtDone: { color: colors.muted },

    list: { padding: 14, paddingBottom: 20, gap: 12 },
    bubbleWrap: { maxWidth: '88%' },
    wrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    wrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
    author: { fontSize: 11, fontWeight: '900', color: colors.muted, marginBottom: 4, marginLeft: 2 },
    bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
    bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
    bubbleTheirs: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 5,
    },
    bubbleTxt: { fontSize: 14.5, color: colors.text, lineHeight: 21 },
    bubbleTxtMine: { color: colors.btnText, fontWeight: '600' },
    time: { fontSize: 10, color: colors.muted, marginTop: 3, marginHorizontal: 3 },
    systemLine: {
      fontSize: 11.5,
      color: colors.muted,
      textAlign: 'center',
      fontStyle: 'italic',
      marginVertical: 2,
    },

    rateBox: {
      marginTop: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 13,
    },
    rateTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text, textAlign: 'center' },
    rateRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    rateBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 11,
      paddingVertical: 10,
      alignItems: 'center',
    },
    rateBtnNo: { borderColor: colors.secondary },
    rateBtnTxt: { fontSize: 12, fontWeight: '800', color: colors.text, textAlign: 'center' },

    humanBtn: {
      marginHorizontal: 14,
      marginBottom: 6,
      borderWidth: 1,
      borderColor: colors.secondary,
      backgroundColor: colors.secondary + '18',
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    humanBtnTxt: { fontSize: 13, fontWeight: '900', color: colors.secondary },

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
      maxHeight: 120,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
    },
    sendBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendTxt: { fontSize: 20, fontWeight: '900', color: colors.btnText, lineHeight: 22 },
  }),
);
