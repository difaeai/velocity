import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { FirebaseError } from 'firebase/app';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { auth, firebaseConfig } from '../../src/firebase';
import { colors } from '../../src/config';

type Step = 'enter_phone' | 'enter_otp';

const LIME = '#ccff00';
const OTP_LENGTH = 6;

function stripPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('92') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d;
}

/** "3001234567" → "300 1234567" (display only). */
function prettyPhone(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/* ─────────────────────────── Small inline icons ─────────────────────────── */

function BoltIcon({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13.5 2 L6 13.5 L11 13.5 L9.5 22 L18 10 L12.5 10 Z" fill={LIME} />
    </Svg>
  );
}

function ClockIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={LIME} strokeWidth={2} />
      <Path d="M12 7 L12 12 L15.5 14" fill="none" stroke={LIME} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function SmsIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={2.5} y={4} width={19} height={14} rx={3.5} fill="none" stroke={LIME} strokeWidth={2} />
      <Path d="M8 18 L8 21.5 L12 18" fill="none" stroke={LIME} strokeWidth={2} strokeLinejoin="round" />
      <Circle cx={8} cy={11} r={1.3} fill={LIME} />
      <Circle cx={12} cy={11} r={1.3} fill={LIME} />
      <Circle cx={16} cy={11} r={1.3} fill={LIME} />
    </Svg>
  );
}

/* ──────────────────────────────── Screen ────────────────────────────────── */

