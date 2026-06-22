import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api } from '../../src/api/client';
import { colors } from '../../src/config';
import { PrimaryButton, Card } from '../../src/ui/components';
import {
  BASE_FARES,
  MAX_SEATS,
  RIDE_TYPE_LABELS,
  fareBounds,
  type Gender,
  type RideType,
} from '../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];
// Default to Islamabad city centre until live geocoding/maps are wired in.
const DEFAULT_PICKUP = { lat: 33.6844, lng: 73.0479 };
const DEFAULT_DROPOFF = { lat: 33.7104, lng: 73.0551 };

export default function Booking() {
  const router = useRouter();
  const [rideType, setRideType] = useState<RideType>('ac');
  const [fare, setFare] = useState<number>(BASE_FARES.ac);
  const [seats, setSeats] = useState(1);
  const [gender, setGender] = useState<Gender>('unspecified');
  const [pool, setPool] = useState(false);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bounds = fareBounds(rideType);

  function selectRide(rt: RideType) {
    setRideType(rt);
    setFare(BASE_FARES[rt]);
  }

  function bumpFare(delta: number) {
    setFare((f) => Math.min(bounds.max, Math.max(bounds.min, f + delta)));
  }

  async function findDriver() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.createTrip({
        rideType,
        offeredFare: fare,
        seats,
        passengerGender: gender,
        pool,
        pickup: { ...DEFAULT_PICKUP, address: pickup || 'Pickup' },
        dropoff: { ...DEFAULT_DROPOFF, address: dropoff || 'Drop-off' },
      });
      router.replace(`/passenger/trip/${res.tripId}`);
    } catch (e) {
      const code = e instanceof FirebaseError ? e.message : 'Could not create the ride.';
      setError(code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Book a ride</Text>

        <Card>
          <Text style={styles.label}>Pickup</Text>
          <TextInput
            value={pickup}
            onChangeText={setPickup}
            placeholder="Where from?"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.label}>Drop-off</Text>
          <TextInput
            value={dropoff}
            onChangeText={setDropoff}
            placeholder="Where to?"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </Card>

        <Text style={styles.section}>Ride type</Text>
        <View style={styles.rideGrid}>
          {RIDE_TYPES.map((rt) => {
            const active = rt === rideType;
            return (
              <Pressable
                key={rt}
                onPress={() => selectRide(rt)}
                style={[styles.rideCard, active && styles.rideCardActive]}
              >
                <Text style={[styles.rideLabel, active && { color: colors.primary }]}>
                  {RIDE_TYPE_LABELS[rt]}
                </Text>
                <Text style={styles.rideFare}>~{BASE_FARES[rt]} PKR</Text>
              </Pressable>
            );
          })}
        </View>

        <Card>
          <Text style={styles.label}>Your offer</Text>
          <View style={styles.stepperRow}>
            <Pressable style={styles.stepBtn} onPress={() => bumpFare(-50)}>
              <Text style={styles.stepTxt}>−</Text>
            </Pressable>
            <Text style={styles.fareValue}>{fare} PKR</Text>
            <Pressable style={styles.stepBtn} onPress={() => bumpFare(50)}>
              <Text style={styles.stepTxt}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Allowed {bounds.min}–{bounds.max} PKR · your share ~{Math.round(fare / seats)} PKR
          </Text>
        </Card>

        <Card>
          <Text style={styles.label}>Seats</Text>
          <View style={styles.pillRow}>
            {Array.from({ length: MAX_SEATS }, (_, i) => i + 1).map((n) => (
              <Pressable
                key={n}
                onPress={() => setSeats(n)}
                style={[styles.pill, seats === n && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, seats === n && { color: '#fff' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Pool preference</Text>
          <View style={styles.pillRow}>
            {(['male', 'female', 'unspecified'] as Gender[]).map((g) => (
              <Pressable
                key={g}
                onPress={() => setGender(g)}
                style={[styles.pill, gender === g && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, gender === g && { color: '#fff' }]}>
                  {g === 'unspecified' ? 'Any' : g.charAt(0).toUpperCase() + g.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.toggleRow} onPress={() => setPool((p) => !p)}>
            <Text style={styles.label}>Smart pool (share & split fare)</Text>
            <View style={[styles.toggle, pool && styles.toggleOn]}>
              <View style={[styles.knob, pool && { alignSelf: 'flex-end' }]} />
            </View>
          </Pressable>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Find a driver" onPress={findDriver} loading={loading} />
        <PrimaryButton variant="secondary" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  title: { fontSize: 24, fontWeight: '900', color: colors.text },
  section: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    marginTop: 6,
    marginBottom: 4,
  },
  rideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rideCard: {
    width: '31%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rideCardActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: '#eef6f1' },
  rideLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  rideFare: { fontSize: 11, color: colors.muted, marginTop: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#eef6f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { fontSize: 22, fontWeight: '900', color: colors.primary },
  fareValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  pill: {
    minWidth: 46,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTxt: { fontWeight: '800', color: colors.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggle: { width: 48, height: 28, borderRadius: 999, backgroundColor: '#d4ddd7', padding: 3 },
  toggleOn: { backgroundColor: colors.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
