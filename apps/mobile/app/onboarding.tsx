/**
 * Set up your account — the one screen straight after the phone number is
 * verified: username, photo, name, gender and date of birth, together.
 *
 * The entry route (app/index.tsx) says which parts are still missing, so an old
 * account that already has a profile is only asked for its username, and one
 * that has a username only for its profile. Drivers are never sent here: they
 * signed up as riders first, and a driver is not stopped on the way to work.
 *
 * THE USERNAME IS CHECKED WHILE YOU TYPE. `usernames/{slug}` is keyed on the
 * name itself, so one debounced document read answers "is it free" (the rules
 * allow `get` there and refuse `list`). The claim is still a callable in a
 * transaction: a green tick is a read from a moment ago, not a reservation.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Text, TextInput } from '../src/ui/Text';
import { api } from '../src/api/client';
import { db, functions } from '../src/firebase';
import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { LogoMark } from '../src/ui/LogoMark';
import { BirthDatePicker, birthDateFromParts, type BirthDateParts } from '../src/ui/BirthDatePicker';
import { USERNAME_MAX, USERNAME_MIN, checkUsername, usernameDoneKey } from '../src/lib/username';

const GENDERS = ['Male', 'Female', 'Other'] as const;
type Gender = typeof GENDERS[number];

type Availability =
  | { state: 'idle' }
  | { state: 'invalid'; reason: string }
  | { state: 'checking' }
  | { state: 'free' }
  | { state: 'taken' };

/** Long enough that a fast typist spends one read, short enough to feel live. */
const DEBOUNCE_MS = 350;

