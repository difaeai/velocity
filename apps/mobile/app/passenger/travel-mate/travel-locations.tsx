/**
 * Travel Partner — travel locations editor.
 *
 * Where the user usually STARTS rides from ("home" pins — not necessarily
 * their house: the pin is wherever they are when they book, e.g. a coffee
 * shop) and where they usually TRAVEL TO. Both lists take multiple places.
 *
 * These pins are saved on travelMateProfiles/{uid}.travelPrefs and shown to
 * other Travel Partner users so potential partners (and riders) can see where the
 * user usually travels — none of them are permanent addresses.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCurrentLocation } from '../../../src/hooks/location';
import { usePlacesAutocomplete, fetchPlaceDetail, type PlacePrediction } from '../../../src/hooks/places';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

const MAX_LOCATIONS = 5;

// Places API (New) requires session tokens to be UUID v4
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface TravelPoint {
  lat: number;
  lng: number;
  label: string;
}

export default function TravelLocations() {
  const { user } = useAuth();
  const router = useRouter();
  const { coords, address: gpsAddress, request: requestLocation } = useCurrentLocation();

  const [homeLocs, setHomeLocs]     = useState<TravelPoint[]>([]);
  const [travelLocs, setTravelLocs] = useState<TravelPoint[]>([]);
  const [homeQuery, setHomeQuery]     = useState('');
  const [travelQuery, setTravelQuery] = useState('');
  const [activeField, setActiveField] = useState<'home' | 'travel' | null>(null);
  const [saving, setSaving]           = useState(false);
  const [loading, setLoading]         = useState(true);

  const sessionTokenRef = useRef(uuidv4());
  const { predictions } = usePlacesAutocomplete(
    activeField === 'home' ? homeQuery : activeField === 'travel' ? travelQuery : '',
    sessionTokenRef.current,
  );

  // Prefill from the saved profile.
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    getDoc(doc(db, 'travelMateProfiles', user.uid))
      .then(snap => {
        const prefs = snap.data()?.travelPrefs as
          | { homeLocations?: TravelPoint[]; travelToLocations?: TravelPoint[] }
          | undefined;
        if (prefs?.homeLocations) setHomeLocs(prefs.homeLocations);
        if (prefs?.travelToLocations) setTravelLocs(prefs.travelToLocations);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.uid]);

  function addPoint(kind: 'home' | 'travel', point: TravelPoint) {
    const [list, setList] = kind === 'home'
      ? [homeLocs, setHomeLocs] as const
      : [travelLocs, setTravelLocs] as const;
    if (list.length >= MAX_LOCATIONS) {
      Alert.alert('Limit reached', `You can save up to ${MAX_LOCATIONS} locations here. Remove one first.`);
      return;
    }
    // Skip near-duplicates (same label or within ~100 m).
    const dup = list.some(p =>
      p.label === point.label ||
      (Math.abs(p.lat - point.lat) < 0.001 && Math.abs(p.lng - point.lng) < 0.001));
    if (dup) {
      Alert.alert('Already added', 'That place is already in your list.');
      return;
    }
    setList([...list, point]);
  }

  function removePoint(kind: 'home' | 'travel', index: number) {
    if (kind === 'home') setHomeLocs(homeLocs.filter((_, i) => i !== index));
    else setTravelLocs(travelLocs.filter((_, i) => i !== index));
  }

  async function selectPrediction(pred: PlacePrediction) {
    const kind = activeField;
    if (!kind) return;
    const detail = await fetchPlaceDetail(pred.placeId, sessionTokenRef.current);
    sessionTokenRef.current = uuidv4(); // rotate token after detail call closes the billing session
    if (!detail) {
      Alert.alert('Could not load place', 'Please try another suggestion.');
      return;
    }
    addPoint(kind, { lat: detail.lat, lng: detail.lng, label: pred.fullText || detail.address });
    if (kind === 'home') setHomeQuery('');
    else setTravelQuery('');
    setActiveField(null);
  }

  function addCurrentPin(kind: 'home' | 'travel') {
    if (!coords) {
      Alert.alert(
        'Location needed',
        'Enable location access to drop a pin where you are right now.',
        [{ text: 'Cancel' }, { text: 'Enable', onPress: requestLocation }],
      );
      return;
    }
    addPoint(kind, {
      lat: coords.lat,
      lng: coords.lng,
      label: gpsAddress ?? 'My current pin location',
    });
  }

  async function save() {
    if (!user) return;
    if (homeLocs.length === 0 && travelLocs.length === 0) {
      Alert.alert('Add a location', 'Add at least one starting point or travel-to place, or go back to skip for now.');
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'travelMateProfiles', user.uid),
        {
          travelPrefs: {
            homeLocations: homeLocs,
            travelToLocations: travelLocs,
          },
          travelPrefsUpdatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      Alert.alert(
        'Saved ✓',
        'Your travel locations are set. Other Travel Partner users can now see where you usually travel and find you as a partner.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><Text style={s.muted}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  const showPredictionsFor = activeField && predictions.length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <Text style={s.backText}>←</Text>
            </Pressable>
            <Text style={s.title}>My travel locations</Text>
          </View>
          <Text style={s.subtitle}>
            These pins help other Travel Partner users guess your routes and find you as a
            partner — and help riders see where you usually go. They're not permanent:
            update them any time.
          </Text>

          {/* Home / starting locations */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>🏠 I usually start rides from</Text>
            <Text style={s.hint}>
              Your pin location when you book — it can be a coffee shop, campus or office,
              not necessarily your home address. Add up to {MAX_LOCATIONS}.
            </Text>

            {homeLocs.map((p, i) => (
              <View key={`${p.label}-${i}`} style={s.locRow}>
                <Text style={s.locPin}>📍</Text>
                <Text style={s.locLabel} numberOfLines={1}>{p.label}</Text>
                <Pressable onPress={() => removePoint('home', i)} hitSlop={10}>
                  <Text style={s.locRemove}>✕</Text>
                </Pressable>
              </View>
            ))}

            <Pressable style={s.pinBtn} onPress={() => addCurrentPin('home')}>
              <Text style={s.pinBtnText}>📍 Use my current pin location</Text>
            </Pressable>

            <TextInput
              style={s.input}
              value={homeQuery}
              onChangeText={t => { setHomeQuery(t); setActiveField('home'); }}
              onFocus={() => setActiveField('home')}
              placeholder="Search a starting area…"
              placeholderTextColor={colors.muted}
            />
            {showPredictionsFor && activeField === 'home' && (
              <View style={s.predictionsBox}>
                {predictions.slice(0, 5).map(pred => (
                  <Pressable key={pred.placeId} style={s.predictionRow} onPress={() => selectPrediction(pred)}>
                    <Text style={s.predictionMain} numberOfLines={1}>{pred.mainText}</Text>
                    {!!pred.secondaryText && (
                      <Text style={s.predictionSub} numberOfLines={1}>{pred.secondaryText}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Travel-to locations */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>🧭 I usually travel to</Text>
            <Text style={s.hint}>
              The places you head to most — office, university, markaz. Add up to {MAX_LOCATIONS}.
            </Text>

            {travelLocs.map((p, i) => (
              <View key={`${p.label}-${i}`} style={s.locRow}>
                <Text style={s.locPin}>🏁</Text>
                <Text style={s.locLabel} numberOfLines={1}>{p.label}</Text>
                <Pressable onPress={() => removePoint('travel', i)} hitSlop={10}>
                  <Text style={s.locRemove}>✕</Text>
                </Pressable>
              </View>
            ))}

            <Pressable style={s.pinBtn} onPress={() => addCurrentPin('travel')}>
              <Text style={s.pinBtnText}>📍 Use my current pin location</Text>
            </Pressable>

            <TextInput
              style={s.input}
              value={travelQuery}
              onChangeText={t => { setTravelQuery(t); setActiveField('travel'); }}
              onFocus={() => setActiveField('travel')}
              placeholder="Search a destination…"
              placeholderTextColor={colors.muted}
            />
            {showPredictionsFor && activeField === 'travel' && (
              <View style={s.predictionsBox}>
                {predictions.slice(0, 5).map(pred => (
                  <Pressable key={pred.placeId} style={s.predictionRow} onPress={() => selectPrediction(pred)}>
                    <Text style={s.predictionMain} numberOfLines={1}>{pred.mainText}</Text>
                    {!!pred.secondaryText && (
                      <Text style={s.predictionSub} numberOfLines={1}>{pred.secondaryText}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save my travel locations'}</Text>
          </Pressable>

          <Pressable style={s.skipBtn} onPress={() => router.back()}>
            <Text style={s.skipBtnText}>Skip for now</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.background },
  scroll:   { padding: 20, gap: 16, paddingBottom: 40 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted:    { color: colors.muted, fontSize: 14 },

  header:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:    { fontSize: 20, fontWeight: '900', color: colors.text, flex: 1 },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  card:         { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  hint:         { fontSize: 11, color: colors.muted, lineHeight: 16 },

  locRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  locPin:    { fontSize: 14 },
  locLabel:  { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  locRemove: { fontSize: 14, color: colors.muted, fontWeight: '900' },

  pinBtn:     { borderRadius: 10, borderWidth: 1.5, borderColor: `${colors.primary}55`, backgroundColor: `${colors.primary}14`, paddingVertical: 10, alignItems: 'center' },
  pinBtnText: { fontSize: 13, fontWeight: '800', color: colors.primary },

  input: { height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },

  predictionsBox: { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  predictionRow:  { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  predictionMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  predictionSub:  { fontSize: 11, color: colors.muted },

  saveBtn:     { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '900', color: '#000' },
  skipBtn:     { alignItems: 'center', paddingVertical: 8 },
  skipBtnText: { fontSize: 13, fontWeight: '700', color: colors.muted },
}));
