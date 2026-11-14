/**
 * Find your Customers — buying an ad.
 *
 * THE RADIUS IS THE PRICE (owner, 2026-11-14)
 * -------------------------------------------
 * One ad is Rs 300 and reaches a kilometre; every kilometre after that is
 * Rs 60. So there is no price list to read and no plan to choose: there is a
 * slider, and the figure above it moves as the thumb does. The three bands and
 * the 3/6/12-month plans this replaced are gone — they made a shopkeeper read a
 * table before they could find out what their own shop would cost.
 *
 * The slider stops at 50 km because that is where the screen runs out; past
 * that the box underneath takes a typed number and prices it the same way.
 *
 * TWO STEPS, NOT THREE
 * The offer and its reach, then the transfer. The plan step had nothing left in
 * it once the months went.
 *
 * IT IS PRICED ON THE FIRST FRAME
 * The ladder is four numbers and the app ships them (src/lib/adPricing), so
 * nothing on this screen waits for a cold function: `getBusinessAdPlans` is
 * still read through the cache and still overrides them the moment it lands,
 * which is what keeps a reprice a config change rather than a release. The
 * server re-derives the price when the application arrives, so what the phone
 * works out is what the screen shows, never what anybody is charged.
 *
 * THE MONEY
 * Rupees throughout (owner, 2026-11-14): the price on the slider is the figure
 * the payment step asks them to transfer, which is also what Easypaisa,
 * JazzCash and a bank transfer actually move.
 *
 * The shop's coordinates come from the device, because "within 3 km" has to be
 * 3 km of somewhere real. There is no address-only path: a typed address we
 * cannot geocode would silently produce a campaign centred on nothing.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { api } from '../../../src/api/client';
import type {
  BusinessAdPaymentMethod,
  BusinessAdPlans,
} from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { useCurrentLocation } from '../../../src/hooks/location';
import { useCachedResource } from '../../../src/lib/cachedResource';
import {
  adPrice,
  adPricing,
  RADIUS_PICKER_MAX_KM,
  type AdPricing,
} from '../../../src/lib/adPricing';
import {
  uploadBusinessAdImage,
  uploadBusinessAdPaymentProof,
} from '../../../src/lib/uploadDoc';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';
import { Glass } from '../../../src/ui/Glass';
import { pickPhoto } from '../../../src/ui/onboarding';
import { formatPKR } from '../../../src/ui/partner';

/** The jumps the chips offer. Anything between them is a drag of the slider. */
const RADIUS_STEPS = [1, 2, 5, 10, 25, 50];

const METHODS: { key: BusinessAdPaymentMethod; label: string }[] = [
  { key: 'easypaisa', label: 'Easypaisa' },
  { key: 'jazzcash', label: 'JazzCash' },
  { key: 'bank', label: 'Bank transfer' },
];

