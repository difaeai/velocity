import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import { api } from '../../src/api/client';

type FreightStatus = 'pending' | 'quoted' | 'confirmed' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
type Priority      = 'standard' | 'express' | 'same-day';
type LoadType      = 'documents' | 'goods' | 'perishable' | 'fragile';

interface FreightRequest {
  id: string;
  passengerId: string;
  businessName: string;
  contactPerson: string;
  contactPhone: string;
  pickup: string;
  dropoff: string;
  priority: Priority;
  loadType: LoadType;
  notes?: string | null;
  estimatedQuote: number;
  finalQuote?: number | null;
  adminNote?: string | null;
  status: FreightStatus;
  createdAt: Timestamp | null;
}

const STATUS_META: Record<FreightStatus, { color: string; label: string }> = {
  pending:    { color: '#f59e0b', label: 'Pending'    },
  quoted:     { color: colors.primary, label: 'Quoted'     },
  confirmed:  { color: '#10b981', label: 'Confirmed'  },
  picked_up:  { color: '#3b82f6', label: 'Picked Up'  },
  in_transit: { color: '#8b5cf6', label: 'In Transit' },
  delivered:  { color: '#10b981', label: 'Delivered'  },
  cancelled:  { color: '#ef4444', label: 'Cancelled'  },
};

const LOAD_LABELS: Record<LoadType, string> = {
  documents:  '📄 Documents',
  goods:      '📦 Goods',
  perishable: '🥦 Perishable',
  fragile:    '🔮 Fragile',
};

const NEXT_STATUS: Partial<Record<FreightStatus, FreightStatus>> = {
  confirmed:  'picked_up',
  picked_up:  'in_transit',
  in_transit: 'delivered',
};

const FILTER_TABS: { key: 'active' | 'all'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'all',    label: 'All Orders' },
];

