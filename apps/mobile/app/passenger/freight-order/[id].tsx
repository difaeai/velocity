import { useEffect, useState } from 'react';
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
  updatedAt: Timestamp | null;
}

const STATUS_META: Record<FreightStatus, { label: string; color: string; desc: string }> = {
  pending:    { label: 'Quote Pending',    color: '#f59e0b', desc: 'Our business team is reviewing your request' },
  quoted:     { label: 'Quote Ready 💰',  color: colors.primary, desc: 'Your quote is ready — review and confirm below' },
  confirmed:  { label: 'Confirmed ✅',    color: '#10b981', desc: 'Your freight order is confirmed and being arranged' },
  picked_up:  { label: 'Cargo Picked Up', color: '#3b82f6', desc: 'Your cargo has been collected and loaded' },
  in_transit: { label: 'In Transit 🛣️',  color: '#8b5cf6', desc: 'Your freight shipment is on its way' },
  delivered:  { label: 'Delivered ✅',    color: '#10b981', desc: 'Freight delivered successfully' },
  cancelled:  { label: 'Cancelled',       color: '#ef4444', desc: 'This freight request was cancelled' },
};

const PRIORITY_LABELS: Record<Priority, string> = {
  standard: 'Standard (24–48 hrs)',
  express:  'Express (4–6 hrs)',
  'same-day': 'Same Day (by 8 PM)',
};

const LOAD_LABELS: Record<LoadType, string> = {
  documents:  '📄 Documents',
  goods:      '📦 Goods',
  perishable: '🥦 Perishable',
  fragile:    '🔮 Fragile',
};

const TIMELINE: FreightStatus[] = ['pending', 'quoted', 'confirmed', 'picked_up', 'in_transit', 'delivered'];

