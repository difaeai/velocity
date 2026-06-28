/**
 * Travel Mate — profile setup / edit screen.
 *
 * Loaded when the user taps "Travel Mate" for the first time (no profile yet)
 * or from the swipe deck's gear icon to edit an existing profile.
 */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api, type TravelMateDay, type UpsertTravelMateInput } from '../../../src/api/client';
import { useCurrentLocation } from '../../../src/hooks/location';
import { colors } from '../../../src/config';
import { Card, PrimaryButton } from '../../../src/ui/components';

const DAYS: { key: TravelMateDay; label: string }[] = [
  { key: 'mon', label: 'Mo' },
  { key: 'tue', label: 'Tu' },
  { key: 'wed', label: 'We' },
  { key: 'thu', label: 'Th' },
  { key: 'fri', label: 'Fr' },
  { key: 'sat', label: 'Sa' },
  { key: 'sun', label: 'Su' },
];

const DEST_TYPES: { key: 'office' | 'university' | 'other'; label: string }[] = [
  { key: 'office', label: 'Office' },
  { key: 'university', label: 'University' },
  { key: 'other', label: 'Other' },
];

export default function TravelMateSetup() {
  const { user } = useAuth();
  const router = useRouter();
  const homeLocation = useCurrentLocation(false);
  const destLocation = useCurrentLocation(false);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [genderPref, setGenderPref] = useState<'male' | 'female' | 'any'>('any');
  const [bio, setBio] = useState('');

  const [homeLat, setHomeLat] = useState('');
  const [homeLng, setHomeLng] = useState('');
  const [homeAddress, setHomeAddress] = useState('');

  const [destType, setDestType] = useState<'office' | 'university' | 'other'>('office');
  const [destName, setDestName] = useState('');
  const [destLat, setDestLat] = useState('');
  const [destLng, setDestLng] = useState('');
  const [destAddress, setDestAddress] = useState('');

  const [days, setDays] = useState<TravelMateDay[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [departTime, setDepartTime] = useState('08:00');
  const [returnTime, setReturnTime] = useState('17:00');

  const [active, setActive] = useState(true);
  const [copyRidePhoto, setCopyRidePhoto] = useState(true);

  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from existing profile if the user already set one up.
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'travelMateProfiles', user.uid))
      .then(snap => {
        if (!snap.exists()) return;
        const d = snap.data();
        setDisplayName(d.displayName ?? '');
        setGender(d.gender ?? 'male');
        setGenderPref(d.genderPreference ?? 'any');
        setBio(d.bio ?? '');
        if (d.home) {
          setHomeLat(String(d.home.lat ?? ''));
          setHomeLng(String(d.home.lng ?? ''));
          setHomeAddress(d.home.address ?? '');
        }
        if (d.destination) {
          setDestType(d.destination.type ?? 'office');
          setDestName(d.destination.name ?? '');
          setDestLat(String(d.destination.lat ?? ''));
          setDestLng(String(d.destination.lng ?? ''));
          setDestAddress(d.destination.address ?? '');
        }
        if (d.schedule) {
          setDays(d.schedule.days ?? []);
          setDepartTime(d.schedule.departTime ?? '08:00');
          setReturnTime(d.schedule.returnTime ?? '17:00');
        }
        setActive(d.active !== false);
        setCopyRidePhoto(false); // they already have a TM photo
      })
      .catch(() => {})
      .finally(() => setPrefilling(false));
  }, [user?.uid]);

  // Pre-fill display name from auth user when not editing an existing profile.
  useEffect(() => {
    if (!prefilling && !displayName && user?.displayName) {
      setDisplayName(user.displayName);
    }
  }, [prefilling]);

  // Apply location from GPS when "Use current location" is tapped.
  useEffect(() => {
    if (homeLocation.coords) {
      setHomeLat(String(homeLocation.coords.lat));
      setHomeLng(String(homeLocation.coords.lng));
      if (homeLocation.address) setHomeAddress(homeLocation.address);
    }
  }, [homeLocation.coords]);

  useEffect(() => {
    if (destLocation.coords) {
      setDestLat(String(destLocation.coords.lat));
      setDestLng(String(destLocation.coords.lng));
      if (destLocation.address) setDestAddress(destLocation.address);
    }
  }, [destLocation.coords]);

  function toggleDay(key: TravelMateDay) {
    setDays(prev =>
      prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key],
    );
  }

  function validate(): string | null {
    if (!displayName.trim()) return 'Enter your name.';
    const lat = parseFloat(homeLat);
    const lng = parseFloat(homeLng);
    if (isNaN(lat) || isNaN(lng)) return 'Set your home location.';
    const dlat = parseFloat(destLat);
    const dlng = parseFloat(destLng);
    if (isNaN(dlat) || isNaN(dlng)) return 'Set your destination location.';
    if (!destName.trim()) return 'Enter your destination name.';
    if (days.length === 0) return 'Pick at least one commute day.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(departTime)) return 'Depart time must be HH:MM (e.g. 08:30).';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(returnTime)) return 'Return time must be HH:MM (e.g. 17:30).';
    return null;
  }

  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setLoading(true);
    try {
      const input: UpsertTravelMateInput = {
        displayName: displayName.trim(),
        gender,
        genderPreference: genderPref,
        bio: bio.trim(),
        home: { lat: parseFloat(homeLat), lng: parseFloat(homeLng), address: homeAddress.trim() },
        destination: {
          type: destType,
          name: destName.trim(),
          lat: parseFloat(destLat),
          lng: parseFloat(destLng),
          address: destAddress.trim(),
        },
        schedule: { days, departTime, returnTime },
        active,
        copyRidePhoto,
      };
      await api.upsertTravelMateProfile(input);
      router.replace('/passenger/travel-mate');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save. Try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (prefilling) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.muted}>Loading your profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={s.header}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <Text style={s.backText}>←</Text>
            </Pressable>
            <Text style={s.title}>Travel Mate profile</Text>
          </View>
          <Text style={s.subtitle}>
            This profile is separate from your ride identity. Your home address is never shown to other commuters.
          </Text>

          {/* About you */}
          <Card>
            <Text style={s.sectionTitle}>About you</Text>
            <Field label="Display name">
              <TextInput
                style={s.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="e.g. Fatima A."
                placeholderTextColor={colors.muted}
              />
            </Field>
            <Field label="Bio (optional)">
              <TextInput
                style={[s.input, s.multiline]}
                value={bio}
                onChangeText={setBio}
                placeholder="Student at FAST, commuting to Gulshan…"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                maxLength={200}
              />
            </Field>
            <Field label="Your gender">
              <Pills
                options={[{ key: 'male', label: 'Male' }, { key: 'female', label: 'Female' }]}
                selected={gender}
                onSelect={v => setGender(v as 'male' | 'female')}
              />
            </Field>
            <Field label="Preferred co-commuter gender">
              <Pills
                options={[
                  { key: 'male', label: 'Male' },
                  { key: 'female', label: 'Female' },
                  { key: 'any', label: 'Any' },
                ]}
                selected={genderPref}
                onSelect={v => setGenderPref(v as 'male' | 'female' | 'any')}
              />
            </Field>
            <View style={s.row}>
              <Text style={s.label}>Use my Velocity profile photo</Text>
              <Switch
                value={copyRidePhoto}
                onValueChange={setCopyRidePhoto}
                trackColor={{ true: colors.primary }}
                thumbColor={copyRidePhoto ? '#000' : colors.muted}
              />
            </View>
          </Card>

          {/* Home location */}
          <Card>
            <Text style={s.sectionTitle}>Home area</Text>
            <Text style={s.hint}>Approximate neighbourhood — never shown to others.</Text>
            <View style={s.locRow}>
              <TextInput
                style={[s.input, s.coordInput]}
                value={homeLat}
                onChangeText={setHomeLat}
                placeholder="Lat"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
              <TextInput
                style={[s.input, s.coordInput]}
                value={homeLng}
                onChangeText={setHomeLng}
                placeholder="Lng"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
              <Pressable
                style={s.gpsBtn}
                onPress={homeLocation.request}
                disabled={homeLocation.status === 'loading'}
              >
                <Text style={s.gpsBtnText}>
                  {homeLocation.status === 'loading' ? '…' : '📍 GPS'}
                </Text>
              </Pressable>
            </View>
            <TextInput
              style={s.input}
              value={homeAddress}
              onChangeText={setHomeAddress}
              placeholder="Neighbourhood / area (optional)"
              placeholderTextColor={colors.muted}
            />
          </Card>

          {/* Destination */}
          <Card>
            <Text style={s.sectionTitle}>Destination</Text>
            <Field label="Type">
              <Pills
                options={DEST_TYPES.map(t => ({ key: t.key, label: t.label }))}
                selected={destType}
                onSelect={v => setDestType(v as 'office' | 'university' | 'other')}
              />
            </Field>
            <Field label="Name">
              <TextInput
                style={s.input}
                value={destName}
                onChangeText={setDestName}
                placeholder="e.g. Systems Ltd, Karachi"
                placeholderTextColor={colors.muted}
              />
            </Field>
            <View style={s.locRow}>
              <TextInput
                style={[s.input, s.coordInput]}
                value={destLat}
                onChangeText={setDestLat}
                placeholder="Lat"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
              <TextInput
                style={[s.input, s.coordInput]}
                value={destLng}
                onChangeText={setDestLng}
                placeholder="Lng"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
              <Pressable
                style={s.gpsBtn}
                onPress={destLocation.request}
                disabled={destLocation.status === 'loading'}
              >
                <Text style={s.gpsBtnText}>
                  {destLocation.status === 'loading' ? '…' : '📍 GPS'}
                </Text>
              </Pressable>
            </View>
            <TextInput
              style={s.input}
              value={destAddress}
              onChangeText={setDestAddress}
              placeholder="Full address (optional)"
              placeholderTextColor={colors.muted}
            />
          </Card>

          {/* Schedule */}
          <Card>
            <Text style={s.sectionTitle}>Commute schedule</Text>
            <Text style={s.label}>Days</Text>
            <View style={s.daysRow}>
              {DAYS.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[s.dayPill, days.includes(key) && s.dayPillActive]}
                  onPress={() => toggleDay(key)}
                >
                  <Text style={[s.dayPillText, days.includes(key) && s.dayPillTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.timeRow}>
              <Field label="Depart" style={{ flex: 1 }}>
                <TextInput
                  style={s.input}
                  value={departTime}
                  onChangeText={setDepartTime}
                  placeholder="08:00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </Field>
              <Field label="Return" style={{ flex: 1 }}>
                <TextInput
                  style={s.input}
                  value={returnTime}
                  onChangeText={setReturnTime}
                  placeholder="17:00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </Field>
            </View>
          </Card>

          {/* Active toggle */}
          <Card>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Show me in the feed</Text>
                <Text style={s.hint}>Turn off to pause matching temporarily.</Text>
              </View>
              <Switch
                value={active}
                onValueChange={setActive}
                trackColor={{ true: colors.primary }}
                thumbColor={active ? '#000' : colors.muted}
              />
            </View>
          </Card>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <PrimaryButton label="Save Travel Mate profile" onPress={save} loading={loading} />

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Small helper components ────────────────────────────────────────────────────

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

function Pills({
  options,
  selected,
  onSelect,
}: {
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={s.pillRow}>
      {options.map(o => (
        <Pressable
          key={o.key}
          style={[s.pill, o.key === selected && s.pillActive]}
          onPress={() => onSelect(o.key)}
        >
          <Text style={[s.pillText, o.key === selected && s.pillTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  scroll:         { padding: 20, gap: 14, paddingBottom: 40 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:       { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:          { fontSize: 22, fontWeight: '900', color: colors.text },
  subtitle:       { fontSize: 13, color: colors.muted, marginBottom: 4, lineHeight: 18 },
  sectionTitle:   { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  label:          { fontSize: 13, fontWeight: '700', color: colors.text },
  hint:           { fontSize: 11, color: colors.muted, marginBottom: 4 },
  muted:          { color: colors.muted, fontSize: 14 },
  input:          { height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.surface },
  multiline:      { height: 72, paddingTop: 12, textAlignVertical: 'top' },
  row:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeRow:        { flexDirection: 'row', gap: 12 },
  locRow:         { flexDirection: 'row', gap: 8, alignItems: 'center' },
  coordInput:     { flex: 1 },
  gpsBtn:         { height: 46, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.primary}18` },
  gpsBtnText:     { fontSize: 12, fontWeight: '800', color: colors.primary },
  pillRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive:     { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  pillText:       { fontSize: 13, fontWeight: '700', color: colors.muted },
  pillTextActive: { color: colors.primary },
  daysRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  dayPill:        { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dayPillActive:  { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  dayPillText:    { fontSize: 12, fontWeight: '800', color: colors.muted },
  dayPillTextActive: { color: colors.primary },
  error:          { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
