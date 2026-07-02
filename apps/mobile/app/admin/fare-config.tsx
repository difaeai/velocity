import { useEffect, useState } from 'react';
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
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import {
  CityFareConfig,
  CategoryRates,
  VehicleCategory,
  DEFAULT_ISLAMABAD_RAWALPINDI,
  DEFAULT_KARACHI,
} from '../../src/lib/fareEngine';

const CITIES: { id: string; label: string; default: CityFareConfig }[] = [
  { id: 'islamabad_rawalpindi', label: 'Islamabad / Rawalpindi', default: DEFAULT_ISLAMABAD_RAWALPINDI },
  { id: 'karachi',              label: 'Karachi',                default: DEFAULT_KARACHI },
];

const CATEGORIES: { key: VehicleCategory; label: string; icon: string }[] = [
  { key: 'moto',     label: 'Moto',     icon: '🏍️' },
  { key: 'rickshaw', label: 'Rickshaw', icon: '🛺' },
  { key: 'mini',     label: 'Mini',     icon: '🚗' },
  { key: 'ac_car',   label: 'AC Car',   icon: '❄️' },
  { key: 'luxury',   label: 'Luxury',   icon: '⭐' },
];

const RATE_FIELDS: { key: keyof CategoryRates; label: string; unit: string; step: number }[] = [
  { key: 'base',          label: 'Base fare',         unit: 'PKR', step: 5  },
  { key: 'includedKm',    label: 'Included km',       unit: 'km',  step: 0.5},
  { key: 'includedMin',   label: 'Included minutes',  unit: 'min', step: 1  },
  { key: 'perKm',         label: 'Per km',            unit: 'PKR', step: 1  },
  { key: 'perMin',        label: 'Per minute',        unit: 'PKR', step: 1  },
  { key: 'minFare',       label: 'Minimum fare',      unit: 'PKR', step: 5  },
  { key: 'bidFloorPerKm', label: 'Bid floor / km',    unit: 'PKR', step: 1  },
  { key: 'freeWaitMin',   label: 'Free wait',         unit: 'min', step: 1  },
  { key: 'waitPerMin',    label: 'Wait charge / min', unit: 'PKR', step: 1  },
];