function ageFromDob(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// Nobody under 13 signs up (checked on save), nobody over 100 is offered.
const MAX_YEAR = new Date().getFullYear() - 13;
const MIN_YEAR = new Date().getFullYear() - 100;

export default function Onboarding() {
  const router = useRouter();
  const { user } = useAuth();
  // What is still missing; both when the route is opened without saying.
  const params = useLocalSearchParams<{ username?: string; profile?: string }>();
  const needUsername = params.username !== '0';
  const needProfile = params.profile !== '0';

  const [username, setUsername]       = useState('');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [name, setName]               = useState('');
  const [gender, setGender]           = useState<Gender | null>(null);
  const [dobParts, setDobParts]       = useState<BirthDateParts>({ day: null, month: null, year: null });
  const dob                           = birthDateFromParts(dobParts);
  const [photoUri, setPhotoUri]       = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  /** Guards against a slow check for an old string landing after a newer one. */
  const latest = useRef('');
  /** Claimed on an earlier tap whose profile save then failed — never claim twice. */
  const claimed = useRef(false);

  useEffect(() => {
    if (!needUsername) return;
    const raw = username.trim();
    latest.current = raw;
    if (!raw) { setAvailability({ state: 'idle' }); return; }
    const parsed = checkUsername(raw);
    if (!parsed.ok) { setAvailability({ state: 'invalid', reason: parsed.reason }); return; }

    setAvailability({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, 'usernames', parsed.slug));
        if (latest.current !== raw) return;
        setAvailability({ state: snap.exists() ? 'taken' : 'free' });
      } catch {
        // A read failure must not look like "taken" — the claim itself is the
        // check that counts, so fall back to letting them try.
        if (latest.current === raw) setAvailability({ state: 'idle' });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [username, needUsername]);

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
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setPhotoBase64(result.assets[0].base64 ?? null);
      setError(null);
    }
  }

  async function uploadPhoto(): Promise<string | null> {
    if (!photoBase64) return null;
    setUploadProgress('Uploading photo…');
    try {
      const upload = httpsCallable<{ base64: string; kind: string }, { photoURL: string }>(
        functions, 'uploadUserPhoto',
      );
      const res = await upload({ base64: photoBase64, kind: 'avatar' });
      return res.data.photoURL;
    } catch {
      // Non-blocking: the profile still saves without a photo.
      return null;
    } finally {
      setUploadProgress(null);
    }
  }

  async function save() {
    const parsedName = checkUsername(username);
    if (needUsername && !claimed.current) {
      if (!parsedName.ok) { setError(parsedName.reason); return; }
      if (availability.state === 'taken') { setError(`@${username.trim()} is already taken.`); return; }
    }
    if (needProfile) {
      if (!name.trim()) { setError('Please enter your name.'); return; }
      if (!gender)       { setError('Please select your gender.'); return; }
      if (!dob)          { setError('Please pick the day, month and year you were born.'); return; }
      if (ageFromDob(dob) < 13) { setError('You must be at least 13 years old.'); return; }
    }
    if (!user) {
      setError('Session expired — please go back and sign in again.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (needUsername && !claimed.current && parsedName.ok) {
        try {
          await api.claimUsername({ username: parsedName.username });
        } catch (e) {
          setAvailability({ state: 'taken' });
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        claimed.current = true;
        await AsyncStorage.setItem(usernameDoneKey(user.uid), '1').catch(() => {});
      }

      if (needProfile && dob && gender) {
        const photoURL = await uploadPhoto();
        // setDoc with merge:true works whether onUserCreate trigger has already
        // created the doc or not — avoids "NOT_FOUND" from updateDoc race condition.
        const patch: Record<string, unknown> = {
          name:            name.trim(),
          gender:          gender.toLowerCase(),
          dob:             dob.toISOString(),
          age:             ageFromDob(dob),
          profileComplete: true,
          lastActive:      serverTimestamp(),
          updatedAt:       serverTimestamp(),
        };
        if (photoURL) patch.photoURL = photoURL;

        await setDoc(doc(db, 'users', user.uid), patch, { merge: true });
        // Cache locally: prevents Firestore read failures from re-showing onboarding.
        await AsyncStorage.setItem(`onboarding_done_${user.uid}`, '1').catch(() => {});
      }
      // The entry route decides where this account goes next.
      router.replace('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Save failed: ${msg}`);
      Alert.alert('Save failed', msg);
    } finally {
      setSaving(false);
    }
  }

  const hint = {
    idle: null,
    invalid: availability.state === 'invalid' ? availability.reason : null,
    checking: 'Checking…',
    free: `@${username.trim()} is free`,
    taken: `@${username.trim()} is already taken`,
  }[availability.state];

  const hintColor =
    availability.state === 'free' ? colors.primary
      : availability.state === 'checking' ? colors.muted
        : colors.danger;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.logoRow}>
          <LogoMark size={52} color="#ccff00" spin />
        </View>
        <Text style={styles.title}>
          {needUsername && needProfile ? 'Set up your account' : needUsername ? 'Pick your username' : 'One last step'}
        </Text>
        <Text style={styles.subtitle}>
          {needUsername
            ? 'Your username is how other riders add you to their fleet — it has to be one nobody has taken.'
            : 'Tell us a little about yourself to get started.'}
        </Text>

        {needUsername ? (
          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.inputRow}>
              <Text style={styles.at}>@</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="e.g. ali99"
                placeholderTextColor={colors.muted}
                style={styles.unameInput}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={USERNAME_MAX}
                accessibilityLabel="Username"
              />
              {availability.state === 'checking' ? <ActivityIndicator size="small" color={colors.muted} /> : null}
              {availability.state === 'free' ? <Text style={styles.tick}>✓</Text> : null}
              {availability.state === 'taken' ? <Text style={styles.cross}>✕</Text> : null}
            </View>
            <Text style={[styles.hint, { color: hint ? hintColor : colors.muted }]}>
              {hint ?? `${USERNAME_MIN}–${USERNAME_MAX} characters. Symbols are fine.`}
            </Text>
          </View>
        ) : null}

        {needProfile ? (
          <>
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
                <Pressable onPress={() => { setPhotoUri(null); setPhotoBase64(null); }}>
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
              <BirthDatePicker
                value={dobParts}
                onChange={setDobParts}
                minYear={MIN_YEAR}
                maxYear={MAX_YEAR}
              />
              {dob && <Text style={styles.dobAge}>{ageFromDob(dob)} years old</Text>}
            </View>
          </>
        ) : null}

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

    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 20, flexGrow: 1, justifyContent: 'center' },
  logoRow:   { alignItems: 'center', marginBottom: 4 },
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

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 16, backgroundColor: colors.surface,
  },
  at:         { fontSize: 17, fontWeight: '900', color: colors.muted },
  unameInput: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text, height: '100%' },
  tick:       { fontSize: 18, fontWeight: '900', color: colors.primary },
  cross:      { fontSize: 18, fontWeight: '900', color: colors.danger },
  hint:       { fontSize: 12.5, fontWeight: '700' },

  genderRow:           { flexDirection: 'row', gap: 10 },
  genderBtn:           { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  genderBtnActive:     { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  genderBtnText:       { fontSize: 13, fontWeight: '700', color: colors.muted },
  genderBtnTextActive: { color: colors.primary },

  dobAge:         { fontSize: 12, color: colors.primary, fontWeight: '700' },

  error:       { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  saveBtn:     { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },
}));
