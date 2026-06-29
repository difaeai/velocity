import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useRouter } from 'expo-router';

import { db, storage } from '../src/firebase';
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

const DEFAULT_DOB = new Date();
DEFAULT_DOB.setFullYear(DEFAULT_DOB.getFullYear() - 25);

const MAX_DATE = new Date();
MAX_DATE.setFullYear(MAX_DATE.getFullYear() - 13);

const MIN_DATE = new Date();
MIN_DATE.setFullYear(MIN_DATE.getFullYear() - 100);

export default function Onboarding() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName]               = useState('');
  const [gender, setGender]           = useState<Gender | null>(null);
  const [dob, setDob]                 = useState<Date | null>(null);
  const [pickerTemp, setPickerTemp]   = useState<Date>(DEFAULT_DOB);
  const [showPicker, setShowPicker]   = useState(false);
  const [photoUri, setPhotoUri]       = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Camera roll access is needed to upload a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setError(null);
    }
  }

  async function uploadPhoto(uid: string): Promise<string | null> {
    if (!photoUri) return null;
    setUploadProgress('Uploading photo…');
    try {
      const resp = await fetch(photoUri);
      const blob = await resp.blob();
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
      return await getDownloadURL(storageRef);
    } catch {
      return null;
    } finally {
      setUploadProgress(null);
    }
  }

  async function save() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!gender)       { setError('Please select your gender.'); return; }
    if (!dob)          { setError('Please select your date of birth.'); return; }
    const age = ageFromDob(dob);
    if (age < 13)      { setError('You must be at least 13 years old.'); return; }
    if (!user)         return;

    setSaving(true);
    setError(null);
    try {
      const photoURL = await uploadPhoto(user.uid);

      // updateDoc only sends the fields we provide — no overwrite of uid/phone/role.
      // onUserCreate trigger already created the doc so this is always an update.
      const patch: Record<string, unknown> = {
        name:            name.trim(),
        gender:          gender.toLowerCase(),
        dob:             dob.toISOString(),
        age,
        profileComplete: true,
        lastActive:      serverTimestamp(),
        updatedAt:       serverTimestamp(),
      };
      if (photoURL) patch.photoURL = photoURL;

      await updateDoc(doc(db, 'users', user.uid), patch);
      router.replace('/passenger/home');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  function openPicker() {
    setPickerTemp(dob ?? DEFAULT_DOB);
    setShowPicker(true);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.logoRow}>
          <View style={styles.logo}><Text style={styles.logoText}>V</Text></View>
        </View>
        <Text style={styles.title}>One last step</Text>
        <Text style={styles.subtitle}>Tell us a little about yourself to get started.</Text>

        {/* Profile photo (optional) */}
        <View style={styles.photoSection}>
          <Pressable onPress={pickPhoto} style={styles.photoBtn}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoIcon}>📷</Text>
                <Text style={styles.photoHint}>Add photo</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.photoOptional}>Optional · tap to choose</Text>
          {photoUri && (
            <Pressable onPress={() => setPhotoUri(null)}>
              <Text style={styles.removePhoto}>Remove</Text>
            </Pressable>
          )}
        </View>

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
          <Pressable style={styles.dobBtn} onPress={openPicker}>
            <Text style={styles.dobIcon}>📅</Text>
            <View style={{ flex: 1 }}>
              <Text style={dob ? styles.dobText : styles.dobPlaceholder}>
                {dob
                  ? dob.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
                  : 'Select your date of birth'}
              </Text>
              {dob && <Text style={styles.dobAge}>{ageFromDob(dob)} years old</Text>}
            </View>
            <Text style={styles.dobChevron}>›</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          {saving ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#000" size="small" />
              <Text style={styles.saveBtnText}>{uploadProgress ?? 'Saving…'}</Text>
            </View>
          ) : (
            <Text style={styles.saveBtnText}>Get started →</Text>
          )}
        </Pressable>
      </ScrollView>

      {/* Spinner date picker in bottom sheet */}
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.modalTitle}>Date of birth</Text>
              <Pressable onPress={() => { setDob(pickerTemp); setShowPicker(false); }}>
                <Text style={styles.modalDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={pickerTemp}
              mode="date"
              display="spinner"
              maximumDate={MAX_DATE}
              minimumDate={MIN_DATE}
              onChange={(_, selected) => { if (selected) setPickerTemp(selected); }}
              style={styles.picker}
              textColor="#ffffff"
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 20, flexGrow: 1, justifyContent: 'center' },
  logoRow:   { alignItems: 'center', marginBottom: 4 },
  logo:      { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText:  { fontSize: 36, fontWeight: '900', color: '#000' },
  title:     { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center' },
  subtitle:  { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 4 },

  photoSection:     { alignItems: 'center', gap: 6 },
  photoBtn:         { width: 96, height: 96, borderRadius: 48 },
  photoPreview:     { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: colors.primary },
  photoPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed',
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  photoIcon:     { fontSize: 28 },
  photoHint:     { fontSize: 11, color: colors.muted, fontWeight: '700' },
  photoOptional: { fontSize: 11, color: colors.muted },
  removePhoto:   { fontSize: 12, color: colors.danger, fontWeight: '700', padding: 4 },

  field:  { gap: 8 },
  label:  { fontSize: 13, fontWeight: '700', color: colors.text },
  input:  {
    height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.surface,
  },

  genderRow:           { flexDirection: 'row', gap: 10 },
  genderBtn:           { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  genderBtnActive:     { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  genderBtnText:       { fontSize: 13, fontWeight: '700', color: colors.muted },
  genderBtnTextActive: { color: colors.primary },

  dobBtn:         { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10 },
  dobIcon:        { fontSize: 20 },
  dobText:        { fontSize: 15, color: colors.text, fontWeight: '700' },
  dobPlaceholder: { fontSize: 15, color: colors.muted },
  dobAge:         { fontSize: 12, color: colors.primary, fontWeight: '700', marginTop: 2 },
  dobChevron:     { fontSize: 22, color: colors.muted },

  error:       { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  saveBtn:     { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: '#1c1e1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle:   { fontSize: 16, fontWeight: '800', color: colors.text },
  modalCancel:  { fontSize: 15, color: colors.muted, fontWeight: '600' },
  modalDone:    { fontSize: 15, fontWeight: '800', color: colors.primary },
  picker:       { width: '100%', height: 200 },
});
