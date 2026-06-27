import { useState } from 'react';
import {
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

import { colors } from '../../src/config';

type Priority = 'standard' | 'express' | 'same-day';
type LoadType = 'documents' | 'goods' | 'perishable' | 'fragile';

const PRIORITIES: { key: Priority; label: string; eta: string; surcharge: string }[] = [
  { key: 'standard',  label: 'Standard',  eta: '24–48 hrs', surcharge: '+0%' },
  { key: 'express',   label: 'Express',   eta: '4–6 hrs',   surcharge: '+40%' },
  { key: 'same-day',  label: 'Same Day',  eta: 'By 8 PM',   surcharge: '+70%' },
];

const LOAD_TYPES: { key: LoadType; emoji: string; label: string }[] = [
  { key: 'documents',  emoji: '📄', label: 'Documents' },
  { key: 'goods',      emoji: '📦', label: 'Goods' },
  { key: 'perishable', emoji: '🥦', label: 'Perishable' },
  { key: 'fragile',    emoji: '🔮', label: 'Fragile' },
];

export default function BusinessDeliveryScreen() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [priority, setPriority] = useState<Priority>('standard');
  const [loadType, setLoadType] = useState<LoadType>('goods');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  function requestQuote() {
    if (!businessName.trim()) { Alert.alert('Missing info', 'Please enter your business name.'); return; }
    if (!pickup.trim()) { Alert.alert('Missing info', 'Please enter a pickup address.'); return; }
    if (!dropoff.trim()) { Alert.alert('Missing info', 'Please enter a delivery address.'); return; }
    if (!contactPhone.trim()) { Alert.alert('Missing info', 'Please enter a contact phone number.'); return; }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Quote Requested! 💼',
        `Our business team will contact you within 30 minutes to confirm pricing and schedule your ${priority} delivery.\n\nBusiness: ${businessName}\nPhone: ${contactPhone}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }, 1200);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Business Delivery</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>BUSINESS DETAILS</Text>
        <View style={styles.card}>
          <TextInput
            style={[styles.input, styles.paddedInput]}
            placeholder="Business name"
            placeholderTextColor={colors.muted}
            value={businessName}
            onChangeText={setBusinessName}
          />
          <View style={styles.divider} />
          <TextInput
            style={[styles.input, styles.paddedInput]}
            placeholder="Contact person name"
            placeholderTextColor={colors.muted}
            value={contactPerson}
            onChangeText={setContactPerson}
          />
          <View style={styles.divider} />
          <TextInput
            style={[styles.input, styles.paddedInput]}
            placeholder="Contact phone number"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            value={contactPhone}
            onChangeText={setContactPhone}
          />
        </View>

        <Text style={styles.sectionLabel}>PICKUP & DELIVERY</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldDot}>🟢</Text>
            <TextInput
              style={styles.input}
              placeholder="Pickup address"
              placeholderTextColor={colors.muted}
              value={pickup}
              onChangeText={setPickup}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldDot}>🔴</Text>
            <TextInput
              style={styles.input}
              placeholder="Delivery address"
              placeholderTextColor={colors.muted}
              value={dropoff}
              onChangeText={setDropoff}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>LOAD TYPE</Text>
        <View style={styles.chipRow}>
          {LOAD_TYPES.map(l => (
            <Pressable
              key={l.key}
              style={[styles.chip, loadType === l.key && styles.chipActive]}
              onPress={() => setLoadType(l.key)}
            >
              <Text style={styles.chipEmoji}>{l.emoji}</Text>
              <Text style={[styles.chipLabel, loadType === l.key && styles.chipLabelActive]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>PRIORITY</Text>
        <View style={styles.priorityRow}>
          {PRIORITIES.map(p => (
            <Pressable
              key={p.key}
              style={[styles.priorityCard, priority === p.key && styles.priorityCardActive]}
              onPress={() => setPriority(p.key)}
            >
              <Text style={[styles.priorityLabel, priority === p.key && styles.priorityLabelActive]}>{p.label}</Text>
              <Text style={styles.priorityEta}>{p.eta}</Text>
              <Text style={[styles.prioritySurcharge, priority === p.key && { color: colors.primary }]}>{p.surcharge}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>SPECIAL INSTRUCTIONS</Text>
        <View style={styles.card}>
          <TextInput
            style={[styles.input, styles.paddedInput, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]}
            placeholder="Handling notes, access codes, fragile warnings…"
            placeholderTextColor={colors.muted}
            multiline
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.bookBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.6 }]}
          onPress={requestQuote}
          disabled={loading}
        >
          <Text style={styles.bookBtnText}>{loading ? 'Requesting…' : 'Request Quote'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  container: { padding: 16, gap: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4 },
  fieldDot: { fontSize: 10, marginRight: 10 },
  input: { flex: 1, height: 48, fontSize: 14, fontWeight: '600', color: colors.text },
  paddedInput: { paddingHorizontal: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  chipEmoji: { fontSize: 15 },
  chipLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  chipLabelActive: { color: colors.primary },
  priorityRow: { flexDirection: 'row', gap: 10 },
  priorityCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    gap: 3,
  },
  priorityCardActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  priorityLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  priorityLabelActive: { color: colors.primary },
  priorityEta: { fontSize: 11, color: colors.muted },
  prioritySurcharge: { fontSize: 11, fontWeight: '700', color: colors.muted },
  bookBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  bookBtnText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
