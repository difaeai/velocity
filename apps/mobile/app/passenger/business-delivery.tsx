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
type LoadType  = 'documents' | 'goods' | 'perishable' | 'fragile';

const PRIORITIES: { key: Priority; label: string; eta: string; pct: number }[] = [
  { key: 'standard',  label: 'Standard',  eta: '24–48 hrs', pct: 0    },
  { key: 'express',   label: 'Express',   eta: '4–6 hrs',   pct: 40   },
  { key: 'same-day',  label: 'Same Day',  eta: 'By 8 PM',   pct: 70   },
];

const LOAD_TYPES: { key: LoadType; emoji: string; label: string }[] = [
  { key: 'documents',  emoji: '📄', label: 'Documents'  },
  { key: 'goods',      emoji: '📦', label: 'Goods'      },
  { key: 'perishable', emoji: '🥦', label: 'Perishable' },
  { key: 'fragile',    emoji: '🔮', label: 'Fragile'    },
];

const BASE_QUOTE = 1200;

export default function BusinessDeliveryScreen() {
  const router = useRouter();
  const [stage, setStage]               = useState<'info' | 'options'>('info');
  const [businessName, setBusinessName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [pickup,  setPickup]  = useState('');
  const [dropoff, setDropoff] = useState('');
  const [priority, setPriority] = useState<Priority>('standard');
  const [loadType, setLoadType] = useState<LoadType>('goods');
  const [notes,  setNotes]   = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedPriority = PRIORITIES.find(p => p.key === priority)!;
  const estimatedQuote   = Math.round(BASE_QUOTE * (1 + selectedPriority.pct / 100));

  function requestQuote() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Quote Requested! 💼',
        `Our business team will contact you within 30 minutes.\n\nBusiness: ${businessName}\nPhone: ${contactPhone}\nPriority: ${selectedPriority.label} (${selectedPriority.eta})\nEstimated: PKR ${estimatedQuote.toLocaleString()}+`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }, 1200);
  }

  // ── STAGE 1: Business info + addresses ───────────────────────────────────────
  if (stage === 'info') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Business Delivery</Text>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>BUSINESS DETAILS</Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.fieldInput}
              placeholder="Business name"
              placeholderTextColor={colors.muted}
              value={businessName}
              onChangeText={setBusinessName}
              autoFocus
            />
            <View style={styles.fieldDivider} />
            <TextInput
              style={styles.fieldInput}
              placeholder="Contact person name"
              placeholderTextColor={colors.muted}
              value={contactPerson}
              onChangeText={setContactPerson}
            />
            <View style={styles.fieldDivider} />
            <TextInput
              style={styles.fieldInput}
              placeholder="Contact phone number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              value={contactPhone}
              onChangeText={setContactPhone}
            />
          </View>

          <Text style={styles.sectionLabel}>PICKUP & DELIVERY</Text>
          <View style={styles.inputCard}>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Pickup address"
                placeholderTextColor={colors.muted}
                value={pickup}
                onChangeText={setPickup}
              />
            </View>
            <View style={styles.fieldDivider} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Delivery address"
                placeholderTextColor={colors.muted}
                value={dropoff}
                onChangeText={setDropoff}
              />
            </View>
          </View>

          <Pressable
            style={[
              styles.continueBtn,
              (!businessName.trim() || !contactPhone.trim() || !pickup.trim() || !dropoff.trim()) && { opacity: 0.4 },
            ]}
            onPress={() => {
              if (!businessName.trim())  { Alert.alert('Missing', 'Enter your business name.');      return; }
              if (!contactPhone.trim())  { Alert.alert('Missing', 'Enter a contact phone number.');  return; }
              if (!pickup.trim())        { Alert.alert('Missing', 'Enter a pickup address.');         return; }
              if (!dropoff.trim())       { Alert.alert('Missing', 'Enter a delivery address.');       return; }
              setStage('options');
            }}
          >
            <Text style={styles.continueBtnTxt}>Choose Priority →</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── STAGE 2: Priority + load type + quote ────────────────────────────────────
  return (
    <View style={styles.safe}>
      {/* Abstract map background */}
      <View style={styles.mapBg}>
        <View style={[styles.road, { top: 110, left: -50, width: '120%', transform: [{ rotate: '-12deg' }] }]} />
        <View style={[styles.road, { top: 260, left: -50, width: '120%', transform: [{ rotate: '18deg'  }] }]} />
        <View style={[styles.road, { top: 420, left: -50, width: '120%', transform: [{ rotate: '-3deg'  }] }]} />
        <View style={[styles.mapPin, { top: 130, left: 90  }]}><Text style={styles.mapPinTxt}>🏢</Text></View>
        <View style={[styles.mapPin, { top: 280, left: 220 }]}><Text style={styles.mapPinTxt}>🏁</Text></View>
      </View>

      {/* Floating header */}
      <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
        <View style={styles.floatingBar}>
          <Pressable style={styles.backBtn} onPress={() => setStage('info')}>
            <Text style={styles.backTxt}>←</Text>
          </Pressable>
          <View style={styles.floatingRouteCard}>
            <View style={styles.floatingPoint}>
              <Text style={styles.floatingEmoji}>🏢</Text>
              <Text style={styles.floatingAddr} numberOfLines={1}>{businessName}</Text>
            </View>
            <View style={styles.floatingDivider} />
            <View style={styles.floatingPoint}>
              <Text style={styles.floatingEmoji}>🏁</Text>
              <Text style={styles.floatingAddr} numberOfLines={1}>{dropoff}</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.dragIndicator} />

        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
          {/* Selected priority — main card */}
          <View style={styles.selectedCard}>
            <View style={styles.selectedTop}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <Text style={styles.selectedName}>{selectedPriority.label}</Text>
                  {selectedPriority.pct > 0 && (
                    <View style={styles.selectedBadge}>
                      <Text style={styles.selectedBadgeTxt}>+{selectedPriority.pct}%</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.selectedEta}>Estimated delivery: {selectedPriority.eta}</Text>
              </View>
              <Text style={{ fontSize: 26 }}>💼</Text>
            </View>

            <View style={styles.quoteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.quoteValue}>PKR {estimatedQuote.toLocaleString()}+</Text>
                <Text style={styles.quoteLabel}>estimated quote · final confirmed by team</Text>
              </View>
            </View>
          </View>

          {/* Other priority options */}
          {PRIORITIES.filter(p => p.key !== priority).map(p => (
            <Pressable key={p.key} style={styles.altRow} onPress={() => setPriority(p.key)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.altName}>{p.label}</Text>
                <Text style={styles.altEta}>{p.eta}</Text>
              </View>
              <Text style={styles.altPrice}>
                PKR {Math.round(BASE_QUOTE * (1 + p.pct / 100)).toLocaleString()}+
              </Text>
              {p.pct > 0 && (
                <View style={styles.altBadge}>
                  <Text style={styles.altBadgeTxt}>+{p.pct}%</Text>
                </View>
              )}
            </Pressable>
          ))}

          {/* Load type */}
          <Text style={styles.sectionLabel}>LOAD TYPE</Text>
          <View style={styles.loadRow}>
            {LOAD_TYPES.map(l => (
              <Pressable
                key={l.key}
                style={[styles.loadChip, loadType === l.key && styles.loadChipActive]}
                onPress={() => setLoadType(l.key)}
              >
                <Text style={styles.loadEmoji}>{l.emoji}</Text>
                <Text style={[styles.loadLabel, loadType === l.key && { color: colors.primary }]}>
                  {l.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Notes */}
          <Pressable style={styles.notesToggle} onPress={() => setShowNotes(v => !v)}>
            <Text style={styles.notesTxt}>
              {showNotes ? '▾' : '▸'} Special instructions (optional)
            </Text>
          </Pressable>
          {showNotes && (
            <TextInput
              style={styles.notesInput}
              placeholder="Handling notes, access codes, fragile warnings…"
              placeholderTextColor={colors.muted}
              multiline
              value={notes}
              onChangeText={setNotes}
            />
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.bookBtn, loading && { opacity: 0.6 }]}
            onPress={requestQuote}
            disabled={loading}
          >
            <Text style={styles.bookBtnTxt}>
              {loading ? 'Requesting…' : `Request Quote · PKR ${estimatedQuote.toLocaleString()}+`}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  // Stage 1
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  closeBtn:    { padding: 6 },
  closeTxt:    { fontSize: 20, color: colors.muted },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fieldInput:   { height: 48, paddingHorizontal: 16, fontSize: 14, fontWeight: '600', color: colors.text },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  routeRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 4 },
  routeDot:    { width: 10, height: 10, borderRadius: 5 },
  routeInput:  { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, height: 40 },
  continueBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  continueBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },

  // Stage 2 map
  mapBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#151616' },
  road: {
    position: 'absolute',
    height: 28,
    backgroundColor: '#1e2020',
    borderRadius: 4,
  },
  mapPin: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinTxt: { fontSize: 16 },

  // Floating header
  floatingHeaderArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  floatingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { fontSize: 20, color: colors.text },
  floatingRouteCard: {
    flex: 1,
    backgroundColor: '#212222',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  floatingPoint:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  floatingEmoji:   { fontSize: 13 },
  floatingAddr:    { fontSize: 12, fontWeight: '700', color: colors.text, flex: 1 },
  floatingDivider: { height: 1, backgroundColor: colors.border, marginLeft: 22 },

  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingHorizontal: 16,
    maxHeight: '72%',
  },
  dragIndicator: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },

  // Selected priority card
  selectedCard: {
    backgroundColor: '#0a1f05',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 16,
    gap: 14,
    marginBottom: 4,
  },
  selectedTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedName: { fontSize: 20, fontWeight: '900', color: colors.primary },
  selectedBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  selectedBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 0.8 },
  selectedEta: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  quoteRow: {
    backgroundColor: '#131f0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3010',
    padding: 14,
  },
  quoteValue: { fontSize: 22, fontWeight: '900', color: colors.primary },
  quoteLabel: { fontSize: 11, color: colors.muted, fontWeight: '600', marginTop: 3 },

  // Alt priority rows
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  altName:  { fontSize: 14, fontWeight: '800', color: colors.text },
  altEta:   { fontSize: 11, color: colors.muted, marginTop: 1 },
  altPrice: { fontSize: 13, fontWeight: '700', color: colors.muted },
  altBadge: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  altBadgeTxt: { fontSize: 10, fontWeight: '800', color: colors.muted },

  // Load type
  loadRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  loadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  loadChipActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  loadEmoji: { fontSize: 14 },
  loadLabel: { fontSize: 12, fontWeight: '700', color: colors.text },

  // Notes
  notesToggle: { paddingVertical: 10 },
  notesTxt:    { fontSize: 13, fontWeight: '700', color: colors.muted },
  notesInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 14,
    color: colors.text,
    height: 80,
    textAlignVertical: 'top',
  },

  // Footer
  footer: { paddingTop: 10, paddingBottom: 28 },
  bookBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
});
