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

const PACKAGE_TYPES: {
  key: PackageSize; emoji: string; label: string; desc: string; basePrice: number; maxPrice: number;
}[] = [
  { key: 'document', emoji: '📄', label: 'Document',  desc: 'Envelopes & letters',        basePrice: 150, maxPrice: 250 },
  { key: 'parcel',   emoji: '📦', label: 'Parcel',    desc: 'Small packages up to 5 kg',  basePrice: 250, maxPrice: 450 },
  { key: 'box',      emoji: '📫', label: 'Large Box', desc: 'Heavy boxes up to 20 kg',    basePrice: 450, maxPrice: 800 },
];

export default function CouriersScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<'route' | 'details'>('route');
  const [pickup,  setPickup]  = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pkgType, setPkgType] = useState<PackageSize>('parcel');
  const [fare,    setFare]    = useState(250);
  const [recipientName,  setRecipientName]  = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [instructions,   setInstructions]   = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [loading, setLoading] = useState(false);

  const selected = PACKAGE_TYPES.find(p => p.key === pkgType)!;

  function selectPkg(key: PackageSize) {
    const pkg = PACKAGE_TYPES.find(p => p.key === key)!;
    setPkgType(key);
    setFare(pkg.basePrice);
  }

  function bumpFare(delta: number) {
    setFare(f => Math.min(selected.maxPrice, Math.max(selected.basePrice, f + delta)));
  }

  function book() {
    if (!recipientName.trim())  { Alert.alert('Missing', 'Enter the recipient name.');         return; }
    if (!recipientPhone.trim()) { Alert.alert('Missing', 'Enter the recipient phone number.'); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Courier Booked! 📦',
        `Your ${selected.label.toLowerCase()} will be picked up shortly.\n\nTo: ${recipientName} · ${recipientPhone}\nOffer: PKR ${fare}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }, 1200);
  }

  // ── STAGE 1: Route ───────────────────────────────────────────────────────────
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Send a Package</Text>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
            <TextInput
              style={styles.routeInput}
              placeholder="Pickup address"
              placeholderTextColor={colors.muted}
              value={pickup}
              onChangeText={setPickup}
              autoFocus
            />
          </View>
          <View style={styles.routeDivider} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
            <TextInput
              style={styles.routeInput}
              placeholder="Delivery address"
              placeholderTextColor={colors.muted}
              value={dropoff}
              onChangeText={setDropoff}
            />
            {dropoff.length > 0 && (
              <Pressable onPress={() => setDropoff('')} hitSlop={10}>
                <Text style={{ color: colors.muted, fontSize: 20 }}>×</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipText}>
            📦  Same-city delivery · Documents, parcels & heavy boxes · Track in real time
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          <Pressable
            style={[styles.continueBtn, (!pickup.trim() || !dropoff.trim()) && { opacity: 0.4 }]}
            onPress={() => {
              if (!pickup.trim())  { Alert.alert('Missing', 'Enter a pickup address.');   return; }
              if (!dropoff.trim()) { Alert.alert('Missing', 'Enter a delivery address.'); return; }
              setStage('details');
            }}
          >
            <Text style={styles.continueBtnText}>Choose package type →</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── STAGE 2: Package type + details ──────────────────────────────────────────
  return (
    <View style={styles.safe}>
      {/* Abstract map background */}
      <View style={styles.mapBg}>
        <View style={[styles.road, { top: 120, left: -50, width: '120%', transform: [{ rotate: '-10deg' }] }]} />
        <View style={[styles.road, { top: 260, left: -50, width: '120%', transform: [{ rotate: '20deg'  }] }]} />
        <View style={[styles.road, { top: 420, left: -50, width: '120%', transform: [{ rotate: '-5deg'  }] }]} />
        <View style={[styles.mapPin, { top: 140, left: 100 }]}><Text style={styles.mapPinTxt}>📦</Text></View>
        <View style={[styles.mapPin, { top: 280, left: 230 }]}><Text style={styles.mapPinTxt}>🏁</Text></View>
      </View>

      {/* Floating route header */}
      <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
        <View style={styles.floatingBar}>
          <Pressable style={styles.backBtn} onPress={() => setStage('route')}>
            <Text style={styles.backTxt}>←</Text>
          </Pressable>
          <View style={styles.floatingRouteCard}>
            <View style={styles.floatingPoint}>
              <Text style={styles.floatingEmoji}>📦</Text>
              <Text style={styles.floatingAddr} numberOfLines={1}>{pickup}</Text>
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

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Selected package — main card with price adjuster */}
          <View style={styles.selectedCard}>
            <View style={styles.selectedCardTop}>
              <Text style={styles.selectedEmoji}>{selected.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedName}>{selected.label}</Text>
                <Text style={styles.selectedDesc}>{selected.desc}</Text>
              </View>
              <View style={styles.selectedBadge}>
                <Text style={styles.selectedBadgeTxt}>SELECTED</Text>
              </View>
            </View>

            <View style={styles.fareRow}>
              <Pressable style={styles.fareBtn} onPress={() => bumpFare(-50)}>
                <Text style={styles.fareBtnTxt}>−</Text>
              </Pressable>
              <View style={{ alignItems: 'center', flex: 1 }}>
                <Text style={styles.fareValue}>PKR {fare}</Text>
                <Text style={styles.fareLabel}>your offer · range {selected.basePrice}–{selected.maxPrice}</Text>
              </View>
              <Pressable style={styles.fareBtn} onPress={() => bumpFare(50)}>
                <Text style={styles.fareBtnTxt}>+</Text>
              </Pressable>
            </View>
          </View>

          {/* Alternative package types */}
          {PACKAGE_TYPES.filter(p => p.key !== pkgType).map(p => (
            <Pressable key={p.key} style={styles.altRow} onPress={() => selectPkg(p.key)}>
              <Text style={styles.altEmoji}>{p.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.altName}>{p.label}</Text>
                <Text style={styles.altDesc}>{p.desc}</Text>
              </View>
              <Text style={styles.altPrice}>PKR {p.basePrice}+</Text>
            </Pressable>
          ))}

          {/* Recipient */}
          <Text style={styles.sectionLabel}>RECIPIENT</Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.fieldInput}
              placeholder="Recipient name"
              placeholderTextColor={colors.muted}
              value={recipientName}
              onChangeText={setRecipientName}
            />
            <View style={styles.fieldDivider} />
            <TextInput
              style={styles.fieldInput}
              placeholder="Recipient phone"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              value={recipientPhone}
              onChangeText={setRecipientPhone}
            />
          </View>

          <Pressable
            style={styles.instructionsToggle}
            onPress={() => setShowInstructions(v => !v)}
          >
            <Text style={styles.instructionsTxt}>
              {showInstructions ? '▾' : '▸'} Special instructions (optional)
            </Text>
          </Pressable>
          {showInstructions && (
            <TextInput
              style={styles.instructionsInput}
              placeholder="Fragile? Access code? Handling notes…"
              placeholderTextColor={colors.muted}
              multiline
              value={instructions}
              onChangeText={setInstructions}
            />
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.bookBtn, loading && { opacity: 0.6 }]}
            onPress={book}
            disabled={loading}
          >
            <Text style={styles.bookBtnTxt}>
              {loading ? 'Booking…' : `Book Courier · PKR ${fare}`}
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
  routeCard: {
    backgroundColor: colors.surface,
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  routeRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  routeDot:    { width: 10, height: 10, borderRadius: 5 },
  routeInput:  { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, height: 34 },
  routeDivider:{ height: 1, backgroundColor: colors.border, marginLeft: 22 },
  tipBox: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tipText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  continueBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },

  // Stage 2 map
  mapBg: { ...StyleSheet.absoluteFill, backgroundColor: '#151616' },
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

  // Selected package card
  selectedCard: {
    backgroundColor: '#0a1f05',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 16,
    gap: 14,
    marginBottom: 4,
  },
  selectedCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedEmoji:   { fontSize: 32 },
  selectedName:    { fontSize: 18, fontWeight: '900', color: colors.primary },
  selectedDesc:    { fontSize: 12, color: colors.muted, marginTop: 2 },
  selectedBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  selectedBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 0.8 },

  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131f0a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3010',
    padding: 12,
    gap: 8,
  },
  fareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fareBtnTxt: { fontSize: 22, fontWeight: '900', color: '#000', lineHeight: 26 },
  fareValue:  { fontSize: 22, fontWeight: '900', color: colors.primary },
  fareLabel:  { fontSize: 11, color: colors.muted, fontWeight: '600', marginTop: 2 },

  // Alternatives
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  altEmoji: { fontSize: 22 },
  altName:  { fontSize: 14, fontWeight: '800', color: colors.text },
  altDesc:  { fontSize: 11, color: colors.muted, marginTop: 1 },
  altPrice: { fontSize: 13, fontWeight: '800', color: colors.muted },

  // Recipient
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 6,
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

  instructionsToggle: { paddingVertical: 10 },
  instructionsTxt:    { fontSize: 13, fontWeight: '700', color: colors.muted },
  instructionsInput: {
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
