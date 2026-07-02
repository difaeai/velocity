import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { api } from '../../../src/api/client';
import {
  IntercityBooking,
  IntercityMessage,
  IntercityTrip,
  VEHICLE_TYPE_ICONS,
  VEHICLE_TYPE_LABELS,
  TRIP_STATUS_META,
  BOOKING_STATUS_META,
} from '../../../src/domain/intercityTypes';

const TRIP_STATUS_ORDER: IntercityTrip['status'][] = ['scheduled', 'boarding', 'in_progress', 'completed'];

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString('en-PK', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function formatMsgTime(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

export default function IntercityTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const { user } = useAuth();

  const [booking, setBooking]   = useState<IntercityBooking | null>(null);
  const [trip, setTrip]         = useState<IntercityTrip | null>(null);
  const [messages, setMessages] = useState<IntercityMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [msgText, setMsgText]   = useState('');
  const [sending, setSending]   = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [activeTab, setActiveTab]   = useState<'info' | 'chat'>('info');
  const flatRef = useRef<FlatList>(null);

  // Listen to booking
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'intercityBookings', id), snap => {
      if (!snap.exists()) { setLoading(false); return; }
      setBooking({ id: snap.id, ...snap.data() } as IntercityBooking);
      setLoading(false);
    });
    return unsub;
  }, [id]);

  // Listen to trip (when we have tripId)
  useEffect(() => {
    if (!booking?.tripId) return;
    const unsub = onSnapshot(doc(db, 'intercityTrips', booking.tripId), snap => {
      if (snap.exists()) setTrip({ id: snap.id, ...snap.data() } as IntercityTrip);
    });
    return unsub;
  }, [booking?.tripId]);

  // Listen to chat
  useEffect(() => {
    if (!booking?.tripId) return;
    const q = query(
      collection(db, 'intercityChats', booking.tripId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as IntercityMessage)));
    });
    return unsub;
  }, [booking?.tripId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (messages.length > 0) setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  async function sendMessage() {
    if (!msgText.trim() || !booking?.tripId) return;
    const text = msgText.trim();
    setMsgText('');
    setSending(true);
    try {
      await api.sendIntercityMessage({ tripId: booking.tripId, text });
    } catch {
      setMsgText(text);
    } finally {
      setSending(false);
    }
  }

  async function cancelBooking() {
    if (!booking) return;
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking? This action cannot be undone.',
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.cancelIntercityBooking({ bookingId: booking.id });
            } catch (e: unknown) {
              Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to cancel.');
              setCancelling(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Booking not found</Text>
          <Pressable onPress={() => router.back()} style={styles.backPressable}>
            <Text style={styles.backPressableTxt}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const tripStatus     = trip?.status ?? 'scheduled';
  const statusMeta     = TRIP_STATUS_META[tripStatus];
  const bookingMeta    = BOOKING_STATUS_META[booking.status];
  const canCancel      = booking.status === 'confirmed' && ['scheduled', 'boarding'].includes(tripStatus) && booking.departureTime > Date.now() + 2 * 3_600_000;
  const statusStep     = TRIP_STATUS_ORDER.indexOf(tripStatus);
  const driverVisible  = ['boarding', 'in_progress'].includes(tripStatus) && trip?.driverName;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/intercity-activity'))} style={styles.backBtn}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {booking.fromCityName} → {booking.toCityName}
          </Text>
          <Text style={styles.headerSub}>{booking.operatorName}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: bookingMeta.color + '22', borderColor: bookingMeta.color + '60' }]}>
          <Text style={[styles.statusBadgeTxt, { color: bookingMeta.color }]}>{bookingMeta.label}</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['info', 'chat'] as const).map(tab => (
          <Pressable key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabTxt, activeTab === tab && styles.tabTxtActive]}>
              {tab === 'info' ? '🎫 Booking Info' : `💬 Trip Chat${messages.length > 0 ? ` (${messages.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'info' ? (
        <ScrollView contentContainerStyle={styles.infoContent}>
          {/* Booking card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Booking Details</Text>
            <Row label="From" value={booking.fromCityName} />
            <Row label="To"   value={booking.toCityName} />
            <Row label="Departure" value={formatDateTime(booking.departureTime)} />
            {booking.estimatedArrivalTime && <Row label="Estimated Arrival" value={formatTime(booking.estimatedArrivalTime)} />}
            <Row label="Vehicle" value={`${VEHICLE_TYPE_ICONS[booking.vehicleType]}  ${VEHICLE_TYPE_LABELS[booking.vehicleType]}`} />
            <Row label="Seats"   value={`${booking.seatsBooked} seat${booking.seatsBooked > 1 ? 's' : ''}${booking.seatNumbers?.length ? ` (${booking.seatNumbers.join(', ')})` : ''}`} />
            <Row label="Payment" value={booking.paymentMethod === 'cash' ? '💵 Cash' : '💳 Wallet'} />
            <View style={styles.rowDivider} />
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Total Fare</Text>
              <Text style={styles.fareValue}>PKR {booking.fareTotal.toLocaleString()}</Text>
            </View>
          </View>

          {/* Pickup / dropoff */}
          {(booking.pickupPoint || booking.dropoffPoint) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Journey Points</Text>
              {booking.pickupPoint  && <Row label="📍 Pickup"  value={booking.pickupPoint} />}
              {booking.dropoffPoint && <Row label="🏁 Dropoff" value={booking.dropoffPoint} />}
            </View>
          )}

          {/* Trip status timeline */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trip Status</Text>
            {TRIP_STATUS_ORDER.map((s, i) => {
              const done    = i <= statusStep;
              const current = i === statusStep;
              const meta    = TRIP_STATUS_META[s];
              return (
                <View key={s} style={styles.timelineRow}>
                  <View style={styles.timelineIconCol}>
                    <View style={[styles.timelineDot, done && { backgroundColor: meta.color }, current && styles.timelineDotActive]}>
                      {current && <View style={styles.timelineDotInner} />}
                    </View>
                    {i < TRIP_STATUS_ORDER.length - 1 && (
                      <View style={[styles.timelineConnector, done && { backgroundColor: meta.color + '60' }]} />
                    )}
                  </View>
                  <Text style={[styles.timelineLabel, current && { color: meta.color, fontWeight: '800' }]}>{meta.label}</Text>
                </View>
              );
            })}
          </View>

          {/* Driver info */}
          {driverVisible && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Driver Info</Text>
              <Row label="Name"  value={trip!.driverName!} />
              {trip?.plateNumber && <Row label="Plate" value={trip.plateNumber} />}
              {trip?.driverPhone && (
                <View style={styles.callRow}>
                  <Text style={styles.rowLabel}>Phone</Text>
                  <Text style={styles.rowValue}>{trip.driverPhone}</Text>
                </View>
              )}
            </View>
          )}

          {/* Cancel button */}
          {canCancel && (
            <Pressable
              style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
              onPress={cancelBooking}
              disabled={cancelling}
            >
              {cancelling
                ? <ActivityIndicator color={colors.danger} />
                : <Text style={styles.cancelBtnTxt}>Cancel Booking</Text>}
            </Pressable>
          )}

          {booking.status === 'cancelled' && (
            <View style={styles.cancelledNote}>
              <Text style={styles.cancelledNoteTxt}>This booking has been cancelled.</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        /* Chat tab */
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          {booking.status !== 'confirmed' ? (
            <View style={styles.center}>
              <Text style={styles.chatDisabledTxt}>Chat is only available for confirmed bookings.</Text>
            </View>
          ) : (
            <>
              <FlatList
                ref={flatRef}
                data={messages}
                keyExtractor={m => m.id}
                contentContainerStyle={styles.chatList}
                ListEmptyComponent={
                  <View style={styles.chatEmpty}>
                    <Text style={styles.chatEmptyIcon}>💬</Text>
                    <Text style={styles.chatEmptyTxt}>No messages yet. Say hello to your driver!</Text>
                  </View>
                }
                renderItem={({ item: msg }) => {
                  const isMe = msg.senderId === user?.uid;
                  return (
                    <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                      {!isMe && (
                        <View style={styles.msgAvatar}>
                          <Text style={styles.msgAvatarTxt}>{msg.senderName.charAt(0).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={[styles.msgBubble, isMe && styles.msgBubbleMe]}>
                        {!isMe && <Text style={styles.msgSender}>{msg.senderName}</Text>}
                        <Text style={[styles.msgText, isMe && styles.msgTextMe]}>{msg.text}</Text>
                        <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>{formatMsgTime(msg.createdAt)}</Text>
                      </View>
                    </View>
                  );
                }}
              />
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Type a message…"
                  placeholderTextColor={colors.muted}
                  value={msgText}
                  onChangeText={setMsgText}
                  multiline
                  maxLength={1000}
                />
                <Pressable
                  style={[styles.sendBtn, (!msgText.trim() || sending) && { opacity: 0.4 }]}
                  onPress={sendMessage}
                  disabled={!msgText.trim() || sending}
                >
                  <Text style={styles.sendBtnTxt}>↑</Text>
                </Pressable>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  backPressable: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  backPressableTxt: { color: colors.muted, fontWeight: '700' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  headerSub: { fontSize: 11, color: colors.muted },
  statusBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },
  tabTxtActive: { color: colors.primary },

  infoContent: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  cardTitle: { fontSize: 13, fontWeight: '900', color: colors.text, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  callRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 13, color: colors.muted, flex: 1 },
  rowValue: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 2, textAlign: 'right' },
  rowDivider: { height: 1, backgroundColor: colors.border },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  fareValue: { fontSize: 18, fontWeight: '900', color: colors.primary },

  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 36 },
  timelineIconCol: { width: 20, alignItems: 'center' },
  timelineDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.border, borderWidth: 2, borderColor: colors.border },
  timelineDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  timelineDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#000', alignSelf: 'center', marginTop: 2 },
  timelineConnector: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2, minHeight: 20 },
  timelineLabel: { fontSize: 14, color: colors.muted, paddingTop: 0, lineHeight: 20 },

  cancelBtn: { borderWidth: 1.5, borderColor: colors.danger, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelBtnTxt: { fontSize: 15, fontWeight: '800', color: colors.danger },
  cancelledNote: { backgroundColor: '#ef444415', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#ef444430' },
  cancelledNoteTxt: { fontSize: 13, color: colors.danger, textAlign: 'center', fontWeight: '700' },

  chatList: { padding: 14, gap: 10, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', gap: 10, marginTop: 60 },
  chatEmptyIcon: { fontSize: 40 },
  chatEmptyTxt: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  chatDisabledTxt: { fontSize: 14, color: colors.muted, textAlign: 'center' },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2d2f2f', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  msgAvatarTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  msgBubble: { maxWidth: '75%', backgroundColor: colors.surface, borderRadius: 16, borderTopLeftRadius: 4, padding: 10, gap: 2 },
  msgBubbleMe: { backgroundColor: '#1a2e0a', borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  msgSender: { fontSize: 11, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  msgText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  msgTextMe: { color: '#d4f5a0' },
  msgTime: { fontSize: 10, color: colors.muted, alignSelf: 'flex-end', marginTop: 2 },
  msgTimeMe: { color: '#8ab870' },

  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.border },
  chatInput: { flex: 1, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnTxt: { fontSize: 18, fontWeight: '900', color: '#000', lineHeight: 22 },
});
