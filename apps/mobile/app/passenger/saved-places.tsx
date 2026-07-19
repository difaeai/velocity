import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';

type PlaceCategory = 'home' | 'work' | 'other';

interface SavedPlace {
  id: string;
  category: PlaceCategory;
  label: string;
  address: string;
  createdAt: Timestamp | null;
}

const CATEGORIES: { key: PlaceCategory; icon: string; color: string; label: string }[] = [
  { key: 'home',  icon: '🏠', color: '#3b82f6', label: 'Home'  },
  { key: 'work',  icon: '💼', color: '#f59e0b', label: 'Work'  },
  { key: 'other', icon: '📍', color: colors.primary, label: 'Other' },
];

const DEFAULT_LABELS: Record<PlaceCategory, string> = {
  home:  'Home',
  work:  'Work',
  other: 'Saved Place',
};

export default function SavedPlacesScreen() {
  const router   = useRouter();
  const { user } = useAuth();
  const [places, setPlaces]     = useState<SavedPlace[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<SavedPlace | null>(null);

  // Modal state
  const [category, setCategory] = useState<PlaceCategory>('other');
  const [label,    setLabel]    = useState('');
  const [address,  setAddress]  = useState('');
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'users', user.uid, 'savedPlaces'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPlaces(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedPlace)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user?.uid]);

  function openAdd() {
    setEditTarget(null);
    setCategory('other');
    setLabel('');
    setAddress('');
    setShowModal(true);
  }

  function openEdit(place: SavedPlace) {
    setEditTarget(place);
    setCategory(place.category);
    setLabel(place.label);
    setAddress(place.address);
    setShowModal(true);
  }

  async function savePlace() {
    if (!address.trim()) { Alert.alert('Missing', 'Enter an address.'); return; }
    if (!user?.uid) return;

    setSaving(true);
    const finalLabel = label.trim() || DEFAULT_LABELS[category];
    try {
      if (editTarget) {
        await updateDoc(doc(db, 'users', user.uid, 'savedPlaces', editTarget.id), {
          category,
          label:   finalLabel,
          address: address.trim(),
        });
      } else {
        await addDoc(collection(db, 'users', user.uid, 'savedPlaces'), {
          category,
          label:     finalLabel,
          address:   address.trim(),
          createdAt: Timestamp.now(),
        });
      }
      setShowModal(false);
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to save place.');
    } finally {
      setSaving(false);
    }
  }

  async function deletePlace(place: SavedPlace) {
    if (!user?.uid) return;
    Alert.alert(
      'Delete Place',
      `Remove "${place.label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'users', user.uid!, 'savedPlaces', place.id));
            } catch {
              Alert.alert('Error', 'Failed to delete place.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Saved Places</Text>
        <Pressable style={styles.addBtn} onPress={openAdd} hitSlop={8}>
          <Text style={styles.addBtnTxt}>+ Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {places.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🗺️</Text>
              <Text style={styles.emptyTitle}>No saved places yet</Text>
              <Text style={styles.emptyDesc}>
                Save your home, office and favourite spots for quick access when booking rides.
              </Text>
              <Pressable style={styles.emptyBtn} onPress={openAdd}>
                <Text style={styles.emptyBtnTxt}>Add your first place</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {places.map((place) => {
                const cat = CATEGORIES.find(c => c.key === place.category)!;
                return (
                  <View key={place.id} style={styles.placeCard}>
                    <View style={[styles.placeIconCircle, { backgroundColor: cat.color + '20', borderColor: cat.color + '40' }]}>
                      <Text style={styles.placeIcon}>{cat.icon}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.placeLabel}>{place.label}</Text>
                      <Text style={styles.placeAddress} numberOfLines={2}>{place.address}</Text>
                    </View>
                    <View style={styles.placeActions}>
                      <Pressable style={styles.editBtn} onPress={() => openEdit(place)} hitSlop={8}>
                        <Text style={styles.editBtnTxt}>Edit</Text>
                      </Pressable>
                      <Pressable style={styles.deleteBtn} onPress={() => deletePlace(place)} hitSlop={8}>
                        <Text style={styles.deleteBtnTxt}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              <Pressable style={styles.addMoreBtn} onPress={openAdd}>
                <Text style={styles.addMoreTxt}>+ Add another place</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editTarget ? 'Edit Place' : 'Add New Place'}</Text>

            <Text style={styles.fieldLabel}>CATEGORY</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map(c => (
                <Pressable
                  key={c.key}
                  style={[styles.categoryChip, category === c.key && { borderColor: c.color, backgroundColor: c.color + '20' }]}
                  onPress={() => {
                    setCategory(c.key);
                    if (!label.trim() || Object.values(DEFAULT_LABELS).includes(label)) {
                      setLabel(DEFAULT_LABELS[c.key]);
                    }
                  }}
                >
                  <Text style={styles.categoryIcon}>{c.icon}</Text>
                  <Text style={[styles.categoryLabel, category === c.key && { color: c.color }]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>LABEL</Text>
            <TextInput
              style={styles.fieldInput}
              value={label}
              onChangeText={setLabel}
              placeholder={DEFAULT_LABELS[category]}
              placeholderTextColor={colors.muted}
              maxLength={50}
            />

            <Text style={styles.fieldLabel}>ADDRESS</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldInputMulti]}
              value={address}
              onChangeText={setAddress}
              placeholder="Full address or landmark"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Pressable
              style={[styles.saveBtn, (!address.trim() || saving) && { opacity: 0.5 }]}
              onPress={savePlace}
              disabled={!address.trim() || saving}
            >
              {saving
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.saveBtnTxt}>Save Place</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
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
  backBtn:     { width: 40 },
  backTxt:     { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  addBtn:      { backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 },
  addBtnTxt:   { fontSize: 13, fontWeight: '900', color: '#000' },

  content: { padding: 16, gap: 10, paddingBottom: 40 },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyIcon:  { fontSize: 52 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyDesc:  { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn:    { height: 50, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, marginTop: 8 },
  emptyBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },

  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  placeIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  placeIcon:    { fontSize: 20 },
  placeLabel:   { fontSize: 14, fontWeight: '800', color: colors.text },
  placeAddress: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  placeActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  editBtnTxt:   { fontSize: 12, fontWeight: '700', color: colors.text },
  deleteBtn:    { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: colors.danger + '40' },
  deleteBtnTxt: { fontSize: 12, fontWeight: '900', color: colors.danger },

  addMoreBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addMoreTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
  modalTitle:  { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },

  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  fieldInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  fieldInputMulti: { height: 90, textAlignVertical: 'top' },

  categoryRow: { flexDirection: 'row', gap: 8 },
  categoryChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryIcon:  { fontSize: 16 },
  categoryLabel: { fontSize: 12, fontWeight: '700', color: colors.muted },

  saveBtn:    { height: 52, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
}));
