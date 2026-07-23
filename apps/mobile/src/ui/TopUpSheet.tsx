/**
 * Top up — the amount sheet and the "Top up via" method picker.
 *
 * Two layers, like every ride-hailing wallet: pick how much, then pick what to
 * pay with. A connected instrument charges in one tap (`topupWithSavedMethod`);
 * a bare gateway opens the hosted checkout and the wallet is credited by the
 * webhook when the gateway confirms.
 *
 * The amount presets are labelled in rides rather than rupees because that is
 * the question the user is actually asking — "how long does this last me?".
 * The conversion is openly approximate (see AVG_FARE_PKR) and labelled as such.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Text, TextInput } from './Text';
import { api, type SavedMethodKind, type TopupProvider } from '../api/client';
import { useCommissionSettings, useSavedPaymentMethods } from '../hooks/driver';
import { colors } from '../config';
import { themed } from '../theme';
import { PrimaryButton } from './components';

/** Backend limits — keep in step with MIN_TOPUP/MAX_TOPUP in payments/index.ts. */
const MIN_TOPUP = 100;
const MAX_TOPUP = 100000;

/**
 * A rough city fare, used only to turn a rupee amount into "~N rides" on the
 * preset chips. Deliberately a single constant rather than a per-user average:
 * it is a hint, it is labelled approximate, and no money decision is made from
 * it. Revisit if real fare data says city averages have moved far from this.
 */
const AVG_FARE_PKR = 300;

const KIND_META: Record<SavedMethodKind, { icon: string; tint: string }> = {
  easypaisa: { icon: '📱', tint: '#12b76a' },
  jazzcash:  { icon: '📲', tint: '#e11d48' },
  bank:      { icon: '🏦', tint: '#3b82f6' },
  card:      { icon: '💳', tint: '#a855f7' },
};

const PROVIDER_META: Record<TopupProvider, { label: string; icon: string; tint: string }> = {
  easypaisa: { label: 'Easypaisa', icon: '📱', tint: '#12b76a' },
  jazzcash:  { label: 'JazzCash',  icon: '📲', tint: '#e11d48' },
  payfast:   { label: 'Card, wallet or bank', icon: '💳', tint: '#a855f7' },
};

/** What the user is paying with: a saved instrument or a bare gateway. */
type Selection =
  | { type: 'saved'; id: string; label: string; kind: SavedMethodKind }
  | { type: 'gateway'; provider: TopupProvider };

