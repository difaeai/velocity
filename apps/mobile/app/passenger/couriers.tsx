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

type PackageSize = 'document' | 'parcel' | 'box';

const PACKAGE_TYPES: { key: PackageSize; emoji: string; label: string; desc: string; price: string }[] = [
  { key: 'document', emoji: '📄', label: 'Document', desc: 'Envelopes, letters', price: '150–250 PKR' },
  { key: 'parcel',   emoji: '📦', label: 'Parcel',   desc: 'Small packages up to 5 kg', price: '250–450 PKR' },
  { key: 'box',      emoji: '📫', label: 'Large Box', desc: 'Boxes up to 20 kg', price: '450–800 PKR' },
];

export default function CouriersScreen() {
  const router = useRouter();
  const [pkgType, setPkgType] = useState<PackageSize>('parcel');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  function book() {
    if (!pickup.trim()) { Alert.alert('Missing info', 'Please enter a pickup address.'); return; }
    if (!dropoff.trim()) { Alert.alert('Missing info', 'Please enter a dropoff address.'); return; }
    if (!recipientName.trim()) { Alert.alert('Missing info', 'Please enter the recipient name.'); return; }
    if (!recipientPhone.trim()) { Alert.alert('Missing info', 'Please enter the recipient phone number.'); return; }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Courier Booked! 📦',
        `Your ${PACKAGE_TYPES.find(p => p.key === pkgType)?.label.toLowerCase()} will be picked up shortly.\n\nRecipient: ${recipientName}\nPhone: ${recipientPhone}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }, 1200);
  }

  const selected = PACKAGE_TYPES.find(p => p.key === pkgType)!;

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
        <Text style={styles.headerTitle}>Couriers</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>PACKAGE TYPE</Text>
        <View style={styles.pkgRow}>
          {PACKAGE_TYPES.map(p => (
            <Pressable
              key={p.key}
              style={[styles.pkgCard, pkgType === p.key && styles.pkgCardActive]}
              onPress={() => setPkgType(p.key)}
            >
              <Text style={styles.pkgEmoji}>{p.emoji}</Text>
              <Text style={[styles.pkgLabel, pkgType === p.key && styles.pkgLabelActive]}>{p.label}</Text>
              <Text style={styles.pkgDesc}>{p.desc}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Estimated price</Text>
          <Text style={styles.priceValue}>{selected.price}</Text>
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

        <Text style={styles.sectionLabel}>RECIPIENT DETAILS</Text>
        <View style={styles.card}>
          <TextInput
            style={[styles.input, styles.standaloneInput]}
            placeholder="Recipient name"
            placeholderTextColor={colors.muted}
            value={recipientName}
            onChangeText={setRecipientName}
          />
          <View style={styles.divider} />
          <TextInput
            style={[styles.input, styles.standaloneInput]}
            placeholder="Recipient phone"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            value={recipientPhone}
            onChangeText={setRecipientPhone}
          />
          <View style={styles.divider} />
          <TextInput
            style={[styles.input, styles.standaloneInput]}
            placeholder="Special instructions (optional)"
            placeholderTextColor={colors.muted}
            value={instructions}
            onChangeText={setInstructions}
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.bookBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.6 }]}
          onPress={book}
          disabled={loading}
        >
          <Text style={styles.bookBtnText}>{loading ? 'Booking…' : 'Book Courier'}</Text>
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
  pkgRow: { flexDirection: 'row', gap: 10 },
  pkgCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  pkgCardActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  pkgEmoji: { fontSize: 24, marginBottom: 2 },
  pkgLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  pkgLabelActive: { color: colors.primary },
  pkgDesc: { fontSize: 10, color: colors.muted, textAlign: 'center' },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  priceLabel: { fontSize: 14, fontWeight: '600', color: colors.muted },
  priceValue: { fontSize: 16, fontWeight: '900', color: colors.primary },
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
  standaloneInput: { paddingHorizontal: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
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
