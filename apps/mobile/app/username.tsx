/**
 * Pick a username. The first thing every rider does, new or old.
 *
 * It exists because of fleets: you add somebody to your travel circle by
 * typing their username, so everyone needs one before anyone can be added.
 *
 * THE AVAILABILITY CHECK RUNS WHILE YOU TYPE, and that is the whole design of
 * this screen. Telling somebody their name is taken after they press the
 * button is the version of this that makes people try four names; telling
 * them at the fourth keystroke costs ONE Firestore document read, debounced,
 * because `usernames/{slug}` is keyed on the name itself — see the rules,
 * which allow `get` here and refuse `list`.
 *
 * The claim is still made by a callable in a transaction. A green tick is a
 * read from a moment ago, not a reservation, so two people can both see free
 * and only one of them can have it.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Text, TextInput } from '../src/ui/Text';
import { api } from '../src/api/client';
import { db } from '../src/firebase';
import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { LogoMark } from '../src/ui/LogoMark';
import { USERNAME_MAX, USERNAME_MIN, checkUsername, usernameDoneKey } from '../src/lib/username';


type Availability =
  | { state: 'idle' }
  | { state: 'invalid'; reason: string }
  | { state: 'checking' }
  | { state: 'free' }
  | { state: 'taken' };

/** Long enough that a fast typist spends one read, short enough to feel live. */
const DEBOUNCE_MS = 350;

export default function UsernameScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [value, setValue] = useState('');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a slow check for an old string landing after a newer one. */
  const latest = useRef('');

  useEffect(() => {
    const raw = value.trim();
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
  }, [value]);

  async function claim() {
    const parsed = checkUsername(value);
    if (!parsed.ok) { setError(parsed.reason); return; }
    setSaving(true);
    setError(null);
    try {
      await api.claimUsername({ username: parsed.username });
      if (user) await AsyncStorage.setItem(usernameDoneKey(user.uid), '1').catch(() => {});
      router.replace('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setAvailability({ state: 'taken' });
    } finally {
      setSaving(false);
    }
  }

  const hint = {
    idle: null,
    invalid: availability.state === 'invalid' ? availability.reason : null,
    checking: 'Checking…',
    free: `@${value.trim()} is free`,
    taken: `@${value.trim()} is already taken`,
  }[availability.state];

  const hintColor =
    availability.state === 'free' ? colors.primary
      : availability.state === 'checking' ? colors.muted
        : colors.danger;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoRow}>
          <LogoMark size={52} color="#ccff00" spin />
        </View>

        <Text style={styles.title}>Pick your username</Text>
        <Text style={styles.subtitle}>
          This is how other riders add you to their fleet — the people they share a car with.
          {'\n'}It has to be unique, so pick one nobody has taken.
        </Text>

        <View style={styles.field}>
          <View style={styles.inputRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="e.g. ali99"
              placeholderTextColor={colors.muted}
              style={styles.input}
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.saveBtn, (saving || availability.state !== 'free') && { opacity: 0.5 }]}
          onPress={claim}
          disabled={saving || availability.state !== 'free'}
        >
          {saving
            ? <ActivityIndicator color="#000" size="small" />
            : <Text style={styles.saveBtnText}>Claim it →</Text>}
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
  subtitle:  { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  field: { gap: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 16, backgroundColor: colors.surface,
  },
  at:    { fontSize: 18, fontWeight: '900', color: colors.muted },
  input: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text, height: '100%' },
  tick:  { fontSize: 18, fontWeight: '900', color: colors.primary },
  cross: { fontSize: 18, fontWeight: '900', color: colors.danger },
  hint:  { fontSize: 12.5, fontWeight: '700' },

  error:       { color: colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  saveBtn:     { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },
}));
