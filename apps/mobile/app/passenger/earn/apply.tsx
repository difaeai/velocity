/**
 * Earn with Velocity — the partner application.
 *
 * Two steps, because the old single scroll buried the tier choice under the
 * form. Step 1 is only the choice: Free or Pro, with the rates side by side.
 * Step 2 is the details for whichever tier was picked — so a Free applicant
 * never scrolls past bank accounts that don't apply to them.
 *
 * Two tiers. Free asks for an identity document and a verified mobile, nothing
 * more. Pro asks for the same plus proof that the registration fee was paid,
 * because Pro earns roughly four times what free earns and the fee is the only
 * thing between "a partner" and "anyone who would like the higher rate".
 *
 * The ID doesn't have to be a CNIC — a university card, driving licence or
 * passport also proves who someone is, and students are exactly the people the
 * program wants recruiting. The strict 13-digit format is only enforced when
 * the document actually is a CNIC.
 *
 * The Pro accounts and the fee come from the backend rather than being baked in,
 * so an admin can change a bank account without shipping a new build — and so
 * real account numbers never sit in the repo.
 *
 * Phone verification is a real gate, not a formality: the backend refuses any
 * application whose mobile is not already on the caller's Firebase Auth record,
 * and a number only lands there once Firebase verified an SMS code for it.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import * as Clipboard from 'expo-clipboard';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { PhoneAuthProvider, linkWithCredential } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { api } from '../../../src/api/client';
import type { IdDocType, PartnerTier, PartnerTiers, WithdrawalMethod } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { auth, firebaseConfig } from '../../../src/firebase';
import { uploadCnicDoc, uploadPartnerPaymentProof } from '../../../src/lib/uploadDoc';
import { PrimaryButton } from '../../../src/ui/components';
import { pickPhoto } from '../../../src/ui/onboarding';
import { Skeleton } from '../../../src/ui/partner';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

/** Formats digits as the user types: 12345-1234567-1. */
function formatCnic(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

const pct = (rate: number) => `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 1)}%`;

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "Rs 50,000", "$175", "500 AED" — however the admin configured the fee. */
function feeLabel(amount: number, currency: string): string {
  if (currency === 'PKR') return `Rs ${thousands(amount)}`;
  if (currency === 'USD') return `$${thousands(amount)}`;
  return `${thousands(amount)} ${currency}`;
}

const ID_TYPES: { key: IdDocType; label: string }[] = [
  { key: 'cnic', label: '🪪 CNIC' },
  { key: 'university_card', label: '🎓 University card' },
  { key: 'driving_license', label: '🚗 Driving licence' },
  { key: 'passport', label: '🛂 Passport' },
  { key: 'other', label: '📇 Other ID' },
];

export default function PartnerApply() {
  const router = useRouter();
  const { user } = useAuth();
  const recaptchaRef = useRef<FirebaseRecaptchaVerifierModal>(null);

  const [step, setStep] = useState<'tier' | 'details'>('tier');
  const [tiers, setTiers] = useState<PartnerTiers | null>(null);
  const [tiersError, setTiersError] = useState(false);
  const [tier, setTier] = useState<PartnerTier>('free');

  const [fullName, setFullName] = useState(user?.displayName ?? '');
  const [city, setCity] = useState('');
  const [idType, setIdType] = useState<IdDocType>('cnic');
  const [idNumber, setIdNumber] = useState('');
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pro only.
  const [proof, setProof] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<WithdrawalMethod>('easypaisa');
  const [payRef, setPayRef] = useState('');

  // Already-verified users never see the OTP step.
  const verifiedPhone = user?.phoneNumber ?? null;
  const [phoneDigits, setPhoneDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);

  const phone = verifiedPhone ?? linkedPhone;

  // A silent failure here used to leave a skeleton where the tier picker
  // should be — the user could never see which tier they were applying for.
  // Fail loudly and offer a retry instead.
  const loadTiers = () => {
    setTiersError(false);
    api
      .getPartnerTiers({})
      .then(setTiers)
      .catch(() => setTiersError(true));
  };

  useEffect(loadTiers, []);

  const isPro = tier === 'pro';
  const isCnic = idType === 'cnic';

  const valid = useMemo(
    () =>
      !!tiers &&
      fullName.trim().length >= 2 &&
      city.trim().length >= 2 &&
      (isCnic ? CNIC_RE.test(idNumber) : idNumber.trim().length >= 4) &&
      !!front &&
      // Only a CNIC has a back worth reading; other IDs may be one-sided.
      (!isCnic || !!back) &&
      !!phone &&
      terms &&
      // The one extra thing Pro asks for.
      (!isPro || !!proof),
    [tiers, fullName, city, isCnic, idNumber, front, back, phone, terms, isPro, proof],
  );

  function pickIdType(next: IdDocType) {
    setIdType(next);
    // A number typed for another document won't be CNIC-shaped; reformat what
    // we can and let validation ask for the rest.
    if (next === 'cnic') setIdNumber((n) => formatCnic(n));
  }

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
      const [frontUp, backUp, proofUp] = await Promise.all([
        uploadCnicDoc(user.uid, 'front', front!),
        back ? uploadCnicDoc(user.uid, 'back', back) : Promise.resolve(null),
        isPro && proof ? uploadPartnerPaymentProof(user.uid, proof) : Promise.resolve(null),
      ]);

      await api.submitPartnerApplication({
        tier,
        fullName: fullName.trim(),
        mobile: phone,
        idType,
        cnicNumber: isCnic ? idNumber : idNumber.trim(),
        cnicFrontUrl: frontUp.url,
        ...(backUp ? { cnicBackUrl: backUp.url } : {}),
        city: city.trim(),
        ...(isPro && proofUp
          ? {
              paymentProofUrl: proofUp.url,
              paymentMethod: payMethod,
              ...(payRef.trim() ? { paymentReference: payRef.trim() } : {}),
            }
          : {}),
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

  // ── Step 1: pick a plan ────────────────────────────────────────────────────
  if (step === 'tier') {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.stepBadge}>Step 1 of 2</Text>
          <Text style={s.stepTitle}>Choose your plan</Text>
          <Text style={s.stepSub}>You can start free and upgrade to Pro later.</Text>

          {tiers ? (
            <View style={{ gap: 10, marginTop: 14 }}>
              <TierCard
                active={tier === 'free'}
                onPress={() => setTier('free')}
                name="Free Partner"
                price="No fee"
                driver={pct(tiers.free.driverFleetRate)}
                passenger={pct(tiers.free.passengerFleetRate)}
                note="Just an identity document and your mobile number."
              />
              <TierCard
                active={tier === 'pro'}
                onPress={() => setTier('pro')}
                name="Pro Partner"
                price={`${feeLabel(tiers.proFee, tiers.proFeeCurrency)} one-off`}
                driver={pct(tiers.pro.driverFleetRate)}
                passenger={pct(tiers.pro.passengerFleetRate)}
                note="Pay the registration fee and upload the receipt."
                highlight
              />
            </View>
          ) : tiersError ? (
            <View style={s.tiersErrorCard}>
              <Text style={s.tiersErrorTitle}>Could not load the partner tiers</Text>
              <Text style={s.tiersErrorBody}>
                Check your internet connection and try again. You cannot apply until the tiers load.
              </Text>
              <PrimaryButton label="Retry" onPress={loadTiers} variant="secondary" />
            </View>
          ) : (
            <Skeleton height={190} radius={16} />
          )}

          <Text style={s.rateNote}>
            Rates are a share of Velocity&apos;s commission on each completed ride — not of the fare.
            You never take money from your drivers or riders.
          </Text>

          <View style={{ marginTop: 22 }}>
            <PrimaryButton
              label={isPro ? 'Continue as Pro Partner' : 'Continue as Free Partner'}
              onPress={() => setStep('details')}
              disabled={!tiers}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step 2: the details ────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaRef}
        firebaseConfig={firebaseConfig}
        attemptInvisibleVerification
      />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.stepBadge}>Step 2 of 2</Text>

        <View style={s.selectedBanner}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.selectedBannerText}>
              Applying as: <Text style={s.selectedBannerTier}>{isPro ? 'Pro Partner ⭐' : 'Free Partner'}</Text>
            </Text>
            <Text style={s.selectedBannerHint}>
              {isPro
                ? 'Requires an identity document, a verified mobile number, and the registration fee receipt below.'
                : 'Requires only an identity document and a verified mobile number — no payment.'}
            </Text>
          </View>
          <Pressable onPress={() => setStep('tier')} hitSlop={10}>
            <Text style={s.changePlan}>Change</Text>
          </Pressable>
        </View>

        <Text style={s.label}>Full name</Text>
        <TextInput
          style={s.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="As printed on your ID"
          placeholderTextColor={colors.muted}
        />

        <Text style={s.label}>Mobile number</Text>
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
                style={[s.input, { flex: 1 }]}
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

        <Text style={s.label}>City</Text>
        <TextInput
          style={s.input}
          value={city}
          onChangeText={setCity}
          placeholder="Lahore"
          placeholderTextColor={colors.muted}
        />

        <Text style={s.label}>Identity document</Text>
        <Text style={s.idHint}>
          Any document that proves your identity — CNIC, university card, driving licence or
          passport.
        </Text>
        <View style={s.idTypes}>
          {ID_TYPES.map((t) => (
            <Pressable
              key={t.key}
              style={[s.idType, idType === t.key && s.idTypeOn]}
              onPress={() => pickIdType(t.key)}
            >
              <Text style={[s.idTypeLabel, idType === t.key && s.idTypeLabelOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>{isCnic ? 'CNIC number' : 'ID number'}</Text>
        <TextInput
          style={s.input}
          value={idNumber}
          onChangeText={(t) => setIdNumber(isCnic ? formatCnic(t) : t)}
          placeholder={isCnic ? '12345-1234567-1' : 'Number printed on your ID'}
          placeholderTextColor={colors.muted}
          keyboardType={isCnic ? 'number-pad' : 'default'}
          autoCapitalize="characters"
        />

        <Text style={s.label}>{isCnic ? 'CNIC photos' : 'ID photos'}</Text>
        <View style={s.uploadRow}>
          <UploadTile label="Front side" uri={front} onPick={() => pickPhoto(setFront)} />
          <UploadTile
            label={isCnic ? 'Back side' : 'Back side (optional)'}
            uri={back}
            onPick={() => pickPhoto(setBack)}
          />
        </View>

        {/* ── Pro: pay the fee, then prove it ── */}
        {isPro && tiers ? (
          <>
            <Text style={s.label}>Pay the registration fee</Text>
            <View style={s.payCard}>
              <Text style={s.payFee}>{feeLabel(tiers.proFee, tiers.proFeeCurrency)}</Text>
              <Text style={s.payHint}>Send it to any one of these, then upload the screenshot.</Text>

              <Account
                label="Bank transfer"
                sub={tiers.payment.bankName}
                value={tiers.payment.bankAccount}
              />
              <Account label="Easypaisa" value={tiers.payment.easypaisaAccount} />
              <Account label="JazzCash" value={tiers.payment.jazzcashAccount} />
            </View>

            <Text style={s.label}>Which account did you pay into?</Text>
            <View style={s.methods}>
              {(
                [
                  { key: 'bank', label: '🏦 Bank' },
                  { key: 'easypaisa', label: '📱 Easypaisa' },
                  { key: 'jazzcash', label: '📲 JazzCash' },
                ] as { key: WithdrawalMethod; label: string }[]
              ).map((m) => (
                <Pressable
                  key={m.key}
                  style={[s.method, payMethod === m.key && s.methodOn]}
                  onPress={() => setPayMethod(m.key)}
                >
                  <Text style={[s.methodLabel, payMethod === m.key && s.methodLabelOn]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Transaction ID (optional)</Text>
            <TextInput
              style={s.input}
              value={payRef}
              onChangeText={setPayRef}
              placeholder="Helps us find your payment faster"
              placeholderTextColor={colors.muted}
            />

            <Text style={s.label}>Payment screenshot</Text>
            <UploadTile label="Payment receipt" uri={proof} onPick={() => pickPhoto(setProof)} wide />
          </>
        ) : null}

        <Pressable style={s.termsRow} onPress={() => setTerms((t) => !t)}>
          <View style={[s.checkbox, terms && s.checkboxOn]}>
            {terms ? <Text style={s.checkmark}>✓</Text> : null}
          </View>
          <Text style={s.termsText}>
            I accept the Partner Program terms. I understand I earn only from genuine completed
            rides, and that fake, cancelled or scam rides pay nothing.
            {isPro ? ' I understand the registration fee is non-refundable once approved.' : ''}
          </Text>
        </Pressable>

        <PrimaryButton
          label={isPro ? 'Submit Pro application' : 'Submit application'}
          onPress={submit}
          loading={submitting}
          disabled={!valid}
        />
        {!phone ? <Text style={s.blocker}>Verify your mobile number to submit.</Text> : null}
        {!front || (isCnic && !back) ? (
          <Text style={s.blocker}>Upload your ID {isCnic ? 'photos' : 'photo'} to submit.</Text>
        ) : null}
        {isPro && !proof ? (
          <Text style={s.blocker}>Upload your payment screenshot to submit.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TierCard({
  active,
  onPress,
  name,
  price,
  driver,
  passenger,
  note,
  highlight,
}: {
  active: boolean;
  onPress: () => void;
  name: string;
  price: string;
  driver: string;
  passenger: string;
  note: string;
  highlight?: boolean;
}) {
  return (
    <Pressable style={[s.tier, active && s.tierOn]} onPress={onPress}>
      <View style={s.tierTop}>
        <View style={[s.radio, active && s.radioOn]}>{active ? <View style={s.radioDot} /> : null}</View>
        <View style={{ flex: 1 }}>
          <Text style={s.tierName}>
            {name} {highlight ? '⭐' : ''}
          </Text>
          <Text style={s.tierPrice}>{price}</Text>
        </View>
        {active ? (
          <View style={s.selectedPill}>
            <Text style={s.selectedPillText}>✓ Selected</Text>
          </View>
        ) : null}
      </View>
      <View style={s.tierRates}>
        <View style={{ flex: 1 }}>
          <Text style={s.tierRateVal}>{driver}</Text>
          <Text style={s.tierRateLbl}>Driver fleet</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.tierRateVal}>{passenger}</Text>
          <Text style={s.tierRateLbl}>Passenger fleet</Text>
        </View>
      </View>
      <Text style={s.tierNote}>{note}</Text>
    </Pressable>
  );
}

/** An account number is useless if it cannot be copied — it gets mistyped. */
function Account({ label, sub, value }: { label: string; sub?: string | null; value: string | null }) {
  if (!value) {
    return (
      <View style={s.account}>
        <Text style={s.accountLabel}>{label}</Text>
        <Text style={s.accountMissing}>Not set up yet — contact support</Text>
      </View>
    );
  }
  return (
    <Pressable
      style={s.account}
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        Alert.alert('Copied', `${label} account number copied.`);
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.accountLabel}>
          {label}
          {sub ? ` · ${sub}` : ''}
        </Text>
        <Text style={s.accountValue}>{value}</Text>
      </View>
      <Text style={s.accountCopy}>Copy</Text>
    </Pressable>
  );
}

function UploadTile({
  label,
  uri,
  onPick,
  wide,
}: {
  label: string;
  uri: string | null;
  onPick: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable style={[s.upload, wide && { width: '100%' as const, height: 170 }]} onPress={onPick}>
      {uri ? (
        <Image source={{ uri }} style={s.uploadImg} resizeMode="cover" />
      ) : (
        <>
          <Text style={s.uploadIcon}>{wide ? '🧾' : '🪪'}</Text>
          <Text style={s.uploadLabel}>{label}</Text>
          <Text style={s.uploadHint}>Tap to upload</Text>
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, paddingBottom: 44 },

  stepBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  stepTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 6 },
  stepSub: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },

  label: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 8 },
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

  tier: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  tierOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  tierName: { color: colors.text, fontSize: 16, fontWeight: '900' },
  tierPrice: { color: colors.muted, fontSize: 12, marginTop: 2, fontWeight: '700' },
  tierRates: { flexDirection: 'row', gap: 12 },
  tierRateVal: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  tierRateLbl: { color: colors.muted, fontSize: 11 },
  tierNote: { color: colors.muted, fontSize: 12, lineHeight: 17 },

  rateNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12 },

  selectedPill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  selectedPillText: { color: colors.btnText, fontSize: 11, fontWeight: '900' },

  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  selectedBannerText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  selectedBannerTier: { color: colors.text, fontSize: 14, fontWeight: '900' },
  selectedBannerHint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  changePlan: { color: colors.primary, fontSize: 13, fontWeight: '800' },

  idHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  idTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  idType: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  idTypeOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  idTypeLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  idTypeLabelOn: { color: colors.text },

  tiersErrorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginTop: 14,
  },
  tiersErrorTitle: { color: colors.danger, fontSize: 15, fontWeight: '900' },
  tiersErrorBody: { color: colors.muted, fontSize: 13, lineHeight: 19 },

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

  payCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  payFee: { color: colors.text, fontSize: 28, fontWeight: '900' },
  payHint: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassChip,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  accountLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  accountValue: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  accountMissing: { color: colors.danger, fontSize: 12, marginTop: 2 },
  accountCopy: { color: colors.primary, fontSize: 12, fontWeight: '800' },

  methods: { flexDirection: 'row', gap: 8 },
  method: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  methodLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  methodLabelOn: { color: colors.text },

  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 22, marginBottom: 14 },
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