export default function BusinessAdSubscribe() {
  const router = useRouter();
  const { user } = useAuth();
  const location = useCurrentLocation();

  /**
   * The ladder, from the cache first and the server a moment later. Nothing
   * renders behind it — `adPricing` falls back to this build's own numbers — so
   * the screen is complete on its first frame even on a cold function.
   */
  const { data: plans } = useCachedResource<BusinessAdPlans>(
    'businessAdPlans',
    () => api.getBusinessAdPlans({}),
    'Could not load the advertising prices.',
  );
  const pricing = adPricing(plans);
  const [step, setStep] = useState<1 | 2>(1);

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
  const [radiusKm, setRadiusKm] = useState(1);

  // Step 2 — the transfer.
  const [method, setMethod] = useState<BusinessAdPaymentMethod>('easypaisa');
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const price = adPrice(pricing, radiusKm);

  // The step slides in rather than cutting: the screen is one flow, and a card
  // arriving from the right says "next" without a word.
  const [turn] = useState(() => new Animated.Value(1));
  useEffect(() => {
    turn.setValue(0);
    Animated.timing(turn, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [step, turn]);

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
        <Pressable onPress={() => (step === 1 ? router.back() : setStep(1))} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Step {step} of 2</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / 2) * 100}%` }]} />
      </View>

      <Animated.View
        style={{
          flex: 1,
          opacity: turn,
          transform: [{ translateX: turn.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
        }}
      >
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
              <ReachCard
                pricing={pricing}
                radiusKm={radiusKm}
                onRadius={setRadiusKm}
                price={price}
              />

              <PrimaryButton
                label={`Continue · ${formatPKR(price)}`}
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
          ) : (
            <>
              <Text style={styles.stepTitle}>Send {formatPKR(price)}</Text>
              <Text style={styles.stepSub}>
                {radiusKm} km for {pricing.planDays} days. Transfer to one of the accounts
                below, then upload the screenshot.
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
                  By submitting you agree that Velocity Rides reviews your offer before it
                  goes out, and may take down an offer that misleads users. Your {pricing.planDays}{' '}
                  days start the day it is approved.
                </Text>
              </View>

              <PrimaryButton
                label={submitting ? 'Submitting…' : `Submit for approval · ${formatPKR(price)}`}
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
      </Animated.View>
    </SafeAreaView>
  );
}

/**
 * The reach, and what it costs — one piece of glass, because the two are the
 * same decision. The price above the slider is the only number on the screen
 * that moves, so it is the biggest thing on it and it pops when it changes.
 */
// Exported for the same reason as PoolBox: a preview route renders it on web.
export function ReachCard({
  pricing,
  radiusKm,
  onRadius,
  price,
}: {
  pricing: AdPricing;
  radiusKm: number;
  onRadius: (km: number) => void;
  /** Whole rupees, for this radius. */
  price: number;
}) {
  const [pop] = useState(() => new Animated.Value(1));
  useEffect(() => {
    pop.setValue(0.92);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [price, pop]);

  // What the box holds: null while they have not typed in it, so it shows the
  // slider's own number instead of fighting it.
  const [typed, setTyped] = useState<string | null>(null);
  const over = radiusKm > RADIUS_PICKER_MAX_KM;

  return (
    <Glass radius={20} style={styles.reach}>
      <View style={styles.reachTop}>
        <View style={{ flex: 1 }}>
          <Animated.View style={{ transform: [{ scale: pop }], alignSelf: 'flex-start' }}>
            {/* One line, whatever the figure: "Rs 18,240" at the widest radius
                we sell is twice the width of "Rs 300". */}
            <Text style={styles.reachPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatPKR(price)}
            </Text>
          </Animated.View>
          <Text style={styles.reachPkr}>for {pricing.planDays} days, one offer</Text>
        </View>
        <View style={styles.reachKmBox}>
          <Text style={styles.reachKm}>{radiusKm}</Text>
          <Text style={styles.reachKmUnit}>km</Text>
        </View>
      </View>

      <RadiusSlider
        value={Math.min(radiusKm, RADIUS_PICKER_MAX_KM)}
        max={RADIUS_PICKER_MAX_KM}
        onChange={(km) => {
          setTyped(null);
          onRadius(km);
        }}
      />

      <View style={styles.chipRow}>
        {RADIUS_STEPS.map((km) => (
          <Pressable
            key={km}
            style={[styles.chip, radiusKm === km && styles.chipOn]}
            onPress={() => {
              setTyped(null);
              onRadius(km);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${km} kilometres`}
          >
            <Text style={[styles.chipTxt, radiusKm === km && { color: colors.primary }]}>{km}</Text>
          </Pressable>
        ))}
      </View>

      {/* Past the slider's end there is no screen left, so the number is typed
          (owner, 2026-11-14) and priced as it is typed. */}
      <View style={[styles.manual, over && styles.manualOn]}>
        <Text style={styles.manualLabel}>Wider than {RADIUS_PICKER_MAX_KM} km? Type it</Text>
        <TextInput
          style={styles.manualField}
          value={typed ?? (over ? String(radiusKm) : '')}
          onChangeText={(t) => {
            const clean = t.replace(/[^0-9.]/g, '').slice(0, 6);
            setTyped(clean);
            const km = Number(clean);
            if (Number.isFinite(km) && km >= 0.5) onRadius(Math.min(km, pricing.maxRadiusKm));
          }}
          keyboardType="decimal-pad"
          placeholder={`${RADIUS_PICKER_MAX_KM + 1}–${pricing.maxRadiusKm}`}
          placeholderTextColor={colors.muted}
          maxLength={6}
        />
        <Text style={styles.manualUnit}>km</Text>
      </View>

      <Text style={styles.reachNote}>
        {pricing.includedKm} km is in the {formatPKR(adPrice(pricing, pricing.includedKm))}; every
        km after that adds {formatPKR(pricing.perKmPkr)}. Everyone inside your radius gets your
        offer — again every {pricing.notifyCooldownHours} hours while it runs.
      </Text>
    </Glass>
  );
}

