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

type CourierStatus = 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
type PackageType   = 'document' | 'parcel' | 'box';

interface CourierOrder {
  id: string;
  passengerId: string;
  pickup: string;
  dropoff: string;
  packageType: PackageType;
  offeredFare: number;
  recipientName: string;
  recipientPhone: string;
  instructions?: string | null;
  status: CourierStatus;
  driverName?: string | null;
  driverPhone?: string | null;
  adminNote?: string | null;
  createdAt: Timestamp | null;
}

const STATUS_META: Record<CourierStatus, { color: string; label: string }> = {
  pending:   { color: '#f59e0b', label: 'Pending'   },
  accepted:  { color: colors.primary, label: 'Accepted'  },
  picked_up: { color: '#3b82f6', label: 'Picked Up' },
  delivered: { color: '#10b981', label: 'Delivered' },
  cancelled: { color: '#ef4444', label: 'Cancelled' },
};

const PKG_LABELS: Record<PackageType, string> = {
  document: '📄 Document',
  parcel:   '📦 Parcel',
  box:      '📫 Large Box',
};

const NEXT_STATUS: Partial<Record<CourierStatus, CourierStatus>> = {
  pending:   'accepted',
  accepted:  'picked_up',
  picked_up: 'delivered',
};

const FILTER_TABS: { key: 'active' | 'all'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'all',    label: 'All Orders' },
];

