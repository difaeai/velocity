import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { FirebaseError } from 'firebase/app';

import { auth } from '../../src/firebase';
import { firebaseConfig } from '../../src/firebase';
import { colors } from '../../src/config';
import { PrimaryButton } from '../../src/ui/components';

type AuthMode = 'phone' | 'email';
type PhoneStep = 'enter_phone' | 'enter_otp';

export default function SignIn() {
  // Auth mode toggle
  const [authMode, setAuthMode] = useState<AuthMode>('phone');

  // Phone OTP state
  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);
  const [phone, setPhone]                       = useState('');
  const [otp, setOtp]                           = useState('');
  const [phoneStep, setPhoneStep]               = useState<PhoneStep>('enter_phone');
  const [confirmation, setConfirmation]         = useState<ConfirmationResult | null>(null);

  // Email state
  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── Phone OTP ──────────────────────────────────────────────────────────────

  async function sendOtp() {
    setError(null);
    const cleaned = phone.trim().replace(/\s/g, '');
    const withPrefix = cleaned.startsWith('+') ? cleaned : `+92${cleaned.replace(/^0/, '')}`;
    if (withPrefix.length < 10) {
      setError('Enter a valid Pakistani mobile number.');
      return;
    }
    setLoading(true);
    try {
      const result = await signInWithPhoneNumber(auth, withPrefix, recaptchaRef.current!);
      setConfirmation(result);
      setPhoneStep('enter_otp');
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : '';
      if (code === 'auth/invalid-phone-number')       setError('Invalid phone number.');
      else if (code === 'auth/too-many-requests')     setError('Too many attempts. Try again later.');
      else if (code === 'auth/captcha-check-failed')  setError('Captcha failed. Try again.');
      else setError('Failed to send OTP. Check your number and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    if (!confirmation) { setError('Please request OTP first.'); return; }
    if (otp.length !== 6) { setError('Enter the 6-digit code.'); return; }
    setLoading(true);
    try {
      await confirmation.confirm(otp);
      // AuthProvider picks up the signed-in user and redirects
    } catch {
      setError('Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Email / Password ───────────────────────────────────────────────────────

  async function submitEmail() {
    setError(null);
    if (!email.trim() || password.length < 6) {
      setError('Enter an email and a password of at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      if (emailMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : 'unknown';
      setError(humaniseAuthError(code));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      {/* Recaptcha verifier — invisible, needed for phone auth */}
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaRef}
        firebaseConfig={firebaseConfig}
        attemptInvisibleVerification
        title="Prove you're human!"
        cancelLabel="Close"
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View style={styles.brandRow}>
            <View style={styles.logo}><Text style={styles.logoText}>V</Text></View>
            <Text style={styles.brand}>Velocity</Text>
          </View>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>Sign in to book rides or manage your account.</Text>

          {/* Mode selector */}
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeBtn, authMode === 'phone' && styles.modeBtnActive]}
              onPress={() => { setAuthMode('phone'); setError(null); }}
            >
              <Text style={[styles.modeBtnText, authMode === 'phone' && styles.modeBtnTextActive]}>
                📱 Phone OTP
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, authMode === 'email' && styles.modeBtnActive]}
              onPress={() => { setAuthMode('email'); setError(null); }}
            >
              <Text style={[styles.modeBtnText, authMode === 'email' && styles.modeBtnTextActive]}>
                ✉️ Email
              </Text>
            </Pressable>
          </View>

          {/* ── Phone OTP ── */}
          {authMode === 'phone' && (
            <>
              {phoneStep === 'enter_phone' ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Mobile number</Text>
                    <View style={styles.phoneRow}>
                      <View style={styles.prefixBox}>
                        <Text style={styles.prefixText}>🇵🇰 +92</Text>
                      </View>
                      <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholder="3001234567"
                        placeholderTextColor={colors.muted}
                        style={[styles.input, styles.phoneInput]}
                        maxLength={11}
                      />
                    </View>
                    <Text style={styles.hint}>Enter your number without the leading 0, e.g. 3001234567</Text>
                  </View>
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <PrimaryButton label="Send OTP" onPress={sendOtp} loading={loading} />
                </>
              ) : (
                <>
                  <View style={styles.otpHeader}>
                    <Text style={styles.otpTitle}>Enter verification code</Text>
                    <Text style={styles.otpSub}>
                      Sent to +92{phone.replace(/^0/, '')}
                    </Text>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>6-digit OTP</Text>
                    <TextInput
                      value={otp}
                      onChangeText={setOtp}
                      keyboardType="number-pad"
                      placeholder="123456"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.otpInput]}
                      maxLength={6}
                    />
                  </View>
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <PrimaryButton label="Verify & sign in" onPress={verifyOtp} loading={loading} />
                  <Pressable onPress={() => { setPhoneStep('enter_phone'); setOtp(''); setError(null); }}>
                    <Text style={styles.switch}>← Change number</Text>
                  </Pressable>
                  <Pressable onPress={sendOtp} disabled={loading}>
                    <Text style={styles.switch}>Resend OTP</Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          {/* ── Email ── */}
          {authMode === 'email' && (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </View>
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
                label={emailMode === 'signup' ? 'Create account' : 'Sign in'}
                onPress={submitEmail}
                loading={loading}
              />
              <Pressable onPress={() => { setEmailMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null); }}>
                <Text style={styles.switch}>
                  {emailMode === 'signin' ? "Don't have an account? Sign up" : 'Already registered? Sign in'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function humaniseAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'That email is already registered — try signing in.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  flex:       { flex: 1 },
  container:  { padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' },
  brandRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logo:       { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText:   { color: '#fff', fontSize: 24, fontWeight: '900' },
  brand:      { fontSize: 24, fontWeight: '900', color: colors.text },
  title:      { fontSize: 26, fontWeight: '900', color: colors.text },
  subtitle:   { fontSize: 15, color: colors.muted, marginBottom: 8 },

  modeRow:        { flexDirection: 'row', gap: 8 },
  modeBtn:        { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  modeBtnActive:  { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  modeBtnText:    { fontSize: 13, fontWeight: '700', color: colors.muted },
  modeBtnTextActive: { color: colors.primary },

  field:      { gap: 6 },
  label:      { fontSize: 13, fontWeight: '700', color: colors.text },
  hint:       { fontSize: 11, color: colors.muted },
  input:      { height: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  phoneRow:   { flexDirection: 'row', gap: 8 },
  prefixBox:  { height: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, justifyContent: 'center' },
  prefixText: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneInput: { flex: 1 },

  otpHeader:  { alignItems: 'center', gap: 4, marginBottom: 4 },
  otpTitle:   { fontSize: 20, fontWeight: '900', color: colors.text },
  otpSub:     { fontSize: 14, color: colors.muted },
  otpInput:   { fontSize: 28, textAlign: 'center', letterSpacing: 8, fontWeight: '900' },

  error:      { color: colors.danger, fontSize: 14, fontWeight: '600' },
  switch:     { color: colors.secondary, fontWeight: '700', textAlign: 'center', paddingVertical: 6 },
});