// LayoutAnimation needs an explicit opt-in on the old Android architecture;
// harmless no-op elsewhere.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SignIn() {
  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);
  const otpRef       = useRef<TextInput>(null);
  const scrollRef    = useRef<ScrollView>(null);

  const [step, setStep]                 = useState<Step>('enter_phone');
  const [phone, setPhone]               = useState('');
  const [otp, setOtp]                   = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [sending, setSending]           = useState(false);   // Send / Resend OTP
  const [verifying, setVerifying]       = useState(false);   // Verify OTP
  const [error, setError]               = useState<string | null>(null);
  // True while the soft keyboard is up. The brand block collapses and the
  // scroll view follows the card, so the input and the Continue button are
  // never left hiding behind the keypad.
  const [kbVisible, setKbVisible]       = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKbVisible(true);
      // After the layout settles, bring the card (input + button) into view.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKbVisible(false);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Resend cooldown timer
  const [sentAt, setSentAt]                 = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (step !== 'enter_otp' || sentAt === null) return;
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - sentAt) / 1000);
      setResendCooldown(Math.max(0, 60 - s));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [step, sentAt]);

  useEffect(() => {
    if (step === 'enter_otp') setTimeout(() => otpRef.current?.focus(), 300);
  }, [step]);

  async function sendOtp(isResend = false) {
    // Reentrancy guard — the keyboard "Done" key and the Send button can both
    // fire. Two concurrent sends orphan one captcha session, which then hangs
    // until its timeout and dumps a phantom "timed out" error on the OTP screen.
    if (sending) return;

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
    setError(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Generous 60-second timeout: when Google escalates to a VISIBLE captcha
      // the user needs time to solve it — a short timeout fires mid-challenge.
      // The timer is cleared once the race settles so it can never fire late.
      const result = await Promise.race([
        signInWithPhoneNumber(auth, `+92${digits}`, recaptchaRef.current),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('timeout')), 60000);
        }),
      ]);
      setConfirmation(result);
      setStep('enter_otp');
      setSentAt(Date.now());
      setResendCooldown(60);
      if (isResend) setOtp('');
    } catch (e) {
      const isTimeout = e instanceof Error && e.message === 'timeout';
      if (isTimeout) {
        setError(isResend
          ? 'Request timed out. Tap Resend to try again.'
          : 'Request timed out. Tap Continue to try again.');
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
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setSending(false);
    }
  }

  async function verifyOtp() {
    if (verifying) return;
    setError(null);
    if (!confirmation) { setError('Please request a code first.'); return; }
    if (otp.length !== OTP_LENGTH) { setError('Enter the 6-digit code.'); return; }
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
    setResendCooldown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function contactSupport() {
    // Placeholder support address until a real support channel ships.
    Linking.openURL('mailto:support@govelocity.pk').catch(() => {});
  }

  const cooldownLabel = `0:${String(resendCooldown % 60).padStart(2, '0')}`;

  /* ─────────────────────────── Phone step UI ──────────────────────────── */

  const phoneStep = (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={styles.phoneContainer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.brandBlock, kbVisible && styles.brandBlockCompact]}>
        <BoltIcon size={kbVisible ? 34 : 56} />
        <Text style={[styles.brandTitle, kbVisible && styles.brandTitleCompact]}>Velocity</Text>
        {kbVisible ? null : (
          <Text style={styles.brandSub}>
            Experience the next generation of urban mobility in Pakistan.
          </Text>
        )}
      </View>

      {/* Welcome card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Welcome Back</Text>

        <Text style={styles.label}>Mobile Number</Text>
        <View style={styles.phoneRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixFlag}>🇵🇰</Text>
            <Text style={styles.prefixCode}>+92</Text>
          </View>
          <View style={styles.phoneDivider} />
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(stripPhone(t))}
            keyboardType="phone-pad"
            placeholder="300 1234567"
            placeholderTextColor="rgba(255,255,255,0.28)"
            style={styles.phoneInput}
            maxLength={11}
            returnKeyType="done"
            onSubmitEditing={() => sendOtp(false)}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, styles.primaryGlow, sending && { opacity: 0.7 }]}
          onPress={() => sendOtp(false)}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.flexSpacer} />

      <Text style={styles.terms}>
        By continuing, you agree to Velocity's <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
        <Text style={styles.termsLink}>Privacy Policy</Text>.
      </Text>
    </ScrollView>
  );

  /* ──────────────────────────── OTP step UI ───────────────────────────── */

  const otpStep = (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={styles.otpContainer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.otpHeader}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.otpBrand}>Velocity</Text>
      </View>

      <Text style={styles.otpTitle}>Verify your number</Text>
      <Text style={styles.otpSub}>We've sent a 6-digit code to</Text>
      <Text style={styles.otpPhone}>+92 {prettyPhone(phone)}</Text>

      {/* 6 code cells over an invisible input */}
      <Pressable style={styles.cellsRow} onPress={() => otpRef.current?.focus()}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.cell, otp.length === i && styles.cellActive]}>
            <Text style={otp[i] ? styles.cellDigit : styles.cellDash}>{otp[i] ?? '–'}</Text>
          </View>
        ))}
        <TextInput
          ref={otpRef}
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          style={styles.hiddenInput}
          caretHidden
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          returnKeyType="done"
          onSubmitEditing={verifyOtp}
        />
      </Pressable>

      {resendCooldown > 0 ? (
        <View style={styles.resendTimerRow}>
          <ClockIcon />
          <Text style={styles.resendTimer}>Resend code in {cooldownLabel}</Text>
        </View>
      ) : null}

      <Pressable onPress={() => sendOtp(true)} disabled={resendCooldown > 0 || sending} hitSlop={8}>
        <Text style={[styles.resendLine, resendCooldown === 0 && !sending && styles.resendReady]}>
          Didn't receive code? <Text style={{ fontWeight: '800' }}>{sending ? 'Sending…' : 'Resend'}</Text>
        </Text>
      </Pressable>

      {error ? <Text style={[styles.error, { textAlign: 'center' }]}>{error}</Text> : null}

      {/* Auto-read card */}
      <View style={styles.autoReadCard}>
        <SmsIcon />
        <View style={styles.flex}>
          <Text style={styles.autoReadTitle}>Auto-reading SMS</Text>
          <Text style={styles.autoReadSub}>We'll automatically detect the code once it arrives.</Text>
        </View>
      </View>

      <View style={styles.flexSpacer} />

      <Pressable
        style={[styles.primaryBtn, verifying && { opacity: 0.7 }]}
        onPress={verifyOtp}
        disabled={verifying}
      >
        {verifying ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
      </Pressable>

      <Text style={styles.supportLine}>
        Having trouble?{' '}
        <Text style={styles.supportLink} onPress={contactSupport}>Contact Support</Text>
      </Text>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Native only: the compat-based captcha modal crashes react-native-web.
          On web sendOtp falls back to the "Captcha not ready" message instead
          of taking the whole route down (it crashed the route before too). */}
      {Platform.OS !== 'web' && (
        <FirebaseRecaptchaVerifierModal
          ref={recaptchaRef}
          firebaseConfig={firebaseConfig}
          attemptInvisibleVerification
          title="Prove you're human!"
          cancelLabel="Close"
        />
      )}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {step === 'enter_phone' ? phoneStep : otpStep}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101210' },
  flex: { flex: 1 },
  flexSpacer: { flexGrow: 1, minHeight: 16 },
  error: { color: colors.danger, fontSize: 13, fontWeight: '700' },

  /* ── Phone step ── */
  phoneContainer: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28 },

  brandBlock: { alignItems: 'center', gap: 10, marginTop: 36, marginBottom: 32 },
  // Keyboard open: the brand shrinks so the card and button stay on screen.
  brandBlockCompact: { gap: 4, marginTop: 4, marginBottom: 14 },
  brandTitle: { fontSize: 36, fontWeight: '900', color: '#ffffff' },
  brandTitleCompact: { fontSize: 24 },
  brandSub: {
    fontSize: 17, lineHeight: 25, color: 'rgba(255,255,255,0.55)',
    textAlign: 'center', paddingHorizontal: 16,
  },

  card: {
    borderRadius: 26,
    padding: 24,
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.18)',
    // Soft lime halo behind the card, like the mock
    shadowColor: LIME,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  cardTitle: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 4 },
  label: { fontSize: 15, color: 'rgba(255,255,255,0.75)' },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderRadius: 30,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  prefix: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefixFlag: { fontSize: 18 },
  prefixCode: { fontSize: 18, fontWeight: '800', color: '#ffffff' },
  phoneDivider: {
    width: 1.5, height: 26, backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 14,
  },
  phoneInput: { flex: 1, fontSize: 19, fontWeight: '600', color: '#ffffff', letterSpacing: 1 },

  primaryBtn: {
    height: 60,
    borderRadius: 30,
    backgroundColor: LIME,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryGlow: {
    shadowColor: LIME,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  primaryBtnText: { fontSize: 21, fontWeight: '800', color: '#0a0d08' },

  terms: {
    fontSize: 14, lineHeight: 21, color: 'rgba(255,255,255,0.6)',
    textAlign: 'center', marginTop: 22, fontWeight: '600',
  },
  termsLink: { color: LIME, fontWeight: '800', textDecorationLine: 'underline' },

  /* ── OTP step ── */
  otpContainer: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 16 },

  otpHeader: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 36 },
  backBtn: { padding: 4 },
  backArrow: { fontSize: 26, color: '#ffffff', fontWeight: '700' },
  otpBrand: { fontSize: 26, fontWeight: '900', color: '#ffffff' },

  otpTitle: { fontSize: 30, fontWeight: '900', color: '#ffffff', textAlign: 'center', marginBottom: 12 },
  otpSub: { fontSize: 18, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  otpPhone: { fontSize: 24, fontWeight: '800', color: LIME, textAlign: 'center', marginTop: 4, marginBottom: 30 },

  cellsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 26 },
  cell: {
    width: 48,
    height: 62,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: LIME, borderWidth: 2 },
  cellDigit: { fontSize: 24, fontWeight: '800', color: '#ffffff' },
  cellDash: { fontSize: 22, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0 },

  resendTimerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginBottom: 14,
  },
  resendTimer: { fontSize: 18, fontWeight: '700', color: LIME },
  resendLine: { fontSize: 17, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 20 },
  resendReady: { color: 'rgba(255,255,255,0.85)' },

  autoReadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 24,
    padding: 20,
    marginTop: 12,
    backgroundColor: 'rgba(204,255,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  autoReadTitle: { fontSize: 17, fontWeight: '800', color: '#ffffff', marginBottom: 4 },
  autoReadSub: { fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.65)' },

  supportLine: {
    fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.55)',
    textAlign: 'center', marginTop: 18, marginBottom: 6,
  },
  supportLink: { color: LIME, textDecorationLine: 'underline', fontWeight: '800' },
});