function formatTime(ts: Timestamp | null): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function FreightOrderScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const { user } = useAuth();
  const [order, setOrder]         = useState<FreightRequest | null>(null);
  const [loading, setLoading]     = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [accepting, setAccepting]   = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'freightRequests', id), (snap) => {
      if (snap.exists()) {
        setOrder({ id: snap.id, ...snap.data() } as FreightRequest);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  async function acceptQuote() {
    Alert.alert(
      'Confirm Quote',
      `Accept the final quote of PKR ${order?.finalQuote?.toLocaleString() ?? '—'} for this freight delivery?`,
      [
        { text: 'Review Later', style: 'cancel' },
        {
          text: 'Accept Quote',
          onPress: async () => {
            setAccepting(true);
            try {
              await api.acceptFreightQuote({ requestId: id! });
            } catch (e: unknown) {
              Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to accept quote.');
            } finally {
              setAccepting(false);
            }
          },
        },
      ],
    );
  }

  async function cancelRequest() {
    Alert.alert(
      'Cancel Request',
      'Are you sure you want to cancel this freight request?',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.cancelFreightRequest({ requestId: id! });
            } catch (e: unknown) {
              Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to cancel request.');
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
          <Text style={styles.headerTitle}>Not Found</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, color: colors.muted }}>Freight request not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const meta       = STATUS_META[order.status];
  const timelineIdx = TIMELINE.indexOf(order.status === 'cancelled' ? 'pending' : order.status);
  const isOwner    = order.passengerId === user?.uid;
  const canCancel  = isOwner && ['pending', 'quoted'].includes(order.status);
  const canAccept  = isOwner && order.status === 'quoted' && !!order.finalQuote;

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
        <Text style={styles.headerTitle}>Freight Order</Text>
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

        {/* Quote ready banner */}
        {canAccept && (
          <View style={styles.quoteReadyCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.quoteReadyTitle}>Final Quote</Text>
              <Text style={styles.quoteReadyAmount}>PKR {order.finalQuote?.toLocaleString()}</Text>
              {order.estimatedQuote !== order.finalQuote && (
                <Text style={styles.quoteReadyEstimate}>
                  Estimated was PKR {order.estimatedQuote.toLocaleString()}
                </Text>
              )}
              {order.adminNote ? <Text style={styles.quoteReadyNote}>{order.adminNote}</Text> : null}
            </View>
            <Pressable
              style={[styles.acceptBtn, accepting && { opacity: 0.6 }]}
              onPress={acceptQuote}
              disabled={accepting}
            >
              {accepting
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.acceptBtnTxt}>Accept</Text>}
            </Pressable>
          </View>
        )}

        {/* Admin note (when confirmed+) */}
        {order.adminNote && order.status !== 'quoted' ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteTxt}>📝 {order.adminNote}</Text>
          </View>
        ) : null}

        {/* Timeline */}
        {order.status !== 'cancelled' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SHIPMENT TIMELINE</Text>
            {TIMELINE.map((step, i) => {
              const done   = i <= timelineIdx;
              const active = i === timelineIdx;
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
                      <View style={[styles.timelineLine, done && i < timelineIdx && { backgroundColor: '#10b981' }]} />
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

        {/* Business details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>BUSINESS DETAILS</Text>
          <Row icon="🏢" label="Business"       value={order.businessName} />
          <Row icon="👤" label="Contact Person" value={order.contactPerson} />
          <Row icon="📞" label="Phone"          value={order.contactPhone} />
        </View>

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ROUTE</Text>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.routeAddr}>{order.pickup}</Text>
            </View>
          </View>
          <View style={styles.routeConnector} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>DELIVERY</Text>
              <Text style={styles.routeAddr}>{order.dropoff}</Text>
            </View>
          </View>
        </View>

        {/* Shipment details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SHIPMENT DETAILS</Text>
          <Row icon="🚛" label="Priority"   value={PRIORITY_LABELS[order.priority]} />
          <Row icon="📦" label="Load Type"  value={LOAD_LABELS[order.loadType]} />
          <Row icon="💰" label="Est. Quote" value={`PKR ${order.estimatedQuote.toLocaleString()}`} />
          {order.finalQuote ? (
            <Row icon="✅" label="Final Quote" value={`PKR ${order.finalQuote.toLocaleString()}`} highlight />
          ) : null}
          {order.notes ? <Row icon="📝" label="Notes" value={order.notes} /> : null}
        </View>

        {/* Order meta */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>REQUEST INFO</Text>
          <Row icon="🆔" label="Request ID"   value={order.id.slice(0, 12) + '…'} />
          <Row icon="🕐" label="Submitted"    value={formatTime(order.createdAt)} />
          <Row icon="🔄" label="Last Updated" value={formatTime(order.updatedAt)} />
        </View>

        {canCancel && (
          <Pressable
            style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
            onPress={cancelRequest}
            disabled={cancelling}
          >
            {cancelling
              ? <ActivityIndicator color={colors.danger} />
              : <Text style={styles.cancelBtnTxt}>Cancel Request</Text>}
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
      <Text style={[rowStyles.value, highlight && { color: colors.primary, fontWeight: '800' }]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon:  { fontSize: 16, width: 24 },
  label: { fontSize: 12, color: colors.muted, fontWeight: '700', flex: 1 },
  value: { fontSize: 13, color: colors.text, fontWeight: '600', flex: 2, textAlign: 'right' },
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

  quoteReadyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0a1f05',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 16,
  },
  quoteReadyTitle:    { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  quoteReadyAmount:   { fontSize: 26, fontWeight: '900', color: colors.primary, marginTop: 2 },
  quoteReadyEstimate: { fontSize: 11, color: colors.muted, marginTop: 2 },
  quoteReadyNote:     { fontSize: 12, color: colors.muted, marginTop: 4 },
  acceptBtn: {
    height: 48,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  acceptBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },

  noteBox: { backgroundColor: '#131c0a', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.primary + '30' },
  noteTxt: { fontSize: 13, color: colors.muted, lineHeight: 18 },

  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  cardTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginBottom: 4 },

  timelineRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 36 },
  timelineLeft: { width: 24, alignItems: 'center' },
  timelineDot:  { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  timelineDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#000' },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2 },
  timelineLabel:{ flex: 1, fontSize: 12, fontWeight: '600', color: colors.muted, paddingTop: 2 },

  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  routeDot:       { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  routeLabel:     { fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  routeAddr:      { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 1 },
  routeConnector: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 4 },

  cancelBtn:    { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelBtnTxt: { fontSize: 15, fontWeight: '800', color: colors.danger },
});
