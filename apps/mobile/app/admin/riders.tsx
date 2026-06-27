import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { colors } from '../../src/config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FareConfig {
  baseFare: number;
  perKm: number;
  perMin: number;
  minFare: number;
  nightSurchargePercent: number;
  allowedVehicles: string[];
}

type Category = 'bike' | 'mini' | 'ac' | 'comfort';
type FareMap = Record<Category, FareConfig>;

// ── Static metadata ───────────────────────────────────────────────────────────

interface CategoryMeta {
  id: Category;
  icon: string;
  label: string;
  fullLabel: string;
  group: 'Bike Riders' | 'Car Riders';
  desc: string;
  color: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'bike',
    icon: '🏍️',
    label: 'Bike',
    fullLabel: 'Bike',
    group: 'Bike Riders',
    desc: '70–150cc motorcycles, affordable city rides',
    color: '#f59e0b',
  },
  {
    id: 'mini',
    icon: '🚗',
    label: 'Mini',
    fullLabel: 'Ride Mini',
    group: 'Car Riders',
    desc: 'Small economical hatchbacks',
    color: '#3b82f6',
  },
  {
    id: 'ac',
    icon: '❄️',
    label: 'AC',
    fullLabel: 'Ride Regular — AC',
    group: 'Car Riders',
    desc: 'Mid-range sedans with air conditioning',
    color: '#06b6d4',
  },
  {
    id: 'comfort',
    icon: '✨',
    label: 'Comfort',
    fullLabel: 'Ride Regular — Comfort',
    group: 'Car Riders',
    desc: 'Premium sedans and SUVs',
    color: '#8b5cf6',
  },
];

// ── Default fares & allowed vehicles ─────────────────────────────────────────

const DEFAULTS: FareMap = {
  bike: {
    baseFare: 50,
    perKm: 25,
    perMin: 3,
    minFare: 80,
    nightSurchargePercent: 20,
    allowedVehicles: [
      'Honda CD 70',
      'Honda CG 125',
      'Yamaha YBR 125',
      'United 70cc',
      'Road Prince 70',
      'Suzuki GS 150',
      'Honda CB 150F',
    ],
  },
  mini: {
    baseFare: 100,
    perKm: 45,
    perMin: 5,
    minFare: 150,
    nightSurchargePercent: 15,
    allowedVehicles: [
      'Suzuki Alto',
      'Suzuki Mehran',
      'Suzuki Bolan',
      'Daihatsu Cuore',
      'Changan Karvaan',
      'KIA Picanto (2010–2018)',
    ],
  },
  ac: {
    baseFare: 150,
    perKm: 65,
    perMin: 7,
    minFare: 200,
    nightSurchargePercent: 15,
    allowedVehicles: [
      'Toyota Corolla',
      'Honda City',
      'Suzuki Cultus',
      'KIA Picanto (2019+)',
      'Hyundai Elantra',
      'Chery Tiggo 4',
      'MG 3',
    ],
  },
  comfort: {
    baseFare: 200,
    perKm: 90,
    perMin: 10,
    minFare: 300,
    nightSurchargePercent: 25,
    allowedVehicles: [
      'Honda Civic',
      'Toyota Fortuner',
      'Toyota Prado',
      'Honda BRV',
      'KIA Sportage',
      'Toyota Vigo',
      'MG HS',
      'Hyundai Tucson',
    ],
  },
};

// ── Fare field descriptors ────────────────────────────────────────────────────

const FARE_FIELDS: {
  key: keyof FareConfig;
  label: string;
  sublabel: string;
  unit: string;
  step: number;
  min: number;
  max: number;
}[] = [
  {
    key: 'baseFare',
    label: 'Base fare',
    sublabel: 'Charged on pickup',
    unit: 'PKR',
    step: 10,
    min: 20,
    max: 500,
  },
  {
    key: 'perKm',
    label: 'Per km',
    sublabel: 'Rate per kilometre',
    unit: 'PKR',
    step: 5,
    min: 10,
    max: 200,
  },
  {
    key: 'perMin',
    label: 'Per minute',
    sublabel: 'Rate per minute (traffic)',
    unit: 'PKR',
    step: 1,
    min: 1,
    max: 30,
  },
  {
    key: 'minFare',
    label: 'Minimum fare',
    sublabel: 'Lowest possible trip fare',
    unit: 'PKR',
    step: 10,
    min: 50,
    max: 500,
  },
  {
    key: 'nightSurchargePercent',
    label: 'Night surcharge',
    sublabel: '10 PM – 6 AM extra charge',
    unit: '%',
    step: 5,
    min: 0,
    max: 100,
  },
];

