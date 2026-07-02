import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { api } from '../../../src/api/client';

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
  updatedAt: Timestamp | null;
}

const PKG_LABELS: Record<PackageType, string> = {
  document: '📄 Document',
  parcel:   '📦 Parcel',
  box:      '📫 Large Box',
};

const STATUS_META: Record<CourierStatus, { label: string; color: string; desc: string }> = {
  pending:   { label: 'Looking for Courier', color: '#f59e0b', desc: 'We are finding a courier for your package' },
  accepted:  { label: 'Courier Assigned',    color: colors.primary, desc: 'Courier is heading to pick up your package' },
  picked_up: { label: 'Package Picked Up',   color: '#3b82f6', desc: 'Your package is on its way to the recipient' },
  delivered: { label: 'Delivered ✅',         color: '#10b981', desc: 'Package delivered successfully' },
  cancelled: { label: 'Cancelled',           color: '#ef4444', desc: 'This order was cancelled' },
};

const TIMELINE: CourierStatus[] = ['pending', 'accepted', 'picked_up', 'delivered'];

function formatTime(ts: Timestamp | null): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

export default function CourierOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const { user } = useAuth();
  const [order, setOrder]     = useState<CourierOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'courierOrders', id), (snap) => {
      if (snap.exists()) {
        setOrder({ id: snap.id, ...snap.data() } as CourierOrder);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  async function cancelOrder() {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this courier order?',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.cancelCourierOrder({ orderId: id! });
            } catch (e: unknown) {
              Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to cancel order.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.backTxt}>←</Text></Pressable>
          <Text style={styles.headerTitle}>Order Not Found</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 40 }}>📦</Text>
          <Text style={{ fontSize: 16, color: colors.muted, marginTop: 12, textAlign: 'center' }}>
            This courier order could not be found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const meta = STATUS_META[order.status];
  const currentStep = TIMELINE.indexOf(order.status === 'cancelled' ? 'pending' : order.status);
  const canCancel = order.passengerId === user?.uid && ['pending', 'accepted'].includes(order.status);

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
        <Text style={styles.headerTitle}>Courier Order</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status banner */}
        <View style={[styles.statusBanner, { borderColor: meta.color + '40', backgroundColor: meta.color + '15' }]}>
          <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.statusDesc}>{meta.desc}</Text>
          </View>
        </View>

        {/* Admin note */}
        {order.adminNote ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteTxt}>📝 {order.adminNote}</Text>
          </View>
        ) : null}

        {/* Timeline */}
        {order.status !== 'cancelled' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>DELIVERY TIMELINE</Text>
            {TIMELINE.map((step, i) => {
              const done    = i <= currentStep;
              const active  = i === currentStep;
              const stepMeta = STATUS_META[step];
              return (
                <View key={step} style={styles.timelineRow}>
                  <View style={styles.timelineLeft}>
                    <View style={[
                      styles.timelineDot,
                      done  && { backgroundColor: active ? colors.primary : '#10b981', borderColor: active ? colors.primary : '#10b981' },
                      !done && { backgroundColor: 'transparent', borderColor: colors.border },
                    ]}>
                      {done && !active && <Text style={{ fontSize: 10, color: '#000' }}>✓</Text>}
                      {active && <View style={styles.timelineDotInner} />}
                    </View>
                    {i < TIMELINE.length - 1 && (
                      <View style={[styles.timelineLine, done && i < currentStep && { backgroundColor: '#10b981' }]} />
                    )}
                  </View>
                  <Text style={[styles.timelineLabel, active && { color: colors.primary, fontWeight: '800' }]}>
                    {stepMeta.label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Package info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PACKAGE DETAILS</Text>
          <Row icon="📦" label="Type" value={PKG_LABELS[order.packageType]} />
          <Row icon="💰" label="Offered Fare" value={`PKR ${order.offeredFare}`} highlight />
          {order.instructions ? <Row icon="📝" label="Instructions" value={order.instructions} /> : null}
        </View>

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ROUTE</Text>
          <View style={styles.routeContainer}>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeAddr}>{order.pickup}</Text>
              </View>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>DELIVERY</Text>
                <Text style={styles.routeAddr}>{order.dropoff}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Recipient */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>RECIPIENT</Text>
          <Row icon="👤" label="Name"  value={order.recipientName} />
          <Row icon="📞" label="Phone" value={order.recipientPhone} />
        </View>

        {/* Driver card (only when assigned) */}
        {(order.driverName || order.driverPhone) && (
          <View style={[styles.card, { borderColor: colors.primary + '40', backgroundColor: '#0a1f05' }]}>
            <Text style={styles.cardTitle}>COURIER DRIVER</Text>
            {order.driverName  ? <Row icon="🧑" label="Driver" value={order.driverName}  /> : null}
            {order.driverPhone ? <Row icon="📞" label="Phone"  value={order.driverPhone} /> : null}
          </View>
        )}

        {/* Order meta */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ORDER INFO</Text>
          <Row icon="🆔" label="Order ID" value={order.id.slice(0, 12) + '…'} />
          <Row icon="🕐" label="Placed At" value={formatTime(order.createdAt)} />
          <Row icon="🔄" label="Last Update" value={formatTime(order.updatedAt)} />
        </View>

        {canCancel && (
          <Pressable
            style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
            onPress={cancelOrder}
            disabled={cancelling}
          >
            {cancelling
              ? <ActivityIndicator color={colors.danger} />
              : <Text style={styles.cancelBtnTxt}>Cancel Order</Text>}
          </Pressable>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.icon}>{icon}</Text>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, highlight && { color: colors.primary, fontWeight: '800' }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon:  { fontSize: 16, width: 24 },
  label: { fontSize: 12, color: colors.muted, fontWeight: '700', flex: 1 },
  value: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 2, textAlign: 'right' },
});

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  statusDot:    { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  statusLabel:  { fontSize: 15, fontWeight: '800' },
  statusDesc:   { fontSize: 12, color: colors.muted, marginTop: 2 },

  noteBox: { backgroundColor: '#131c0a', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.primary + '30' },
  noteTxt: { fontSize: 13, color: colors.muted, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 0,
  },
  cardTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginBottom: 4 },

  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  timelineLeft: { width: 24, alignItems: 'center', gap: 0 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  timelineDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#000' },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2 },
  timelineLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.muted, paddingTop: 2 },

  routeContainer: { gap: 0 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  routeLabel: { fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  routeAddr:  { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 1 },
  routeLine:  { width: 2, height: 16, backgroundColor: colors.border, marginLeft: 4 },

  cancelBtn: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelBtnTxt: { fontSize: 15, fontWeight: '800', color: colors.danger },
});
