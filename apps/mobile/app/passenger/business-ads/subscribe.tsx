/**
 * Find your Customers — buying a campaign.
 *
 * Three steps, in the order the decisions actually get made:
 *
 *   1. THE OFFER + THE RADIUS. The radius is the price, so it belongs next to
 *      the offer rather than buried after it — every tap on the radius chips
 *      re-prices the plan in front of them, and the ad-slot count changes with
 *      it. The offer itself is captured here (not after approval) because the
 *      reviewer has to see what would be pushed to thousands of phones before
 *      saying yes to it.
 *   2. THE PLAN. 3, 6 or 12 months × the band's monthly fee, paid in one go.
 *   3. THE TRANSFER. Our accounts, their screenshot, their reference.
 *
 * Prices, bands and accounts all come from the backend, so they can change
 * without a new build and no real account number sits in the repo.
 *
 * The shop's coordinates come from the device, because "within 3 km" has to be
 * 3 km of somewhere real. There is no address-only path: a typed address we
 * cannot geocode would silently produce a campaign centred on nothing.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { api } from '../../../src/api/client';
import type {
  BusinessAdPaymentMethod,
  BusinessAdPlanMonths,
  BusinessAdPlans,
  BusinessAdTier,
} from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { useCurrentLocation } from '../../../src/hooks/location';
import {
  uploadBusinessAdImage,
  uploadBusinessAdPaymentProof,
} from '../../../src/lib/uploadDoc';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';
import { pickPhoto } from '../../../src/ui/onboarding';
import { ErrorState, formatPKR, Skeleton } from '../../../src/ui/partner';

/** Radius options, in km. The band each one falls into comes from the backend. */
const RADIUS_STEPS = [1, 2, 3, 4, 5];

const METHODS: { key: BusinessAdPaymentMethod; label: string }[] = [
  { key: 'easypaisa', label: 'Easypaisa' },
  { key: 'jazzcash', label: 'JazzCash' },
  { key: 'bank', label: 'Bank transfer' },
];

