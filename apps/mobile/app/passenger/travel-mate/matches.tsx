/**
 * Travel Mate — matches + groups list screen.
 *
 * Section 1: active matches (travelMateMatches where users array-contains me)
 * Section 2: my commute groups (travelMateGroups where members array-contains me)
 *
 * Tapping a match → chat screen.
 * Tapping a group → group screen.
 * "Join group" FAB → join-by-ID sheet.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';

type MatchStatus = 'active' | 'unmatched';
interface TravelMatch {
  id: string;
  users: string[];
  userInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status: MatchStatus;
  lastMessageAt?: { seconds: number } | null;
  matchedAt?: { seconds: number };
}

interface Group {
  id: string;
  name: string;
  members: string[];
  memberInfo: Record<string, { displayName: string; photoURL: string | null }>;
  destinationName: string;
  status: string;
  createdAt?: { seconds: number };
}

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TravelMateMatches() {
  const { user } = useAuth();
  const router = useRouter();

  const [matches, setMatches] = useState<TravelMatch[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateMatches'), where('users', 'array-contains', user.uid)),
      snap => setMatches(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TravelMatch)),
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateGroups'), where('members', 'array-contains', user.uid)),
      snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Group)),
    );
  }, [user?.uid]);

  const activeMatches = useMemo(
    () => [...matches]
      .filter(m => m.status === 'active')
      .sort((a, b) => (b.lastMessageAt?.seconds ?? b.matchedAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? a.matchedAt?.seconds ?? 0)),
    [matches],
  );

  async function joinGroup() {
    if (!joinId.trim()) return;
    setJoining(true);
    try {
      await api.joinTravelMateGroup({ groupId: joinId.trim() });
      const gid = joinId.trim();
      setJoinModalOpen(false);
      setJoinId('');
      router.push(`/passenger/travel-mate/group/${gid}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError) {
        Alert.alert('Could not join', e.message);
      }
    } finally {
      setJoining(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>←</Text></Pressable>
        <Text style={s.title}>Travel Mate</Text>
        <Pressable onPress={() => router.push('/passenger/travel-mate')} style={s.swipeBtn}>
          <Text style={s.swipeBtnText}>🔍</Text>
        </Pressable>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={() => (
          <>
            {/* Active matches */}
            <Text style={s.sectionHead}>Matches</Text>
            {activeMatches.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No matches yet — keep swiping!</Text>
              </View>
            )}
            {activeMatches.map(match => {
              const otherId = match.users.find(u => u !== user?.uid) ?? '';
              const other = match.userInfo?.[otherId];
              const ts = match.lastMessageAt ?? match.matchedAt;
              return (
                <Pressable
                  key={match.id}
                  style={s.matchRow}
                  onPress={() => router.push(`/passenger/travel-mate/chat/${match.id}` as Parameters<typeof router.push>[0])}
                >
                  {other?.photoURL ? (
                    <Image source={{ uri: other.photoURL }} style={s.avatarPhoto} />
                  ) : (
                    <View style={s.avatar}><Text style={s.avatarEmoji}>👤</Text></View>
                  )}
                  <View style={s.matchInfo}>
                    <Text style={s.matchName}>{other?.displayName ?? 'Travel mate'}</Text>
                    <Text style={s.matchSub} numberOfLines={1}>
                      {match.lastMessageAt ? 'Tap to continue chatting 💬' : 'Tap to say hello 👋'}
                    </Text>
                  </View>
                  <Text style={s.matchTime}>{ts ? timeAgo(ts.seconds) : ''}</Text>
                </Pressable>
              );
            })}

            {/* Groups */}
            <View style={s.sectionRow}>
              <Text style={s.sectionHead}>My Groups</Text>
              <Pressable onPress={() => setJoinModalOpen(true)} style={s.joinBtn}>
                <Text style={s.joinBtnText}>+ Join</Text>
              </Pressable>
            </View>
            {groups.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No groups yet — start one from a match chat.</Text>
              </View>
            )}
            {groups.map(group => (
              <Pressable
                key={group.id}
                style={s.groupRow}
                onPress={() => router.push(`/passenger/travel-mate/group/${group.id}` as Parameters<typeof router.push>[0])}
              >
                <View style={s.groupIcon}><Text style={{ fontSize: 22 }}>🤝</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.groupName}>{group.name}</Text>
                  <Text style={s.groupSub}>{group.members.length}/{group.members.length > 0 ? (group as { maxSize?: number }).maxSize ?? 4 : 4} members · {group.destinationName}</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ))}

            <View style={{ height: 40 }} />
          </>
        )}
        showsVerticalScrollIndicator={false}
      />

      {/* Join group modal */}
      <Modal visible={joinModalOpen} transparent animationType="slide" onRequestClose={() => setJoinModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Join a group</Text>
            <Text style={s.modalSub}>Ask the group creator to share their Group ID with you.</Text>
            <TextInput
              style={s.joinInput}
              value={joinId}
              onChangeText={setJoinId}
              placeholder="Paste Group ID…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => { setJoinModalOpen(false); setJoinId(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={joinGroup} disabled={joining || !joinId.trim()} style={[s.confirmBtn, (!joinId.trim() || joining) && { opacity: 0.5 }]}>
                <Text style={s.confirmBtnText}>{joining ? 'Joining…' : 'Join'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  topBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:   { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:      { fontSize: 18, fontWeight: '900', color: colors.text },
  swipeBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  swipeBtnText: { fontSize: 16 },

  sectionHead: { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 20 },
  joinBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  joinBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },

  emptyCard:  { marginHorizontal: 20, padding: 18, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyText:  { fontSize: 13, color: colors.muted, textAlign: 'center' },

  // Match row
  matchRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 14 },
  avatar:      { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  avatarEmoji: { fontSize: 22 },
  avatarPhoto: { width: 52, height: 52, borderRadius: 26 },
  matchInfo:  { flex: 1, gap: 3 },
  matchName:  { fontSize: 15, fontWeight: '800', color: colors.text },
  matchSub:   { fontSize: 12, color: colors.muted },
  matchTime:  { fontSize: 11, color: colors.muted },

  // Group row
  groupRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 10, padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14 },
  groupIcon:  { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  groupName:  { fontSize: 15, fontWeight: '800', color: colors.text },
  groupSub:   { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:    { fontSize: 20, color: colors.muted },

  // Join modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  joinInput:    { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '800', color: '#fff' },
});
