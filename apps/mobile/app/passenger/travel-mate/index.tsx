/**
 * Travel Mate — Home hub.
 *
 * The landing screen for Travel Mate. Surfaces every action in one place:
 *   - Find travel partners  → swipe deck (discover)
 *   - Create a group / Join a group (invite code)
 *   - Matches / Chats
 *   - Share a ride link (book a ride, then invite partners to split it)
 *   - My groups (live list)
 *
 * Gated on having a Travel Mate profile — otherwise shows a create-profile CTA.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';

const PINK = '#E8637A';

interface Group {
  id: string;
  name: string;
  members: string[];
  destinationName?: string;
  maxSize?: number;
}

export default function TravelMateHome() {
  const { user } = useAuth();
  const router = useRouter();

  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDest, setCreateDest] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  // Profile gate
  useEffect(() => {
    if (!user) { setHasProfile(false); return; }
    return onSnapshot(
      doc(db, 'travelMateProfiles', user.uid),
      snap => setHasProfile(snap.exists()),
      () => setHasProfile(false),
    );
  }, [user?.uid]);

  // My groups (live)
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateGroups'), where('members', 'array-contains', user.uid)),
      snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Group)),
      () => {},
    );
  }, [user?.uid]);

  async function createGroup() {
    if (creating) return;
    setCreating(true);
    try {
      const { groupId } = await api.createTravelMateGroup({
        name: createName.trim() || undefined,
        destinationName: createDest.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateDest('');
      router.push(`/passenger/travel-mate/group/${groupId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your Travel Mate profile first, then create a group.');
      } else {
        Alert.alert('Could not create group', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function joinGroup() {
    const code = joinCode.trim();
    if (!code || joining) return;
    setJoining(true);
    try {
      await api.joinTravelMateGroup({ groupId: code });
      setJoinOpen(false);
      setJoinCode('');
      router.push(`/passenger/travel-mate/group/${code}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please check the invite code and try again.');
    } finally {
      setJoining(false);
    }
  }

  // ── Top bar ─────────────────────────────────────────────────────────────────
  const TopBar = () => (
    <View style={s.topBar}>
      <Pressable onPress={() => router.push('/passenger/home')} style={s.backBtn}>
        <Text style={s.backBtnText}>← Book Ride</Text>
      </Pressable>
      <Text style={s.screenTitle}>TravelMate</Text>
      <Pressable onPress={() => router.push('/passenger/travel-mate/setup')} style={s.gearBtn}>
        <Text style={s.gearText}>⚙️</Text>
      </Pressable>
    </View>
  );

  // ── No profile → create-profile CTA ───────────────────────────────────────────
  if (hasProfile === false) {
    return (
      <SafeAreaView style={s.safe}>
        <TopBar />
        <View style={s.gateBox}>
          <Text style={s.gateEmoji}>💛</Text>
          <Text style={s.gateTitle}>Welcome to TravelMate</Text>
          <Text style={s.gateSub}>
            Find travel partners heading your way, form commute groups, and split the fare.
            Set up your profile to get started.
          </Text>
          <Pressable style={s.gateBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.gateBtnText}>Create my profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TopBar />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero — Find travel partners */}
        <Pressable style={s.hero} onPress={() => router.push('/passenger/travel-mate/discover')}>
          <View style={{ flex: 1 }}>
            <Text style={s.heroKicker}>DISCOVER</Text>
            <Text style={s.heroTitle}>Find travel partners</Text>
            <Text style={s.heroSub}>Swipe to match with riders going your way</Text>
          </View>
          <View style={s.heroIconWrap}>
            <Text style={s.heroIcon}>🔍</Text>
          </View>
        </Pressable>

        {/* Quick actions grid */}
        <View style={s.grid}>
          <ActionTile
            emoji="🤝"
            label="Create a group"
            sub="Start a commute group"
            onPress={() => setCreateOpen(true)}
          />
          <ActionTile
            emoji="➕"
            label="Join a group"
            sub="Use an invite code"
            onPress={() => setJoinOpen(true)}
          />
          <ActionTile
            emoji="❤️"
            label="Matches"
            sub="People you matched"
            onPress={() => router.push('/passenger/travel-mate/matches')}
          />
          <ActionTile
            emoji="💬"
            label="Chats"
            sub="Your conversations"
            onPress={() => router.push('/passenger/travel-mate/chats')}
          />
        </View>

        {/* Share a ride link */}
        <Pressable style={s.shareCard} onPress={() => router.push('/passenger/booking')}>
          <Text style={s.shareIcon}>🚗</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.shareTitle}>Share a ride link</Text>
            <Text style={s.shareSub}>Book a ride, then invite partners to join and split the fare</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        {/* My groups */}
        <View style={s.sectionRow}>
          <Text style={s.sectionHead}>My groups</Text>
          {groups.length > 0 && (
            <Pressable onPress={() => setJoinOpen(true)}>
              <Text style={s.sectionAction}>+ Join</Text>
            </Pressable>
          )}
        </View>

        {groups.length === 0 ? (
          <Pressable style={s.emptyGroups} onPress={() => setCreateOpen(true)}>
            <Text style={s.emptyGroupsEmoji}>🤝</Text>
            <Text style={s.emptyGroupsTitle}>No groups yet</Text>
            <Text style={s.emptyGroupsSub}>Create a commute group and invite your matches to share rides.</Text>
            <View style={s.emptyGroupsBtn}><Text style={s.emptyGroupsBtnText}>Create a group</Text></View>
          </Pressable>
        ) : (
          groups.map(g => (
            <Pressable
              key={g.id}
              style={s.groupRow}
              onPress={() => router.push(`/passenger/travel-mate/group/${g.id}` as Parameters<typeof router.push>[0])}
            >
              <View style={s.groupIcon}><Text style={{ fontSize: 22 }}>🤝</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.groupName} numberOfLines={1}>{g.name}</Text>
                <Text style={s.groupSub} numberOfLines={1}>
                  {g.members.length}/{g.maxSize ?? 4} members{g.destinationName ? ` · ${g.destinationName}` : ''}
                </Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          ))
        )}

        {/* Profile shortcut */}
        <Pressable style={s.profileRow} onPress={() => router.push('/passenger/travel-mate/profile')}>
          <Text style={{ fontSize: 20 }}>👤</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.profileTitle}>My profile</Text>
            <Text style={s.profileSub}>Edit photo, bio, interests and visibility</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Create group modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Create a group</Text>
            <Text style={s.modalSub}>Name your commute group. You can invite matched partners once it's created.</Text>
            <TextInput
              style={s.input}
              value={createName}
              onChangeText={setCreateName}
              placeholder="Group name (e.g. Office Commute)"
              placeholderTextColor={colors.muted}
              maxLength={40}
            />
            <TextInput
              style={s.input}
              value={createDest}
              onChangeText={setCreateDest}
              placeholder="Destination (optional)"
              placeholderTextColor={colors.muted}
              maxLength={60}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => { setCreateOpen(false); setCreateName(''); setCreateDest(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={createGroup} disabled={creating} style={[s.confirmBtn, creating && { opacity: 0.5 }]}>
                <Text style={s.confirmBtnText}>{creating ? 'Creating…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join group modal */}
      <Modal visible={joinOpen} transparent animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Join a group</Text>
            <Text style={s.modalSub}>Ask the group creator to share their invite code with you.</Text>
            <TextInput
              style={s.input}
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Paste invite code…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => { setJoinOpen(false); setJoinCode(''); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={joinGroup} disabled={joining || !joinCode.trim()} style={[s.confirmBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }]}>
                <Text style={s.confirmBtnText}>{joining ? 'Joining…' : 'Join'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Quick-action tile ──────────────────────────────────────────────────────────
function ActionTile({
  emoji, label, sub, onPress,
}: { emoji: string; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={s.tile} onPress={onPress}>
      <Text style={s.tileEmoji}>{emoji}</Text>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileSub}>{sub}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  topBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  screenTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  gearBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gearText:    { fontSize: 16 },

  scroll: { padding: 16, gap: 14 },

  // Hero
  hero:        { flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 20, backgroundColor: PINK, gap: 14 },
  heroKicker:  { fontSize: 11, fontWeight: '900', color: 'rgba(255,255,255,0.85)', letterSpacing: 1.2 },
  heroTitle:   { fontSize: 22, fontWeight: '900', color: '#fff', marginTop: 4 },
  heroSub:     { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4, lineHeight: 18 },
  heroIconWrap:{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  heroIcon:    { fontSize: 30 },

  // Quick actions grid
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile:      { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 3 },
  tileEmoji: { fontSize: 26, marginBottom: 4 },
  tileLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub:   { fontSize: 12, color: colors.muted },

  // Share a ride
  shareCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
  shareIcon: { fontSize: 26 },
  shareTitle:{ fontSize: 15, fontWeight: '800', color: colors.text },
  shareSub:  { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },

  // Sections
  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionHead:  { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionAction:{ fontSize: 13, fontWeight: '800', color: colors.primary },

  // Group rows
  groupRow:  { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${PINK}22`, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 15, fontWeight: '800', color: colors.text },
  groupSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:   { fontSize: 22, color: colors.muted },

  // Empty groups
  emptyGroups:     { alignItems: 'center', padding: 24, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  emptyGroupsEmoji:{ fontSize: 30 },
  emptyGroupsTitle:{ fontSize: 15, fontWeight: '900', color: colors.text },
  emptyGroupsSub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  emptyGroupsBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: PINK },
  emptyGroupsBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  // Profile shortcut
  profileRow:  { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 6 },
  profileTitle:{ fontSize: 15, fontWeight: '800', color: colors.text },
  profileSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },

  // Profile gate
  gateBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  gateEmoji: { fontSize: 60 },
  gateTitle: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  gateSub:   { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  gateBtn:   { width: '100%', height: 54, borderRadius: 16, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  gateBtnText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  input:        { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 46, borderRadius: 12, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '800', color: '#fff' },
});
