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
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { colors } from '../../src/config';

interface Customer {
  uid: string;
  name: string;
  phone: string | null;
  email?: string | null;
  gender?: string;
  age?: number;
  role: string;
  profileComplete?: boolean;
  createdAt?: { seconds: number } | null;
  lastActive?: { seconds: number } | null;
}

function formatDate(ts?: { seconds: number } | null) {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const ROLES = ['passenger', 'driver', 'admin'];
const GENDERS = ['male', 'female', 'other'];

export default function AdminCustomers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Edit modal state
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editRole, setEditRole] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Customer, 'uid'>) })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  const filtered = search.trim()
    ? customers.filter((c) =>
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.phone?.includes(search) ||
        c.email?.toLowerCase().includes(search.toLowerCase())
      )
    : customers;

  const passengers = customers.filter((c) => c.role === 'passenger').length;
  const drivers    = customers.filter((c) => c.role === 'driver').length;

  function openEdit(c: Customer) {
    setEditing(c);
    setEditName(c.name ?? '');
    setEditGender(c.gender ?? '');
    setEditAge(c.age ? String(c.age) : '');
    setEditRole(c.role ?? 'passenger');
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editName.trim()) { Alert.alert('Error', 'Name cannot be empty.'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', editing.uid), {
        name: editName.trim(),
        gender: editGender || null,
        age: editAge ? parseInt(editAge, 10) : null,
        role: editRole,
        updatedAt: serverTimestamp(),
      });
      setEditing(null);
    } catch (e) {
      Alert.alert('Error', 'Failed to update customer.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(c: Customer) {
    Alert.alert(
      'Delete customer',
      `Remove ${c.name || c.phone || c.uid} permanently? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'users', c.uid));
            } catch {
              Alert.alert('Error', 'Failed to delete customer.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Customers</Text>
        <Text style={styles.count}>{customers.length}</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Text style={styles.statNum}>{customers.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statNum}>{passengers}</Text>
          <Text style={styles.statLabel}>Passengers</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statNum}>{drivers}</Text>
          <Text style={styles.statLabel}>Drivers</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone..."
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')}>
            <Text style={styles.clearSearch}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.length === 0 && (
            <Text style={styles.empty}>No customers found.</Text>
          )}
          {filtered.map((c) => (
            <View key={c.uid} style={styles.card}>
              {/* Avatar + info */}
              <View style={styles.cardTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {c.name ? c.name.charAt(0).toUpperCase() : '?'}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{c.name || '—'}</Text>
                  <Text style={styles.cardPhone}>{c.phone || c.email || c.uid}</Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, c.role === 'driver' && styles.badgeDriver]}>
                      <Text style={styles.badgeText}>{c.role}</Text>
                    </View>
                    {c.gender ? (
                      <View style={styles.badgeGender}>
                        <Text style={styles.badgeText}>{c.gender}</Text>
                      </View>
                    ) : null}
                    {c.age ? (
                      <View style={styles.badgeAge}>
                        <Text style={styles.badgeText}>{c.age} yrs</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Meta */}
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>Joined: {formatDate(c.createdAt)}</Text>
                <Text style={styles.metaText}>Active: {formatDate(c.lastActive)}</Text>
              </View>

              {/* Actions */}
              <View style={styles.cardActions}>
                <Pressable style={styles.editBtn} onPress={() => openEdit(c)}>
                  <Text style={styles.editBtnText}>✏️ Edit</Text>
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={() => confirmDelete(c)}>
                  <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Edit Modal */}
      <Modal visible={!!editing} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit customer</Text>
            <Text style={styles.modalSub}>{editing?.phone || editing?.email || editing?.uid}</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              style={styles.modalInput}
              placeholderTextColor={colors.muted}
              placeholder="Full name"
            />

            <Text style={styles.fieldLabel}>Age</Text>
            <TextInput
              value={editAge}
              onChangeText={setEditAge}
              style={styles.modalInput}
              keyboardType="number-pad"
              placeholderTextColor={colors.muted}
              placeholder="Age"
              maxLength={3}
            />

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.chipRow}>
              {GENDERS.map((g) => (
                <Pressable
                  key={g}
                  style={[styles.chip, editGender === g && styles.chipActive]}
                  onPress={() => setEditGender(g)}
                >
                  <Text style={[styles.chipText, editGender === g && styles.chipTextActive]}>
                    {g}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.chipRow}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.chip, editRole === r && styles.chipActive]}
                  onPress={() => setEditRole(r)}
                >
                  <Text style={[styles.chipText, editRole === r && styles.chipTextActive]}>
                    {r}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setEditing(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.saveBtnText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  header:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back:        { fontSize: 24, color: colors.text, width: 36 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  count:       { fontSize: 14, color: colors.muted, fontWeight: '700', width: 36, textAlign: 'right' },

  statsRow: { flexDirection: 'row', gap: 10, padding: 14 },
  statChip: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center', gap: 2,
  },
  statNum:   { fontSize: 22, fontWeight: '900', color: colors.primary },
  statLabel: { fontSize: 10, color: colors.muted, fontWeight: '700' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 14, marginBottom: 10,
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44,
  },
  searchIcon:  { fontSize: 16 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  clearSearch: { color: colors.muted, fontSize: 16, padding: 4 },

  list:  { paddingHorizontal: 14, paddingBottom: 30, gap: 12 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40, fontSize: 14 },

  card: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10,
  },
  cardTop:   { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  avatar:    {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: `${colors.primary}25`, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '900', color: colors.primary },
  cardInfo:   { flex: 1, gap: 3 },
  cardName:   { fontSize: 15, fontWeight: '800', color: colors.text },
  cardPhone:  { fontSize: 12, color: colors.muted },
  badgeRow:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  badge:      { backgroundColor: `${colors.secondary}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeDriver:{ backgroundColor: `${colors.primary}20` },
  badgeGender:{ backgroundColor: '#3b82f620', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeAge:   { backgroundColor: '#f59e0b20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:  { fontSize: 10, fontWeight: '800', color: colors.text },

  cardMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 11, color: colors.muted },

  cardActions: { flexDirection: 'row', gap: 10 },
  editBtn:     {
    flex: 1, height: 36, borderRadius: 10, borderWidth: 1,
    borderColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  editBtnText:   { fontSize: 13, fontWeight: '700', color: colors.primary },
  deleteBtn:     {
    flex: 1, height: 36, borderRadius: 10, borderWidth: 1,
    borderColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 13, fontWeight: '700', color: colors.danger },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet:   {
    backgroundColor: '#1c1e1e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36, gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  modalSub:   { fontSize: 12, color: colors.muted, marginTop: -6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, fontSize: 15, color: colors.text, backgroundColor: colors.background,
  },
  chipRow:       { flexDirection: 'row', gap: 8 },
  chip:          {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  chipActive:    { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  chipText:      { fontSize: 13, fontWeight: '700', color: colors.muted },
  chipTextActive:{ color: colors.primary },
  modalBtns:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:     {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '700', color: colors.muted },
  saveBtn:       { flex: 1, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText:   { fontSize: 15, fontWeight: '900', color: '#000' },
});
