import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { LogoMark } from '../../src/ui/LogoMark';

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: Timestamp | null;
}

const SUPPORT_ID = 'velocity_support';
const SUPPORT_NAME = 'Velocity Support';
const WELCOME_MSG =
  'Hello! Welcome to Velocity Support. How can we help you today? We typically reply within a few minutes.';

export default function SupportChatScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!user) return;

    const chatRef = doc(db, 'supportChats', user.uid);
    const msgsRef = collection(db, 'supportChats', user.uid, 'messages');
    const q = query(msgsRef, orderBy('timestamp', 'asc'));

    const unsub = onSnapshot(q, async (snap) => {
      const msgs: Message[] = snap.docs.map((d) => ({
        id: d.id,
        text: d.data().text as string,
        senderId: d.data().senderId as string,
        senderName: d.data().senderName as string,
        timestamp: d.data().timestamp as Timestamp | null,
      }));
      setMessages(msgs);
      setLoading(false);

      // Post the welcome message once if chat is brand new.
      if (!initialized.current && msgs.length === 0) {
        initialized.current = true;
        await setDoc(chatRef, { userId: user.uid, createdAt: serverTimestamp() }, { merge: true });
        await addDoc(msgsRef, {
          text: WELCOME_MSG,
          senderId: SUPPORT_ID,
          senderName: SUPPORT_NAME,
          timestamp: serverTimestamp(),
          read: false,
        });
      } else {
        initialized.current = true;
      }
    });

    return unsub;
  }, [user]);

  // Scroll to bottom whenever messages change.
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !user || sending) return;
    setText('');
    setSending(true);
    try {
      await addDoc(collection(db, 'supportChats', user.uid, 'messages'), {
        text: trimmed,
        senderId: user.uid,
        senderName: user.displayName ?? 'Passenger',
        timestamp: serverTimestamp(),
        read: false,
      });
      // Update last-message metadata for the support dashboard.
      await setDoc(
        doc(db, 'supportChats', user.uid),
        { lastMessage: trimmed, lastAt: serverTimestamp(), status: 'open' },
        { merge: true },
      );
    } finally {
      setSending(false);
    }
  }

  function formatTime(ts: Timestamp | null): string {
    if (!ts) return '';
    const d = ts.toDate();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <View style={styles.agentInfo}>
          <View style={styles.avatar}>
            <LogoMark size={24} color="#000" />
          </View>
          <View>
            <Text style={styles.agentName}>Velocity Support</Text>
            <Text style={styles.agentStatus}>Online</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.msgList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              const isUser = item.senderId !== SUPPORT_ID;
              const prevMsg = messages[index - 1];
              const showSender =
                !isUser && (!prevMsg || prevMsg.senderId !== item.senderId);

              return (
                <View style={[styles.msgRow, isUser ? styles.msgRowRight : styles.msgRowLeft]}>
                  {!isUser && (
                    <View style={[styles.msgAvatar, !showSender && { opacity: 0 }]}>
                      <LogoMark size={17} color="#000" />
                    </View>
                  )}
                  <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleSupport]}>
                    <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
                      {item.text}
                    </Text>
                    <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
                      {formatTime(item.timestamp)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Input bar */}
        <SafeAreaView edges={['bottom']} style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.sendIcon}>↑</Text>
            )}
          </Pressable>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },
  agentInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentName: { fontSize: 15, fontWeight: '800', color: colors.text },
  agentStatus: { fontSize: 12, color: '#22c55e', fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  msgList: { paddingHorizontal: 12, paddingVertical: 16, gap: 6 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowLeft: { justifyContent: 'flex-start' },
  msgRowRight: { justifyContent: 'flex-end' },

  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },

  bubble: {
    maxWidth: '75%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
  },
  bubbleSupport: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  bubbleTextUser: { color: '#000' },
  bubbleTime: { fontSize: 10, color: colors.muted, alignSelf: 'flex-end' },
  bubbleTimeUser: { color: '#00000066' },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { fontSize: 20, fontWeight: '900', color: '#000' },
});
