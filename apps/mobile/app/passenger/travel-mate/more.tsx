import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';

interface Group {
  id: string;
  name: string;
  members: string[];
  memberInfo: Record<string, { displayName: string; photoURL: string | null }>;
  destinationName: string;
  status: string;
  maxSize?: number;
}

export default function TravelMateMore() {
  const { user } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<Group[]>([]);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateGroups'), where('members', 'array-contains', user.uid)),
      snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Group)),
    );
  }, [user?.uid]);

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
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please check the Group ID and try again.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Book Ride</Text>
        </Pressable>
        <Text style={s.title}>More</Text>
        <View style={{ width: 80 }} />
      </View>

      <FlatList
        data={groups}
        keyExtractor={g => g.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={() => (
          <>
            {/* Groups section header */}
            <View style={s.sectionRow}>
              <Text style={s.sectionHead}>My Commute Groups</Text>
              <Pressable onPress={() => setJoinModalOpen(true)} style={s.joinBtn}>
                <Text style={s.joinBtnText}>+ Join group</Text>
              </Pressable>
            </View>
            {groups.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={{ fontSize: 28, marginBottom: 6 }}>🤝</Text>
                <Text style={s.emptyTitle}>No groups yet</Text>
                <Text style={s.emptySub}>Join a group by ID, or create one from a match chat.</Text>
              </View>
            )}
          </>
        )}
        renderItem={({ item: group }) => (
          <Pressable
            style={s.groupRow}
            onPress={() => router.push(`/passenger/travel-mate/group/${group.id}` as Parameters<typeof router.push>[0])}
          >
            <View style={s.groupIcon}><Text style={{ fontSize: 22 }}>🤝</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.groupName}>{group.name}</Text>
              <Text style={s.groupSub}>{group.members.length}/{group.maxSize ?? 4} members · {group.destinationName}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </Pressable>
        )}
        ListFooterComponent={() => (
          <>
            <View style={{ height: 24 }} />
            {/* Settings shortcuts */}
            <Text style={s.sectionHead}>Settings</Text>
            <Pressable style={s.settingsRow} onPress={() => router.push('/passenger/travel-mate/setup')}>
              <Text style={{ fontSize: 20 }}>✏️</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.settingsTitle}>Edit my profile</Text>
                <Text style={s.settingsSub}>Update photo, bio, interests and visibility</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
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
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },

  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionHead: { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  joinBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  joinBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },

  emptyCard: { padding: 28, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 4 },
  emptyTitle:{ fontSize: 15, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center' },

  groupRow:  { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14, marginBottom: 10 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 15, fontWeight: '800', color: colors.text },
  groupSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:   { fontSize: 20, color: colors.muted },

  settingsRow:  { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14, marginBottom: 10 },
  settingsTitle:{ fontSize: 15, fontWeight: '800', color: colors.text },
  settingsSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  joinInput:    { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '800', color: '#000' },
});
