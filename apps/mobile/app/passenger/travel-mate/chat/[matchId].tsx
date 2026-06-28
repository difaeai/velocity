/**
 * Travel Mate — match chat screen.
 *
 * Reads messages from travelMateMatches/{matchId}/messages (written by
 * sendTravelMateMessage CF). Sending calls the CF (not a direct Firestore write).
 *
 * Header actions:
 *   - Report: opens reason sheet → calls reportTravelMateUser (auto-unmatches)
 *   - Unmatch: confirm → calls unmatchTravelMate
 *   - Group: creates a commute group and navigates to it
 *
 * Read-only mode when match.status === 'unmatched'.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api } from '../../../../src/api/client';
import { colors } from '../../../../src/config';

interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt?: { seconds: number } | null;
}

interface TravelMatch {
  users: string[];
  userInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status: 'active' | 'unmatched';
}

export default function TravelMateChat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [match, setMatch] = useState<TravelMatch | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reporting, setReporting] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const listRef = useRef<FlatList>(null);

  const otherId = match?.users.find(u => u !== user?.uid) ?? '';
  const otherInfo = match?.userInfo[otherId];
  const closed = match?.status === 'unmatched';

  // Subscribe to match doc
  useEffect(() => {
    if (!matchId) return;
    return onSnapshot(doc(db, 'travelMateMatches', matchId), snap => {
      if (snap.exists()) setMatch(snap.data() as TravelMatch);
    });
  }, [matchId]);

  // Subscribe to messages
  useEffect(() => {
    if (!matchId) return;
    const q = query(
      collection(db, 'travelMateMatches', matchId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Message));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    });
  }, [matchId]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending || closed) return;
    setSending(true);
    setText('');
    try {
      await api.sendTravelMateMessage({ matchId, text: trimmed });
    } catch {
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }

  function confirmUnmatch() {
    Alert.alert(
      'Unmatch',
      `Are you sure you want to unmatch with ${otherInfo?.displayName ?? 'this person'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch', style: 'destructive',
          onPress: async () => {
            try {
              await api.unmatchTravelMate({ matchId });
              router.back();
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not unmatch.');
            }
          },
        },
      ],
    );
  }

  async function submitReport() {
    if (!reportReason.trim()) return;
    setReporting(true);
    try {
      await api.reportTravelMateUser({
        reportedUid: otherId,
        matchId,
        reason: reportReason.trim(),
      });
      setReportOpen(false);
      setReportReason('');
      Alert.alert('Reported', 'Thank you for your report. This match has been closed.');
      router.back();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Report failed.');
    } finally {
      setReporting(false);
    }
  }

  const createGroup = useCallback(async () => {
    setCreatingGroup(true);
    try {
      const { groupId } = await api.createTravelMateGroup({});
      router.push(`/passenger/travel-mate/group/${groupId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your Travel Mate profile first.');
      } else {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not create group.');
      }
    } finally {
      setCreatingGroup(false);
    }
  }, [router]);

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerName} numberOfLines={1}>{otherInfo?.displayName ?? '…'}</Text>
          {closed && <Text style={s.closedBadge}>Conversation closed</Text>}
        </View>
        <View style={s.headerActions}>
          <Pressable onPress={createGroup} disabled={closed || creatingGroup} style={s.headerAction}>
            <Text style={s.headerActionText}>{creatingGroup ? '…' : '🤝'}</Text>
          </Pressable>
          <Pressable onPress={() => setReportOpen(true)} disabled={closed} style={s.headerAction}>
            <Text style={s.headerActionText}>🚩</Text>
          </Pressable>
          <Pressable onPress={confirmUnmatch} disabled={closed} style={s.headerAction}>
            <Text style={[s.headerActionText, { color: colors.danger }]}>✕</Text>
          </Pressable>
        </View>
      </View>

      {closed && (
        <View style={s.closedBanner}>
          <Text style={s.closedBannerText}>This conversation is closed. You can still read previous messages.</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.msgList}
          ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello! 👋</Text>}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.uid;
            return (
              <View style={[s.bubbleWrap, mine && s.bubbleWrapMine]}>
                {!mine && (
                  <Text style={s.senderName}>{otherInfo?.displayName ?? 'Travel mate'}</Text>
                )}
                <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
                  <Text style={[s.msgText, mine && s.msgTextMine]}>{item.text}</Text>
                </View>
                {item.createdAt && (
                  <Text style={s.msgTime}>{timeStr(item.createdAt.seconds)}</Text>
                )}
              </View>
            );
          }}
        />

        {!closed && (
          <View style={s.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message…"
              placeholderTextColor={colors.muted}
              style={s.textInput}
              returnKeyType="send"
              onSubmitEditing={send}
              blurOnSubmit={false}
              maxLength={2000}
            />
            <Pressable
              style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnOff]}
              onPress={send}
              disabled={!text.trim() || sending}
            >
              <Text style={s.sendText}>Send</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Report modal */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Report {otherInfo?.displayName ?? 'user'}</Text>
            <Text style={s.modalSub}>Describe the issue. This match will be closed and reviewed by our team.</Text>
            <TextInput
              style={s.reasonInput}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="What happened?"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
            <View style={s.modalBtns}>
              <Pressable onPress={() => { setReportOpen(false); setReportReason(''); }} style={s.cancelBtn}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitReport}
                disabled={!reportReason.trim() || reporting}
                style={[s.reportBtn, (!reportReason.trim() || reporting) && { opacity: 0.5 }]}
              >
                <Text style={s.reportText}>{reporting ? 'Sending…' : 'Report'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function timeStr(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:    { color: colors.text, fontSize: 18, fontWeight: '700' },
  headerName:  { fontSize: 16, fontWeight: '800', color: colors.text },
  closedBadge: { fontSize: 11, color: colors.muted, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerAction:  { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerActionText: { fontSize: 16 },

  closedBanner: { backgroundColor: `${colors.danger}18`, paddingHorizontal: 20, paddingVertical: 10 },
  closedBannerText: { fontSize: 12, color: colors.danger, fontWeight: '600', textAlign: 'center' },

  msgList:    { padding: 16, gap: 10, paddingBottom: 8 },
  empty:      { textAlign: 'center', color: colors.muted, marginTop: 60, fontSize: 14 },

  bubbleWrap:     { maxWidth: '80%', alignSelf: 'flex-start', gap: 3 },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  senderName:     { fontSize: 11, color: colors.muted, fontWeight: '700', marginLeft: 4 },
  bubble:         { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther:    { backgroundColor: colors.surface },
  bubbleMine:     { backgroundColor: colors.primary },
  msgText:        { fontSize: 15, color: colors.text, lineHeight: 20 },
  msgTextMine:    { color: '#fff' },
  msgTime:        { fontSize: 10, color: colors.muted, marginLeft: 4, marginTop: 2 },

  inputRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  textInput:   { flex: 1, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border, maxHeight: 100 },
  sendBtn:     { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10 },
  sendBtnOff:  { opacity: 0.4 },
  sendText:    { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Report modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  reasonInput:  { height: 90, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background, textAlignVertical: 'top' },
  modalBtns:    { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelText:   { fontSize: 14, fontWeight: '700', color: colors.muted },
  reportBtn:    { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  reportText:   { fontSize: 14, fontWeight: '800', color: '#fff' },
});
