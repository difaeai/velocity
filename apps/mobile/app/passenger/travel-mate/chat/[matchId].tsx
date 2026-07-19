/**
 * Travel Partner — match chat screen.
 *
 * Reads messages from travelMateMatches/{matchId}/messages (written by
 * sendTravelMateMessage CF). Sending calls the CF (not a direct Firestore write).
 *
 * Messages can be text, a photo, a shared location, a contact, or a file. There
 * is an emoji keyboard for the composer and long-press reactions on any bubble.
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
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
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
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api, type TravelMateMessageInput, type ChatAttachment } from '../../../../src/api/client';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import { EmojiPicker, QUICK_REACTIONS } from '../../../../src/ui/EmojiPicker';
import {
  AttachmentError,
  captureChatPhoto,
  getChatLocation,
  pickChatContact,
  pickChatDocument,
  pickChatPhoto,
  uploadFileAttachment,
  uploadImageAttachment,
} from '../../../../src/chat/attachments';

type MessageType = 'text' | 'image' | 'location' | 'contact' | 'file';

interface Message {
  id: string;
  senderId: string;
  text?: string;
  type?: MessageType;
  image?: ChatAttachment;
  file?: ChatAttachment;
  location?: { lat: number; lng: number; label?: string | null };
  contact?: { name: string; phone: string };
  reactions?: Record<string, string>;
  createdAt?: { seconds: number } | null;
}

interface TravelMatch {
  users: string[];
  userInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status: 'active' | 'unmatched' | 'declined';
  /** Absent on threads created before message requests existed = accepted. */
  requestStatus?: 'pending' | 'accepted' | 'declined';
  requestFrom?: string | null;
  requestTo?: string | null;
  requestSent?: boolean;
}

