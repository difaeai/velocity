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
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import { api } from '../../src/api/client';
import {
  IntercityTrip,
  IntercityVehicleType,
  VEHICLE_TYPE_LABELS,
  TRIP_STATUS_META,
  PAKISTAN_CITIES,
} from '../../src/domain/intercityTypes';

const VEHICLE_TYPES: { key: IntercityVehicleType; label: string; defaultSeats: number }[] = [
  { key: 'standard_ac', label: 'Standard AC',  defaultSeats: 28 },
  { key: 'business_ac', label: 'Business AC',  defaultSeats: 14 },
  { key: 'non_ac',      label: 'Non-AC Economy', defaultSeats: 40 },
  { key: 'coaster',     label: 'Coaster (14)',  defaultSeats: 14 },
  { key: 'suv',         label: 'Private SUV',   defaultSeats: 4  },
  { key: 'hiace',       label: 'Hiace Van',     defaultSeats: 14 },
];

const STATUSES: IntercityTrip['status'][] = ['scheduled', 'boarding', 'in_progress', 'completed', 'cancelled'];

function formatTime(ms: number) {
  return new Date(ms).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

// Default date/time to +24h from now, rounded to next hour
function defaultDeparture() {
  const d = new Date(Date.now() + 86_400_000);
  d.setMinutes(0, 0, 0);
  return d;
}
function toInputDate(d: Date) { return d.toISOString().split('T')[0]!; }
function toInputTime(d: Date) { const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0'); return `${hh}:${mm}`; }

interface TripForm {
  fromCityId: string; fromCityName: string;
  toCityId:   string; toCityName:   string;
  date: string; time: string;
  vehicleType: IntercityVehicleType;
  totalSeats: string; farePerSeat: string;
  operatorName: string;
  pickupPoint: string; dropoffPoint: string;
  driverName: string; driverPhone: string; plateNumber: string;
  notes: string;
}

function emptyForm(): TripForm {
  const dep = defaultDeparture();
  return {
    fromCityId: 'islamabad', fromCityName: 'Islamabad',
    toCityId:   'lahore',    toCityName:   'Lahore',
    date: toInputDate(dep), time: toInputTime(dep),
    vehicleType: 'standard_ac',
    totalSeats: '28', farePerSeat: '1100',
    operatorName: 'Velocity',
    pickupPoint: '', dropoffPoint: '',
    driverName: '', driverPhone: '', plateNumber: '',
    notes: '',
  };
}

function CityPicker({ label, selected, onSelect }: { label: string; selected: string; onSelect: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const city = PAKISTAN_CITIES.find(c => c.id === selected);
  const filtered = PAKISTAN_CITIES.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Pressable style={styles.fieldRow} onPress={() => setOpen(true)}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.fieldValue}>
          <Text style={styles.fieldValueTxt}>{city?.name ?? 'Select city'}</Text>
          <Text style={styles.fieldChevron}>▾</Text>
        </View>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)}><Text style={styles.pickerClose}>Done</Text></Pressable>
          </View>
          <View style={styles.pickerSearch}>
            <TextInput style={styles.pickerSearchInput} placeholder="Search…" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} />
          </View>
          <ScrollView>
            {filtered.map(c => (
              <Pressable key={c.id} style={[styles.pickerRow, c.id === selected && styles.pickerRowActive]} onPress={() => { onSelect(c.id, c.name); setOpen(false); }}>
                <Text style={[styles.pickerRowTxt, c.id === selected && { color: colors.primary }]}>{c.name}</Text>
                <Text style={styles.pickerRowProv}>{c.province}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

export default function AdminIntercityTrips() {
  const router = useRouter();
  const [trips, setTrips]     = useState<IntercityTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]       = useState<TripForm>(emptyForm());
  const [creating, setCreating]   = useState(false);
  const [seeding, setSeeding]     = useState(false);
  const [filter, setFilter]   = useState<'upcoming' | 'all'>('upcoming');

  useEffect(() => {
    const now = Date.now();
    let q = filter === 'upcoming'
      ? query(collection(db, 'intercityTrips'), where('status', 'in', ['scheduled', 'boarding', 'in_progress']), orderBy('departureTime', 'asc'))
      : query(collection(db, 'intercityTrips'), orderBy('departureTime', 'desc'));

    const unsub = onSnapshot(q, snap => {
      setTrips(snap.docs.map(d => ({ id: d.id, ...d.data() } as IntercityTrip)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [filter]);

  function setF(key: keyof TripForm, val: string) {
    setForm(p => ({ ...p, [key]: val }));
  }

  async function createTrip() {
    const dateTime = new Date(`${form.date}T${form.time}`);
    if (isNaN(dateTime.getTime())) { Alert.alert('Invalid date/time'); return; }
    if (form.fromCityId === form.toCityId) { Alert.alert('Origin and destination must differ.'); return; }
    const seats = parseInt(form.totalSeats);
    const fare  = parseInt(form.farePerSeat);
    if (!seats || seats < 1 || !fare || fare < 1) { Alert.alert('Enter valid seats and fare.'); return; }

    setCreating(true);
    try {
      await api.adminCreateIntercityTrip({
        fromCityId: form.fromCityId, fromCityName: form.fromCityName,
        toCityId:   form.toCityId,   toCityName:   form.toCityName,
        departureTime: dateTime.getTime(),
        vehicleType: form.vehicleType,
        totalSeats: seats,
        farePerSeat: fare,
        operatorName: form.operatorName || 'Velocity',
        pickupPoint:  form.pickupPoint  || undefined,
        dropoffPoint: form.dropoffPoint || undefined,
        driverName:   form.driverName   || undefined,
        driverPhone:  form.driverPhone  || undefined,
        plateNumber:  form.plateNumber  || undefined,
        notes:        form.notes        || undefined,
      });
      setShowCreate(false);
      setForm(emptyForm());
      Alert.alert('Trip Created', 'The trip has been scheduled successfully.');
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to create trip.');
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(trip: IntercityTrip, status: IntercityTrip['status']) {
    try {
      await api.adminUpdateIntercityTrip({ tripId: trip.id, status });
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to update.');
    }
  }

  async function cancelTrip(trip: IntercityTrip) {
    Alert.alert(
      'Cancel Trip',
      `Cancel ${trip.fromCityName} → ${trip.toCityName}?\nAll ${trip.bookedSeats} booked passengers will be notified.`,
      [
        { text: 'Keep Trip', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: async () => {
          try {
            await api.adminCancelIntercityTrip({ tripId: trip.id, reason: 'Cancelled by operator.' });
          } catch (e: unknown) {
            Alert.alert('Error', (e as { message?: string }).message ?? 'Failed.');
          }
        }},
      ],
    );
  }

  async function seedTrips() {
    Alert.alert('Seed Demo Trips', 'Create ~25 sample trips across major routes for the next 2 days?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Seed', onPress: async () => {
        setSeeding(true);
        try {
          const res = await api.seedIntercityTrips({});
          Alert.alert('Done', `Created ${res.seeded} demo trips.`);
        } catch (e: unknown) {
          Alert.alert('Error', (e as { message?: string }).message ?? 'Failed.');
        } finally {
          setSeeding(false);
        }
      }},
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))} style={styles.backBtn}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Intercity Trips</Text>
        <Pressable style={styles.createBtn} onPress={() => { setForm(emptyForm()); setShowCreate(true); }}>
          <Text style={styles.createBtnTxt}>+ Create</Text>
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['upcoming', 'all'] as const).map(f => (
          <Pressable key={f} style={[styles.filterTab, filter === f && styles.filterTabActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterTabTxt, filter === f && styles.filterTabTxtActive]}>
              {f === 'upcoming' ? 'Upcoming' : 'All Trips'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {trips.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🚌</Text>
              <Text style={styles.emptyTitle}>No trips yet</Text>
              <Text style={styles.emptyDesc}>Create a trip or seed demo data to get started.</Text>
            </View>
          )}
          {trips.map(trip => {
            const meta = TRIP_STATUS_META[trip.status];
            const left = trip.totalSeats - trip.bookedSeats;
            const nextStatuses = STATUSES.filter(s => {
              if (trip.status === 'scheduled') return s === 'boarding';
              if (trip.status === 'boarding')  return s === 'in_progress';
              if (trip.status === 'in_progress') return s === 'completed';
              return false;
            });

            return (
              <View key={trip.id} style={styles.tripCard}>
                <View style={styles.tripCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tripRoute}>{trip.fromCityName} → {trip.toCityName}</Text>
                    <Text style={styles.tripTime}>{formatTime(trip.departureTime)}</Text>
                    <Text style={styles.tripMeta}>{VEHICLE_TYPE_LABELS[trip.vehicleType]} · {trip.operatorName}</Text>
                    <Text style={styles.tripSeats}>{trip.bookedSeats}/{trip.totalSeats} seats · PKR {trip.farePerSeat.toLocaleString()}/seat</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + '22', borderColor: meta.color + '60' }]}>
                    <Text style={[styles.statusPillTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actionsRow}>
                  {nextStatuses.map(s => (
                    <Pressable key={s} style={styles.actionBtn} onPress={() => updateStatus(trip, s)}>
                      <Text style={styles.actionBtnTxt}>→ {TRIP_STATUS_META[s].label}</Text>
                    </Pressable>
                  ))}
                  {!['completed', 'cancelled'].includes(trip.status) && (
                    <Pressable style={styles.cancelActionBtn} onPress={() => cancelTrip(trip)}>
                      <Text style={styles.cancelActionTxt}>Cancel</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}

          {/* Seed button */}
          <Pressable
            style={[styles.seedBtn, seeding && { opacity: 0.6 }]}
            onPress={seedTrips}
            disabled={seeding}
          >
            {seeding
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={styles.seedBtnTxt}>🌱  Seed Demo Trips</Text>}
          </Pressable>
        </ScrollView>
      )}

      {/* Create trip modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowCreate(false)}><Text style={styles.modalClose}>✕</Text></Pressable>
            <Text style={styles.modalTitle}>Create Trip</Text>
            <Pressable
              style={[styles.modalSaveBtn, creating && { opacity: 0.6 }]}
              onPress={createTrip}
              disabled={creating}
            >
              {creating ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.modalSaveTxt}>Create</Text>}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.formContent}>
            <CityPicker label="From City" selected={form.fromCityId} onSelect={(id, name) => setForm(p => ({ ...p, fromCityId: id, fromCityName: name }))} />
            <CityPicker label="To City"   selected={form.toCityId}   onSelect={(id, name) => setForm(p => ({ ...p, toCityId: id,   toCityName: name }))} />

            <View style={styles.twoCol}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.formLabel}>Departure Date</Text>
                <TextInput style={styles.formInput} value={form.date} onChangeText={v => setF('date', v)} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.formLabel}>Time (24h)</Text>
                <TextInput style={styles.formInput} value={form.time} onChangeText={v => setF('time', v)} placeholder="HH:MM" placeholderTextColor={colors.muted} />
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Vehicle Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}>
                  {VEHICLE_TYPES.map(vt => (
                    <Pressable
                      key={vt.key}
                      style={[styles.vtChip, form.vehicleType === vt.key && styles.vtChipActive]}
                      onPress={() => setForm(p => ({ ...p, vehicleType: vt.key, totalSeats: String(vt.defaultSeats) }))}
                    >
                      <Text style={[styles.vtChipTxt, form.vehicleType === vt.key && { color: colors.primary }]}>{vt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>

            <View style={styles.twoCol}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.formLabel}>Total Seats</Text>
                <TextInput style={styles.formInput} value={form.totalSeats} onChangeText={v => setF('totalSeats', v)} keyboardType="number-pad" placeholderTextColor={colors.muted} />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.formLabel}>Fare/Seat (PKR)</Text>
                <TextInput style={styles.formInput} value={form.farePerSeat} onChangeText={v => setF('farePerSeat', v)} keyboardType="number-pad" placeholderTextColor={colors.muted} />
              </View>
            </View>

            <Field label="Operator Name" value={form.operatorName} onChange={v => setF('operatorName', v)} placeholder="Velocity" />
            <Field label="Pickup Point"  value={form.pickupPoint}  onChange={v => setF('pickupPoint', v)}  placeholder="Terminal address" />
            <Field label="Dropoff Point" value={form.dropoffPoint} onChange={v => setF('dropoffPoint', v)} placeholder="Destination terminal" />
            <Field label="Driver Name"   value={form.driverName}   onChange={v => setF('driverName', v)}   placeholder="Optional" />
            <Field label="Driver Phone"  value={form.driverPhone}  onChange={v => setF('driverPhone', v)}  placeholder="+92..." />
            <Field label="Plate Number"  value={form.plateNumber}  onChange={v => setF('plateNumber', v)}  placeholder="LHR-1234" />
            <Field label="Notes"         value={form.notes}        onChange={v => setF('notes', v)}        placeholder="Any special instructions" />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput style={styles.formInput} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  createBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnTxt: { fontSize: 13, fontWeight: '900', color: '#000' },
  filterRow: { flexDirection: 'row', margin: 16, backgroundColor: colors.surface, borderRadius: 12, padding: 4 },
  filterTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  filterTabActive: { backgroundColor: colors.primary },
  filterTabTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },
  filterTabTxtActive: { color: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12, paddingBottom: 32 },
  emptyBox: { alignItems: 'center', padding: 32, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyDesc: { fontSize: 13, color: colors.muted, textAlign: 'center' },

  tripCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  tripCardTop: { flexDirection: 'row', gap: 10 },
  tripRoute: { fontSize: 15, fontWeight: '900', color: colors.text },
  tripTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tripMeta: { fontSize: 12, color: colors.muted },
  tripSeats: { fontSize: 12, color: colors.muted },
  statusPill: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  statusPillTxt: { fontSize: 11, fontWeight: '800' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { borderRadius: 8, borderWidth: 1, borderColor: colors.primary + '60', backgroundColor: '#1a2010', paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  cancelActionBtn: { borderRadius: 8, borderWidth: 1, borderColor: colors.danger + '60', backgroundColor: '#ef444415', paddingHorizontal: 12, paddingVertical: 6 },
  cancelActionTxt: { fontSize: 12, fontWeight: '700', color: colors.danger },

  seedBtn: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center', marginTop: 4 },
  seedBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },

  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalClose: { fontSize: 20, color: colors.text, width: 40 },
  modalTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' },
  modalSaveBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  modalSaveTxt: { fontSize: 13, fontWeight: '900', color: '#000' },
  formContent: { padding: 16, gap: 12, paddingBottom: 32 },
  formField: { gap: 6 },
  formLabel: { fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 0.4 },
  formInput: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
  twoCol: { flexDirection: 'row', gap: 12 },
  vtChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  vtChipActive: { borderColor: colors.primary, backgroundColor: '#1a2010' },
  vtChipTxt: { fontSize: 12, fontWeight: '700', color: colors.muted },

  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 12 },
  fieldLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  fieldValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldValueTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  fieldChevron: { fontSize: 12, color: colors.muted },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  pickerClose: { fontSize: 14, fontWeight: '700', color: colors.primary },
  pickerSearch: { margin: 16, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  pickerSearchInput: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerRowActive: { backgroundColor: '#1a2010' },
  pickerRowTxt: { fontSize: 15, fontWeight: '700', color: colors.text },
  pickerRowProv: { fontSize: 12, color: colors.muted },
});
