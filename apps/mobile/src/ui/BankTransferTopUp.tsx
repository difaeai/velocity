/**
 * Funding a Velocity balance by bank transfer and a screenshot.
 *
 * This is the top-up path that works before any gateway does: the driver pays
 * Velocity from Easypaisa, JazzCash or their bank's own app — the way everybody
 * in Pakistan already pays everybody — uploads the receipt, and our own OCR
 * engine credits it on the spot. No gateway, no card, nothing to connect.
 *
 * ── WHY THE "EXACT AMOUNT" NAGGING ───────────────────────────────────────────
 *
 * `AMOUNT_TOLERANCE` in domain/topupProof.ts is **zero**: if the number typed
 * here differs from the number the engine reads off the receipt by a single
 * rupee, the top-up is not credited — it waits for an admin. That is the right
 * call on the backend (the screenshot decides the amount, so a tolerance is a
 * discount on forgery), but it means the one thing this screen has to get
 * right is stopping the driver typing a rounded figure. Hence the amount step
 * is third, after they have the receipt in front of them, and says "exactly"
 * twice. Every honest driver who guesses here costs an admin thirty seconds.
 *
 * ── WHY IT IS A SHEET AND NOT A SCREEN ───────────────────────────────────────
 *
 * It is mounted from two places that must not navigate away: the Top up sheet
 * (once the wallet is open) and the commission lock on the driver's home tab,
 * which is the only one of the two a driver can reach today — the wallet
 * surfaces are removed while `walletTopupEnabled` is false, so a route would
 * strand this feature behind a flag that has nothing to do with it.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { Text, TextInput } from './Text';
import { api } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { uploadTopupProof } from '../lib/uploadDoc';
import { useLatestManualTopup, useSettlementAccounts } from '../hooks/driver';
import { PrimaryButton } from './components';

/**
 * Keep in step with MIN_SINGLE/MAX_SINGLE in domain/topupProof.ts. These are
 * NOT the gateway's limits — a manual top-up is capped lower, because the cap
 * is what bounds a single successful forgery.
 */
const MIN_TOPUP = 100;
const MAX_TOPUP = 50000;

type PayMethod = 'easypaisa' | 'jazzcash' | 'bank';

const METHOD_LABEL: Record<PayMethod, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  bank: 'Bank transfer',
};

const METHOD_ICON: Record<PayMethod, string> = {
  easypaisa: '📱',
  jazzcash: '📲',
  bank: '🏦',
};

/** The verdict we show after an upload, mirroring the backend's three statuses. */
type Outcome = {
  status: 'approved' | 'pending_review' | 'rejected';
  credited: number;
  commissionSettled: number;
  message: string;
};

