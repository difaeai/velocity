import { useState } from 'react';
import {
  ActivityIndicator,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useRouter } from 'expo-router';

import { db } from '../src/firebase';
import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/config';

const GENDERS = ['Male', 'Female', 'Other'] as const;
type Gender = typeof GENDERS[number];

function ageFromDob(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export default function Onboarding() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date for the picker — 25 years ago
  const defaultPickerDate = new Date();
  defaultPickerDate.setFullYear(defaultPickerDate.getFullYear() - 25);

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() - 13); // minimum age 13

  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 100);

  async function save() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!gender)       { setError('Please select your gender.'); return; }
    if (!dob)          { setError('Please select your date of birth.'); return; }
    const age = ageFromDob(dob);
    if (age < 13)      { setError('You must be at least 13 years old.'); return; }

    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        phone: user.phoneNumber ?? null,
        name: name.trim(),
        gender: gender.toLowerCase(),
        dob: dob.toISOString(),
        age,
        role: 'passenger',
        profileComplete: true,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      });
      router.replace('/passenger/home');
    } catch (e) {
      setError('Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const pickerDate = dob ?? defaultPickerDate;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.logoRow}>
          <View style={styles.logo}><Text style={styles.logoText}>V</Text></View>
        </View>
        <Text style={styles.title}>One last step</Text>
        <Text style={styles.subtitle}>Tell us a little about yourself to get started.</Text>

        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Full name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Ali Hassan"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="words"
          />
        </View>

        {/* Gender */}
        <View style={styles.field}>
          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderRow}>
            {GENDERS.map((g) => (
              <Pressable
                key={g}
                style={[styles.genderBtn, gender === g && styles.genderBtnActive]}
                onPress={() => setGender(g)}
              >
                <Text style={[styles.genderBtnText, gender === g && styles.genderBtnTextActive]}>
                  {g === 'Male' ? '👨 ' : g === 'Female' ? '👩 ' : '🧑 '}{g}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Date of Birth */}
        <View style={styles.field}>
          <Text style={styles.label}>Date of birth</Text>
          <Pressable style={styles.dobBtn} onPress={() => setShowPicker(true)}>
            <Text style={styles.dobIcon}>📅</Text>
            <Text style={dob ? styles.dobText : styles.dobPlaceholder}>
              {dob
                ? `${dob.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}  (${ageFromDob(dob)} yrs)`
                : 'Select date of birth'}
            </Text>
          </Pressable>
        </View>

        {/* Android: inline picker shown via state */}
        {Platform.OS === 'android' && showPicker && (
          <DateTimePicker
            value={pickerDate}
            mode="date"
            display="calendar"
            maximumDate={maxDate}
            minimumDate={minDate}
            onChange={(_, selected) => {
              setShowPicker(false);
              if (selected) setDob(selected);
            }}
          />
        )}

        {/* iOS: picker in a modal */}
        {Platform.OS === 'ios' && (
          <Modal visible={showPicker} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Date of birth</Text>
                  <Pressable onPress={() => setShowPicker(false)}>
                    <Text style={styles.modalDone}>Done</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={pickerDate}
                  mode="date"
                  display="spinner"
                  maximumDate={maxDate}
                  minimumDate={minDate}
                  textColor="#ffffff"
                  onChange={(_, selected) => { if (selected) setDob(selected); }}
                  style={{ width: '100%' }}
                />
              </View>
            </View>
          </Modal>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.saveBtnText}>Get started →</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  container:  { padding: 24, gap: 20, flexGrow: 1, justifyContent: 'center' },
  logoRow:    { alignItems: 'center', marginBottom: 4 },
  logo:       { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText:   { fontSize: 36, fontWeight: '900', color: '#000' },
  title:      { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
  subtitle:   { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 8 },

  field:      { gap: 8 },
  label:      { fontSize: 13, fontWeight: '700', color: colors.text },
  input:      {
    height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.surface,
  },

  genderRow:  { flexDirection: 'row', gap: 10 },
  genderBtn:  {
    flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center',
  },
  genderBtnActive:     { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  genderBtnText:       { fontSize: 13, fontWeight: '700', color: colors.muted },
  genderBtnTextActive: { color: colors.primary },

  dobBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, paddingHorizontal: 16,
  },
  dobIcon:        { fontSize: 18 },
  dobText:        { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1 },
  dobPlaceholder: { fontSize: 15, color: colors.muted, flex: 1 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet:   { backgroundColor: '#1c1e1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  modalTitle:   { fontSize: 17, fontWeight: '800', color: colors.text },
  modalDone:    { fontSize: 16, fontWeight: '800', color: colors.primary },

  error:    { color: colors.danger, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  saveBtn:  {
    height: 54, borderRadius: 16, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  saveBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },
});
