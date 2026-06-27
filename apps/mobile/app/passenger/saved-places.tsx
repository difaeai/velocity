import { useState } from 'react';
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

import { colors } from '../../src/config';

type PlaceCategory = 'home' | 'work' | 'other';

interface SavedPlace {
  id: string;
  label: string;
  address: string;
  category: PlaceCategory;
}

const CATEGORY_META: Record<PlaceCategory, { emoji: string; color: string }> = {
  home:  { emoji: '🏠', color: '#3b82f6' },
  work:  { emoji: '🏢', color: '#f59e0b' },
  other: { emoji: '📍', color: colors.primary },
};

const DEFAULT_PLACES: SavedPlace[] = [
  { id: '1', label: 'Home',   address: 'Add your home address',   category: 'home' },
  { id: '2', label: 'Work',   address: 'Add your work address',   category: 'work' },
];

export default function SavedPlacesScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<SavedPlace[]>(DEFAULT_PLACES);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState<PlaceCategory>('other');

  function openAddModal() {
    setEditingId(null);
    setLabel('');
    setAddress('');
    setCategory('other');
    setModalVisible(true);
  }

  function openEditModal(p: SavedPlace) {
    setEditingId(p.id);
    setLabel(p.label);
    setAddress(p.address === 'Add your home address' || p.address === 'Add your work address' ? '' : p.address);
    setCategory(p.category);
    setModalVisible(true);
  }

  function savePlace() {
    if (!label.trim()) { Alert.alert('Missing info', 'Please enter a label for this place.'); return; }
    if (!address.trim()) { Alert.alert('Missing info', 'Please enter an address.'); return; }

    if (editingId) {
      setPlaces(prev => prev.map(p => p.id === editingId ? { ...p, label: label.trim(), address: address.trim(), category } : p));
    } else {
      setPlaces(prev => [...prev, { id: Date.now().toString(), label: label.trim(), address: address.trim(), category }]);
    }
    setModalVisible(false);
  }

  function deletePlace(id: string) {
    Alert.alert('Remove place', 'Remove this saved place?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setPlaces(prev => prev.filter(p => p.id !== id)) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Saved Places</Text>
        <Pressable onPress={openAddModal} hitSlop={12}>
          <Text style={styles.addBtn}>+ Add</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {places.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📍</Text>
            <Text style={styles.emptyTitle}>No saved places</Text>
            <Text style={styles.emptySub}>Save your home, work, and favourite spots for faster booking.</Text>
            <Pressable style={styles.emptyBtn} onPress={openAddModal}>
              <Text style={styles.emptyBtnText}>Add a place</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {places.map(p => {
              const meta = CATEGORY_META[p.category];
              const isPlaceholder = p.address === 'Add your home address' || p.address === 'Add your work address';
              return (
                <Pressable key={p.id} style={styles.placeCard} onPress={() => openEditModal(p)}>
                  <View style={[styles.placeIcon, { backgroundColor: `${meta.color}20`, borderColor: `${meta.color}40` }]}>
                    <Text style={styles.placeEmoji}>{meta.emoji}</Text>
                  </View>
                  <View style={styles.placeInfo}>
                    <Text style={styles.placeLabel}>{p.label}</Text>
                    <Text style={[styles.placeAddress, isPlaceholder && { color: colors.muted, fontStyle: 'italic' }]} numberOfLines={1}>
                      {p.address}
                    </Text>
                  </View>
                  <View style={styles.placeActions}>
                    <Pressable style={styles.editBtn} onPress={() => openEditModal(p)} hitSlop={8}>
                      <Text style={styles.editBtnText}>Edit</Text>
                    </Pressable>
                    <Pressable style={styles.deleteBtn} onPress={() => deletePlace(p.id)} hitSlop={8}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}

            <Pressable style={styles.addMoreBtn} onPress={openAddModal}>
              <Text style={styles.addMoreIcon}>+</Text>
              <Text style={styles.addMoreText}>Add another place</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editingId ? 'Edit Place' : 'Add a Place'}</Text>

            <Text style={styles.modalLabel}>CATEGORY</Text>
            <View style={styles.catRow}>
              {(Object.keys(CATEGORY_META) as PlaceCategory[]).map(c => {
                const m = CATEGORY_META[c];
                return (
                  <Pressable
                    key={c}
                    style={[styles.catChip, category === c && { borderColor: m.color, backgroundColor: `${m.color}20` }]}
                    onPress={() => setCategory(c)}
                  >
                    <Text style={styles.catEmoji}>{m.emoji}</Text>
                    <Text style={[styles.catLabel, category === c && { color: m.color }]}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>LABEL</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Home, Office, Gym"
              placeholderTextColor={colors.muted}
              value={label}
              onChangeText={setLabel}
            />

            <Text style={styles.modalLabel}>ADDRESS</Text>
            <TextInput
              style={[styles.modalInput, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]}
              placeholder="Full address"
              placeholderTextColor={colors.muted}
              multiline
              value={address}
              onChangeText={setAddress}
            />

            <Pressable style={styles.saveBtn} onPress={savePlace}>
              <Text style={styles.saveBtnText}>Save Place</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 40 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  addBtn: { fontSize: 15, fontWeight: '800', color: colors.primary },
  container: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 48, marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingHorizontal: 20 },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  emptyBtnText: { color: '#000', fontWeight: '900', fontSize: 15 },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  placeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeEmoji: { fontSize: 20 },
  placeInfo: { flex: 1, gap: 3 },
  placeLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  placeAddress: { fontSize: 12, color: colors.muted },
  placeActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: colors.text },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ef444420',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 12, color: colors.danger, fontWeight: '700' },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    padding: 16,
    justifyContent: 'center',
  },
  addMoreIcon: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  addMoreText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: '#1c1b1b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
    paddingBottom: 36,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 4 },
  modalLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  catRow: { flexDirection: 'row', gap: 10 },
  catChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  catEmoji: { fontSize: 16 },
  catLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  modalInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  saveBtn: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
