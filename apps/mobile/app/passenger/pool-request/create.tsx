import { useState } from 'react';
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

import { api } from '../../../src/api/client';
import type { PoolGenderPref } from '../../../src/api/client';
import { colors } from '../../../src/config';

const GENDER_OPTIONS: { key: PoolGenderPref; label: string; icon: string; desc: string }[] = [
  { key: 'any',         label: 'Open to all',  icon: '👥', desc: 'Any gender' },
  { key: 'male_only',   label: 'Males only',   icon: '♂',  desc: 'Same gender (male)' },
  { key: 'female_only', label: 'Females only', icon: '♀',  desc: 'Same gender (female)' },
];

export default function CreatePoolRequestScreen() {
  const router = useRouter();

  const [pickupArea, setPickupArea]     = useState('');
  const [destArea, setDestArea]         = useState('');
  const [farePerSeat, setFarePerSeat]   = useState('');
  const [totalSlots, setTotalSlots]     = useState(2);
  const [genderPref, setGenderPref]     = useState<PoolGenderPref>('any');
  const [submitting, setSubmitting]     = useState(false);

  const fareNum = parseInt(farePerSeat, 10) || 0;
  const totalFare = fareNum * totalSlots;

  async function submit() {
    if (!pickupArea.trim())  { Alert.alert('Required', 'Enter your pickup area.'); return; }
    if (!destArea.trim())    { Alert.alert('Required', 'Enter your destination area.'); return; }
    if (fareNum < 50)        { Alert.alert('Invalid fare', 'Enter at least 50 PKR per seat.'); return; }

    setSubmitting(true);
    try {
      const { requestId } = await api.createPoolRideRequest({
        pickupLat:           0,
        pickupLng:           0,
        pickupAreaName:      pickupArea.trim(),
        destinationLat:      0,
        destinationLng:      0,
        destinationAreaName: destArea.trim(),
        proposedFarePerSeat: fareNum,
        totalSlots,
        genderPref,
      });
      router.replace(`/passenger/pool-request/${requestId}` as Parameters<typeof router.replace>[0]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to create request. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Request a Pool Ride</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>How it works</Text>
          <Text style={styles.infoText}>
            You propose a fare per seat. A driver can accept or suggest a higher fare. Once you agree, other passengers can join at the same rate — they cannot renegotiate.
          </Text>
        </View>

        {/* Route */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR ROUTE</Text>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Pickup area / neighbourhood"
                placeholderTextColor={colors.muted}
                value={pickupArea}
                onChangeText={setPickupArea}
              />
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Destination area"
                placeholderTextColor={colors.muted}
                value={destArea}
                onChangeText={setDestArea}
              />
            </View>
          </View>
        </View>

        {/* Fare */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROPOSED FARE PER SEAT (PKR)</Text>
          <Text style={styles.helperText}>
            Set what you think is fair. Drivers can accept or counter with a higher amount.
          </Text>
          <View style={styles.fareRow}>
            <Text style={styles.farePrefix}>PKR</Text>
            <TextInput
              style={styles.fareInput}
              placeholder="e.g. 200"
              placeholderTextColor={colors.muted}
              value={farePerSeat}
              onChangeText={(t) => setFarePerSeat(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
            />
          </View>
          {fareNum >= 50 && (
            <View style={styles.totalChip}>
              <Text style={styles.totalChipText}>
                Total ride value: {totalFare} PKR ({totalSlots} seats × {fareNum} PKR)
              </Text>
            </View>
          )}
        </View>

        {/* Slots */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SEATS NEEDED</Text>
          <Text style={styles.helperText}>Including yourself. Other passengers will join at the same fare.</Text>
          <View style={styles.seatsRow}>
            {[2, 3, 4].map((s) => (
              <Pressable
                key={s}
                style={[styles.seatOpt, totalSlots === s && styles.seatOptActive]}
                onPress={() => setTotalSlots(s)}
              >
                <Text style={styles.seatNum}>{s}</Text>
                <Text style={styles.seatLabel}>seats</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Gender */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GENDER PREFERENCE</Text>
          <View style={styles.genderList}>
            {GENDER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.key}
                style={[styles.genderOpt, genderPref === opt.key && styles.genderOptActive]}
                onPress={() => setGenderPref(opt.key)}
              >
                <Text style={styles.genderIcon}>{opt.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.genderLabel, genderPref === opt.key && { color: colors.primary }]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.genderDesc}>{opt.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          style={[styles.submitBtn, (submitting || fareNum < 50) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={submitting || fareNum < 50}
        >
          {submitting
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.submitBtnText}>Post Ride Request →</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:       { width: 40 },
  backArrow:     { fontSize: 24, color: colors.text },
  headerTitle:   { fontSize: 17, fontWeight: '800', color: colors.text },

  container:     { padding: 16, gap: 4, paddingBottom: 32 },
  section:       { gap: 8, marginBottom: 14 },
  sectionTitle:  { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  helperText:    { fontSize: 12, color: colors.muted, lineHeight: 17 },

  infoCard:      { backgroundColor: '#0d1a06', borderRadius: 14, borderWidth: 1, borderColor: `${colors.primary}30`, padding: 14, marginBottom: 14 },
  infoTitle:     { fontSize: 13, fontWeight: '800', color: colors.primary, marginBottom: 6 },
  infoText:      { fontSize: 12, color: colors.muted, lineHeight: 18 },

  routeCard:     { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  routeRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot:           { width: 10, height: 10, borderRadius: 5 },
  routeInput:    { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  routeDivider:  { height: 1, backgroundColor: colors.border, marginLeft: 34 },

  fareRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, height: 52, gap: 8 },
  farePrefix:    { fontSize: 14, fontWeight: '700', color: colors.muted },
  fareInput:     { flex: 1, fontSize: 22, fontWeight: '900', color: colors.text },
  totalChip:     { backgroundColor: '#0d1a06', borderRadius: 10, borderWidth: 1, borderColor: `${colors.primary}30`, paddingHorizontal: 12, paddingVertical: 8 },
  totalChipText: { fontSize: 12, color: colors.primary, fontWeight: '700' },

  seatsRow:      { flexDirection: 'row', gap: 10 },
  seatOpt:       { flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 4 },
  seatOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  seatNum:       { fontSize: 28, fontWeight: '900', color: colors.text },
  seatLabel:     { fontSize: 10, color: colors.muted, fontWeight: '600' },

  genderList:    { gap: 8 },
  genderOpt:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  genderOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  genderIcon:    { fontSize: 20, width: 28, textAlign: 'center' },
  genderLabel:   { fontSize: 14, fontWeight: '700', color: colors.text },
  genderDesc:    { fontSize: 11, color: colors.muted, marginTop: 2 },

  submitBtn:     { height: 56, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitBtnText: { color: '#000', fontSize: 17, fontWeight: '900' },
});