// ── Helper ────────────────────────────────────────────────────────────────────

// City average ~30 km/h → ~2 min/km
function estimateFare(cfg: FareConfig, km: number): number {
  const minutes = km * 2;
  return Math.max(cfg.minFare, Math.round(cfg.baseFare + cfg.perKm * km + cfg.perMin * minutes));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryTab({
  meta,
  active,
  onPress,
}: {
  meta: CategoryMeta;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.tab, active && { ...styles.tabActive, borderColor: meta.color }]}
      onPress={onPress}
    >
      <Text style={styles.tabIcon}>{meta.icon}</Text>
      <Text style={[styles.tabLabel, active && { color: meta.color }]}>{meta.label}</Text>
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RidersAdmin() {
  const router = useRouter();
  const [active, setActive] = useState<Category>('bike');
  const [fares, setFares] = useState<FareMap>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [newVehicle, setNewVehicle] = useState('');

  const cat = CATEGORIES.find((c) => c.id === active)!;
  const cfg = fares[active];

  // ── Firestore sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'rideFares'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<FareMap>;
          setFares({
            bike:    { ...DEFAULTS.bike,    ...(d.bike    ?? {}) },
            mini:    { ...DEFAULTS.mini,    ...(d.mini    ?? {}) },
            ac:      { ...DEFAULTS.ac,      ...(d.ac      ?? {}) },
            comfort: { ...DEFAULTS.comfort, ...(d.comfort ?? {}) },
          });
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  // ── Mutation helpers ────────────────────────────────────────────────────────

  function updateNumericField(key: keyof FareConfig, val: number) {
    setFares((prev) => ({ ...prev, [active]: { ...prev[active], [key]: val } }));
  }

  function removeVehicle(vehicle: string) {
    setFares((prev) => ({
      ...prev,
      [active]: {
        ...prev[active],
        allowedVehicles: prev[active].allowedVehicles.filter((v) => v !== vehicle),
      },
    }));
  }

  function confirmAddVehicle() {
    const trimmed = newVehicle.trim();
    if (!trimmed) return;
    if (cfg.allowedVehicles.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert('Already exists', `"${trimmed}" is already in the ${cat.label} list.`);
      return;
    }
    setFares((prev) => ({
      ...prev,
      [active]: { ...prev[active], allowedVehicles: [...prev[active].allowedVehicles, trimmed] },
    }));
    setNewVehicle('');
    setModalVisible(false);
  }

  async function saveCategory() {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'config', 'rideFares'),
        { [active]: { ...cfg }, updatedAt: serverTimestamp() },
        { merge: true },
      );
      Alert.alert('Saved ✓', `${cat.fullLabel} settings saved successfully.`);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const fare5  = estimateFare(cfg, 5);
  const fare10 = estimateFare(cfg, 10);
  const fare15 = estimateFare(cfg, 15);
  const maxFare = fare15;

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Ride Categories</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Tab bar ── */}
      <View style={styles.tabBar}>
        {/* Bike riders group */}
        <View style={styles.tabGroup}>
          <Text style={styles.tabGroupLabel}>BIKE</Text>
          <CategoryTab meta={CATEGORIES[0]} active={active === 'bike'} onPress={() => setActive('bike')} />
        </View>

        <View style={styles.tabSep} />

        {/* Car riders group */}
        <View style={[styles.tabGroup, { flex: 1 }]}>
          <Text style={styles.tabGroupLabel}>CAR RIDERS</Text>
          <View style={styles.tabRow}>
            {(['mini', 'ac', 'comfort'] as Category[]).map((id) => {
              const m = CATEGORIES.find((c) => c.id === id)!;
              return (
                <View key={id} style={{ flex: 1 }}>
                  <CategoryTab meta={m} active={active === id} onPress={() => setActive(id)} />
                </View>
              );
            })}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Category banner ── */}
        <View style={[styles.catBanner, { borderColor: cat.color + '60' }]}>
          <View style={[styles.catIconCircle, { backgroundColor: cat.color + '20' }]}>
            <Text style={styles.catIconBig}>{cat.icon}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.catFullLabel, { color: cat.color }]}>{cat.fullLabel}</Text>
            <Text style={styles.catDesc}>{cat.desc}</Text>
            <Text style={styles.catGroup}>Group: {cat.group}</Text>
          </View>
        </View>

        {/* ── Fare settings ── */}
        <Text style={styles.sectionLabel}>FARE SETTINGS</Text>
        <View style={styles.card}>
          {FARE_FIELDS.map((field, idx) => (
            <View key={field.key}>
              {idx > 0 && <View style={styles.divider} />}
              <View style={styles.stepperRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepperLabel}>{field.label}</Text>
                  <Text style={styles.stepperSub}>{field.sublabel}</Text>
                </View>
                <View style={styles.stepperControls}>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() =>
                      updateNumericField(
                        field.key,
                        Math.max(field.min, (cfg[field.key] as number) - field.step),
                      )
                    }
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue}>
                    {cfg[field.key] as number}
                    <Text style={styles.stepUnit}> {field.unit}</Text>
                  </Text>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() =>
                      updateNumericField(
                        field.key,
                        Math.min(field.max, (cfg[field.key] as number) + field.step),
                      )
                    }
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}

          {/* ── Fare preview ── */}
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>ESTIMATED FARES (city avg 30 km/h)</Text>
            {[
              { km: 5,  fare: fare5  },
              { km: 10, fare: fare10 },
              { km: 15, fare: fare15 },
            ].map(({ km, fare }) => (
              <View key={km} style={styles.previewRow}>
                <Text style={styles.previewKm}>{km} km</Text>
                <View style={styles.previewBarTrack}>
                  {/* flex-based bar: no percentage string needed */}
                  <View style={{ flex: Math.round((fare / maxFare) * 100), height: 5, backgroundColor: cat.color, borderRadius: 3 }} />
                  <View style={{ flex: 100 - Math.round((fare / maxFare) * 100) }} />
                </View>
                <Text style={styles.previewFare}>{fare} PKR</Text>
              </View>
            ))}
            <View style={styles.previewNightRow}>
              <Text style={styles.previewNightLabel}>🌙 Night fare (10PM–6AM)</Text>
              <Text style={styles.previewNightVal}>
                {Math.round(fare10 * (1 + cfg.nightSurchargePercent / 100))} PKR{' '}
                <Text style={styles.previewNightPct}>(+{cfg.nightSurchargePercent}%)</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* ── Allowed vehicles ── */}
        <View style={styles.vehiclesHeader}>
          <Text style={styles.sectionLabel}>
            ALLOWED VEHICLES ({cfg.allowedVehicles.length})
          </Text>
          <Pressable
            style={[styles.addBtn, { borderColor: cat.color }]}
            onPress={() => setModalVisible(true)}
          >
            <Text style={[styles.addBtnText, { color: cat.color }]}>+ Add vehicle</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {cfg.allowedVehicles.length === 0 ? (
            <Text style={styles.emptyText}>
              No vehicles yet. Tap "+ Add vehicle" to allow vehicles in this category.
            </Text>
          ) : (
            cfg.allowedVehicles.map((v, idx) => (
              <View key={v}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.vehicleRow}>
                  <View style={[styles.vehicleDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.vehicleName}>{v}</Text>
                  <Pressable
                    hitSlop={10}
                    onPress={() =>
                      Alert.alert(
                        'Remove vehicle',
                        `Remove "${v}" from ${cat.fullLabel}?\n\nDrivers with this vehicle will no longer match this category.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeVehicle(v) },
                        ],
                      )
                    }
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ── Earnings note ── */}
        <View style={[styles.earningsNote, { borderColor: cat.color + '40' }]}>
          <Text style={styles.earningsNoteTitle}>💰 Driver earnings for {cat.label}</Text>
          <Text style={styles.earningsNoteText}>
            10 km trip · Base {cfg.baseFare} + {cfg.perKm} × 10 km + {cfg.perMin} × 20 min
            {' = '}
            <Text style={{ color: cat.color, fontWeight: '800' }}>
              {fare10} PKR
            </Text>
            {'\n'}
            Night: {Math.round(fare10 * (1 + cfg.nightSurchargePercent / 100))} PKR
            · Min guaranteed: {cfg.minFare} PKR
          </Text>
        </View>

        {/* ── Save button ── */}
        <Pressable
          style={[styles.saveBtn, { backgroundColor: cat.color }, saving && { opacity: 0.6 }]}
          onPress={saveCategory}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save {cat.fullLabel} Settings</Text>
          )}
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Add Vehicle Modal ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={[styles.modalHandleBar, { backgroundColor: cat.color }]} />
              <Text style={styles.modalTitle}>Add Vehicle to {cat.fullLabel}</Text>
              <Text style={styles.modalSub}>
                Enter make and model. Example: "Toyota Corolla 2022"
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Honda City 1.3 2023"
                placeholderTextColor={colors.muted}
                value={newVehicle}
                onChangeText={setNewVehicle}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={confirmAddVehicle}
              />
              <View style={styles.modalBtnRow}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    setNewVehicle('');
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalConfirmBtn, { backgroundColor: cat.color }]}
                  onPress={confirmAddVehicle}
                >
                  <Text style={styles.modalConfirmText}>Add Vehicle</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  tabGroup: { gap: 5, alignItems: 'stretch' },
  tabGroupLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  tabRow: { flexDirection: 'row', gap: 4 },
  tabSep: {
    width: 1,
    backgroundColor: colors.border,
    marginTop: 14,
    height: 36,
    marginHorizontal: 2,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  tabActive: { backgroundColor: colors.background },
  tabIcon: { fontSize: 15 },
  tabLabel: { fontSize: 9, fontWeight: '800', color: colors.muted },

  // Content
  scroll: { padding: 16, gap: 12 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.8,
    marginTop: 4,
  },

  // Category banner
  catBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
  },
  catIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catIconBig: { fontSize: 26 },
  catFullLabel: { fontSize: 15, fontWeight: '800' },
  catDesc: { fontSize: 12, color: colors.muted },
  catGroup: { fontSize: 10, color: colors.muted, fontStyle: 'italic' },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border },

  // Stepper rows
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
  },
  stepperLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  stepperSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 20, color: colors.primary, fontWeight: '900', lineHeight: 24 },
  stepValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    minWidth: 68,
    textAlign: 'center',
  },
  stepUnit: { fontSize: 11, color: colors.muted, fontWeight: '600' },

  // Fare preview
  previewBox: {
    backgroundColor: '#0c1709',
    margin: 12,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  previewTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewKm: { fontSize: 12, color: colors.muted, width: 34 },
  previewBarTrack: {
    flex: 1,
    height: 5,
    backgroundColor: '#1a2e0f',
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  previewFare: { fontSize: 13, fontWeight: '800', color: colors.text, width: 70, textAlign: 'right' },
  previewNightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a2e0f',
  },
  previewNightLabel: { fontSize: 11, color: colors.muted },
  previewNightVal: { fontSize: 12, fontWeight: '700', color: colors.text },
  previewNightPct: { color: '#f59e0b', fontSize: 11 },

  // Vehicles
  vehiclesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  addBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  addBtnText: { fontSize: 12, fontWeight: '800' },
  emptyText: {
    padding: 20,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  vehicleDot: { width: 8, height: 8, borderRadius: 4 },
  vehicleName: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  removeText: { fontSize: 14, color: colors.danger, fontWeight: '800', paddingHorizontal: 4 },

  // Earnings note
  earningsNote: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  earningsNoteTitle: { fontSize: 12, fontWeight: '800', color: colors.text },
  earningsNoteText: { fontSize: 12, color: colors.muted, lineHeight: 20 },

  // Save button
  saveBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000bb',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingTop: 16,
    gap: 12,
  },
  modalHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
    opacity: 0.5,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  modalSub: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  modalInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.text,
    marginTop: 4,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancelBtn: {
    flex: 1,
    height: 50,
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  modalConfirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: { fontSize: 14, fontWeight: '900', color: '#fff' },
});
