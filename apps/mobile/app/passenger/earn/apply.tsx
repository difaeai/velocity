/**
 * Earn with Velocity — the partner application.
 *
 * Phone verification is a real gate, not a formality. The backend refuses any
 * application whose mobile number is not already on the caller's Firebase Auth
 * record, and a number only lands there once Firebase has verified an SMS code
 * for it. Most users signed in by phone and are therefore already verified — for
 * them this screen shows the number and moves on. Anyone else links a phone here
 * with a real OTP round-trip.
 */
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { PhoneAuthProvider, linkWithCredential } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { auth, firebaseConfig } from '../../../src/firebase';
import { uploadCnicDoc } from '../../../src/lib/uploadDoc';
import { PrimaryButton } from '../../../src/ui/components';
import { pickPhoto } from '../../../src/ui/onboarding';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

/** Formats digits as the user types: 12345-1234567-1. */
function formatCnic(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export default function PartnerApply() {
  const router = useRouter();
  const { user } = useAuth();
  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);

  const [fullName, setFullName] = useState(user?.displayName ?? '');
  const [city, setCity] = useState('');
  const [cnic, setCnic] = useState('');
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Already-verified users never see the OTP step.
  const verifiedPhone = user?.phoneNumber ?? null;
  const [phoneDigits, setPhoneDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);

  const phone = verifiedPhone ?? linkedPhone;

  const valid = useMemo(
    () =>
      fullName.trim().length >= 2 &&
      city.trim().length >= 2 &&
      CNIC_RE.test(cnic) &&
      !!front &&
      !!back &&
      !!phone &&
      terms,
    [fullName, city, cnic, front, back, phone, terms],
  );

  async function sendOtp() {
    const digits = phoneDigits.replace(/\D/g, '').replace(/^0/, '');
    if (digits.length !== 10) {
      Alert.alert('Check the number', 'Enter your 10-digit mobile number, e.g. 3001234567.');
      return;
    }
    if (!recaptchaRef.current) return;
    setLinking(true);
    try {
      const provider = new PhoneAuthProvider(auth);
      const id = await provider.verifyPhoneNumber(`+92${digits}`, recaptchaRef.current);
      setVerificationId(id);
    } catch (e) {
      Alert.alert('Could not send the code', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setLinking(false);
    }
  }

  async function confirmOtp() {
    if (!verificationId || otp.length < 6) return;
    setLinking(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, otp);
      // Links the verified number onto the existing account — which is exactly
      // what the backend checks for. No link, no application.
      const result = await linkWithCredential(auth.currentUser!, credential);
      setLinkedPhone(result.user.phoneNumber);
      setVerificationId(null);
      setOtp('');
    } catch (e) {
      const msg =
        e instanceof FirebaseError && e.code === 'auth/credential-already-in-use'
          ? 'That number is already attached to another Velocity account.'
          : e instanceof FirebaseError && e.code === 'auth/invalid-verification-code'
            ? 'That code is not right. Check the SMS and try again.'
            : 'Could not verify that number.';
      Alert.alert('Verification failed', msg);
    } finally {
      setLinking(false);
    }
  }

  async function submit() {
    if (!valid || !user || !phone) return;
    setSubmitting(true);
    try {
      // Upload first: a submission whose documents failed to upload would sit in
      // the admin queue with broken images and get rejected for no reason.
      const [frontUp, backUp] = await Promise.all([
        uploadCnicDoc(user.uid, 'front', front!),
        uploadCnicDoc(user.uid, 'back', back!),
      ]);

      await api.submitPartnerApplication({
        fullName: fullName.trim(),
        mobile: phone,
        cnicNumber: cnic,
        cnicFrontUrl: frontUp.url,
        cnicBackUrl: backUp.url,
        city: city.trim(),
        acceptedTerms: true,
      });

      Alert.alert(
        'Application submitted',
        'Your application has been submitted successfully. Our team will review your documents. You will receive a notification once your application is approved.',
        [{ text: 'Done', onPress: () => router.replace('/passenger/earn') }],
      );
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaRef}
        firebaseConfig={firebaseConfig}
        attemptInvisibleVerification
      />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>
          Fleet owners handle other people's earnings, so we verify every partner by CNIC before
          approving them.
        </Text>

        <Label>Full name</Label>
        <TextInput
          style={s.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="As printed on your CNIC"
          placeholderTextColor={colors.muted}
        />

        <Label>Mobile number</Label>
        {phone ? (
          <View style={s.verifiedRow}>
            <Text style={s.verifiedText}>✅ {phone}</Text>
            <Text style={s.verifiedHint}>Verified</Text>
          </View>
        ) : verificationId ? (
          <View style={{ gap: 10 }}>
            <TextInput
              style={s.input}
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
            />
            <PrimaryButton label="Verify code" onPress={confirmOtp} loading={linking} disabled={otp.length < 6} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={s.phoneRow}>
              <Text style={s.phonePrefix}>+92</Text>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={phoneDigits}
                onChangeText={setPhoneDigits}
                placeholder="3001234567"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                maxLength={11}
              />
            </View>
            <PrimaryButton label="Send OTP" onPress={sendOtp} loading={linking} variant="secondary" />
          </View>
        )}

        <Label>CNIC number</Label>
        <TextInput
          style={s.input}
          value={cnic}
          onChangeText={(t) => setCnic(formatCnic(t))}
          placeholder="12345-1234567-1"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
        />

        <Label>City</Label>
        <TextInput
          style={s.input}
          value={city}
          onChangeText={setCity}
          placeholder="Lahore"
          placeholderTextColor={colors.muted}
        />

        <Label>CNIC photos</Label>
        <View style={s.uploadRow}>
          <UploadTile label="Front side" uri={front} onPick={() => pickPhoto(setFront)} />
          <UploadTile label="Back side" uri={back} onPick={() => pickPhoto(setBack)} />
        </View>

        <Pressable style={s.termsRow} onPress={() => setTerms((t) => !t)}>
          <View style={[s.checkbox, terms && s.checkboxOn]}>
            {terms ? <Text style={s.checkmark}>✓</Text> : null}
          </View>
          <Text style={s.termsText}>
            I accept the Partner Program terms. I understand I earn only from genuine completed
            rides, and that fake, cancelled or scam rides pay nothing.
          </Text>
        </Pressable>

        <PrimaryButton
          label="Submit application"
          onPress={submit}
          loading={submitting}
          disabled={!valid}
        />
        {!phone ? (
          <Text style={s.blocker}>Verify your mobile number to submit.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

function UploadTile({ label, uri, onPick }: { label: string; uri: string | null; onPick: () => void }) {
  return (
    <Pressable style={s.upload} onPress={onPick}>
      {uri ? (
        <Image source={{ uri }} style={s.uploadImg} resizeMode="cover" />
      ) : (
        <>
          <Text style={s.uploadIcon}>🪪</Text>
          <Text style={s.uploadLabel}>{label}</Text>
          <Text style={s.uploadHint}>Tap to upload</Text>
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, gap: 8, paddingBottom: 44 },

  intro: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 8 },

  label: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    color: colors.text,
    fontSize: 15,
  },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phonePrefix: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    height: 50,
    lineHeight: 48,
    paddingHorizontal: 12,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  verifiedText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  verifiedHint: { color: colors.primary, fontSize: 12, fontWeight: '800' },

  uploadRow: { flexDirection: 'row', gap: 12 },
  upload: {
    flex: 1,
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: 3,
  },
  uploadImg: { width: '100%', height: '100%' },
  uploadIcon: { fontSize: 26 },
  uploadLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  uploadHint: { color: colors.muted, fontSize: 11 },

  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 18, marginBottom: 14 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.btnText, fontSize: 14, fontWeight: '900' },
  termsText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },

  blocker: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
