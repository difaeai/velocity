import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { colors } from '../config';

interface ChatMessage {
  id:         string;
  senderId:   string;
  senderName: string;
  text:       string;
  sentAt:     unknown;
}

interface Props {
  visible:     boolean;
  /** tripId for regular trips, rideId for pool rides */
  roomId:      string;
  isPoolRide?: boolean;
  myUid:       string;
  myName:      string;
  otherName:   string;
  onClose:     () => void;
}

export function ChatModal({ visible, roomId, isPoolRide, myUid, myName, otherName, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text,     setText]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const listRef = useRef<FlatList>(null);

  const collPath = isPoolRide
    ? `poolRides/${roomId}/chat`
    : `trips/${roomId}/chat`;

  useEffect(() => {
    if (!visible || !roomId) return;
    const q = query(collection(db, collPath), orderBy('sentAt', 'asc'));
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) })));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    });
  }, [visible, roomId, collPath]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addDoc(collection(db, collPath), {
        senderId:   myUid,
        senderName: myName,
        text:       trimmed,
        sentAt:     serverTimestamp(),
      });
      setText('');
    } catch {
      // silently ignore — user can retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title}>{otherName}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.msgList}
            ListEmptyComponent={
              <Text style={styles.empty}>No messages yet. Say hello!</Text>
            }
            renderItem={({ item }) => {
              const mine = item.senderId === myUid;
              return (
                <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
                  {!mine && (
                    <Text style={styles.senderName}>{item.senderName}</Text>
                  )}
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    <Text style={[styles.msgText, mine && styles.msgTextMine]}>
                      {item.text}
                    </Text>
                  </View>
                </View>
              );
            }}
          />

          {/* Input row */}
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message…"
              placeholderTextColor={colors.muted}
              style={styles.textInput}
              returnKeyType="send"
              onSubmitEditing={send}
              blurOnSubmit={false}
              maxLength={500}
            />
            <Pressable
              style={[styles.sendBtn, (!text.trim() || busy) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!text.trim() || busy}
            >
              <Text style={styles.sendBtnText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: { width: 40, alignItems: 'flex-start' },
  closeText: { fontSize: 18, color: colors.muted, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  msgList: { padding: 16, gap: 10 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, fontSize: 14 },
  bubbleWrap: { maxWidth: '80%', alignSelf: 'flex-start' },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  senderName: { fontSize: 11, color: colors.muted, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleOther: { backgroundColor: colors.card },
  bubbleMine:  { backgroundColor: colors.primary },
  msgText:     { fontSize: 15, color: colors.text, lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