export default function AdminFreightOrdersScreen() {
  const router = useRouter();
  const [orders, setOrders]     = useState<FreightRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'active' | 'all'>('active');
  const [updating, setUpdating] = useState<string | null>(null);

  // Modal state
  const [modalId, setModalId]           = useState<string | null>(null);
  const [newStatus, setNewStatus]       = useState<FreightStatus>('quoted');
  const [finalQuote, setFinalQuote]     = useState('');
  const [adminNote, setAdminNote]       = useState('');
  const [modalSaving, setModalSaving]   = useState(false);

  useEffect(() => {
    let q;
    if (filter === 'active') {
      q = query(
        collection(db, 'freightRequests'),
        where('status', 'in', ['pending', 'quoted', 'confirmed', 'picked_up', 'in_transit']),
        orderBy('createdAt', 'desc'),
      );
    } else {
      q = query(collection(db, 'freightRequests'), orderBy('createdAt', 'desc'));
    }
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as FreightRequest)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [filter]);

  async function quickAdvance(order: FreightRequest) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setUpdating(order.id);
    try {
      await api.adminUpdateFreightStatus({ requestId: order.id, status: next });
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Update failed.');
    } finally {
      setUpdating(null);
    }
  }

  async function cancelRequest(order: FreightRequest) {
    Alert.alert('Cancel Request', 'Cancel this freight request?', [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Cancel', style: 'destructive',
        onPress: async () => {
          setUpdating(order.id);
          try {
            await api.adminUpdateFreightStatus({ requestId: order.id, status: 'cancelled' });
          } catch (e: unknown) {
            Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to cancel.');
          } finally {
            setUpdating(null);
          }
        },
      },
    ]);
  }

  function openModal(order: FreightRequest) {
    setModalId(order.id);
    setNewStatus(order.status);
    setFinalQuote(order.finalQuote ? String(order.finalQuote) : String(order.estimatedQuote));
    setAdminNote(order.adminNote ?? '');
  }

  async function saveModal() {
    if (!modalId) return;
    setModalSaving(true);
    try {
      await api.adminUpdateFreightStatus({
        requestId:  modalId,
        status:     newStatus,
        finalQuote: finalQuote.trim() ? parseInt(finalQuote.trim(), 10) : undefined,
        adminNote:  adminNote.trim() || undefined,
      });
      setModalId(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Update failed.');
    } finally {
      setModalSaving(false);
    }
  }

  function formatTime(ts: Timestamp | null): string {
    if (!ts) return '—';
    return ts.toDate().toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const modalOrder = orders.find(o => o.id === modalId);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Freight Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        {FILTER_TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tab, filter === t.key && styles.tabActive]}
            onPress={() => setFilter(t.key)}
          >
            <Text style={[styles.tabTxt, filter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : orders.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 40 }}>🚛</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12 }}>No freight orders</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' }}>
            {filter === 'active' ? 'No active freight requests.' : 'No freight orders yet.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {orders.map(order => {
            const meta = STATUS_META[order.status];
            const next = NEXT_STATUS[order.status];
            const isUpdating = updating === order.id;
            const needsQuote = order.status === 'pending';
            return (
              <View key={order.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + '20', borderColor: meta.color + '50' }]}>
                    <Text style={[styles.statusTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.orderTime}>{formatTime(order.createdAt)}</Text>
                </View>

                {needsQuote && (
                  <View style={styles.urgentBanner}>
                    <Text style={styles.urgentTxt}>⚡ Awaiting your quote — respond within 30 min</Text>
                  </View>
                )}

                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Business</Text>
                  <Text style={styles.orderValue}>{order.businessName}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Contact</Text>
                  <Text style={styles.orderValue}>{order.contactPerson} · {order.contactPhone}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Pickup</Text>
                  <Text style={styles.orderValue} numberOfLines={2}>{order.pickup}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Dropoff</Text>
                  <Text style={styles.orderValue} numberOfLines={2}>{order.dropoff}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Priority</Text>
                  <Text style={styles.orderValue}>{order.priority} · {LOAD_LABELS[order.loadType]}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Est. Quote</Text>
                  <Text style={styles.orderValue}>PKR {order.estimatedQuote.toLocaleString()}</Text>
                </View>
                {order.finalQuote ? (
                  <View style={styles.orderRow}>
                    <Text style={styles.orderLabel}>Final Quote</Text>
                    <Text style={[styles.orderValue, { color: colors.primary, fontWeight: '800' }]}>
                      PKR {order.finalQuote.toLocaleString()}
                    </Text>
                  </View>
                ) : null}
                {order.notes ? (
                  <View style={styles.orderRow}>
                    <Text style={styles.orderLabel}>Notes</Text>
                    <Text style={styles.orderValue}>{order.notes}</Text>
                  </View>
                ) : null}
                {order.adminNote ? (
                  <View style={styles.noteBox}>
                    <Text style={styles.noteTxt}>📝 {order.adminNote}</Text>
                  </View>
                ) : null}

                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <View style={styles.actionRow}>
                    {/* Quote button for pending */}
                    {needsQuote && (
                      <Pressable
                        style={styles.quoteBtn}
                        onPress={() => openModal(order)}
                      >
                        <Text style={styles.quoteBtnTxt}>Send Quote</Text>
                      </Pressable>
                    )}
                    {/* Advance button */}
                    {next && (
                      <Pressable
                        style={[styles.advanceBtn, isUpdating && { opacity: 0.6 }, needsQuote && { flex: 1 }]}
                        onPress={() => quickAdvance(order)}
                        disabled={isUpdating}
                      >
                        {isUpdating
                          ? <ActivityIndicator color="#000" size="small" />
                          : <Text style={styles.advanceBtnTxt}>→ {STATUS_META[next].label}</Text>}
                      </Pressable>
                    )}
                    {!needsQuote && (
                      <Pressable style={styles.editOrderBtn} onPress={() => openModal(order)}>
                        <Text style={styles.editOrderBtnTxt}>Edit</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={styles.cancelOrderBtn}
                      onPress={() => cancelRequest(order)}
                      disabled={isUpdating}
                    >
                      <Text style={styles.cancelOrderBtnTxt}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Edit modal */}
      {modalId && modalOrder && (
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setModalId(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Update Freight Request</Text>
            <Text style={styles.modalSub}>{modalOrder.businessName} · {modalId.slice(0, 10)}…</Text>

            <Text style={styles.fieldLabel}>STATUS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(Object.keys(STATUS_META) as FreightStatus[]).map(s => (
                  <Pressable
                    key={s}
                    style={[styles.statusChip, newStatus === s && { borderColor: STATUS_META[s].color, backgroundColor: STATUS_META[s].color + '20' }]}
                    onPress={() => setNewStatus(s)}
                  >
                    <Text style={[styles.statusChipTxt, newStatus === s && { color: STATUS_META[s].color }]}>
                      {STATUS_META[s].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.fieldLabel}>FINAL QUOTE (PKR)</Text>
            <TextInput
              style={styles.fieldInput}
              value={finalQuote}
              onChangeText={setFinalQuote}
              placeholder="e.g. 1500"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>NOTE TO PASSENGER</Text>
            <TextInput
              style={[styles.fieldInput, { height: 80, textAlignVertical: 'top' }]}
              value={adminNote}
              onChangeText={setAdminNote}
              placeholder="Optional note or instructions for the passenger"
              placeholderTextColor={colors.muted}
              multiline
            />

            <Pressable
              style={[styles.saveBtn, modalSaving && { opacity: 0.6 }]}
              onPress={saveModal}
              disabled={modalSaving}
            >
              {modalSaving ? <ActivityIndicator color="#000" /> : <Text style={styles.saveBtnTxt}>Save Changes</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  tabs:      { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab:       { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt:    { fontSize: 13, fontWeight: '700', color: colors.muted },
  tabTxtActive: { color: '#000' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  orderCard:   { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  orderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  statusPill:  { borderRadius: 99, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  statusTxt:   { fontSize: 11, fontWeight: '800' },
  orderTime:   { fontSize: 11, color: colors.muted },

  urgentBanner: { backgroundColor: '#f59e0b15', borderRadius: 10, borderWidth: 1, borderColor: '#f59e0b30', padding: 10 },
  urgentTxt:    { fontSize: 12, fontWeight: '700', color: '#f59e0b' },

  orderRow:   { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  orderLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, width: 70 },
  orderValue: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },

  noteBox: { backgroundColor: colors.glassLime, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.primary + '30' },
  noteTxt: { fontSize: 12, color: colors.muted },

  actionRow:       { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  quoteBtn:        { flex: 2, height: 38, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quoteBtnTxt:     { fontSize: 12, fontWeight: '900', color: '#000' },
  advanceBtn:      { flex: 2, height: 38, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  advanceBtnTxt:   { fontSize: 12, fontWeight: '800', color: '#000' },
  editOrderBtn:    { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  editOrderBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  cancelOrderBtn:    { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.danger + '50', backgroundColor: 'rgba(239,68,68,0.10)', alignItems: 'center', justifyContent: 'center' },
  cancelOrderBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.danger },

  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: colors.border, padding: 20, paddingBottom: 40, gap: 10 },
  modalHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
  modalTitle:   { fontSize: 18, fontWeight: '800', color: colors.text },
  modalSub:     { fontSize: 12, color: colors.muted },

  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  fieldInput: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text },

  statusChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusChipTxt: { fontSize: 12, fontWeight: '700', color: colors.muted },

  saveBtn:    { height: 50, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },
});