export function TopUpSheet({
  visible,
  onClose,
  role,
  uid,
}: {
  visible: boolean;
  onClose: () => void;
  role: 'passenger' | 'driver';
  uid?: string;
}) {
  const router = useRouter();
  const savedMethods = useSavedPaymentMethods(uid);
  const { rate } = useCommissionSettings();

  const [amount, setAmount] = useState('');
  const [providers, setProviders] = useState<TopupProvider[]>([]);
  const [comingSoon, setComingSoon] = useState(true);
  const [mockGateway, setMockGateway] = useState(false);
  const [chosen, setChosen] = useState<Selection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<TextInput>(null);

  // What one ride costs this user: a passenger pays the fare, a driver owes
  // commission on it. Drives both the presets and their "~N rides" labels.
  const perRide = useMemo(
    () => (role === 'driver' ? Math.max(1, Math.round(AVG_FARE_PKR * rate)) : AVG_FARE_PKR),
    [role, rate],
  );

  const presets = useMemo(() => {
    const base = Math.max(MIN_TOPUP, Math.round((perRide * 10) / 100) * 100);
    return [base, base * 2, base * 3];
  }, [perRide]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api.getPaymentOptions({})
      .then((res) => {
        if (cancelled) return;
        setComingSoon(res.comingSoon === true);
        setProviders(res.providers ?? []);
        setMockGateway(res.mock === true);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [visible]);

  /**
   * What we fall back to when the user has not picked anything yet: their
   * default instrument, else the first configured gateway. Derived rather than
   * seeded into state via an effect, so a method arriving from the live
   * Firestore subscription is reflected without an extra render pass.
   */
  const defaultSelection = useMemo<Selection | null>(() => {
    const preferred = savedMethods.find((m) => m.isDefault && m.status !== 'revoked')
      ?? savedMethods.find((m) => m.status !== 'revoked');
    if (preferred) {
      return { type: 'saved', id: preferred.id, label: preferred.label, kind: preferred.kind };
    }
    const firstGateway = providers[0];
    return firstGateway ? { type: 'gateway', provider: firstGateway } : null;
  }, [savedMethods, providers]);

  const selection = chosen ?? defaultSelection;

  /**
   * Close and clear. Resetting here rather than in an effect on `visible` keeps
   * the state change tied to the user action that caused it, instead of
   * cascading an extra render every time the parent re-renders.
   */
  function close() {
    setAmount('');
    setPickerOpen(false);
    onClose();
  }

  const amountNum = parseInt(amount, 10);
  const amountValid = Number.isFinite(amountNum) && amountNum >= MIN_TOPUP && amountNum <= MAX_TOPUP;
  const ridesFor = (value: number) => Math.max(1, Math.floor(value / perRide));

  const selectionLabel = !selection
    ? 'Choose a payment method'
    : selection.type === 'saved'
      ? selection.label
      : PROVIDER_META[selection.provider]?.label ?? selection.provider;

  const selectionIcon = !selection
    ? '＋'
    : selection.type === 'saved'
      ? KIND_META[selection.kind]?.icon ?? '💳'
      : PROVIDER_META[selection.provider]?.icon ?? '💳';

  async function submit() {
    if (!amountValid) {
      Alert.alert('Enter an amount', `Top up between ${MIN_TOPUP} and ${MAX_TOPUP.toLocaleString()} PKR.`);
      return;
    }
    if (!selection) {
      setPickerOpen(true);
      return;
    }
    setBusy(true);
    try {
      if (selection.type === 'saved') {
        const res = await api.topupWithSavedMethod({ methodId: selection.id, amount: amountNum });
        Alert.alert('Wallet topped up', `${res.amount.toLocaleString()} PKR added from ${selection.label}.`);
        close();
        return;
      }
      const res = await api.createTopupIntent({ amount: amountNum, provider: selection.provider });
      if (res.mock) {
        await api.mockConfirmTopup({ intentId: res.intentId });
        Alert.alert('Wallet topped up', `${amountNum.toLocaleString()} PKR added (mock gateway).`);
        close();
      } else if (res.redirectUrl) {
        await Linking.openURL(res.redirectUrl);
        close();
      }
    } catch (e) {
      Alert.alert('Top-up failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const usableMethods = savedMethods.filter((m) => m.status !== 'revoked');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Top up</Text>
            <Pressable onPress={close} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {comingSoon ? (
              <View style={styles.comingSoonBanner}>
                <Text style={styles.comingSoonBadgeText}>Coming soon</Text>
                <Text style={styles.comingSoonText}>
                  Automatic wallet top-ups are almost here. Until then you can pay Velocity directly
                  from the accounts shown on your Wallet screen.
                </Text>
              </View>
            ) : null}

            {/* Selected payment method — tap to change */}
            <Pressable
              onPress={() => (comingSoon ? undefined : setPickerOpen(true))}
              disabled={comingSoon}
              style={[styles.methodRow, comingSoon && styles.disabled]}
            >
              <View style={styles.methodBadge}>
                <Text style={styles.methodIcon}>{selectionIcon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodLabel}>{selectionLabel}</Text>
                <Text style={styles.methodSub}>Payment method</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Text style={styles.enterLabel}>Enter amount</Text>
            <View style={styles.amountRow}>
              <Text style={styles.currency}>PKR</Text>
              <TextInput
                ref={amountRef}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder={String(presets[0])}
                placeholderTextColor={colors.muted}
                editable={!comingSoon}
                style={styles.amountInput}
              />
              {/* Pencil affordance — the amount is editable even after a preset
                  has filled it in, which is not obvious from a bare number. */}
              <Pressable
                onPress={() => amountRef.current?.focus()}
                disabled={comingSoon}
                hitSlop={10}
                style={[styles.editBtn, comingSoon && styles.disabled]}
              >
                <Text style={styles.editIcon}>✎</Text>
              </Pressable>
            </View>

            <View style={styles.presetRow}>
              {presets.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setAmount(String(p))}
                  disabled={comingSoon}
                  style={[
                    styles.preset,
                    amountNum === p && styles.presetActive,
                    comingSoon && styles.disabled,
                  ]}
                >
                  <Text style={[styles.presetAmount, amountNum === p && styles.presetAmountActive]}>
                    {p.toLocaleString()}
                  </Text>
                  <Text style={styles.presetRides}>~{ridesFor(p)} rides</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.approxNote}>
              {role === 'driver'
                ? 'Approximate — how many rides of commission this covers.'
                : 'The number of rides is approximate.'}
            </Text>

            {mockGateway && !comingSoon ? (
              <Text style={styles.mockNote}>
                Development gateway — no real money moves.
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.sheetFooter}>
            <PrimaryButton
              label="Top up securely"
              onPress={submit}
              loading={busy}
              disabled={comingSoon || !amountValid}
            />
          </View>
        </View>
      </View>

      {/* ── "Top up via" picker ─────────────────────────────────────────── */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Top up via</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={12} style={styles.closeBtn}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              {usableMethods.length > 0 ? (
                <>
                  <Text style={styles.pickerSection}>Your accounts</Text>
                  {usableMethods.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => {
                        setChosen({ type: 'saved', id: m.id, label: m.label, kind: m.kind });
                        setPickerOpen(false);
                      }}
                      style={[
                        styles.pickerRow,
                        selection?.type === 'saved' && selection.id === m.id && styles.pickerRowActive,
                      ]}
                    >
                      <View style={[styles.methodBadge, { backgroundColor: `${KIND_META[m.kind]?.tint ?? colors.primary}22` }]}>
                        <Text style={styles.methodIcon}>{KIND_META[m.kind]?.icon ?? '💳'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.methodLabel}>{m.label}</Text>
                        <Text style={styles.methodSub}>One tap — no redirect</Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}

              {providers.length > 0 ? (
                <>
                  <Text style={styles.pickerSection}>Pay once</Text>
                  {providers.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => {
                        setChosen({ type: 'gateway', provider: p });
                        setPickerOpen(false);
                      }}
                      style={[
                        styles.pickerRow,
                        selection?.type === 'gateway' && selection.provider === p && styles.pickerRowActive,
                      ]}
                    >
                      <View style={[styles.methodBadge, { backgroundColor: `${PROVIDER_META[p]?.tint ?? colors.primary}22` }]}>
                        <Text style={styles.methodIcon}>{PROVIDER_META[p]?.icon ?? '💳'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.methodLabel}>{PROVIDER_META[p]?.label ?? p}</Text>
                        <Text style={styles.methodSub}>
                          from PKR {MIN_TOPUP} to {MAX_TOPUP.toLocaleString()}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}

              <Pressable
                onPress={() => {
                  close();
                  router.push(role === 'driver' ? '/driver/payment-methods' : '/passenger/payment-methods');
                }}
                style={styles.pickerRow}
              >
                <View style={[styles.methodBadge, { backgroundColor: `${colors.primary}22` }]}>
                  <Text style={styles.methodIcon}>＋</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodLabel}>Connect a new account</Text>
                  <Text style={styles.methodSub}>Easypaisa, JazzCash, bank or card</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  closeText: { fontSize: 15, fontWeight: '800', color: colors.text },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 8 },
  disabled: { opacity: 0.45 },

  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodBadge: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassChip,
  },
  methodIcon: { fontSize: 20 },
  methodLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  methodSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.muted },

  enterLabel: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 4 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 10,
  },
  currency: { fontSize: 30, fontWeight: '900', color: colors.muted },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '900', color: colors.text, padding: 0 },
  editBtn: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editIcon: { fontSize: 17, color: colors.text },

  presetRow: { flexDirection: 'row', gap: 10 },
  preset: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  presetAmount: { fontSize: 17, fontWeight: '900', color: colors.text },
  presetAmountActive: { color: colors.primary },
  presetRides: { fontSize: 11, color: colors.muted, marginTop: 2 },
  approxNote: { fontSize: 12, color: colors.muted },
  mockNote: { fontSize: 12, color: colors.primary, fontWeight: '700' },

  pickerSection: { fontSize: 13, fontWeight: '800', color: colors.muted, marginTop: 8 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    // Transparent border rather than none, so selecting a row does not shift
    // the layout of the list around it.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pickerRowActive: { borderColor: colors.text, backgroundColor: colors.surface },

  comingSoonBanner: {
    backgroundColor: `${colors.primary}12`,
    borderWidth: 1,
    borderColor: `${colors.primary}45`,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  comingSoonBadgeText: { fontSize: 10, fontWeight: '900', color: colors.primary, textTransform: 'uppercase' },
  comingSoonText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
}));