export default function BusinessAdSubscribe() {
  const router = useRouter();
  const { user } = useAuth();
  const location = useCurrentLocation();

  const [plans, setPlans] = useState<BusinessAdPlans | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — the offer and the reach.
  const [businessName, setBusinessName] = useState('');
  const [title, setTitle] = useState('');
  const [offerDetails, setOfferDetails] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [city, setCity] = useState('');
  /**
   * Null until they type: the field then shows the device's reverse-geocoded
   * street, which is a better first guess at the shop address than a blank box.
   * Derived rather than copied into state — syncing it in an effect would fight
   * whatever they were in the middle of typing.
   */
  const [addressEdit, setAddressEdit] = useState<string | null>(null);
  const address = addressEdit ?? location.address ?? '';
  const [contactPhone, setContactPhone] = useState('');
  const [radiusKm, setRadiusKm] = useState(3);

  // Step 2 — how long.
  const [months, setMonths] = useState<BusinessAdPlanMonths>(3);

  // Step 3 — the transfer.
  const [method, setMethod] = useState<BusinessAdPaymentMethod>('easypaisa');
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function loadPlans() {
    setPlansError(false);
    api
      .getBusinessAdPlans({})
      .then((p) => {
        setPlans(p);
        // The backend decides which plan lengths are on sale; if the one we
        // defaulted to isn't, fall back to the shortest that is.
        const first = p.planMonths[0];
        if (first && !p.planMonths.includes(months)) setMonths(first);
      })
      .catch(() => setPlansError(true));
  }

  useEffect(loadPlans, []);

  const tier: BusinessAdTier | null = useMemo(() => {
    if (!plans || plans.tiers.length === 0) return null;
    return (
      plans.tiers.find((t) => radiusKm <= t.maxRadiusKm) ??
      plans.tiers[plans.tiers.length - 1] ??
      null
    );
  }, [plans, radiusKm]);

  const monthlyFee = tier?.monthlyFee ?? 0;
  const totalFee = monthlyFee * months;

  const step1Valid =
    businessName.trim().length >= 2 &&
    title.trim().length >= 3 &&
    offerDetails.trim().length >= 5 &&
    !!imageUri &&
    city.trim().length >= 2 &&
    contactPhone.trim().length >= 7;

  async function submit() {
    if (!user) return;
    if (!location.coords) {
      Alert.alert(
        'We need your shop location',
        'Allow location access while standing at your business, so we know the centre of your radius.',
        [{ text: 'OK', onPress: location.request }],
      );
      return;
    }
    if (!imageUri || !proofUri) return;

    setSubmitting(true);
    try {
      const [image, proof] = await Promise.all([
        uploadBusinessAdImage(user.uid, imageUri),
        uploadBusinessAdPaymentProof(user.uid, proofUri),
      ]);

      await api.submitBusinessAdApplication({
        radiusKm,
        months,
        lat: location.coords.lat,
        lng: location.coords.lng,
        address: address.trim() || undefined,
        city: city.trim(),
        contactPhone: contactPhone.trim(),
        creative: {
          title: title.trim(),
          businessName: businessName.trim(),
          offerDetails: offerDetails.trim(),
          imageUrl: image.url,
        },
        paymentProofUrl: proof.url,
        paymentMethod: method,
        paymentReference: reference.trim() || undefined,
        acceptedTerms: true,
      });

      router.replace('/passenger/business-ads');
      Alert.alert(
        'Sent for approval',
        'We are checking your payment. You will get a notification as soon as your advertising is approved.',
      );
    } catch (e) {
      Alert.alert('Could not submit', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => (step === 1 ? router.back() : setStep(step === 3 ? 2 : 1))} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Step {step} of 3</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
      </View>

      {plansError ? (
        <View style={{ padding: 16 }}>
          <ErrorState message="Could not load the advertising prices." onRetry={loadPlans} />
        </View>
      ) : !plans || !tier ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={120} />
          <Skeleton height={90} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <Text style={styles.stepTitle}>Your offer</Text>
              <Text style={styles.stepSub}>
                This is exactly what people near you will see in their notification.
              </Text>

              <Pressable style={styles.photoPicker} onPress={() => pickPhoto(setImageUri)}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.photo} />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Text style={styles.photoEmptyIcon}>🖼️</Text>
                    <Text style={styles.photoEmptyTxt}>Add your offer picture</Text>
                    <Text style={styles.photoEmptyHint}>Shown inside the notification</Text>
                  </View>
                )}
              </Pressable>

              <View style={styles.inputCard}>
                <TextInput
                  style={styles.field}
                  placeholder="Business name"
                  placeholderTextColor={colors.muted}
                  value={businessName}
                  onChangeText={setBusinessName}
                />
                <View style={styles.divider} />
                <TextInput
                  style={styles.field}
                  placeholder="Offer title — e.g. 30% off all pizzas"
                  placeholderTextColor={colors.muted}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={80}
                />
              </View>

              <TextInput
                style={styles.textarea}
                placeholder="Offer details — what's included, and until when"
                placeholderTextColor={colors.muted}
                value={offerDetails}
                onChangeText={setOfferDetails}
                multiline
                maxLength={600}
              />

              <Text style={styles.sectionLabel}>YOUR BUSINESS</Text>
              <View style={styles.inputCard}>
                <TextInput
                  style={styles.field}
                  placeholder="City"
                  placeholderTextColor={colors.muted}
                  value={city}
                  onChangeText={setCity}
                />
                <View style={styles.divider} />
                <TextInput
                  style={styles.field}
                  placeholder="Shop address (optional)"
                  placeholderTextColor={colors.muted}
                  value={address}
                  onChangeText={setAddressEdit}
                />
                <View style={styles.divider} />
                <TextInput
                  style={styles.field}
                  placeholder="Contact number"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  value={contactPhone}
                  onChangeText={setContactPhone}
                />
              </View>

              <View style={location.coords ? styles.locOk : styles.locWarn}>
                <Text style={location.coords ? styles.locOkTxt : styles.locWarnTxt}>
                  {location.coords
                    ? '📍 Using your current location as the centre of your radius.'
                    : '📍 Stand at your business and allow location — it sets the centre of your radius.'}
                </Text>
                {!location.coords ? (
                  <Pressable onPress={location.request} hitSlop={8}>
                    <Text style={styles.locBtn}>Allow</Text>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.sectionLabel}>HOW FAR TO REACH</Text>
              <View style={styles.radiusRow}>
                {RADIUS_STEPS.filter((km) => km <= plans.maxRadiusKm).map((km) => (
                  <Pressable
                    key={km}
                    style={[styles.radiusChip, radiusKm === km && styles.radiusChipOn]}
                    onPress={() => setRadiusKm(km)}
                  >
                    <Text style={[styles.radiusTxt, radiusKm === km && { color: colors.primary }]}>
                      {km} km
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.quoteCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quoteAmount}>{formatPKR(monthlyFee)}</Text>
                  <Text style={styles.quoteMeta}>
                    per month · {tier.adSlots} offer{tier.adSlots === 1 ? '' : 's'} running at a time
                  </Text>
                </View>
                <Text style={styles.quoteRadius}>{radiusKm} km</Text>
              </View>
              <Text style={styles.hint}>
                Everyone inside your radius gets your offer as a notification, and
                again every {plans.notifyCooldownHours} hours while your plan runs.
              </Text>

              <PrimaryButton
                label="Choose your plan →"
                disabled={!step1Valid}
                onPress={() => {
                  if (!step1Valid) {
                    Alert.alert('Almost there', 'Add your picture, offer and business details first.');
                    return;
                  }
                  setStep(2);
                }}
              />
              {!step1Valid ? (
                <Text style={styles.blockerHint}>
                  Needed: picture, business name, offer title, offer details, city and contact number.
                </Text>
              ) : null}
            </>
          ) : step === 2 ? (
            <>
              <Text style={styles.stepTitle}>How long?</Text>
              <Text style={styles.stepSub}>
                One transfer covers the whole plan — {formatPKR(monthlyFee)} per month for
                your {radiusKm} km radius.
              </Text>

              {plans.planMonths.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.planRow, months === m && styles.planRowOn]}
                  onPress={() => setMonths(m)}
                >
                  <View style={[styles.radio, months === m && styles.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{m === 12 ? '1 year' : `${m} months`}</Text>
                    <Text style={styles.planMeta}>{formatPKR(monthlyFee)} × {m} months</Text>
                  </View>
                  <Text style={styles.planTotal}>{formatPKR(monthlyFee * m)}</Text>
                </Pressable>
              ))}

              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>One-time payment</Text>
                <Text style={styles.totalAmount}>{formatPKR(totalFee)}</Text>
                <Text style={styles.totalMeta}>
                  {radiusKm} km · {tier.adSlots} offer{tier.adSlots === 1 ? '' : 's'} ·{' '}
                  {months === 12 ? '1 year' : `${months} months`}
                </Text>
              </View>

              <PrimaryButton label="Continue to payment →" onPress={() => setStep(3)} />
            </>
          ) : (
            <>
              <Text style={styles.stepTitle}>Send {formatPKR(totalFee)}</Text>
              <Text style={styles.stepSub}>
                Transfer to one of the accounts below, then upload the screenshot.
              </Text>

              <View style={styles.methodRow}>
                {METHODS.map((m) => (
                  <Pressable
                    key={m.key}
                    style={[styles.methodChip, method === m.key && styles.methodChipOn]}
                    onPress={() => setMethod(m.key)}
                  >
                    <Text style={[styles.methodTxt, method === m.key && { color: colors.primary }]}>
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <AccountCard plans={plans} method={method} />

              <Pressable style={styles.photoPicker} onPress={() => pickPhoto(setProofUri)}>
                {proofUri ? (
                  <Image source={{ uri: proofUri }} style={styles.photo} />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Text style={styles.photoEmptyIcon}>🧾</Text>
                    <Text style={styles.photoEmptyTxt}>Upload payment screenshot</Text>
                    <Text style={styles.photoEmptyHint}>Our team checks it by hand</Text>
                  </View>
                )}
              </Pressable>

              <TextInput
                style={styles.field2}
                placeholder="Transaction ID / reference (optional)"
                placeholderTextColor={colors.muted}
                value={reference}
                onChangeText={setReference}
              />

              <View style={styles.termsCard}>
                <Text style={styles.termsTxt}>
                  By submitting you agree that Velocity reviews your offer before it
                  goes out, and may take down an offer that misleads users. Your plan
                  starts the day it is approved.
                </Text>
              </View>

              <PrimaryButton
                label={submitting ? 'Submitting…' : `Submit for approval · ${formatPKR(totalFee)}`}
                loading={submitting}
                disabled={!proofUri || submitting}
                onPress={submit}
              />
              {!proofUri ? (
                <Text style={styles.blockerHint}>Upload your payment screenshot to submit.</Text>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * The account to pay into, for whichever rail they picked. Copy-to-clipboard
 * rather than "type this 16-digit number correctly off a phone screen".
 */
function AccountCard({
  plans,
  method,
}: {
  plans: BusinessAdPlans;
  method: BusinessAdPaymentMethod;
}) {
  const p = plans.payment;
  const account =
    method === 'bank' ? p.bankAccount : method === 'easypaisa' ? p.easypaisaAccount : p.jazzcashAccount;
  const title =
    method === 'bank'
      ? p.bankAccountTitle
      : method === 'easypaisa'
        ? p.easypaisaTitle
        : p.jazzcashTitle;

  if (!account) {
    return (
      <View style={styles.accountCard}>
        <Text style={styles.accountMissing}>
          This account isn&apos;t set up yet. Pick another method, or contact support.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.accountCard}>
      {method === 'bank' && p.bankName ? <Text style={styles.accountBank}>{p.bankName}</Text> : null}
      <Text style={styles.accountNumber}>{account}</Text>
      {title ? <Text style={styles.accountTitle}>Account title: {title}</Text> : null}
      <Pressable
        style={styles.copyBtn}
        onPress={() => {
          void Clipboard.setStringAsync(account);
          Alert.alert('Copied', 'Account number copied.');
        }}
      >
        <Text style={styles.copyTxt}>Copy number</Text>
      </Pressable>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 14, fontWeight: '800', color: colors.muted },
  progressTrack: { height: 3, backgroundColor: colors.border },
  progressFill: { height: 3, backgroundColor: colors.primary },

  body: { padding: 16, paddingBottom: 44, gap: 12 },
  stepTitle: { fontSize: 22, fontWeight: '900', color: colors.text },
  stepSub: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19, marginBottom: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginTop: 6,
  },
  hint: { fontSize: 11, color: colors.muted, fontWeight: '600', lineHeight: 16 },
  blockerHint: { fontSize: 11, color: colors.muted, fontWeight: '600', textAlign: 'center' },

  photoPicker: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: 180 },
  photoEmpty: { height: 150, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoEmptyIcon: { fontSize: 28 },
  photoEmptyTxt: { fontSize: 14, fontWeight: '800', color: colors.text },
  photoEmptyHint: { fontSize: 11, fontWeight: '600', color: colors.muted },

  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  field: { height: 48, paddingHorizontal: 16, fontSize: 14, fontWeight: '600', color: colors.text },
  field2: {
    height: 48,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  textarea: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    height: 96,
    textAlignVertical: 'top',
  },

  locOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.glassLime,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    padding: 12,
  },
  locOkTxt: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.text, lineHeight: 16 },
  locWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  locWarnTxt: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.muted, lineHeight: 16 },
  locBtn: { fontSize: 12, fontWeight: '900', color: colors.primary },

  radiusRow: { flexDirection: 'row', gap: 8 },
  radiusChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radiusChipOn: { borderColor: colors.primary, backgroundColor: colors.glassLime, borderWidth: 1.5 },
  radiusTxt: { fontSize: 13, fontWeight: '800', color: colors.text },

  quoteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.glassLime,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 16,
  },
  quoteAmount: { fontSize: 22, fontWeight: '900', color: colors.primary },
  quoteMeta: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 2 },
  quoteRadius: { fontSize: 16, fontWeight: '900', color: colors.text },

  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  planRowOn: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.glassLime },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  planName: { fontSize: 15, fontWeight: '900', color: colors.text },
  planMeta: { fontSize: 11, fontWeight: '600', color: colors.muted, marginTop: 1 },
  planTotal: { fontSize: 15, fontWeight: '900', color: colors.text },

  totalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 2,
    marginTop: 4,
  },
  totalLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.5 },
  totalAmount: { fontSize: 28, fontWeight: '900', color: colors.primary },
  totalMeta: { fontSize: 12, fontWeight: '600', color: colors.muted },

  methodRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  methodChipOn: { borderColor: colors.primary, backgroundColor: colors.glassLime, borderWidth: 1.5 },
  methodTxt: { fontSize: 12, fontWeight: '800', color: colors.text },

  accountCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  accountBank: { fontSize: 12, fontWeight: '800', color: colors.muted },
  accountNumber: { fontSize: 20, fontWeight: '900', color: colors.text, letterSpacing: 0.5 },
  accountTitle: { fontSize: 12, fontWeight: '600', color: colors.muted },
  accountMissing: { fontSize: 12, fontWeight: '700', color: colors.danger, lineHeight: 18 },
  copyBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  copyTxt: { fontSize: 12, fontWeight: '900', color: colors.primary },

  termsCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  termsTxt: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 17 },
}));
