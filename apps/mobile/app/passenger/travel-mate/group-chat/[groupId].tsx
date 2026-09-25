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
 *
 * Chat management (⋮): leave the group, or — from any member's card — block or
 * report that person. Leaving drops your membership, and membership is what the
 * Firestore rules gate reads on, so the screen has to pop itself the moment
 * access goes: a listener that has just been denied looks exactly like a group
 * that has gone empty.
 *
 * Messages from anyone you have blocked are hidden here. A block cannot throw
 * someone out of a shared group, but it can stop you having to read them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../../../../src/firebase';
import { CHAT_WINDOW, oldestFirst } from '../../../../src/lib/chatWindow';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api } from '../../../../src/api/client';
import { useBlockedSet } from '../../../../src/hooks/travelMateCommunity';
import { markChatSeen } from '../../../../src/lib/chatSeen';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import {
  ChatMenuSheet,
  ReportSheet,
  type ChatMenuAction,
  type ReportSubmission,
} from '../../../../src/ui/ChatSafety';

interface GroupDoc {
  name: string;
  createdBy: string;
  members: string[];
  memberInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status?: 'open' | 'full' | 'closed';
}

interface GroupMessage {
  id: string;
  senderId: string;
  senderName?: string;
  type?: 'text' | 'ride_share' | 'system';
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
  const [openingDm, setOpeningDm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [memberMenuFor, setMemberMenuFor] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const blocked = useBlockedSet();
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!groupId) return;
    return onSnapshot(
      doc(db, 'travelMateGroups', groupId),
      snap => {
        if (snap.exists()) setGroup(snap.data() as GroupDoc);
      },
      // Reads are gated on membership, so permission-denied here means this
      // user is no longer in the group — theirs or an admin's doing. Only that
      // code: any other error is a network blip, and dropping someone out of a
      // group chat because their train went through a tunnel would be worse
      // than the stale view they get by staying.
      err => {
        if ((err as { code?: string }).code === 'permission-denied') setAccessLost(true);
      },
    );
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    // Most recent window, flipped back into reading order — lib/chatWindow.ts.
    const q = query(
      collection(db, 'travelMateGroups', groupId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(CHAT_WINDOW),
    );
    return onSnapshot(q, snap => {
      setMessages(oldestFirst(snap.docs.map(d => ({ id: d.id, ...d.data() }) as GroupMessage)));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      // Reading the group while it is on screen — same rule as a 1:1 chat.
      markChatSeen('group', groupId);
    });
  }, [groupId]);

  // Losing membership ends the screen. Done in an effect rather than inline in
  // the listener so the navigation happens after render, not during it.
  useEffect(() => {
    if (!accessLost) return;
    if (router.canGoBack()) router.back();
    else router.replace('/passenger/travel-mate' as Parameters<typeof router.replace>[0]);
  }, [accessLost, router]);

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
      setMembersOpen(false);
      router.push(`/passenger/travel-mate/chat/${matchId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open the chat.');
    } finally {
      setOpeningDm(false);
    }
  }

  // ── Chat management ────────────────────────────────────────────────────────
  const myName = user ? group?.memberInfo?.[user.uid]?.displayName : undefined;
  const nameOf = (uid: string) => group?.memberInfo?.[uid]?.displayName ?? 'this member';

  function confirmLeaveGroup() {
    const others = (group?.members.length ?? 1) - 1;
    Alert.alert(
      'Leave this group?',
      others > 0
        ? `You'll be removed from ${group?.name ?? 'the group'} and lose access to its messages. The other ${others === 1 ? 'member' : `${others} members`} will see that you left.`
        : `You're the last member, so ${group?.name ?? 'the group'} will be closed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave group',
          style: 'destructive',
          onPress: async () => {
            if (!groupId) return;
            setLeaving(true);
            try {
              await api.leaveTravelMateGroupChat({ groupId });
              // Don't wait for the listener to fail — go now, so the screen
              // never flashes a permission error on the way out.
              if (router.canGoBack()) router.back();
              else router.replace('/passenger/travel-mate' as Parameters<typeof router.replace>[0]);
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not leave the group.');
            } finally {
              setLeaving(false);
            }
          },
        },
      ],
    );
  }

  function confirmBlockMember(targetUid: string) {
    const name = nameOf(targetUid);
    Alert.alert(
      `Block ${name}?`,
      `Their messages will be hidden from you here, and they won't be able to DM you, see your posts or find you again. Blocking does not remove them from this group.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.blockTravelMateUser({ targetUid });
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not block.');
            }
          },
        },
      ],
    );
  }

  async function submitReport({ category, reason, alsoBlock }: ReportSubmission) {
    if (!reportTarget || !groupId) return;
    const name = nameOf(reportTarget);
    setReporting(true);
    try {
      await api.reportTravelMateChat({
        scope: 'group',
        roomId: groupId,
        reportedUid: reportTarget,
        category,
        reason,
        alsoBlock,
      });
      setReportTarget(null);
      Alert.alert(
        'Report sent',
        alsoBlock
          ? `Thanks — our safety team will review this group's messages. ${name} is now blocked, so you won't see them here.`
          : `Thanks — our safety team will review this group's messages.`,
      );
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Report failed.');
    } finally {
      setReporting(false);
    }
  }

  const groupMenuActions: ChatMenuAction[] = [
    {
      id: 'members',
      icon: '👥',
      label: 'Members',
      hint: 'See who is in the group, message or report them',
      onPress: () => setMembersOpen(true),
    },
    {
      id: 'leave',
      icon: '🚪',
      label: 'Leave group',
      hint: 'You lose access to these messages',
      destructive: true,
      onPress: confirmLeaveGroup,
    },
  ];

  const memberMenuActions: ChatMenuAction[] = memberMenuFor
    ? [
        {
          id: 'dm',
          icon: '💬',
          label: 'Message privately',
          hint: 'Open a 1:1 chat',
          onPress: () => openPrivateChat(memberMenuFor),
        },
        {
          id: 'report',
          icon: '🚩',
          label: 'Report',
          hint: 'Send this group’s messages to our safety team',
          destructive: true,
          onPress: () => setReportTarget(memberMenuFor),
        },
        {
          id: 'block',
          icon: '🚫',
          label: 'Block',
          hint: 'Hide them here and stop them contacting you',
          destructive: true,
          onPress: () => confirmBlockMember(memberMenuFor),
        },
      ]
    : [];

  // Blocking cannot evict someone from a group you both belong to, but their
  // messages stop being yours to read. Their own sends still reach everyone
  // else — this is a filter on one reader, not moderation of the room.
  const visibleMessages = useMemo(
    () => messages.filter(m => !blocked.has(m.senderId)),
    [messages, blocked],
  );


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
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={s.headerAction}
          disabled={leaving}
          accessibilityRole="button"
          accessibilityLabel="Group options"
        >
          <Text style={{ fontSize: 18, color: colors.text, fontWeight: '800' }}>{leaving ? '…' : '⋮'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.msgList}
          ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello to your group! 👋</Text>}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.uid;
            const senderName = item.senderName
              ?? group?.memberInfo?.[item.senderId]?.displayName
              ?? 'Member';
            // "X left the group" — the group's own voice, not anyone's bubble.
            if (item.type === 'system') {
              return (
                <View style={s.systemWrap}>
                  <Text style={s.systemText}>{item.text}</Text>
                </View>
              );
            }
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
                  <Pressable onPress={() => setMemberMenuFor(item.senderId)}>
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
                  onPress={() => { setMembersOpen(false); setMemberMenuFor(uid); }}
                >
                  <View style={s.memberAvatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
                  <Text style={s.memberName}>
                    {info?.displayName ?? 'Member'}{isMe ? ' (you)' : ''}
                    {!isMe && blocked.has(uid) ? ' · blocked' : ''}
                  </Text>
                  {uid === group.createdBy && <Text style={s.creatorTag}>Creator</Text>}
                  {!isMe && <Text style={s.memberChevron}>⋯</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>


      {/* Chat management — the group, then one member of it. */}
      <ChatMenuSheet
        visible={menuOpen}
        title={group?.name ?? 'Group chat'}
        subtitle={
          group
            ? `${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}${myName ? ` · you are ${myName}` : ''}`
            : undefined
        }
        actions={groupMenuActions}
        onClose={() => setMenuOpen(false)}
      />
      <ChatMenuSheet
        visible={!!memberMenuFor}
        title={memberMenuFor ? nameOf(memberMenuFor) : ''}
        subtitle={
          memberMenuFor && blocked.has(memberMenuFor)
            ? 'Blocked — their messages are hidden from you'
            : 'Group member'
        }
        actions={memberMenuActions}
        onClose={() => setMemberMenuFor(null)}
      />
      <ReportSheet
        visible={!!reportTarget}
        personName={reportTarget ? nameOf(reportTarget) : ''}
        // Says the quiet part: blocking hides them from you, it does not throw
        // them out of a group you both belong to.
        blockLabel="Also block them (they stay in the group)"
        submitting={reporting}
        onClose={() => setReportTarget(null)}
        onSubmit={submitReport}
      />
    </SafeAreaView>
  );
}

function timeStr(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

const s = themed(() => StyleSheet.create({
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

  systemWrap: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginVertical: 2 },
  systemText:  { fontSize: 11.5, fontWeight: '700', color: colors.muted, textAlign: 'center' },

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
  modalBox:   { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 4 },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 8 },

  memberRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  memberName:   { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  creatorTag:   { fontSize: 10, fontWeight: '800', color: colors.primary },
  memberChevron:{ fontSize: 14 },
}));