export default function TravelMateChat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [match, setMatch] = useState<TravelMatch | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<Message | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reporting, setReporting] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const listRef = useRef<FlatList>(null);

  const otherId = match?.users.find(u => u !== user?.uid) ?? '';
  const otherInfo = match?.userInfo[otherId];
  const closed = match?.status !== undefined && match.status !== 'active';

  // ── Message-request state ──────────────────────────────────────────────────
  // A thread with someone you haven't matched with is a *request*: the sender
  // gets one opening message, then the composer locks until the recipient
  // accepts. The recipient sees Accept / Delete instead of a composer.
  const pending = match?.requestStatus === 'pending';
  const iSentRequest = pending && match?.requestFrom === user?.uid;
  const iAmAsked = pending && match?.requestTo === user?.uid;
  // Trust the server's flag, but also treat a message already on screen as sent
  // so the composer locks the instant the first one lands.
  const openerSent = !!match?.requestSent || messages.some(m => m.senderId === match?.requestFrom);
  const composerLocked = closed || (iSentRequest && openerSent) || iAmAsked;

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
    if (!trimmed || sending || composerLocked || !user) return;
    setSending(true);
    setText('');
    setEmojiOpen(false);
    try {
      // The messages subcollection is CF-write-only (security rules), so all
      // sends go through sendTravelMateMessage — it also pushes FCM, bumps the
      // lastMessage preview, and enforces the one-message request limit.
      await api.sendTravelMateMessage({ matchId, text: trimmed });
    } catch {
      setText(trimmed); // restore the draft so the user can retry
    } finally {
      setSending(false);
    }
  }

  // ── Answering a message request (recipient only) ───────────────────────────
  async function acceptRequest() {
    setAnswering(true);
    try {
      await api.acceptTravelMateMessageRequest({ matchId });
    } catch (e: unknown) {
      Alert.alert('Could not accept', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAnswering(false);
    }
  }

  function declineRequest() {
    Alert.alert(
      'Delete request?',
      `The message from ${otherInfo?.displayName ?? 'this person'} will be deleted and they won't be able to message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAnswering(true);
            try {
              await api.declineTravelMateMessageRequest({ matchId });
              router.back();
            } catch (e: unknown) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setAnswering(false);
            }
          },
        },
      ],
    );
  }

  // Send a non-text message (photo, file, location, contact). Uploads first
  // when the payload carries a local file.
  const sendAttachment = useCallback(
    async (build: () => Promise<Omit<TravelMateMessageInput, 'matchId'> | null>) => {
      if (!user || composerLocked || sending || uploading) return;
      setAttachOpen(false);
      setUploading(true);
      try {
        const payload = await build();
        if (!payload) return; // user cancelled the picker
        setSending(true);
        await api.sendTravelMateMessage({ matchId, ...payload });
      } catch (e) {
        Alert.alert(
          'Could not send',
          e instanceof AttachmentError || e instanceof Error ? e.message : 'Please try again.',
        );
      } finally {
        setUploading(false);
        setSending(false);
      }
    },
    [user, composerLocked, sending, uploading, matchId],
  );

  const onCamera = () =>
    sendAttachment(async () => {
      const img = await captureChatPhoto();
      if (!img) return null;
      return { image: await uploadImageAttachment(user!.uid, img) };
    });

  const onPhoto = () =>
    sendAttachment(async () => {
      const img = await pickChatPhoto();
      if (!img) return null;
      return { image: await uploadImageAttachment(user!.uid, img) };
    });

  const onDocument = () =>
    sendAttachment(async () => {
      const f = await pickChatDocument();
      if (!f) return null;
      return { file: await uploadFileAttachment(user!.uid, f) };
    });

  const onLocation = () =>
    sendAttachment(async () => {
      const loc = await getChatLocation();
      if (!loc) return null;
      return { location: loc };
    });

  const onContact = () =>
    sendAttachment(async () => {
      const c = await pickChatContact();
      if (!c) return null;
      return { contact: c };
    });

  // Toggle a reaction on a message. Tapping your current emoji again clears it.
  async function react(message: Message, emoji: string) {
    setReactionTarget(null);
    if (!user) return;
    const current = message.reactions?.[user.uid];
    try {
      await api.reactToTravelMateMessage({
        matchId,
        messageId: message.id,
        emoji: current === emoji ? null : emoji,
      });
    } catch {
      /* best-effort — the snapshot listener reflects the real state */
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
        Alert.alert('Profile needed', 'Set up your Travel Partner profile first.');
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
            const reactions = aggregateReactions(item.reactions, user?.uid);
            return (
              <View style={[s.bubbleWrap, mine && s.bubbleWrapMine]}>
                {!mine && (
                  <Text style={s.senderName}>{otherInfo?.displayName ?? 'Travel mate'}</Text>
                )}
                <Pressable
                  onLongPress={() => !closed && setReactionTarget(item)}
                  delayLongPress={250}
                >
                  <MessageBody item={item} mine={mine} />
                </Pressable>
                {reactions.length > 0 && (
                  <View style={[s.reactionRow, mine && { alignSelf: 'flex-end' }]}>
                    {reactions.map(r => (
                      <Pressable
                        key={r.emoji}
                        onPress={() => react(item, r.emoji)}
                        style={[s.reactionChip, r.mine && s.reactionChipMine]}
                      >
                        <Text style={s.reactionEmoji}>{r.emoji}</Text>
                        {r.count > 1 && <Text style={s.reactionCount}>{r.count}</Text>}
                      </Pressable>
                    ))}
                  </View>
                )}
                {item.createdAt && (
                  <Text style={[s.msgTime, mine && { alignSelf: 'flex-end' }]}>{timeStr(item.createdAt.seconds)}</Text>
                )}
              </View>
            );
          }}
        />

        {/* The recipient of a request answers it instead of replying. */}
        {iAmAsked && (
          <View style={s.requestBar}>
            <Text style={s.requestBarText}>
              {otherInfo?.displayName ?? 'This person'} isn&apos;t matched with you. Accept to reply —
              they can&apos;t send anything else until you do.
            </Text>
            <View style={s.requestBarBtns}>
              <Pressable
                style={[s.requestDeleteBtn, answering && { opacity: 0.5 }]}
                onPress={declineRequest}
                disabled={answering}
              >
                <Text style={s.requestDeleteText}>Delete</Text>
              </Pressable>
              <Pressable
                style={[s.requestAcceptBtn, answering && { opacity: 0.5 }]}
                onPress={acceptRequest}
                disabled={answering}
              >
                <Text style={s.requestAcceptText}>{answering ? '…' : 'Accept'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* The sender has used their one opening message and now waits. */}
        {iSentRequest && openerSent && !closed && (
          <View style={s.waitingBar}>
            <Text style={s.waitingText}>
              ⏳ Message request sent. You can send another once{' '}
              {otherInfo?.displayName ?? 'they'} accepts.
            </Text>
          </View>
        )}

        {!composerLocked && (
          <>
            {iSentRequest && (
              <View style={s.requestHintBar}>
                <Text style={s.requestHintText}>
                  You aren&apos;t matched yet — this first message is a request.
                </Text>
              </View>
            )}
            <View style={s.inputRow}>
              <Pressable
                style={s.iconBtn}
                onPress={() => { setEmojiOpen(false); setAttachOpen(true); }}
                disabled={uploading}
              >
                <Text style={s.iconBtnText}>＋</Text>
              </Pressable>
              <Pressable
                style={s.iconBtn}
                onPress={() => setEmojiOpen(v => !v)}
              >
                <Text style={s.iconBtnText}>{emojiOpen ? '⌨️' : '😊'}</Text>
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                onFocus={() => setEmojiOpen(false)}
                placeholder={uploading ? 'Sending attachment…' : 'Type a message…'}
                placeholderTextColor={colors.muted}
                style={s.textInput}
                returnKeyType="send"
                onSubmitEditing={send}
                blurOnSubmit={false}
                maxLength={2000}
                editable={!uploading}
              />
              <Pressable
                style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnOff]}
                onPress={send}
                disabled={!text.trim() || sending}
              >
                <Text style={s.sendText}>Send</Text>
              </Pressable>
            </View>
            {emojiOpen && (
              <EmojiPicker onPick={(e) => setText(t => (t + e).slice(0, 2000))} />
            )}
          </>
        )}
      </KeyboardAvoidingView>

      {/* Attachment action sheet */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={s.sheetOverlay} onPress={() => setAttachOpen(false)}>
          <Pressable style={s.attachSheet} onPress={() => {}}>
            <View style={s.dragHandle} />
            <Text style={s.attachTitle}>Share</Text>
            <View style={s.attachGrid}>
              <AttachOption icon="📷" label="Camera" tint="#3b82f6" onPress={onCamera} />
              <AttachOption icon="🖼️" label="Photo" tint="#a855f7" onPress={onPhoto} />
              <AttachOption icon="📄" label="Document" tint="#f59e0b" onPress={onDocument} />
              <AttachOption icon="📍" label="Location" tint="#10b981" onPress={onLocation} />
              <AttachOption icon="👤" label="Contact" tint="#ef4444" onPress={onContact} />
            </View>
            <Pressable style={s.attachCancel} onPress={() => setAttachOpen(false)}>
              <Text style={s.attachCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reaction picker (long-press a message) */}
      <Modal visible={!!reactionTarget} transparent animationType="fade" onRequestClose={() => setReactionTarget(null)}>
        <Pressable style={s.reactOverlay} onPress={() => setReactionTarget(null)}>
          <View style={s.reactBar}>
            {QUICK_REACTIONS.map(e => (
              <Pressable key={e} style={s.reactBtn} onPress={() => reactionTarget && react(reactionTarget, e)}>
                <Text style={s.reactBtnEmoji}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {uploading && (
        <View style={s.uploadingToast}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={s.uploadingText}>Sending…</Text>
        </View>
      )}

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

// ── Message rendering ─────────────────────────────────────────────────────────
function MessageBody({ item, mine }: { item: Message; mine: boolean }) {
  const type = item.type ?? 'text';

  if (type === 'image' && item.image?.url) {
    const w = item.image.width ?? 1;
    const h = item.image.height ?? 1;
    const ratio = w && h ? w / h : 1;
    return (
      <Pressable
        style={[s.bubble, s.imageBubble, mine ? s.bubbleMine : s.bubbleOther]}
        onPress={() => Linking.openURL(item.image!.url)}
      >
        <Image
          source={{ uri: item.image.url }}
          alt="Shared photo"
          style={[s.image, { aspectRatio: ratio > 0 ? ratio : 1 }]}
          resizeMode="cover"
        />
        {!!item.text && <Text style={[s.msgText, mine && s.msgTextMine, { marginTop: 6 }]}>{item.text}</Text>}
      </Pressable>
    );
  }

  if (type === 'location' && item.location) {
    const { lat, lng, label } = item.location;
    return (
      <Pressable
        style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}
        onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}
      >
        <Text style={[s.attachHeading, mine && s.msgTextMine]}>📍 Shared location</Text>
        <Text style={[s.attachSub, mine && { color: 'rgba(0,0,0,0.7)' }]} numberOfLines={2}>
          {label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        </Text>
        <Text style={[s.attachAction, mine && { color: '#2f5000' }]}>Open in Maps →</Text>
      </Pressable>
    );
  }

  if (type === 'contact' && item.contact) {
    return (
      <Pressable
        style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}
        onPress={() => Linking.openURL(`tel:${item.contact!.phone}`)}
      >
        <Text style={[s.attachHeading, mine && s.msgTextMine]}>👤 {item.contact.name}</Text>
        <Text style={[s.attachSub, mine && { color: 'rgba(0,0,0,0.7)' }]}>{item.contact.phone}</Text>
        <Text style={[s.attachAction, mine && { color: '#2f5000' }]}>Call →</Text>
      </Pressable>
    );
  }

  if (type === 'file' && item.file?.url) {
    return (
      <Pressable
        style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}
        onPress={() => Linking.openURL(item.file!.url)}
      >
        <Text style={[s.attachHeading, mine && s.msgTextMine]} numberOfLines={1}>📎 {item.file.name || 'File'}</Text>
        {!!item.file.size && (
          <Text style={[s.attachSub, mine && { color: 'rgba(0,0,0,0.7)' }]}>{formatBytes(item.file.size)}</Text>
        )}
        <Text style={[s.attachAction, mine && { color: '#2f5000' }]}>Open →</Text>
      </Pressable>
    );
  }

  return (
    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
      <Text style={[s.msgText, mine && s.msgTextMine]}>{item.text}</Text>
    </View>
  );
}

function AttachOption({ icon, label, tint, onPress }: { icon: string; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable style={s.attachOpt} onPress={onPress}>
      <View style={[s.attachIconCircle, { backgroundColor: `${tint}22`, borderColor: `${tint}55` }]}>
        <Text style={s.attachIcon}>{icon}</Text>
      </View>
      <Text style={s.attachLabel}>{label}</Text>
    </Pressable>
  );
}

function aggregateReactions(
  reactions: Record<string, string> | undefined,
  myUid: string | undefined,
): { emoji: string; count: number; mine: boolean }[] {
  if (!reactions) return [];
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const [uid, emoji] of Object.entries(reactions)) {
    const cur = counts.get(emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (uid === myUid) cur.mine = true;
    counts.set(emoji, cur);
  }
  return Array.from(counts.entries()).map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeStr(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

const s = themed(() => StyleSheet.create({
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

  bubbleWrap:     { maxWidth: '82%', alignSelf: 'flex-start', gap: 3 },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  senderName:     { fontSize: 11, color: colors.muted, fontWeight: '700', marginLeft: 4 },
  bubble:         { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther:    { backgroundColor: colors.surface },
  bubbleMine:     { backgroundColor: colors.primary },
  msgText:        { fontSize: 15, color: colors.text, lineHeight: 20 },
  msgTextMine:    { color: '#000' },
  msgTime:        { fontSize: 10, color: colors.muted, marginLeft: 4, marginTop: 2 },

  // Attachment bubbles
  imageBubble:  { padding: 5 },
  image:        { width: 220, maxWidth: 220, borderRadius: 12, backgroundColor: colors.surface },
  attachHeading:{ fontSize: 14, fontWeight: '800', color: colors.text },
  attachSub:    { fontSize: 12, color: colors.muted, marginTop: 3 },
  attachAction: { fontSize: 12, fontWeight: '800', color: colors.primary, marginTop: 6 },

  // Reactions on a bubble
  reactionRow:      { flexDirection: 'row', gap: 4, marginTop: 2, marginLeft: 4, flexWrap: 'wrap' },
  reactionChip:     { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2 },
  reactionChipMine: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  reactionEmoji:    { fontSize: 13 },
  reactionCount:    { fontSize: 11, fontWeight: '800', color: colors.muted },

  // Message requests: the recipient's Accept / Delete bar, the sender's
  // "waiting" notice, and the hint above the one message they're allowed.
  requestBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  requestBarText: { fontSize: 13, color: colors.muted, lineHeight: 19, textAlign: 'center' },
  requestBarBtns: { flexDirection: 'row', gap: 10 },
  requestDeleteBtn: {
    flex: 1, height: 46, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  requestDeleteText: { fontSize: 14, fontWeight: '800', color: colors.muted },
  requestAcceptBtn: {
    flex: 1, height: 46, borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  requestAcceptText: { fontSize: 14, fontWeight: '900', color: '#000' },

  waitingBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  waitingText: { fontSize: 13, color: colors.muted, lineHeight: 19, textAlign: 'center' },

  requestHintBar: {
    backgroundColor: colors.glassLime,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  requestHintText: { fontSize: 11, fontWeight: '700', color: colors.primary, textAlign: 'center' },

  inputRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  iconBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 20, color: colors.text },
  textInput:   { flex: 1, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border, maxHeight: 100 },
  sendBtn:     { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtnOff:  { opacity: 0.4 },
  sendText:    { color: '#000', fontWeight: '800', fontSize: 14 },

  // Attachment sheet
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  attachSheet:  { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: colors.border, padding: 20, paddingBottom: 34, gap: 8 },
  dragHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 6 },
  attachTitle:  { fontSize: 16, fontWeight: '900', color: colors.text, marginBottom: 6 },
  attachGrid:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  attachOpt:    { width: '18%', alignItems: 'center', gap: 6 },
  attachIconCircle: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  attachIcon:   { fontSize: 24 },
  attachLabel:  { fontSize: 11, fontWeight: '700', color: colors.muted },
  attachCancel: { marginTop: 10, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  attachCancelText: { fontSize: 14, fontWeight: '800', color: colors.muted },

  // Reaction picker
  reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  reactBar:     { flexDirection: 'row', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 30, paddingHorizontal: 12, paddingVertical: 10 },
  reactBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reactBtnEmoji:{ fontSize: 28 },

  uploadingToast: { position: 'absolute', bottom: 90, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  uploadingText:  { fontSize: 13, fontWeight: '800', color: '#000' },

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
}));
