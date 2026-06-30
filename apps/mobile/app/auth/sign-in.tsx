import { useEffect, useRef, useState } from 'react';
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
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { FirebaseError } from 'firebase/app';

import { auth, firebaseConfig } from '../../src/firebase';
import { colors } from '../../src/config';
import { PrimaryButton } from '../../src/ui/components';
import { LogoMark } from '../../src/ui/LogoMark';

type Step = 'enter_phone' | 'enter_otp';

function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d;
}

export default function SignIn() {
  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);
  const otpRef       = useRef<TextInput>(null);

  const [step, setStep]                 = useState<Step>('enter_phone');
  const [phone, setPhone]               = useState('');
  const [otp, setOtp]                   = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [sending, setSending]           = useState(false);   // Send / Resend OTP
  const [verifying, setVerifying]       = useState(false);   // Verify OTP
  const [resendLabel, setResendLabel]   = useState('Resend OTP');
  const [error, setError]               = useState<string | null>(null);

  // Resend cooldown timer
  const [sentAt, setSentAt]               = useState<number | null>(null);
  const [elapsed, setElapsed]             = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (step !== 'enter_otp' || sentAt === null) return;
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - sentAt) / 1000);
      setElapsed(s);
      setResendCooldown(Math.max(0, 60 - s));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [step, sentAt]);

  useEffect(() => {
    if (step === 'enter_otp') setTimeout(() => otpRef.current?.focus(), 300);
  }, [step]);

  async function sendOtp(isResend = false) {
    setError(null);
    const digits = stripPhone(phone);
    setPhone(digits);

    if (digits.length !== 10 || !digits.startsWith('3')) {
      setError('Enter a valid Pakistani mobile number, e.g. 3001234567');
      return;
    }
    if (!recaptchaRef.current) {
      setError('Captcha not ready — please wait a moment.');
      return;
    }

    setSending(true);
    if (isResend) setResendLabel('Sending…');
    setError(null);
    try {
      // 15-second timeout — reCAPTCHA re-verification can hang on some devices
      const result = await Promise.race([
        signInWithPhoneNumber(auth, `+92${digits}`, recaptchaRef.current),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 15000)
        ),
      ]);
      setConfirmation(result);
      setStep('enter_otp');
      const now = Date.now();
      setSentAt(now);
      setElapsed(0);
      setResendCooldown(60);
      if (isResend) { setOtp(''); setResendLabel('Resend OTP'); }
    } catch (e) {
      const isTimeout = e instanceof Error && e.message === 'timeout';
      if (isTimeout) {
        setError('Request timed out. Tap Resend OTP to try again.');
        if (isResend) setResendLabel('Resend OTP');
        return;
      }
      const code = e instanceof FirebaseError ? e.code : 'unknown';
      const msg  = e instanceof FirebaseError ? e.message : String(e);
      if (code === 'auth/invalid-phone-number')       setError('Invalid phone number format.');
      else if (code === 'auth/too-many-requests')     setError('Too many attempts — wait a few minutes.');
      else if (code === 'auth/captcha-check-failed')  setError('Captcha failed. Try again.');
      else if (code === 'auth/operation-not-allowed') setError('Pakistani numbers blocked. Enable Pakistan (+92) in Firebase Console → Authentication → Settings → SMS region policy.');
      else if (code === 'auth/app-not-authorized')    setError('Phone Auth not enabled. Enable it in Firebase Console → Authentication → Sign-in method.');
      else if (code === 'auth/quota-exceeded')        setError('SMS quota exceeded.');
      else setError(`Failed [${code}]: ${msg}`);
      if (isResend) setResendLabel('Resend OTP');
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    if (!confirmation) { setError('Please request OTP first.'); return; }
    if (otp.length !== 6) { setError('Enter the 6-digit code.'); return; }
    setVerifying(true);
    try {
      await confirmation.confirm(otp);
    } catch {
      setError('Incorrect code — please try again.');
    } finally {
      setVerifying(false);
    }
  }

  function goBack() {
    setStep('enter_phone');
    setOtp('');
    setError(null);
    setSentAt(null);
    setElapsed(0);
    setResendCooldown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaRef}
        firebaseConfig={firebaseConfig}
        attemptInvisibleVerification
        title="Prove you're human!"
        cancelLabel="Close"
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          {/* Brand */}
          <View style={styles.brandRow}>
            <View style={styles.logo}><LogoMark size={28} color="#000" /></View>
            <Text style={styles.brand}>Velocity</Text>
          </View>

          {step === 'enter_phone' ? (
            <>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Enter your mobile number to sign in or create an account.</Text>

              <Text style={styles.label}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixFlag}>🇵🇰</Text>
                  <Text style={styles.prefixCode}>+92</Text>
                </View>
                <TextInput
                  value={phone}
                  onChangeText={(t) => setPhone(stripPhone(t))}
                  keyboardType="phone-pad"
                  placeholder="3001234567"
                  placeholderTextColor={colors.muted}
                  style={styles.phoneInput}
                  maxLength={11}
                  returnKeyType="done"
                  onSubmitEditing={() => sendOtp(false)}
                />
              </View>
              <Text style={styles.hint}>Leading zero is removed automatically</Text>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <PrimaryButton
                label="Send OTP"
                onPress={() => sendOtp(false)}
                loading={sending}
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter code</Text>
              <Text style={styles.subtitle}>
                Sent to{' '}
                <Text style={{ color: colors.primary, fontWeight: '800' }}>+92{phone}</Text>
              </Text>

              {/* Live wait banner */}
              <View style={elapsed >= 60 ? styles.bannerOk : styles.bannerWaiting}>
                <Text style={styles.bannerText}>
                  {elapsed < 30
                    ? `⏳  Waiting for SMS…  (${elapsed}s)`
                    : elapsed < 60
                    ? `⏳  Still waiting…  (${elapsed}s) — check your messages`
                    : '✅  SMS should have arrived — enter the code below'}
                </Text>
                {elapsed < 60 && (
                  <Text style={styles.bannerSub}>
                    Pakistani networks can take up to 60 seconds.
                  </Text>
                )}
              </View>

              <TextInput
                ref={otpRef}
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                placeholder="• • • • • •"
                placeholderTextColor={colors.muted}
                style={styles.otpInput}
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={verifyOtp}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <PrimaryButton
                label="Verify & sign in"
                onPress={verifyOtp}
                loading={verifying}
              />

              <View style={styles.otpFooter}>
                <Pressable onPress={goBack} hitSlop={10}>
                  <Text style={styles.link}>← Change number</Text>
                </Pressable>
                {resendCooldown > 0 ? (
                  <Text style={styles.cooldown}>Resend in {resendCooldown}s</Text>
                ) : (
                  <Pressable onPress={() => sendOtp(true)} disabled={sending} hitSlop={10}>
                    <Text style={[styles.link, sending && { opacity: 0.4 }]}>{resendLabel}</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  flex:      { flex: 1 },
  container: { flex: 1, padding: 28, justifyContent: 'center', gap: 14 },

  brandRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  logo:       { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brand:      { fontSize: 26, fontWeight: '900', color: colors.text },
  title:      { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle:   { fontSize: 15, color: colors.muted, marginBottom: 4 },

  label:     { fontSize: 13, fontWeight: '700', color: colors.text },
  phoneRow:  { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  prefixBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 54, paddingHorizontal: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  prefixFlag: { fontSize: 20 },
  prefixCode: { fontSize: 16, fontWeight: '800', color: colors.text },
  phoneInput: {
    flex: 1, height: 54, borderRadius: 14, borderWidth: 1.5,
    borderColor: colors.border, paddingHorizontal: 16,
    fontSize: 20, fontWeight: '700', color: colors.text, backgroundColor: colors.surface,
  },
  hint:  { fontSize: 11, color: colors.muted, marginTop: -6 },
  error: { color: colors.danger, fontSize: 13, fontWeight: '700' },

  bannerWaiting: {
    borderRadius: 14, padding: 14,
    backgroundColor: '#f59e0b12', borderWidth: 1, borderColor: '#f59e0b35', gap: 4,
  },
  bannerOk: {
    borderRadius: 14, padding: 14,
    backgroundColor: `${colors.primary}12`, borderWidth: 1, borderColor: `${colors.primary}35`,
  },
  bannerText: { fontSize: 13, fontWeight: '700', color: colors.text },
  bannerSub:  { fontSize: 12, color: colors.muted },

  otpInput: {
    height: 68, borderRadius: 16, borderWidth: 2, borderColor: colors.primary,
    paddingHorizontal: 20, fontSize: 34, fontWeight: '900', color: colors.text,
    backgroundColor: colors.surface, textAlign: 'center', letterSpacing: 12,
  },

  otpFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  link:      { color: colors.secondary, fontWeight: '700', fontSize: 13, paddingVertical: 6 },
  cooldown:  { fontSize: 12, color: colors.muted, fontWeight: '600' },
});