/** One official account: label, number/IBAN, and a copy button. */
function AccountRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await Clipboard.setStringAsync(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <View style={styles.accountRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.accountRowLabel}>{label}</Text>
        <Text style={styles.accountRowValue} selectable>{value}</Text>
      </View>
      <Pressable onPress={copy} style={styles.copyBtn} hitSlop={8}>
        <Text style={styles.copyBtnText}>{copied ? '✓ Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
}

export function BankTransferTopUpSheet({
  visible,
  onClose,
  uid,
  /** Prefills the amount — the commission due, when opened from the lock. */
  suggestedAmount,
  /**
   * The balance a locked driver has to reach for the lock to clear itself.
   *
   * Auto-settle is all-or-nothing (`status: 'short'` in drivers/autoSettle.ts
   * debits nothing at all), so a driver who tops up less than they owe is
   * credited and stays locked. Without this, the sheet would tell them their
   * money arrived and leave them to work out why they are still stuck.
   */
  unlockAtAmount,
  /** One line above the steps, for why the driver is here. */
  intro,
}: {
  visible: boolean;
  onClose: () => void;
  uid?: string;
  suggestedAmount?: number;
  unlockAtAmount?: number;
  intro?: string;
}) {
  const accounts = useSettlementAccounts();
  const latest = useLatestManualTopup(uid);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('easypaisa');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Which methods we can actually receive on — an account we have not been
  // given is not an option, because the driver would send money nowhere.
  const available: PayMethod[] = [];
  if (accounts?.easypaisaNumber) available.push('easypaisa');
  if (accounts?.jazzcashNumber) available.push('jazzcash');
  if (accounts?.bankIban) available.push('bank');
  const activeMethod = available.includes(method) ? method : available[0] ?? 'easypaisa';

  function accountValue(m: PayMethod): string | null {
    if (!accounts) return null;
    if (m === 'easypaisa') return accounts.easypaisaNumber ?? null;
    if (m === 'jazzcash') return accounts.jazzcashNumber ?? null;
    return accounts.bankIban ?? null;
  }

  const amountNum = parseInt(amount, 10);
  const amountValid = Number.isFinite(amountNum) && amountNum >= MIN_TOPUP && amountNum <= MAX_TOPUP;

  // An earlier upload is still with our team. Showing it matters more than
  // another upload button: a driver who cannot see that we have their receipt
  // uploads it again, and the second one is rejected as a replay of the first.
  const awaitingReview = !outcome && latest?.status === 'pending_review';

  function close() {
    setAmount('');
    setOutcome(null);
    onClose();
  }

  async function pickAndSubmit() {
    if (!uid) return;
    if (!amountValid) {
      Alert.alert(
        'Enter the amount',
        `Type the amount exactly as it appears on your receipt — between PKR ${MIN_TOPUP} and ${MAX_TOPUP.toLocaleString()}.`,
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload your payment screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const upload = await uploadTopupProof(uid, asset.uri, asset.mimeType);
      const res = await api.submitManualTopup({
        proofPath: upload.path,
        amount: amountNum,
        method: activeMethod,
      });
      setOutcome({
        status: res.status,
        credited: res.credited ?? 0,
        commissionSettled: res.commissionSettled ?? 0,
        message: res.message,
      });
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {outcome ? 'Top-up' : 'Add balance by transfer'}
            </Text>
            <Pressable onPress={close} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {outcome ? (
              <OutcomeView outcome={outcome} unlockAtAmount={unlockAtAmount} />
            ) : available.length === 0 ? (
              <Text style={styles.noAccounts}>
                Velocity Rides&apos; payment accounts aren&apos;t set up yet. Please contact support
                to add balance.
              </Text>
            ) : (
              <>
                {intro ? <Text style={styles.intro}>{intro}</Text> : null}

                {awaitingReview ? (
                  <View style={[styles.statusBox, { borderColor: '#f59e0b' }]}>
                    <Text style={[styles.statusText, { color: '#f59e0b' }]}>
                      ⏳ Your last receipt is being checked by our team. You&apos;ll be notified as
                      soon as it&apos;s credited — no need to upload it again.
                    </Text>
                  </View>
                ) : null}

                {/* ── 1. Send the money ── */}
                <Text style={styles.stepTitle}>1. Send the money to Velocity Rides</Text>
                <View style={styles.methodRow}>
                  {available.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMethod(m)}
                      style={[styles.methodChip, activeMethod === m && styles.methodChipActive]}
                    >
                      <Text style={styles.methodChipIcon}>{METHOD_ICON[m]}</Text>
                      <Text
                        style={[
                          styles.methodChipText,
                          activeMethod === m && styles.methodChipTextActive,
                        ]}
                      >
                        {METHOD_LABEL[m]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.accountBox}>
                  {accounts?.accountTitle ? (
                    <AccountRow label="Account title" value={accounts.accountTitle} />
                  ) : null}
                  {activeMethod === 'bank' && accounts?.bankName ? (
                    <AccountRow label="Bank" value={accounts.bankName} />
                  ) : null}
                  <AccountRow
                    label={activeMethod === 'bank' ? 'IBAN' : `${METHOD_LABEL[activeMethod]} number`}
                    value={accountValue(activeMethod) ?? '—'}
                  />
                </View>

                {/* ── 2. Screenshot ── */}
                <Text style={styles.stepTitle}>2. Screenshot the confirmation</Text>
                <Text style={styles.stepBody}>
                  Take a screenshot of the whole success screen — uncropped, showing the amount and
                  the transaction ID. Without a readable transaction ID we can&apos;t credit it
                  automatically.
                </Text>

                {/* ── 3. The amount, exactly ── */}
                <Text style={styles.stepTitle}>3. Enter the amount on the receipt</Text>
                <View style={styles.amountRow}>
                  <Text style={styles.currency}>PKR</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder={String(suggestedAmount ?? MIN_TOPUP)}
                    placeholderTextColor={colors.muted}
                    style={styles.amountInput}
                  />
                </View>
                {suggestedAmount && suggestedAmount >= MIN_TOPUP && suggestedAmount <= MAX_TOPUP ? (
                  <Pressable onPress={() => setAmount(String(suggestedAmount))} style={styles.preset}>
                    <Text style={styles.presetText}>
                      Use PKR {suggestedAmount.toLocaleString()}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={styles.exactNote}>
                  ⚠️ It must match the receipt <Text style={styles.bold}>exactly</Text>. If it
                  doesn&apos;t, your top-up waits for our team instead of being credited straight
                  away.
                </Text>
              </>
            )}
          </ScrollView>

          <View style={styles.sheetFooter}>
            {outcome ? (
              <PrimaryButton label="Done" onPress={close} />
            ) : busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.busyText}>Uploading & checking your receipt…</Text>
              </View>
            ) : (
              <PrimaryButton
                label="📤 Upload payment screenshot"
                onPress={pickAndSubmit}
                disabled={available.length === 0 || !amountValid}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The verdict, in the driver's words.
 *
 * Three outcomes, not two — the middle one is the point of the whole engine, so
 * it reads as "we have it" rather than as a failure. The message comes from the
 * backend: it is the single place that knows which rule fired.
 */
function OutcomeView({
  outcome,
  unlockAtAmount,
}: {
  outcome: Outcome;
  unlockAtAmount?: number;
}) {
  const approved = outcome.status === 'approved';
  const rejected = outcome.status === 'rejected';
  const tint = approved ? '#12b76a' : rejected ? colors.danger : '#f59e0b';

  // Credited, but the lock did not clear. Almost always a balance still short
  // of the full amount owed, since auto-settle refuses to part-pay; rarely, a
  // settle that failed and will be retried. Both leave the driver credited and
  // still locked, which needs saying either way.
  const shortOfUnlock = approved && outcome.commissionSettled === 0 && unlockAtAmount != null;

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.outcomeCard, { borderColor: `${tint}55`, backgroundColor: `${tint}12` }]}>
        <Text style={styles.outcomeIcon}>{approved ? '✅' : rejected ? '❌' : '⏳'}</Text>
        <Text style={[styles.outcomeTitle, { color: tint }]}>
          {approved
            ? `PKR ${outcome.credited.toLocaleString()} added`
            : rejected
              ? 'Not credited'
              : 'With our team'}
        </Text>
        <Text style={styles.outcomeBody}>{outcome.message}</Text>
      </View>

      {approved && outcome.commissionSettled > 0 ? (
        <View style={styles.unlockedBox}>
          <Text style={styles.unlockedText}>
            🔓 PKR {outcome.commissionSettled.toLocaleString()} of commission was cleared
            automatically — you can go back online now.
          </Text>
        </View>
      ) : null}

      {shortOfUnlock ? (
        <View style={[styles.statusBox, { borderColor: '#f59e0b' }]}>
          <Text style={[styles.statusText, { color: '#f59e0b' }]}>
            The commission hasn&apos;t been taken yet — your balance has to cover the full PKR{' '}
            {unlockAtAmount!.toLocaleString()} owed before it clears itself. Nothing is lost: the
            money is in your balance. Top up the difference and the lock lifts on its own.
          </Text>
        </View>
      ) : null}

      {!approved && !rejected ? (
        <Text style={styles.outcomeNote}>
          Nothing is lost — we have your receipt. You&apos;ll get a notification the moment it&apos;s
          credited, usually well inside a day.
        </Text>
      ) : null}

      {rejected ? (
        <Text style={styles.outcomeNote}>
          If you believe this is wrong, contact support — every decision can be contested, and your
          receipt stays on file.
        </Text>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
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
  sheetBody: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 8 },

  intro: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  bold: { fontWeight: '900', color: colors.text },

  stepTitle: { fontSize: 15, fontWeight: '900', color: colors.text, marginTop: 8 },
  stepBody: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  methodRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  methodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  methodChipIcon: { fontSize: 14 },
  methodChipText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  methodChipTextActive: { color: colors.primary },

  accountBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  accountRowLabel: { fontSize: 11, color: colors.muted, fontWeight: '700' },
  accountRowValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 2 },
  copyBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyBtnText: { fontSize: 12, fontWeight: '800', color: colors.text },

  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
  },
  currency: { fontSize: 26, fontWeight: '900', color: colors.muted },
  amountInput: { flex: 1, fontSize: 30, fontWeight: '900', color: colors.text, padding: 0 },
  preset: {
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: `${colors.primary}18`,
    borderWidth: 1,
    borderColor: `${colors.primary}55`,
  },
  presetText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  exactNote: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  noAccounts: { fontSize: 14, color: colors.muted, lineHeight: 20 },

  statusBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.surface,
  },
  statusText: { fontSize: 13, fontWeight: '700', lineHeight: 19 },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  busyText: { fontSize: 13, color: colors.muted, fontWeight: '700' },

  outcomeCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  outcomeIcon: { fontSize: 34 },
  outcomeTitle: { fontSize: 18, fontWeight: '900' },
  outcomeBody: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  unlockedBox: {
    borderWidth: 1,
    borderColor: `${colors.primary}55`,
    backgroundColor: `${colors.primary}12`,
    borderRadius: 12,
    padding: 12,
  },
  unlockedText: { fontSize: 13, fontWeight: '800', color: colors.primary, lineHeight: 19 },
  outcomeNote: { fontSize: 12, color: colors.muted, lineHeight: 18, textAlign: 'center' },
}));