function RateField({
  label, unit, value, step, onChange,
}: {
  label: string; unit: string; value: number; step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => { setText(String(value)); }, [value]);

  return (
    <View style={styles.rateRow}>
      <Text style={styles.rateLabel}>{label}</Text>
      <View style={styles.rateControls}>
        <Pressable style={styles.rateBtn} onPress={() => onChange(Math.max(0, +(value - step).toFixed(2)))}>
          <Text style={styles.rateBtnText}>−</Text>
        </Pressable>
        <TextInput
          style={styles.rateInput}
          value={text}
          onChangeText={setText}
          onBlur={() => {
            const parsed = parseFloat(text);
            if (!isNaN(parsed) && parsed >= 0) onChange(parsed);
            else setText(String(value));
          }}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
        <Text style={styles.rateUnit}>{unit}</Text>
        <Pressable style={styles.rateBtn} onPress={() => onChange(+(value + step).toFixed(2))}>
          <Text style={styles.rateBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function FareConfig() {
  const router = useRouter();
  const [cityIdx, setCityIdx] = useState(0);
  const [catIdx,  setCatIdx]  = useState(0);
  const [config,  setConfig]  = useState<CityFareConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const city = CITIES[cityIdx]!;
  const cat  = CATEGORIES[catIdx]!;

  useEffect(() => {
    setLoading(true);
    setConfig(null);
    getDoc(doc(db, 'fareConfig', city.id))
      .then((snap) => {
        setConfig(snap.exists() ? (snap.data() as CityFareConfig) : null);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [city.id]);

  function updateRate(field: keyof CategoryRates, value: number) {
    const catKey = cat.key;
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: {
          ...prev.categories,
          [catKey]: { ...prev.categories[catKey], [field]: value },
        },
      };
    });
  }

  function updateGlobal(path: 'surge.maxMultiplier' | 'commission.rate', value: number) {
    setConfig((prev) => {
      if (!prev) return prev;
      if (path === 'surge.maxMultiplier') return { ...prev, surge: { ...prev.surge, maxMultiplier: value } };
      if (path === 'commission.rate')     return { ...prev, commission: { ...prev.commission, rate: value } };
      return prev;
    });
  }

  function useDefaults() {
    setConfig({ ...city.default, updatedAt: Date.now() });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'fareConfig', city.id), { ...config, updatedAt: Date.now() });
      Alert.alert('Saved', `Fare config for ${city.label} saved successfully.`);
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setSaving(false);
    }
  }

  const rates = config?.categories[cat.key];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.title}>Fare Configuration</Text>
        <Pressable
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving || !config}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>

      {/* City selector */}
      <View style={styles.segmentRow}>
        {CITIES.map((c, i) => (
          <Pressable
            key={c.id}
            style={[styles.segment, i === cityIdx && styles.segmentActive]}
            onPress={() => setCityIdx(i)}
          >
            <Text style={[styles.segmentText, i === cityIdx && styles.segmentTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : !config ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No config found for {city.label}</Text>
          <Pressable style={styles.defaultsBtn} onPress={useDefaults}>
            <Text style={styles.defaultsBtnText}>Use Default Rates</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }}>
          {/* Global settings card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Global Settings</Text>
            <RateField label="Commission rate (%)" unit="%" value={+(config.commission.rate * 100).toFixed(1)} step={0.5}
              onChange={(v) => updateGlobal('commission.rate', v / 100)} />
            <RateField label="Surge max multiplier" unit="×" value={config.surge.maxMultiplier} step={0.1}
              onChange={(v) => updateGlobal('surge.maxMultiplier', v)} />
            <RateField label="Pool: 2 riders factor (%)" unit="%" value={+((config.pooling.perRiderFactor[2] ?? 0.65) * 100)} step={5}
              onChange={(v) => setConfig((p) => p ? { ...p, pooling: { ...p.pooling, perRiderFactor: { ...p.pooling.perRiderFactor, 2: v / 100 } } } : p)} />
            <RateField label="Pool: 3 riders factor (%)" unit="%" value={+((config.pooling.perRiderFactor[3] ?? 0.5) * 100)} step={5}
              onChange={(v) => setConfig((p) => p ? { ...p, pooling: { ...p.pooling, perRiderFactor: { ...p.pooling.perRiderFactor, 3: v / 100 } } } : p)} />
            <RateField label="Pool: 4 riders factor (%)" unit="%" value={+((config.pooling.perRiderFactor[4] ?? 0.42) * 100)} step={5}
              onChange={(v) => setConfig((p) => p ? { ...p, pooling: { ...p.pooling, perRiderFactor: { ...p.pooling.perRiderFactor, 4: v / 100 } } } : p)} />
          </View>

          {/* Category tabs */}
          <View style={styles.catTabRow}>
            {CATEGORIES.map((c, i) => (
              <Pressable
                key={c.key}
                style={[styles.catTab, i === catIdx && styles.catTabActive]}
                onPress={() => setCatIdx(i)}
              >
                <Text style={styles.catTabIcon}>{c.icon}</Text>
                <Text style={[styles.catTabText, i === catIdx && styles.catTabTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Per-category rate fields */}
          {rates && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{cat.icon} {cat.label} — Rates</Text>
              <Text style={styles.cardHint}>
                Suggested fare = base + (km − includedKm) × perKm + (min − includedMin) × perMin
              </Text>
              {RATE_FIELDS.map((f) => (
                <RateField
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  value={rates[f.key] as number}
                  step={f.step}
                  onChange={(v) => updateRate(f.key, v)}
                />
              ))}

              {/* Live preview */}
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>Live Preview — 10 km / 25 min trip</Text>
                {(() => {
                  const r = rates;
                  const bKm  = Math.max(0, 10 - r.includedKm);
                  const bMin = Math.max(0, 25 - r.includedMin);
                  const sub  = Math.max(r.minFare, r.base + bKm * r.perKm + bMin * r.perMin);
                  const rec  = Math.round(sub / 5) * 5;
                  const floor= Math.round(Math.max(r.minFare, 10 * r.bidFloorPerKm) / 5) * 5;
                  return (
                    <>
                      <Text style={styles.previewLine}>Recommended: <Text style={styles.previewVal}>PKR {rec}</Text></Text>
                      <Text style={styles.previewLine}>Bid floor: <Text style={styles.previewVal}>PKR {floor}</Text></Text>
                      <Text style={styles.previewLine}>Driver net (7%): <Text style={styles.previewVal}>PKR {Math.round(rec * 0.93)}</Text></Text>
                    </>
                  );
                })()}
              </View>
            </View>
          )}

          <Pressable style={styles.defaultsBtn} onPress={useDefaults}>
            <Text style={styles.defaultsBtnText}>Reset to Default Rates</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#151616' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2d2f2f' },
  backBtn:{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt:{ color: '#fff', fontSize: 20 },
  title:  { flex: 1, fontSize: 17, fontWeight: '800', color: '#fff', marginLeft: 8 },
  saveBtn:{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { fontWeight: '900', fontSize: 13, color: '#000' },

  segmentRow: { flexDirection: 'row', margin: 16, backgroundColor: '#1c1e1e', borderRadius: 12, padding: 4 },
  segment:    { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText:   { fontSize: 12, fontWeight: '700', color: '#8a8c8c' },
  segmentTextActive: { color: '#000' },

  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText:  { color: '#8a8c8c', fontSize: 15, textAlign: 'center' },

  scroll: { flex: 1, paddingHorizontal: 16 },
  card:   { backgroundColor: '#1c1e1e', borderRadius: 16, padding: 16, marginBottom: 14, gap: 12 },
  cardTitle:{ fontSize: 15, fontWeight: '900', color: '#fff', marginBottom: 4 },
  cardHint: { fontSize: 11, color: '#8a8c8c', lineHeight: 16, marginBottom: 4 },

  catTabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  catTab:    { flex: 1, backgroundColor: '#1c1e1e', borderRadius: 10, padding: 8, alignItems: 'center', gap: 2 },
  catTabActive: { backgroundColor: '#1e3a10', borderWidth: 1, borderColor: colors.primary },
  catTabIcon: { fontSize: 18 },
  catTabText: { fontSize: 10, fontWeight: '700', color: '#8a8c8c' },
  catTabTextActive: { color: colors.primary },

  rateRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rateLabel:   { flex: 1, fontSize: 13, color: '#ccc', fontWeight: '600' },
  rateControls:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  rateBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2d2f2f', alignItems: 'center', justifyContent: 'center' },
  rateBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  rateInput:   { width: 56, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '800', backgroundColor: '#0e1505', borderRadius: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#2d4010' },
  rateUnit:    { fontSize: 11, color: '#8a8c8c', width: 26 },

  previewBox:  { backgroundColor: '#0a1505', borderRadius: 10, padding: 12, gap: 4, marginTop: 4 },
  previewTitle:{ fontSize: 12, fontWeight: '800', color: '#8cc840', marginBottom: 4 },
  previewLine: { fontSize: 13, color: '#ccc' },
  previewVal:  { fontWeight: '900', color: colors.primary },

  defaultsBtn:     { backgroundColor: '#1c1e1e', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  defaultsBtnText: { color: '#8a8c8c', fontWeight: '700', fontSize: 13 },
});