/**
 * The radius itself: drag the thumb, or tap anywhere on the track. Built on
 * PanResponder (as the travel-mate cards are) rather than a slider package —
 * it is a line, a dot and a width.
 */
function RadiusSlider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (km: number) => void;
}) {
  const [width, setWidth] = useState(0);
  // The responder is made once and closes over refs: the live width, and the
  // caller's latest callback.
  const w = useRef(0);
  w.current = width;
  const cb = useRef(onChange);
  cb.current = onChange;

  const pan = useMemo(() => {
    const toKm = (x: number) => {
      if (w.current <= 0) return 1;
      const ratio = Math.max(0, Math.min(1, x / w.current));
      return Math.max(1, Math.round(1 + ratio * (max - 1)));
    };
    const at = (x: number) => cb.current(toKm(x));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
    });
  }, [max]);

  const pct = ((Math.max(1, value) - 1) / (max - 1)) * 100;
  return (
    <View
      style={styles.sliderHit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={`Radius ${value} kilometres`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, value - 1));
      }}
      {...pan.panHandlers}
    >
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${pct}%` }]} />
      </View>
      <View style={[styles.sliderThumb, { left: `${pct}%` }]} />
    </View>
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
  plans: BusinessAdPlans | null;
  method: BusinessAdPaymentMethod;
}) {
  const p = plans?.payment;
  const account =
    method === 'bank' ? p?.bankAccount : method === 'easypaisa' ? p?.easypaisaAccount : p?.jazzcashAccount;
  const title =
    method === 'bank'
      ? p?.bankAccountTitle
      : method === 'easypaisa'
        ? p?.easypaisaTitle
        : p?.jazzcashTitle;

  if (!account) {
    return (
      <View style={styles.accountCard}>
        <Text style={styles.accountMissing}>
          {plans
            ? "This account isn't set up yet. Pick another method, or contact support."
            : 'Fetching the account to pay into…'}
        </Text>
      </View>
    );
  }

  return (
    <Glass radius={16} style={styles.accountCard}>
      {method === 'bank' && p?.bankName ? <Text style={styles.accountBank}>{p.bankName}</Text> : null}
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
    </Glass>
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

  /** The reach and its price: one glass panel. */
  reach: { backgroundColor: colors.glassStrong, padding: 16, gap: 14 },
  reachTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reachPrice: { fontSize: 40, fontWeight: '900', color: colors.primary, letterSpacing: -1 },
  reachPkr: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 2 },
  reachKmBox: {
    alignItems: 'center',
    minWidth: 66,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.glassChip,
  },
  reachKm: { fontSize: 22, fontWeight: '900', color: colors.text },
  reachKmUnit: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.8 },
  reachNote: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 16 },

  /** The slider: a tall touch area so a thumb can find a 6 px line. */
  sliderHit: { height: 40, justifyContent: 'center' },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: colors.glassChip, overflow: 'hidden' },
  sliderFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  sliderThumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.background,
  },

  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.glassLime, borderWidth: 1.5 },
  chipTxt: { fontSize: 13, fontWeight: '800', color: colors.text },

  manual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  manualOn: { borderColor: colors.primary, borderWidth: 1.5 },
  manualLabel: { flex: 1, fontSize: 11.5, fontWeight: '700', color: colors.muted },
  manualField: {
    width: 86,
    height: 44,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  manualUnit: { fontSize: 11, fontWeight: '800', color: colors.muted },

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
