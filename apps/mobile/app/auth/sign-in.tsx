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
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { startPhoneVerification, type PhoneVerification } from '../../src/auth/phoneSignIn';
import { colors } from '../../src/config';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '../../src/share/links';
import { themed } from '../../src/theme';
import { describePhoneAuthError, SMS_THROTTLE_COOLDOWN_MS } from '../../src/lib/phoneAuthErrors';
import { checkOtpSendAllowed, noteOtpSendAttempt, noteOtpThrottled } from '../../src/auth/otpGuard';
import { RESEND_UI_COOLDOWN_S } from '../../src/lib/otpThrottle';

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

/**
 * The red failure line, with the native diagnostic hidden behind a long-press.
 *
 * A passenger sees a plain sentence and nothing else. But when the cause is a
 * project misconfiguration the sentence alone cannot be acted on by anybody —
 * the Android SDK's own text is the only thing that names the console setting at
 * fault, and this app ships signed by Play, so there is no debug build to
 * reproduce it on. A long-press is discoverable enough for whoever needs it and
 * invisible to everyone else.
 */
function ErrorLine({
  error,
  detail,
  shown,
  onReveal,
  centered = false,
}: {
  error: string | null;
  detail: string | null;
  shown: boolean;
  onReveal: () => void;
  centered?: boolean;
}) {
  if (!error) return null;
  const align = centered ? ({ textAlign: 'center' } as const) : undefined;
  return (
    <View>
      <Text
        style={[styles.error, align]}
        onLongPress={detail ? onReveal : undefined}
        suppressHighlighting
      >
        {error}
      </Text>
      {detail && shown ? (
        <Text selectable style={[styles.errorDetail, align]}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/* ──────────────────────────────── Screen ────────────────────────────────── */

// LayoutAnimation needs an explicit opt-in on the old Android architecture;
// harmless no-op elsewhere.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SignIn() {
  const otpRef       = useRef<TextInput>(null);
  const scrollRef    = useRef<ScrollView>(null);

  const [step, setStep]                 = useState<Step>('enter_phone');
  const [phone, setPhone]               = useState('');
  const [otp, setOtp]                   = useState('');
  const [confirmation, setConfirmation] = useState<PhoneVerification | null>(null);
  const [sending, setSending]           = useState(false);   // Send / Resend OTP
  const [verifying, setVerifying]       = useState(false);   // Verify OTP
  const [error, setErrorText]           = useState<string | null>(null);
  // The native SDK's own words about why a send failed, kept aside rather than
  // shown. A passenger must never read a Firebase exception — but when the cause
  // is a project misconfiguration, this string names the console setting that
  // needs changing, and it is the only place that information exists. Long-press
  // the red line to reveal it.
  const [errorDetail, setErrorDetail]   = useState<string | null>(null);
  const [detailShown, setDetailShown]   = useState(false);

  /**
   * Sets the red line, and the diagnostic that belongs to it.
   *
   * Every error path goes through here so the two can never drift apart: a stale
   * native message left attached to a new, unrelated failure would send whoever
   * reads it chasing a problem that is no longer happening. Callers with nothing
   * to attach simply omit the second argument and the old one is dropped.
   */
  function setError(message: string | null, detail?: string) {
    setErrorText(message);
    setErrorDetail(detail && detail.length ? detail : null);
    setDetailShown(false);
  }
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
      setResendCooldown(Math.max(0, RESEND_UI_COOLDOWN_S - s));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [step, sentAt]);

  useEffect(() => {
    if (step === 'enter_otp') setTimeout(() => otpRef.current?.focus(), 300);
  }, [step]);

  // A ref, not the `sending` state: `sendOtp` awaits the local send brake before
  // it flips `sending`, and two taps landing in that window would both read the
  // stale `false` and spend two SMS against Firebase's per-number throttle.
  const sendingRef = useRef(false);

  function adoptConfirmation(result: PhoneVerification, isResend: boolean) {
    setConfirmation(result);
    setStep('enter_otp');
    setSentAt(Date.now());
    setResendCooldown(RESEND_UI_COOLDOWN_S);
    if (isResend) setOtp('');
  }

  async function sendOtp(isResend = false) {
    if (sendingRef.current) return;

    setError(null);
    const digits = stripPhone(phone);
    setPhone(digits);

    if (digits.length !== 10 || !digits.startsWith('3')) {
      setError('Enter a valid Pakistani mobile number, e.g. 3001234567');
      return;
    }
    sendingRef.current = true;
    try {
      // Firebase throttles sendVerificationCode per number *and* per device, and
      // answers a throttled call with an unmapped numeric code that used to land
      // on this screen as "Failed [auth/error-code:-39]". The brake keeps us under
      // that ceiling instead of discovering it the hard way.
      const blocked = await checkOtpSendAllowed(digits);
      if (blocked) { setError(blocked); return; }

      setSending(true);
      await noteOtpSendAttempt(digits);

      // Patience timer, not an abort: the SMS is already on its way once the
      // request lands, so we free the button and say so, but a result that shows
      // up late is still adopted. Racing it away told the user to "try again" and
      // spent a second SMS on a code that already worked.
      let landed = false;
      const patience = setTimeout(() => {
        if (landed) return;
        // Release the reentrancy guard too, or the button we just re-enabled would
        // silently do nothing. What a retry is allowed to do is the brake's call,
        // not this timer's.
        sendingRef.current = false;
        setSending(false);
        setError('Still sending — Pakistani networks can be slow. Give it a few seconds.');
      }, 60000);

      try {
        // Any previous attempt's listener must go, or an auto-verification from the
        // number the user just abandoned could sign them in as someone else.
        confirmation?.cancel();
        const result = await startPhoneVerification(`+92${digits}`, (autoError) => {
          // Android read the SMS itself. On success the JS-SDK session is already
          // live and the root layout navigates away. Clear any error still on
          // screen from an earlier attempt: leaving it there means the last thing
          // the user sees before landing on the home screen is a red failure
          // message about something that has just succeeded.
          if (!autoError) { setError(null); return; }

          // A failure HERE is not a failure to send. The SMS went out, Android
          // read it, and the number is verified — only the hand-off into the
          // app's own session broke. Running it through describePhoneAuthError
          // printed "Could not send the code right now", which is untrue and
          // sends the user off resending codes they already have. Their next tap
          // retries exactly the part that failed (see phoneSignIn's confirm()),
          // so this asks for that instead of raising an alarm.
          setError('Almost there — tap Verify to finish signing in.');
        });
        landed = true;
        adoptConfirmation(result, isResend);
      } catch (e) {
        landed = true;
        const { message, throttled, misconfigured, detail } = describePhoneAuthError(e);
        // Sit out a server-side throttle locally, with a countdown, rather than
        // letting retries extend it.
        if (throttled) await noteOtpThrottled(digits, SMS_THROTTLE_COOLDOWN_MS);
        // A project misconfiguration will fail identically on every retry, so the
        // native text is the only thing that moves it forward. Put it in logcat
        // for whoever is holding a cable, and behind a long-press for whoever is
        // holding the phone.
        if (misconfigured && detail) console.warn('[phone-auth] send refused:', detail);
        setError(message, misconfigured ? detail : undefined);
      } finally {
        clearTimeout(patience);
        setSending(false);
      }
    } finally {
      sendingRef.current = false;
    }
  }

  // A ref, not the `verifying` state: two calls landing in the same render batch
  // (the 6th digit and the keyboard's Done key) would both read the stale
  // `false` and fire two confirms against one code.
  const verifyingRef = useRef(false);

  async function verifyOtp(codeArg?: string) {
    const code = codeArg ?? otp;
    if (verifyingRef.current) return;
    setError(null);
    if (!confirmation) { setError('Please request a code first.'); return; }
    // Auto-verification leaves the boxes empty by design — the user never had to
    // type anything. Demanding six digits then would block the retry that is the
    // only way out of a failed hand-off.
    if (!confirmation.verifiedNatively() && code.length !== OTP_LENGTH) {
      setError('Enter the 6-digit code.');
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    try {
      // Resolving means the code was right *and* the native verification has been
      // traded for a JS-SDK session; the root layout navigates on auth state.
      await confirmation.confirm(code);
      Keyboard.dismiss();
    } catch (e) {
      // "Incorrect code" is a lie when the code simply aged out, the account is
      // throttled, or the session exchange failed — the user retypes the same
      // digits and fails again.
      const failCode = (e as { code?: string } | null)?.code ?? '';
      if (failCode === 'auth/code-expired' || failCode === 'auth/session-expired')
        setError('That code has expired. Tap Resend for a new one.');
      else if (failCode === 'auth/too-many-requests')
        setError('Too many attempts. Please wait a while before trying again.');
      else if (failCode.startsWith('functions/') || failCode === 'auth/network-request-failed')
        setError('Your code was accepted but sign-in did not finish. Check your connection and tap Verify again.');
      else setError('Incorrect code — please try again.');
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }

  /**
   * Typing (or SMS-autofilling) the last digit verifies on its own — nobody
   * should have to hunt for a button after entering a code they were just told.
   * The code is passed explicitly because `otp` state has not re-rendered yet at
   * this point. Verify stays on screen as the retry affordance after a bad code.
   */
  function onOtpChange(raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(next);
    if (next.length === OTP_LENGTH) verifyOtp(next);
  }

  function goBack() {
    // Drop the auto-verification watcher with the number it belonged to, so a late
    // SMS for an abandoned number cannot sign the user in behind their back.
    confirmation?.cancel();
    setConfirmation(null);
    setStep('enter_phone');
    setOtp('');
    setError(null);
    setSentAt(null);
    setResendCooldown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  // Same reason, for leaving the screen entirely.
  useEffect(() => () => confirmation?.cancel(), [confirmation]);

  function contactSupport() {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
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

        <ErrorLine
          error={error}
          detail={errorDetail}
          shown={detailShown}
          onReveal={() => setDetailShown(true)}
        />

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
        By continuing, you agree to Velocity&apos;s{' '}
        <Text
          style={styles.termsLink}
          onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}
        >
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          style={styles.termsLink}
          onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
        >
          Privacy Policy
        </Text>
        .
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
          onChangeText={onOtpChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          style={styles.hiddenInput}
          caretHidden
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          returnKeyType="done"
          onSubmitEditing={() => verifyOtp()}
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

      <ErrorLine
        error={error}
        detail={errorDetail}
        shown={detailShown}
        onReveal={() => setDetailShown(true)}
        centered
      />


      {/* Auto-read card */}
      <View style={styles.autoReadCard}>
        <SmsIcon />
        <View style={styles.flex}>
          <Text style={styles.autoReadTitle}>{verifying ? 'Verifying your code…' : 'Auto-reading SMS'}</Text>
          <Text style={styles.autoReadSub}>
            {verifying
              ? 'Hang on — checking the code you entered.'
              : "We'll detect the code once it arrives and verify it for you."}
          </Text>
        </View>
      </View>

      <View style={styles.flexSpacer} />

      {/* Verification starts on the last digit — this is the retry affordance
          for a code that came back wrong, not the normal way through. */}
      <Pressable
        style={[styles.primaryBtn, verifying && { opacity: 0.7 }]}
        onPress={() => verifyOtp()}
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
      {/* No captcha component any more: verification is native and attested by
          Play Integrity, so there is no hidden WebView to mount. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {step === 'enter_phone' ? phoneStep : otpStep}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101210' },
  flex: { flex: 1 },
  flexSpacer: { flexGrow: 1, minHeight: 16 },
  error: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  // Selectable so the text can be copied into a bug report rather than retyped
  // off a photograph of the screen.
  errorDetail: { color: colors.muted, fontSize: 11, marginTop: 6, lineHeight: 15 },

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
}));
