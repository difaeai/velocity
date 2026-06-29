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
import { doc, onSnapshot } from 'firebase/firestore';

import { db as firestoreDb } from '../../src/firebase';
import { api } from '../../src/api/client';
import type { PoolGenderPref, CommuteDay } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';

const DAYS: { key: CommuteDay; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const GENDER_OPTIONS: { key: PoolGenderPref; label: string; icon: string }[] = [
  { key: 'any',         label: 'Open to all',  icon: '👥' },
  { key: 'male_only',   label: 'Males only',   icon: '♂' },
  { key: 'female_only', label: 'Females only', icon: '♀' },
];

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const parts = value.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);

  function cycleHour(dir: 1 | -1) {
    const next = ((h + dir + 24) % 24);
    onChange(`${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  function cycleMin(dir: 1 | -1) {
    const mins = [0, 15, 30, 45];
    const idx = mins.indexOf(m);
    const next = mins[((idx + dir + 4) % 4)] ?? 0;
    onChange(`${String(h).padStart(2, '0')}:${String(next).padStart(2, '0')}`);
  }
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;

  return (
    <View style={timeStyles.wrap}>
      <Text style={timeStyles.label}>{label}</Text>
      <View style={timeStyles.row}>
        <View style={timeStyles.picker}>
          <Pressable onPress={() => cycleHour(1)} style={timeStyles.btn}><Text style={timeStyles.btnTxt}>▲</Text></Pressable>
          <Text style={timeStyles.val}>{String(h12).padStart(2, '0')}</Text>
          <Pressable onPress={() => cycleHour(-1)} style={timeStyles.btn}><Text style={timeStyles.btnTxt}>▼</Text></Pressable>
        </View>
        <Text style={timeStyles.sep}>:</Text>
        <View style={timeStyles.picker}>
          <Pressable onPress={() => cycleMin(1)} style={timeStyles.btn}><Text style={timeStyles.btnTxt}>▲</Text></Pressable>
          <Text style={timeStyles.val}>{String(m).padStart(2, '0')}</Text>
          <Pressable onPress={() => cycleMin(-1)} style={timeStyles.btn}><Text style={timeStyles.btnTxt}>▼</Text></Pressable>
        </View>
        <Text style={timeStyles.ampm}>{ampm}</Text>
      </View>
    </View>
  );
}

const timeStyles = StyleSheet.create({
  wrap:    { gap: 6 },
  label:   { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  picker:  { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, gap: 2 },
  btn:     { paddingHorizontal: 10, paddingVertical: 2 },
  btnTxt:  { fontSize: 13, color: colors.muted, fontWeight: '700' },
  val:     { fontSize: 26, fontWeight: '900', color: colors.text, width: 42, textAlign: 'center' },
  sep:     { fontSize: 22, fontWeight: '900', color: colors.text, marginBottom: 4 },
  ampm:    { fontSize: 16, fontWeight: '800', color: colors.muted, marginBottom: 2 },
});

export default function CommuteScheduleScreen() {
  const router    = useRouter();
  const { user }  = useAuth();

  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  const [homeAreaName, setHomeAreaName]   = useState('');
  const [destAreaName, setDestAreaName]   = useState('');
  const [morningTime, setMorningTime]     = useState('08:00');
  const [eveningTime, setEveningTime]     = useState<string | null>(null);
  const [activeDays, setActiveDays]       = useState<CommuteDay[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [genderPref, setGenderPref]       = useState<PoolGenderPref>('any');
  const [active, setActive]               = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(firestoreDb, 'commuteSchedules', user.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setHomeAreaName(d.homeAreaName ?? '');
        setDestAreaName(d.destinationAreaName ?? '');
        setMorningTime(d.morningTime ?? '08:00');
        setEveningTime(d.eveningTime ?? null);
        setActiveDays((d.activeDays as CommuteDay[]) ?? ['mon', 'tue', 'wed', 'thu', 'fri']);
        setGenderPref((d.genderPref as PoolGenderPref) ?? 'any');
        setActive(d.active ?? true);
        setHasExisting(true);
      }
      setLoading(false);
    });
    return unsub;
  }, [user?.uid]);

  function toggleDay(day: CommuteDay) {
    setActiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  async function save() {
    if (!homeAreaName.trim()) { Alert.alert('Required', 'Enter your home area name.'); return; }
    if (!destAreaName.trim()) { Alert.alert('Required', 'Enter your destination area name.'); return; }
    if (activeDays.length === 0) { Alert.alert('Required', 'Select at least one active day.'); return; }

    setSaving(true);
    try {
      await api.upsertCommuteSchedule({
        homeAreaName:        homeAreaName.trim(),
        homeLat:             0,
        homeLng:             0,
        destinationAreaName: destAreaName.trim(),
        destinationLat:      0,
        destinationLng:      0,
        morningTime,
        eveningTime,
        activeDays,
        genderPref,
        active,
      });
      Alert.alert('Saved!', 'Your commute schedule has been saved. Drivers in your area will see anonymised demand data — never your personal details.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule() {
    Alert.alert('Delete Schedule?', 'Remove your commute schedule? Drivers will no longer see demand from your area.', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deleteCommuteSchedule({});
            setHasExisting(false);
            setHomeAreaName('');
            setDestAreaName('');
            setActiveDays(['mon', 'tue', 'wed', 'thu', 'fri']);
            Alert.alert('Deleted', 'Your commute schedule has been removed.');
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Failed to delete.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Commute Schedule</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.privacyCard}>
          <Text style={styles.privacyTitle}>Your privacy is protected</Text>
          <Text style={styles.privacyText}>
            Drivers only see that "A user is going to [Area] at 8:30 AM" — never your name, exact home address, or UID. This helps drivers position themselves without exposing you.
          </Text>
        </View>

        {/* Active toggle */}
        <View style={styles.section}>
          <View style={styles.activeRow}>
            <View>
              <Text style={styles.sectionTitle}>SCHEDULE ACTIVE</Text>
              <Text style={styles.helperText}>Drivers can see your demand when active.</Text>
            </View>
            <Pressable
              style={[styles.toggle, active && styles.toggleOn]}
              onPress={() => setActive((v) => !v)}
            >
              <View style={[styles.toggleKnob, active && styles.toggleKnobOn]} />
            </Pressable>
          </View>
        </View>

        {/* Route */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR COMMUTE ROUTE</Text>
          <Text style={styles.helperText}>Use general area names, not your exact street address.</Text>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Home area (e.g. F-7, Islamabad)"
                placeholderTextColor={colors.muted}
                value={homeAreaName}
                onChangeText={setHomeAreaName}
              />
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Destination area (e.g. Blue Area)"
                placeholderTextColor={colors.muted}
                value={destAreaName}
                onChangeText={setDestAreaName}
              />
            </View>
          </View>
        </View>

        {/* Morning time */}
        <View style={styles.section}>
          <TimeInput value={morningTime} onChange={setMorningTime} label="MORNING DEPARTURE TIME" />
        </View>

        {/* Evening time */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>EVENING RETURN TIME (OPTIONAL)</Text>
          {eveningTime === null ? (
            <Pressable style={styles.addEveningBtn} onPress={() => setEveningTime('17:00')}>
              <Text style={styles.addEveningText}>+ Add return time</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              <TimeInput value={eveningTime} onChange={setEveningTime} label="" />
              <Pressable onPress={() => setEveningTime(null)}>
                <Text style={styles.removeText}>Remove evening time</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Active days */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACTIVE DAYS</Text>
          <View style={styles.daysRow}>
            {DAYS.map((d) => (
              <Pressable
                key={d.key}
                style={[styles.dayBtn, activeDays.includes(d.key) && styles.dayBtnActive]}
                onPress={() => toggleDay(d.key)}
              >
                <Text style={[styles.dayBtnText, activeDays.includes(d.key) && styles.dayBtnTextActive]}>
                  {d.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Gender preference */}
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
                <Text style={[styles.genderLabel, genderPref === opt.key && { color: colors.primary }]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.saveBtnText}>{hasExisting ? 'Update Schedule' : 'Save Schedule'}</Text>
          }
        </Pressable>

        {hasExisting && (
          <Pressable style={styles.deleteBtn} onPress={deleteSchedule} disabled={deleting}>
            {deleting
              ? <ActivityIndicator size="small" color="#ef4444" />
              : <Text style={styles.deleteBtnText}>Remove my commute schedule</Text>
            }
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:        { width: 40 },
  backArrow:      { fontSize: 24, color: colors.text },
  headerTitle:    { fontSize: 17, fontWeight: '800', color: colors.text },

  container:      { padding: 16, gap: 4, paddingBottom: 40 },
  section:        { gap: 8, marginBottom: 14 },
  sectionTitle:   { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  helperText:     { fontSize: 12, color: colors.muted, lineHeight: 17 },

  privacyCard:    { backgroundColor: '#0d1a06', borderRadius: 14, borderWidth: 1, borderColor: `${colors.primary}30`, padding: 14, marginBottom: 14 },
  privacyTitle:   { fontSize: 13, fontWeight: '800', color: colors.primary, marginBottom: 6 },
  privacyText:    { fontSize: 12, color: colors.muted, lineHeight: 18 },

  activeRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle:         { width: 52, height: 30, borderRadius: 15, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:       { backgroundColor: colors.primary },
  toggleKnob:     { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.muted },
  toggleKnobOn:   { backgroundColor: '#000', alignSelf: 'flex-end' },

  routeCard:      { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot:            { width: 10, height: 10, borderRadius: 5 },
  routeInput:     { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  routeDivider:   { height: 1, backgroundColor: colors.border, marginLeft: 34 },

  addEveningBtn:  { height: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  addEveningText: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  removeText:     { fontSize: 12, color: '#ef4444', textAlign: 'center' },

  daysRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayBtn:         { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dayBtnActive:   { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  dayBtnText:     { fontSize: 13, fontWeight: '700', color: colors.muted },
  dayBtnTextActive: { color: colors.primary },

  genderList:     { gap: 8 },
  genderOpt:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  genderOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  genderIcon:     { fontSize: 20, width: 28, textAlign: 'center' },
  genderLabel:    { fontSize: 14, fontWeight: '700', color: colors.text },

  saveBtn:        { height: 56, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText:    { color: '#000', fontSize: 17, fontWeight: '900' },
  deleteBtn:      { height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  deleteBtnText:  { fontSize: 13, color: '#ef4444', fontWeight: '700' },
});
