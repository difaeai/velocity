/**
 * Travel Partner — city community groups directory.
 *
 * Every community is pinned to a city, and the list is grouped by city so
 * everyone can always see where a group belongs. Anyone with a Travel Partner
 * profile can create a group — but they MUST pick the city first.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api, type TMCommunity } from '../../../src/api/client';
import { PAKISTAN_CITIES } from '../../../src/domain/intercityTypes';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';


export default function TravelMateCommunities() {
  const { user } = useAuth();
  const router = useRouter();

  const [communities, setCommunities] = useState<TMCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [cityQuery, setCityQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'travelMateCommunities'),
        orderBy('city', 'asc'),
        orderBy('memberCount', 'desc'),
        limit(200),
      ));
      setCommunities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMCommunity));
    } catch {
      Alert.alert('Error', 'Could not load communities. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? communities.filter(c =>
          c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))
      : communities;
    const byCity = new Map<string, TMCommunity[]>();
    filtered.forEach(c => {
      const list = byCity.get(c.city) ?? [];
      list.push(c);
      byCity.set(c.city, list);
    });
    return [...byCity.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cityName, data]) => ({ title: cityName, data }));
  }, [communities, search]);

  const cityOptions = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    const names = PAKISTAN_CITIES.map(c => c.name);
    return q ? names.filter(n => n.toLowerCase().includes(q)) : names;
  }, [cityQuery]);

  async function create() {
    if (creating) return;
    if (!name.trim() || name.trim().length < 3) {
      Alert.alert('Name needed', 'Give your group a name (at least 3 characters).');
      return;
    }
    if (!city) {
      Alert.alert('City required', 'Pick the city this group belongs to — everyone who joins will always see it.');
      return;
    }
    setCreating(true);
    try {
      const { communityId } = await api.createTravelMateCommunity({
        name: name.trim(),
        city,
        description: description.trim() || undefined,
      });
      setCreateOpen(false);
      setName(''); setCity(null); setDescription(''); setCityQuery('');
      router.push(`/passenger/travel-mate/community/${communityId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your Travel Partner profile first, then create a group.');
      } else if (e instanceof FirebaseError && e.code === 'functions/already-exists') {
        Alert.alert('Already exists', e.message);
      } else {
        Alert.alert('Could not create group', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate/feed' as Parameters<typeof router.replace>[0]))}
          style={s.backBtn}
        >
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.title}>City groups</Text>
        <Pressable onPress={() => setCreateOpen(true)} style={s.newBtn}>
          <Text style={s.newBtnText}>+ New</Text>
        </Pressable>
      </View>

      <View style={s.searchWrap}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search groups or cities…"
          placeholderTextColor={colors.muted}
        />
      </View>

      {loading ? (
        <View style={s.centerBox}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : sections.length === 0 ? (
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>🏙️</Text>
          <Text style={s.emptyTitle}>No groups yet</Text>
          <Text style={s.emptySub}>Create the first community group for your city!</Text>
          <Pressable style={s.createBtn} onPress={() => setCreateOpen(true)}>
            <Text style={s.createBtnText}>Create a group</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={s.sectionHead}>
              <Text style={s.sectionCity}>📍 {section.title}</Text>
              <Text style={s.sectionCount}>
                {section.data.length} {section.data.length === 1 ? 'group' : 'groups'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isMember = !!user && item.members?.includes(user.uid);
            return (
              <Pressable
                style={s.commRow}
                onPress={() => router.push(`/passenger/travel-mate/community/${item.id}` as Parameters<typeof router.push>[0])}
              >
                <View style={s.commIcon}><Text style={{ fontSize: 20 }}>🌆</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.commName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.commSub} numberOfLines={1}>
                    {item.memberCount} {item.memberCount === 1 ? 'member' : 'members'}
                    {item.description ? ` · ${item.description}` : ''}
                  </Text>
                </View>
                {isMember && <View style={s.memberBadge}><Text style={s.memberBadgeText}>Joined</Text></View>}
                <Text style={s.chevron}>›</Text>
              </Pressable>
            );
          }}
        />
      )}

      {/* Create group modal — city is mandatory */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => !creating && setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Create a city group</Text>
            <Text style={s.modalSub}>
              Pick the city first — every group belongs to a city, and members will
              always see which city it is for.
            </Text>

            <Text style={s.fieldLabel}>City *</Text>
            {city ? (
              <View style={s.cityPickedRow}>
                <Text style={s.cityPicked}>📍 {city}</Text>
                <Pressable onPress={() => setCity(null)}>
                  <Text style={s.cityChange}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <TextInput
                  style={s.input}
                  value={cityQuery}
                  onChangeText={setCityQuery}
                  placeholder="Search your city…"
                  placeholderTextColor={colors.muted}
                />
                <ScrollView style={s.cityList} keyboardShouldPersistTaps="handled">
                  {cityOptions.slice(0, 8).map(n => (
                    <Pressable key={n} style={s.cityOption} onPress={() => { setCity(n); setCityQuery(''); }}>
                      <Text style={s.cityOptionText}>📍 {n}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={s.fieldLabel}>Group name *</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Daily commuters, Foodies, Students…"
              placeholderTextColor={colors.muted}
              maxLength={48}
            />

            <Text style={s.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="What is this group about?"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={300}
            />

            <View style={s.modalActions}>
              <Pressable
                onPress={() => { if (!creating) { setCreateOpen(false); setName(''); setCity(null); setDescription(''); setCityQuery(''); } }}
                style={s.cancelBtn}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={create}
                disabled={creating}
                style={[s.confirmBtn, creating && { opacity: 0.5 }]}
              >
                <Text style={s.confirmBtnText}>{creating ? 'Creating…' : 'Create group'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },
  newBtn:  { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: colors.primary },
  newBtnText: { fontSize: 13, fontWeight: '900', color: '#000' },

  searchWrap:  { paddingHorizontal: 16, paddingBottom: 10 },
  searchInput: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 14 },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle:{ fontSize: 19, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  createBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary },
  createBtnText: { fontSize: 14, fontWeight: '900', color: '#000' },

  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  sectionCity: { fontSize: 14, fontWeight: '900', color: colors.primary },
  sectionCount:{ fontSize: 11, color: colors.muted, fontWeight: '700' },

  commRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, marginBottom: 8 },
  commIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: `${colors.primary}22`, alignItems: 'center', justifyContent: 'center' },
  commName: { fontSize: 15, fontWeight: '800', color: colors.text },
  commSub:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  memberBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: `${colors.primary}22`, borderWidth: 1, borderColor: `${colors.primary}55` },
  memberBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  chevron:  { fontSize: 20, color: colors.muted },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.glassPanel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 10, borderWidth: 1, borderColor: colors.border },
  modalTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub:     { fontSize: 13, color: colors.muted, lineHeight: 18 },
  fieldLabel:   { fontSize: 12, fontWeight: '800', color: colors.text, marginTop: 6 },
  input:        { height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  multiline:    { height: 70, paddingTop: 12, textAlignVertical: 'top' },

  cityPickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: `${colors.primary}18`, paddingHorizontal: 14 },
  cityPicked:    { fontSize: 14, fontWeight: '800', color: colors.primary },
  cityChange:    { fontSize: 12, fontWeight: '800', color: colors.muted },
  cityList:      { maxHeight: 150, marginTop: 6 },
  cityOption:    { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  cityOptionText:{ fontSize: 14, color: colors.text, fontWeight: '600' },

  modalActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  cancelBtn:    { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmBtn:   { flex: 1, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText:{ fontSize: 14, fontWeight: '900', color: '#000' },
}));
