import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { useRouter } from 'expo-router';

import { auth } from '../src/firebase';
import { api } from '../src/api/client';
import { colors } from '../src/config';
import { PrimaryButton } from '../src/ui/components';
import { LogoMark } from '../src/ui/LogoMark';

function humaniseAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default function DriverSignIn() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Sign out any existing session the moment this screen mounts so the
  // passenger layout guard doesn't fire and redirect us away.
  useEffect(() => { fbSignOut(auth).catch(() => {}); }, []);

  async function submit() {
    setError(null);
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and password (at least 6 characters).');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);

      // Force-refresh token to get custom claims set by admin
      let token = await cred.user.getIdTokenResult(true);
      let role = token.claims.role as string | undefined;

      // Self-heal: if claims are missing but the Firestore driver doc is approved,
      // request the backend to re-apply the driver claim and re-fetch the token.
      if (role !== 'driver') {
        try {
          await api.claimDriverRole({});
          token = await cred.user.getIdTokenResult(true);
          role = token.claims.role as string | undefined;
        } catch {
          // claimDriverRole throws if no approved driver doc exists — fall through
        }
      }

      if (role !== 'driver') {
        await fbSignOut(auth);
        setError('This account is not registered as a driver. Contact your fleet admin.');
        return;
      }
      // Navigate directly to driver home — no index.tsx redirect needed
      router.replace('/driver/home');
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : 'unknown';
      setError(humaniseAuthError(code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Back button */}
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>

        <View style={styles.container}>
          {/* Header */}
          <View style={styles.logoRow}>
            <View style={styles.logoBadge}>
              <LogoMark size={46} color="#1a1a1a" />
            </View>
          </View>

          <Text style={styles.title}>Login as Driver / Rider</Text>
          <Text style={styles.subtitle}>
            Sign in with your driver credentials to access ride requests and manage your trips.
          </Text>

          {/* Email */}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="driver@example.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoFocus
            />
          </View>

          {/* Password */}
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            label="Sign in as Driver"
            onPress={submit}
            loading={loading}
          />

          <Text style={styles.hint}>
            Your credentials were shared by your fleet admin when your account was created.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#1a1a1a' },
  flex:      { flex: 1 },
  back:      { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  backText:  { color: colors.muted, fontSize: 16, fontWeight: '600' },
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },

  logoRow:   { alignItems: 'center', marginBottom: 8 },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },

  title:    { fontSize: 30, fontWeight: '900', color: '#ffffff', textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22, marginBottom: 8 },

  field:  { gap: 6 },
  label:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  input:  {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#ffffff',
    backgroundColor: '#2a2a2a',
  },

  error: { color: colors.danger, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  hint:  { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 8 },
});
