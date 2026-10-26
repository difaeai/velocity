/**
 * Travel Partner — Groups tab.
 *
 * Create a commute group, join one with an invite code, and the live list of
 * groups you belong to. (Moved off the old Home hub, which is now the deck.)
 */
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { useTravelMateGroups } from '../../../src/hooks/travelMateCommunity';
import { api } from '../../../src/api/client';
import { appLink } from '../../../src/share/links';
import { InboxModeBar } from '../../../src/ui/InboxModeBar';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

export default function TravelMateGroups() {
  const router = useRouter();
  const groups = useTravelMateGroups();
  // Edge-to-edge Android draws behind the system navigation bar — bottom
  // sheets must pad past it or their last row is hidden behind the OS bar.
  const insets = useSafeAreaInsets();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDest, setCreateDest] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

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
      // Surface the invite code immediately — people kept creating groups and
      // never finding the code others need to join.
      Alert.alert(
        'Group created 🎉',
        `Invite code:\n\n${groupId}\n\nShare it with matched travel partners — they join via "Join a group", or by opening your invite link. The code also stays visible on the group screen.`,
        [
          {
            text: 'Share invite',
            onPress: () => {
              const link = appLink(`/passenger/travel-mate/group-invite/${groupId}`);
              Share.share({
                message:
                  `Join my Travel Partner commute group on Velocity Rides!\n\n${link}\n\n` +
                  `Or open the app → Travel Partner → Groups → "Join a group" and paste this invite code:\n${groupId}`,
                title: 'Join my Travel Partner group',
              }).catch(() => {});
            },
          },
          { text: 'Done' },
        ],
      );
    } catch (e: unknown) {
      Alert.alert('Could not create group', e instanceof Error ? e.message : 'Please try again.');
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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.push('/passenger/home')} style={s.backBtn}>
          <Text style={s.backBtnText}>← Book Ride</Text>
        </Pressable>
        <Text style={s.screenTitle}>Groups</Text>
        <View style={{ width: 80 }} />
      </View>
      <InboxModeBar />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.grid}>
          <Pressable style={s.tile} onPress={() => setCreateOpen(true)}>
            <Text style={s.tileEmoji}>🤝</Text>
            <Text style={s.tileLabel}>Create a group</Text>
            <Text style={s.tileSub}>Start a commute group</Text>
          </Pressable>
          <Pressable style={s.tile} onPress={() => setJoinOpen(true)}>
            <Text style={s.tileEmoji}>➕</Text>
            <Text style={s.tileLabel}>Join a group</Text>
            <Text style={s.tileSub}>Use an invite code</Text>
          </Pressable>
        </View>

        <Text style={s.sectionHead}>My groups</Text>

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
      </ScrollView>

      {/* Create group modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: 28 + insets.bottom }]}>
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
          <View style={[s.modalBox, { paddingBottom: 28 + insets.bottom }]}>
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

const s = themed(() => StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  topBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  screenTitle: { fontSize: 18, fontWeight: '900', color: colors.text },

  scroll: { padding: 16, gap: 14 },

  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile:      { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 3 },
  tileEmoji: { fontSize: 26, marginBottom: 4 },
  tileLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub:   { fontSize: 12, color: colors.muted },

  sectionHead: { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6 },

  groupRow:  { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}22`, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 15, fontWeight: '800', color: colors.text },
  groupSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron:   { fontSize: 22, color: colors.muted },

  emptyGroups:     { alignItems: 'center', padding: 24, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  emptyGroupsEmoji:{ fontSize: 30 },
  emptyGroupsTitle:{ fontSize: 15, fontWeight: '900', color: colors.text },
  emptyGroupsSub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  emptyGroupsBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary },
  emptyGroupsBtnText: { fontSize: 14, fontWeight: '800', color: '#000' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  input:        { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '800', color: '#000' },
}));
