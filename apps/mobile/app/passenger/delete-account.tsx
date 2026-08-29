/**
 * Delete account — the in-app half of App Store guideline 5.1.1(v).
 *
 * This used to be a link out to velocityrides.app/delete-account. Apple treats
 * a link as no deletion path at all, so the whole flow now lives here: the user
 * reads what will happen, types the word, and the account is gone before the
 * screen unmounts.
 *
 * The screen is deliberately slow to use. Everything on it is irreversible, so
 * it states plainly what disappears AND what survives — a driver's completed
 * trips do not vanish just because the passenger left, and someone deleting
 * their account deserves to know that rather than discover it later.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';

/** Must match CONFIRM_PHRASE in the backend — the server checks it too. */
const CONFIRM_PHRASE = 'DELETE';

/** What goes, in the user's terms rather than collection names. */
const REMOVED = [
  'Your profile, phone number and photo',
  'Your saved places and ride history',
  'Your wallet, payment methods and saved cards',
  'Your Travel Partner profile, posts and messages',
  'Any CNIC or vehicle documents you uploaded',
];

/**
 * What stays, and why. Being upfront here is not just honesty — it is the
 * difference between a support ticket and a Play Store review.
 */
const RETAINED = [
  'Completed trips stay in the other person’s history, with your name and number removed',
  'Payment and commission records are kept as required for tax and accounting',
  'Safety reports are kept so they can still be investigated',
];

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const armed = typed.trim().toUpperCase() === CONFIRM_PHRASE && !busy;

  /** Second gate. The typed word arms the button; this confirms the intent. */
  const confirm = () => {
    Alert.alert(
      'Delete your account?',
      'This cannot be undone. You will be signed out immediately and this account cannot be recovered.',
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete forever', style: 'destructive', onPress: run },
      ],
    );
  };

  const run = async () => {
    setBusy(true);
    try {
      await api.deleteMyAccount({ confirm: CONFIRM_PHRASE });
      // The account is gone; the local session is now a token for a uid that no
      // longer exists. Sign out before routing so nothing tries to read as them.
      await signOut().catch(() => {});
      router.replace('/welcome');
      Alert.alert('Account deleted', 'Your Velocity account and personal data have been removed.');
    } catch (e) {
      // The backend refuses with a readable sentence when a ride is running or
      // money is owed either way — show that verbatim, it names the amount and
      // the way to clear it. Anything else is a network problem.
      const message =
        (e as { message?: string })?.message ?? 'Something went wrong. Please try again.';
      Alert.alert('Account not deleted', message);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Delete account</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.lede}>
            Deleting your account is permanent. There is no way to restore it, and the same phone
            number will start over as a new account.
          </Text>

          <Text style={styles.sectionLabel}>WHAT IS DELETED</Text>
          <View style={styles.card}>
            {REMOVED.map((line) => (
              <View key={line} style={styles.bulletRow}>
                <Text style={styles.bulletMark}>✕</Text>
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>WHAT IS KEPT</Text>
          <View style={styles.card}>
            {RETAINED.map((line) => (
              <View key={line} style={styles.bulletRow}>
                <Text style={[styles.bulletMark, styles.keepMark]}>•</Text>
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>CONFIRM</Text>
          <Text style={styles.hint}>
            Type {CONFIRM_PHRASE} below to enable the button.
          </Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={CONFIRM_PHRASE}
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            style={styles.input}
          />

          <Pressable
            onPress={confirm}
            disabled={!armed}
            style={[styles.deleteButton, !armed && styles.deleteButtonOff]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.deleteLabel}>Delete my account</Text>
            )}
          </Pressable>

          <Pressable onPress={() => router.back()} disabled={busy} style={styles.keepButton}>
            <Text style={styles.keepLabel}>Keep my account</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },

  container: { padding: 16, gap: 8, paddingBottom: 40 },
  lede: { fontSize: 14, lineHeight: 20, color: colors.text, marginBottom: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    marginTop: 12,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
  },
  bulletRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  bulletMark: { fontSize: 13, color: colors.danger, width: 14, lineHeight: 19 },
  keepMark: { color: colors.muted },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginLeft: 4, marginBottom: 6 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.text,
  },

  deleteButton: {
    marginTop: 16,
    backgroundColor: colors.danger,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  // Dimmed rather than hidden: the user can see what typing the word unlocks.
  deleteButtonOff: { opacity: 0.35 },
  deleteLabel: { fontSize: 16, fontWeight: '800', color: '#ffffff' },

  keepButton: { paddingVertical: 16, alignItems: 'center' },
  keepLabel: { fontSize: 15, fontWeight: '700', color: colors.muted },
}));
