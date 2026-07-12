/**
 * Travel Partner — joint group chat.
 *
 * All group members chat together in travelMateGroups/{groupId}/messages.
 * Sending goes through sendTravelMateGroupMessage (CF → FCM push to members),
 * with a direct Firestore write as fallback.
 *
 * Tap any member (header 👥 sheet or a sender's name on their bubble) to view
 * their mini profile and start a private 1:1 chat (openTravelMateDirectChat →
 * existing chat/[matchId] screen).
 *
 * Ride-share cards (type 'ride_share', posted by shareTravelMateRide) render
 * with a "View ride" button deep-linking to shared-ride/[shareId].
 */
import { useEffect, useRef, useState } from 'react';
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
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api } from '../../../../src/api/client';
import { colors } from '../../../../src/config';

interface GroupDoc {
  name: string;
  createdBy: string;
  members: string[];
  memberInfo: Record<string, { displayName: string; photoURL: string | null }>;
}

interface GroupMessage {
  id: string;
  senderId: string;
  senderName?: string;
  type?: 'text' | 'ride_share';
  shareId?: string;
  text: string;
  createdAt?: { seconds: number } | null;
}

export default function TravelMateGroupChat() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const { user } = useAuth();
  const router = useRouter();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [dmTarget, setDmTarget] = useState<string | null>(null);
  const [openingDm, setOpeningDm] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!groupId) return;
    return onSnapshot(doc(db, 'travelMateGroups', groupId), snap => {
      if (snap.exists()) setGroup(snap.data() as GroupDoc);
    });
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const q = query(
      collection(db, 'travelMateGroups', groupId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GroupMessage));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    });
  }, [groupId]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending || !user || !groupId) return;
    setSending(true);
    setText('');
    try {
      // CF first so other members get an FCM push.
      await api.sendTravelMateGroupMessage({ groupId, text: trimmed });
    } catch {
      // Fallback: direct write (allowed for members by Firestore rules).
      try {
        await addDoc(collection(db, 'travelMateGroups', groupId, 'messages'), {
          senderId: user.uid,
          senderName: group?.memberInfo?.[user.uid]?.displayName ?? 'Member',
          type: 'text',
          text: trimmed,
          createdAt: serverTimestamp(),
        });
      } catch {
        setText(trimmed);
      }
    } finally {
      setSending(false);
    }
  }

  async function openPrivateChat(targetUid: string) {
    if (!groupId || openingDm) return;
    setOpeningDm(true);
    try {
      const { matchId } = await api.openTravelMateDirectChat({ targetUid, groupId });
      setDmTarget(null);
      setMembersOpen(false);
      router.push(`/passenger/travel-mate/chat/${matchId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open the chat.');
    } finally {
      setOpeningDm(false);
    }
  }

  const dmInfo = dmTarget ? group?.memberInfo?.[dmTarget] : null;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerName} numberOfLines={1}>{group?.name ?? 'Group chat'}</Text>
          <Text style={s.headerSub}>{group ? `${group.members.length} members` : '…'}</Text>
        </View>
        <Pressable onPress={() => setMembersOpen(true)} style={s.headerAction}>
          <Text style={{ fontSize: 16 }}>👥</Text>
        </Pressable>
      </View>

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
          ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello to your group! 👋</Text>}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.uid;
            const senderName = item.senderName
              ?? group?.memberInfo?.[item.senderId]?.displayName
              ?? 'Member';
            if (item.type === 'ride_share') {
              return (
                <View style={s.rideCardWrap}>
                  <Text style={s.rideCardHead}>🚗 {senderName} shared a ride</Text>
                  <Text style={s.rideCardText}>{item.text}</Text>
                  {item.shareId && (
                    <Pressable
                      style={s.rideCardBtn}
                      onPress={() => router.push(`/passenger/travel-mate/shared-ride/${item.shareId}` as Parameters<typeof router.push>[0])}
                    >
                      <Text style={s.rideCardBtnText}>View ride →</Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            return (
              <View style={[s.bubbleWrap, mine && s.bubbleWrapMine]}>
                {!mine && (
                  <Pressable onPress={() => setDmTarget(item.senderId)}>
                    <Text style={s.senderName}>{senderName}</Text>
                  </Pressable>
                )}
                <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
                  <Text style={[s.msgText, mine && s.msgTextMine]}>{item.text}</Text>
                </View>
                {item.createdAt && <Text style={s.msgTime}>{timeStr(item.createdAt.seconds)}</Text>}
              </View>
            );
          }}
        />

        <View style={s.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message the group…"
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
      </KeyboardAvoidingView>

      {/* Members sheet */}
      <Modal visible={membersOpen} transparent animationType="slide" onRequestClose={() => setMembersOpen(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setMembersOpen(false)}>
          <Pressable style={s.modalBox} onPress={() => {}}>
            <Text style={s.modalTitle}>Members</Text>
            {group?.members.map(uid => {
              const info = group.memberInfo?.[uid];
              const isMe = uid === user?.uid;
              return (
                <Pressable
                  key={uid}
                  style={s.memberRow}
                  disabled={isMe}
                  onPress={() => setDmTarget(uid)}
                >
                  <View style={s.memberAvatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
                  <Text style={s.memberName}>{info?.displayName ?? 'Member'}{isMe ? ' (you)' : ''}</Text>
                  {uid === group.createdBy && <Text style={s.creatorTag}>Creator</Text>}
                  {!isMe && <Text style={s.memberChevron}>💬</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Member mini-profile → private chat */}
      <Modal visible={!!dmTarget} transparent animationType="fade" onRequestClose={() => setDmTarget(null)}>
        <Pressable style={s.modalOverlayCenter} onPress={() => setDmTarget(null)}>
          <Pressable style={s.profileBox} onPress={() => {}}>
            <View style={s.profileAvatar}><Text style={{ fontSize: 34 }}>👤</Text></View>
            <Text style={s.profileName}>{dmInfo?.displayName ?? 'Member'}</Text>
            <Text style={s.profileSub}>Group member</Text>
            <Pressable
              style={[s.dmBtn, openingDm && { opacity: 0.6 }]}
              disabled={openingDm}
              onPress={() => dmTarget && openPrivateChat(dmTarget)}
            >
              <Text style={s.dmBtnText}>{openingDm ? 'Opening…' : '💬 Message privately'}</Text>
            </Pressable>
            <Pressable style={s.dmCancel} onPress={() => setDmTarget(null)}>
              <Text style={s.dmCancelText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function timeStr(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:   { color: colors.text, fontSize: 18, fontWeight: '700' },
  headerName: { fontSize: 16, fontWeight: '800', color: colors.text },
  headerSub:  { fontSize: 11, color: colors.muted, marginTop: 1 },
  headerAction: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  msgList: { padding: 16, gap: 10, paddingBottom: 8 },
  empty:   { textAlign: 'center', color: colors.muted, marginTop: 60, fontSize: 14 },

  bubbleWrap:     { maxWidth: '80%', alignSelf: 'flex-start', gap: 3 },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  senderName:     { fontSize: 11, color: colors.primary, fontWeight: '700', marginLeft: 4 },
  bubble:         { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther:    { backgroundColor: colors.surface },
  bubbleMine:     { backgroundColor: colors.primary },
  msgText:        { fontSize: 15, color: colors.text, lineHeight: 20 },
  msgTextMine:    { color: '#fff' },
  msgTime:        { fontSize: 10, color: colors.muted, marginLeft: 4, marginTop: 2 },

  rideCardWrap: { alignSelf: 'stretch', backgroundColor: `${colors.primary}14`, borderWidth: 1, borderColor: `${colors.primary}40`, borderRadius: 14, padding: 12, gap: 6 },
  rideCardHead: { fontSize: 12, fontWeight: '900', color: colors.primary },
  rideCardText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  rideCardBtn:  { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 2 },
  rideCardBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  inputRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  textInput: { flex: 1, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border, maxHeight: 100 },
  sendBtn:   { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10 },
  sendBtnOff:{ opacity: 0.4 },
  sendText:  { color: '#000', fontWeight: '800', fontSize: 14 },

  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modalBox:   { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 4 },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 8 },

  memberRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  memberName:   { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  creatorTag:   { fontSize: 10, fontWeight: '800', color: colors.primary },
  memberChevron:{ fontSize: 14 },

  profileBox:    { backgroundColor: colors.surface, borderRadius: 24, padding: 28, alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  profileName:   { fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 6 },
  profileSub:    { fontSize: 12, color: colors.muted },
  dmBtn:         { alignSelf: 'stretch', height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  dmBtnText:     { fontSize: 15, fontWeight: '800', color: '#fff' },
  dmCancel:      { paddingVertical: 10 },
  dmCancelText:  { fontSize: 13, fontWeight: '700', color: colors.muted },
});