export default function AdminCourierOrdersScreen() {
  const router = useRouter();
  const [orders, setOrders]     = useState<CourierOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'active' | 'all'>('active');
  const [updating, setUpdating] = useState<string | null>(null);

  // Update modal state
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);
  const [newStatus, setNewStatus]       = useState<CourierStatus>('accepted');
  const [driverName, setDriverName]     = useState('');
  const [driverPhone, setDriverPhone]   = useState('');
  const [adminNote, setAdminNote]       = useState('');
  const [modalSaving, setModalSaving]   = useState(false);

  useEffect(() => {
    let q;
    if (filter === 'active') {
      q = query(
        collection(db, 'courierOrders'),
        where('status', 'in', ['pending', 'accepted', 'picked_up']),
        orderBy('createdAt', 'desc'),
      );
    } else {
      q = query(collection(db, 'courierOrders'), orderBy('createdAt', 'desc'));
    }
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as CourierOrder)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [filter]);

  async function quickAdvance(order: CourierOrder) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setUpdating(order.id);
    try {
      await api.adminUpdateCourierStatus({ orderId: order.id, status: next });
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Update failed.');
    } finally {
      setUpdating(null);
    }
  }

  async function cancelOrder(order: CourierOrder) {
    Alert.alert('Cancel Order', 'Cancel this courier order?', [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Cancel Order', style: 'destructive',
        onPress: async () => {
          setUpdating(order.id);
          try {
            await api.adminUpdateCourierStatus({ orderId: order.id, status: 'cancelled' });
          } catch (e: unknown) {
            Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to cancel.');
          } finally {
            setUpdating(null);
          }
        },
      },
    ]);
  }

  function openModal(order: CourierOrder) {
    setModalOrderId(order.id);
    setNewStatus(order.status);
    setDriverName(order.driverName ?? '');
    setDriverPhone(order.driverPhone ?? '');
    setAdminNote(order.adminNote ?? '');
  }

  async function saveModal() {
    if (!modalOrderId) return;
    setModalSaving(true);
    try {
      await api.adminUpdateCourierStatus({
        orderId:     modalOrderId,
        status:      newStatus,
        driverName:  driverName.trim() || undefined,
        driverPhone: driverPhone.trim() || undefined,
        note:        adminNote.trim() || undefined,
      });
      setModalOrderId(null);
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

  const modalOrder = orders.find(o => o.id === modalOrderId);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Courier Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Filter tabs */}
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
          <Text style={{ fontSize: 40 }}>📦</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12 }}>No orders</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' }}>
            {filter === 'active' ? 'No active courier orders right now.' : 'No courier orders yet.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {orders.map(order => {
            const meta = STATUS_META[order.status];
            const next = NEXT_STATUS[order.status];
            const isUpdating = updating === order.id;
            return (
              <View key={order.id} style={styles.orderCard}>
                {/* Header row */}
                <View style={styles.orderHeader}>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + '20', borderColor: meta.color + '50' }]}>
                    <Text style={[styles.statusTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.orderTime}>{formatTime(order.createdAt)}</Text>
                </View>

                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Package</Text>
                  <Text style={styles.orderValue}>{PKG_LABELS[order.packageType]}</Text>
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
                  <Text style={styles.orderLabel}>Recipient</Text>
                  <Text style={styles.orderValue}>{order.recipientName} · {order.recipientPhone}</Text>
                </View>
                <View style={styles.orderRow}>
                  <Text style={styles.orderLabel}>Fare Offer</Text>
                  <Text style={[styles.orderValue, { color: colors.primary, fontWeight: '800' }]}>PKR {order.offeredFare}</Text>
                </View>
                {order.driverName ? (
                  <View style={styles.orderRow}>
                    <Text style={styles.orderLabel}>Driver</Text>
                    <Text style={styles.orderValue}>{order.driverName} {order.driverPhone ? `· ${order.driverPhone}` : ''}</Text>
                  </View>
                ) : null}
                {order.adminNote ? (
                  <View style={styles.noteBox}>
                    <Text style={styles.noteTxt}>📝 {order.adminNote}</Text>
                  </View>
                ) : null}

                {/* Actions */}
                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <View style={styles.actionRow}>
                    {next && (
                      <Pressable
                        style={[styles.advanceBtn, isUpdating && { opacity: 0.6 }]}
                        onPress={() => quickAdvance(order)}
                        disabled={isUpdating}
                      >
                        {isUpdating
                          ? <ActivityIndicator color="#000" size="small" />
                          : <Text style={styles.advanceBtnTxt}>→ {STATUS_META[next].label}</Text>}
                      </Pressable>
                    )}
                    <Pressable
                      style={styles.editOrderBtn}
                      onPress={() => openModal(order)}
                    >
                      <Text style={styles.editOrderBtnTxt}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.cancelOrderBtn}
                      onPress={() => cancelOrder(order)}
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
      {modalOrderId && modalOrder && (
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setModalOrderId(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Update Order</Text>
            <Text style={styles.modalSub}>ID: {modalOrderId.slice(0, 10)}…</Text>

            <Text style={styles.fieldLabel}>STATUS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(Object.keys(STATUS_META) as CourierStatus[]).map(s => (
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

            <Text style={styles.fieldLabel}>DRIVER NAME</Text>
            <TextInput style={styles.fieldInput} value={driverName} onChangeText={setDriverName} placeholder="Driver name" placeholderTextColor={colors.muted} />

            <Text style={styles.fieldLabel}>DRIVER PHONE</Text>
            <TextInput style={styles.fieldInput} value={driverPhone} onChangeText={setDriverPhone} placeholder="Driver phone" placeholderTextColor={colors.muted} keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>NOTE TO PASSENGER</Text>
            <TextInput style={[styles.fieldInput, { height: 70, textAlignVertical: 'top' }]} value={adminNote} onChangeText={setAdminNote} placeholder="Optional note shown to passenger" placeholderTextColor={colors.muted} multiline />

            <Pressable style={[styles.saveBtn, modalSaving && { opacity: 0.6 }]} onPress={saveModal} disabled={modalSaving}>
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

  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab:       { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt:    { fontSize: 13, fontWeight: '700', color: colors.muted },
  tabTxtActive: { color: '#000' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  orderCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  orderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  statusPill: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  statusTxt:  { fontSize: 11, fontWeight: '800' },
  orderTime:  { fontSize: 11, color: colors.muted },

  orderRow:   { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  orderLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, width: 64 },
  orderValue: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },

  noteBox: { backgroundColor: 'rgba(204,255,0,0.10)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.primary + '30' },
  noteTxt: { fontSize: 12, color: colors.muted },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  advanceBtn:    { flex: 2, height: 38, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  advanceBtnTxt: { fontSize: 12, fontWeight: '800', color: '#000' },
  editOrderBtn:    { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  editOrderBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  cancelOrderBtn:    { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.danger + '50', backgroundColor: 'rgba(239,68,68,0.10)', alignItems: 'center', justifyContent: 'center' },
  cancelOrderBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.danger },

  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: colors.border, padding: 20, paddingBottom: 40, gap: 10 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
  modalTitle:  { fontSize: 18, fontWeight: '800', color: colors.text },
  modalSub:    { fontSize: 12, color: colors.muted },

  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  fieldInput: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text },

  statusChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusChipTxt: { fontSize: 12, fontWeight: '700', color: colors.muted },

  saveBtn:    { height: 50, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },
});
