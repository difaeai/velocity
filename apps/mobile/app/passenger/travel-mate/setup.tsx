import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';

import { db, storage } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';

const INTERESTS = [
  'Music', 'Movies', 'Sports', 'Gaming', 'Reading', 'Travel',
  'Foodie', 'Fitness', 'Art', 'Tech', 'Photography', 'Cooking',
];

export default function TravelMateSetup() {
  const { user } = useAuth();
  const router = useRouter();

  const [photoUri, setPhotoUri]     = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoURL, setPhotoURL]     = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [age, setAge]             = useState('');
  const [gender, setGender]       = useState<'male' | 'female'>('male');
  const [genderPref, setGenderPref] = useState<'male' | 'female' | 'any'>('any');
  const [bio, setBio]             = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [activeMode, setActiveMode] = useState<'today' | 'week'>('week');
  const [active, setActive]       = useState(true);
  const [loading, setLoading]     = useState(false);
  const [prefilling, setPrefilling] = useState(true);

  useEffect(() => {
    if (!user) { setPrefilling(false); return; }
    getDoc(doc(db, 'travelMateProfiles', user.uid))
      .then(snap => {
        if (!snap.exists()) return;
        const d = snap.data();
        setDisplayName(d.displayName ?? '');
        setAge(d.age ? String(d.age) : '');
        setGender(d.gender ?? 'male');
        setGenderPref(d.genderPref ?? 'any');
        setBio(d.bio ?? '');
        setInterests(d.interests ?? []);
        setActiveMode(d.activeMode ?? 'week');
        setActive(d.active !== false);
        if (d.photoURL) setPhotoURL(d.photoURL);
      })
      .catch(() => {})
      .finally(() => setPrefilling(false));
  }, [user?.uid]);

  useEffect(() => {
    if (!prefilling && !displayName && user?.displayName) {
      setDisplayName(user.displayName);
    }
  }, [prefilling]);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to add a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.75,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setPhotoBase64(result.assets[0].base64 ?? null);
    }
  }

  function toggleInterest(tag: string) {
    setInterests(prev =>
      prev.includes(tag) ? prev.filter(i => i !== tag) : [...prev, tag],
    );
  }

  async function save() {
    if (!user) return;
    if (!displayName.trim()) { Alert.alert('Required', 'Enter your display name.'); return; }
    const ageNum = parseInt(age, 10);
    if (!age || isNaN(ageNum) || ageNum < 18 || ageNum > 99) {
      Alert.alert('Required', 'Enter your age (18–99).');
      return;
    }
    setLoading(true);
    try {
      let finalPhotoURL = photoURL;
      if (photoBase64) {
        const storageRef = ref(storage, `travelMatePhotos/${user.uid}.jpg`);
        await uploadString(storageRef, photoBase64, 'base64', { contentType: 'image/jpeg' });
        finalPhotoURL = await getDownloadURL(storageRef);
      }
      await setDoc(doc(db, 'travelMateProfiles', user.uid), {
        uid: user.uid,
        displayName: displayName.trim(),
        age: ageNum,
        gender,
        genderPref,
        bio: bio.trim(),
        interests,
        photoURL: finalPhotoURL ?? null,
        active,
        activeMode,
        lastActive: serverTimestamp(),
      });
      router.replace('/passenger/travel-mate');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (prefilling) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><Text style={s.muted}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  const displayPhoto = photoUri ?? photoURL;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          <View style={s.header}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <Text style={s.backText}>←</Text>
            </Pressable>
            <Text style={s.title}>Your Travel Mate profile</Text>
          </View>
          <Text style={s.subtitle}>Only visible to people you match with.</Text>

          {/* Photo */}
          <View style={s.photoSection}>
            <Pressable style={s.photoWrap} onPress={pickPhoto}>
              {displayPhoto ? (
                <Image source={{ uri: displayPhoto }} style={s.photo} />
              ) : (
                <View style={s.photoPlaceholder}>
                  <Text style={s.photoPlaceholderIcon}>📷</Text>
                  <Text style={s.photoPlaceholderText}>Add photo</Text>
                </View>
              )}
              <View style={s.photoBadge}>
                <Text style={{ fontSize: 14 }}>✏️</Text>
              </View>
            </Pressable>
          </View>

          {/* About */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>About you</Text>
            <Text style={s.label}>Display name</Text>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your first name"
              placeholderTextColor={colors.muted}
              maxLength={30}
            />
            <Text style={s.label}>Age</Text>
            <TextInput
              style={[s.input, { width: 100 }]}
              value={age}
              onChangeText={setAge}
              placeholder="25"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={s.label}>Bio (optional)</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell people something about yourself…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              maxLength={150}
            />
            <Text style={s.charCount}>{bio.length}/150</Text>
          </View>

          {/* Gender */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Gender</Text>
            <Text style={s.label}>I am</Text>
            <View style={s.pillRow}>
              {(['male', 'female'] as const).map(g => (
                <Pressable key={g} style={[s.pill, gender === g && s.pillActive]} onPress={() => setGender(g)}>
                  <Text style={[s.pillText, gender === g && s.pillTextActive]}>
                    {g === 'male' ? 'Male' : 'Female'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.label}>Show me</Text>
            <View style={s.pillRow}>
              {[
                { key: 'male' as const, label: 'Men' },
                { key: 'female' as const, label: 'Women' },
                { key: 'any' as const, label: 'Everyone' },
              ].map(o => (
                <Pressable key={o.key} style={[s.pill, genderPref === o.key && s.pillActive]} onPress={() => setGenderPref(o.key)}>
                  <Text style={[s.pillText, genderPref === o.key && s.pillTextActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Interests */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Interests</Text>
            <Text style={s.hint}>Pick up to 6 that describe you</Text>
            <View style={s.tagsWrap}>
              {INTERESTS.map(tag => {
                const on = interests.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={[s.tag, on && s.tagActive]}
                    onPress={() => toggleInterest(tag)}
                    disabled={!on && interests.length >= 6}
                  >
                    <Text style={[s.tagText, on && s.tagTextActive]}>{tag}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Visibility */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>Visibility</Text>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Show me in the feed</Text>
                <Text style={s.hint}>Turn off to pause matching.</Text>
              </View>
              <Switch
                value={active}
                onValueChange={setActive}
                trackColor={{ true: colors.primary }}
                thumbColor={active ? '#000' : colors.muted}
              />
            </View>
            <Text style={s.label}>My active status</Text>
            <View style={s.pillRow}>
              {[
                { key: 'today' as const, label: 'Active today' },
                { key: 'week' as const, label: 'Active this week' },
              ].map(o => (
                <Pressable key={o.key} style={[s.pill, activeMode === o.key && s.pillActive]} onPress={() => setActiveMode(o.key)}>
                  <Text style={[s.pillText, activeMode === o.key && s.pillTextActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable style={[s.saveBtn, loading && { opacity: 0.6 }]} onPress={save} disabled={loading}>
            <Text style={s.saveBtnText}>{loading ? 'Saving…' : 'Save profile'}</Text>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  scroll:      { padding: 20, gap: 16, paddingBottom: 40 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:    { color: colors.text, fontSize: 18, fontWeight: '700' },
  title:       { fontSize: 20, fontWeight: '900', color: colors.text, flex: 1 },
  subtitle:    { fontSize: 13, color: colors.muted },

  photoSection:        { alignItems: 'center', paddingVertical: 8 },
  photoWrap:           { position: 'relative' },
  photo:               { width: 120, height: 160, borderRadius: 20 },
  photoPlaceholder:    { width: 120, height: 160, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPlaceholderIcon:{ fontSize: 36 },
  photoPlaceholderText:{ fontSize: 12, fontWeight: '700', color: colors.muted },
  photoBadge:          { position: 'absolute', bottom: -8, right: -8, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background },

  card:         { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  label:        { fontSize: 13, fontWeight: '700', color: colors.text },
  hint:         { fontSize: 11, color: colors.muted },
  input:        { height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  multiline:    { height: 80, paddingTop: 12, textAlignVertical: 'top' },
  charCount:    { fontSize: 11, color: colors.muted, textAlign: 'right' },
  muted:        { color: colors.muted, fontSize: 14 },
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  pillRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:         { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  pillActive:   { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  pillText:     { fontSize: 13, fontWeight: '700', color: colors.muted },
  pillTextActive: { color: colors.primary },

  tagsWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  tagActive:    { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  tagText:      { fontSize: 13, fontWeight: '700', color: colors.muted },
  tagTextActive:{ color: colors.primary },

  saveBtn:      { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText:  { fontSize: 16, fontWeight: '900', color: '#000' },
});
