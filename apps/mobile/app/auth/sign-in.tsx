import { useEffect, useRef, useState } from 'react';
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

function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  // Strip full country code prefix (e.g. 923441234567 → 3441234567)
  if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  // Strip leading zeros (e.g. 03441234567 → 3441234567)
  d = d.replace(/^0+/, '');
  return d;
}

export default function SignIn() {
  const [authMode, setAuthMode] = useState<AuthMode>('phone');

  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);
  const otpRef       = useRef<TextInput>(null);
  const [phone, setPhone]               = useState('');
  const [otp, setOtp]                   = useState('');
  const [phoneStep, setPhoneStep]       = useState<PhoneStep>('enter_phone');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  // OTP wait timer & resend cooldown
  const [sentAt, setSentAt]         = useState<number | null>(null);
  const [elapsed, setElapsed]       = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Tick every second while waiting for OTP
  useEffect(() => {
    if (phoneStep !== 'enter_otp' || sentAt === null) return;
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - sentAt) / 1000);
      setElapsed(secs);
      setResendCooldown(Math.max(0, 60 - secs));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phoneStep, sentAt]);

  // Auto-focus OTP field when screen appears
  useEffect(() => {
    if (phoneStep === 'enter_otp') {
      setTimeout(() => otpRef.current?.focus(), 300);
    }
  }, [phoneStep]);

  // ── Phone OTP ──────────────────────────────────────────────────────────────

  async function sendOtp(isResend = false) {
    setError(null);
    const digits = stripPhone(phone);
    // Always sync cleaned digits back to state
    setPhone(digits);

    if (digits.length !== 10 || !digits.startsWith('3')) {
      setError('Enter a valid Pakistani mobile number, e.g. 3001234567');
      return;
    }
    if (!recaptchaRef.current) {
      setError('Captcha not ready — please wait a moment and try again.');
      return;
    }

    setLoading(true);
    try {
      const result = await signInWithPhoneNumber(auth, `+92${digits}`, recaptchaRef.current);
      setConfirmation(result);
      setPhoneStep('enter_otp');
      const now = Date.now();
      setSentAt(now);
      setElapsed(0);
      setResendCooldown(60);
      if (isResend) setOtp('');
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : 'unknown';
      const msg  = e instanceof FirebaseError ? e.message : String(e);
      if (code === 'auth/invalid-phone-number')      setError('Invalid phone number format.');
      else if (code === 'auth/too-many-requests')    setError('Too many attempts. Wait a few minutes and try again.');
      else if (code === 'auth/captcha-check-failed') setError('Captcha failed. Try again.');
      else if (code === 'auth/app-not-authorized')   setError('Phone Auth not enabled. Enable it in Firebase Console → Authentication → Sign-in method.');
      else if (code === 'auth/quota-exceeded')       setError('SMS quota exceeded for this project.');
      else if (code === 'auth/operation-not-allowed')setError('Pakistani numbers are blocked. Enable Pakistan (+92) in Firebase Console → Authentication → Settings → SMS region policy.');
      else setError(`OTP failed [${code}]: ${msg}`);
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
    } catch {
      setError('Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function goBackToPhone() {
    setPhoneStep('enter_phone');
    setOtp('');
    setError(null);
    setSentAt(null);
    setElapsed(0);
    setResendCooldown(0);
    if (timerRef.current) clearInterval(timerRef.current);
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
                        onChangeText={(t) => setPhone(stripPhone(t))}
                        keyboardType="phone-pad"
                        placeholder="3001234567"
                        placeholderTextColor={colors.muted}
                        style={[styles.input, styles.phoneInput]}
                        maxLength={11}
                      />
                    </View>
                    <Text style={styles.hint}>
                      Enter your number — leading 0 is removed automatically
                    </Text>
                  </View>
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <PrimaryButton label="Send OTP" onPress={() => sendOtp(false)} loading={loading} />
                </>
              ) : (
                <>
                  {/* OTP screen */}
                  <View style={styles.otpHeader}>
                    <Text style={styles.otpTitle}>Enter verification code</Text>
                    <Text style={styles.otpSub}>Sent to +92{phone}</Text>
                  </View>

                  {/* Wait banner */}
                  <View style={[
                    styles.waitBanner,
                    elapsed >= 60 ? styles.waitBannerOk : styles.waitBannerWaiting,
                  ]}>
                    {elapsed < 30 ? (
                      <Text style={styles.waitText}>
                        ⏳ Waiting for SMS… ({elapsed}s){'\n'}
                        <Text style={styles.waitSub}>Pakistani networks can take up to 60 seconds.</Text>
                      </Text>
                    ) : elapsed < 60 ? (
                      <Text style={styles.waitText}>
                        ⏳ Still waiting… ({elapsed}s){'\n'}
                        <Text style={styles.waitSub}>Should arrive any moment — check your messages.</Text>
                      </Text>
                    ) : (
                      <Text style={styles.waitText}>
                        ✅ OTP should have arrived. Enter it below.
                      </Text>
                    )}
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>6-digit OTP</Text>
                    <TextInput
                      ref={otpRef}
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

                  <View style={styles.otpActions}>
                    <Pressable onPress={goBackToPhone}>
                      <Text style={styles.switchLink}>← Change number</Text>
                    </Pressable>

                    {resendCooldown > 0 ? (
                      <Text style={styles.resendCooldown}>
                        Resend in {resendCooldown}s
                      </Text>
                    ) : (
                      <Pressable onPress={() => sendOtp(true)} disabled={loading}>
                        <Text style={styles.switchLink}>Resend OTP</Text>
                      </Pressable>
                    )}
                  </View>
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
                <Text style={styles.switchLink}>
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
  safe:      { flex: 1, backgroundColor: colors.background },
  flex:      { flex: 1 },
  container: { padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logo:     { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#000', fontSize: 24, fontWeight: '900' },
  brand:    { fontSize: 24, fontWeight: '900', color: colors.text },
  title:    { fontSize: 26, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: 8 },

  modeRow:           { flexDirection: 'row', gap: 8 },
  modeBtn:           { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  modeBtnActive:     { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  modeBtnText:       { fontSize: 13, fontWeight: '700', color: colors.muted },
  modeBtnTextActive: { color: colors.primary },

  field:      { gap: 6 },
  label:      { fontSize: 13, fontWeight: '700', color: colors.text },
  hint:       { fontSize: 11, color: colors.muted },
  input:      { height: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  phoneRow:   { flexDirection: 'row', gap: 8 },
  prefixBox:  { height: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, justifyContent: 'center' },
  prefixText: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneInput: { flex: 1 },

  otpHeader: { alignItems: 'center', gap: 4 },
  otpTitle:  { fontSize: 20, fontWeight: '900', color: colors.text },
  otpSub:    { fontSize: 14, color: colors.muted },
  otpInput:  { fontSize: 28, textAlign: 'center', letterSpacing: 8, fontWeight: '900' },

  waitBanner:        { borderRadius: 12, padding: 14, borderWidth: 1 },
  waitBannerWaiting: { backgroundColor: '#f59e0b15', borderColor: '#f59e0b40' },
  waitBannerOk:      { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}40` },
  waitText:          { fontSize: 13, color: colors.text, fontWeight: '700', lineHeight: 20 },
  waitSub:           { fontSize: 12, color: colors.muted, fontWeight: '400' },

  otpActions:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  switchLink:     { color: colors.secondary, fontWeight: '700', paddingVertical: 6, fontSize: 13 },
  resendCooldown: { fontSize: 12, color: colors.muted, fontWeight: '600' },

  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
