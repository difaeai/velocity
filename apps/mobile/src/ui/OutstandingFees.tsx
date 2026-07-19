import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { uploadSettlementProof } from '../lib/uploadDoc';
import {
  useLatestFeeSettlement,
  useSettlementAccounts,
  type OutstandingStatus,
} from '../hooks/driver';
import { PrimaryButton } from './components';

type PayMethod = 'easypaisa' | 'jazzcash' | 'bank';

const METHOD_LABEL: Record<PayMethod, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  bank: 'Bank transfer',
};

/**
 * Unpaid cancellation fees — the money the user owes Velocity for walking away
 * from a confirmed ride. Shown in the wallet for passengers and drivers alike.
 *
 * Small debts just sit here as a reminder. Once the debt reaches the admin-set
 * limit the account is blocked (a passenger can't book, a driver can't bid), and
 * this card becomes the way out: pay Velocity, upload the screenshot, get
 * cleared — the same AI-verified flow drivers use for their commission.
 */
export function OutstandingFees({
  status,
  uid,
  role,
}: {
  status: OutstandingStatus;
  uid?: string;
  role: 'passenger' | 'driver';
}) {
  const accounts = useSettlementAccounts();
  const settlement = useLatestFeeSettlement(uid);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PayMethod>('easypaisa');

  const { amount, blocked, limit } = status;

  // Which methods Velocity can actually receive on.
  const available: PayMethod[] = [];
  if (accounts?.easypaisaNumber) available.push('easypaisa');
  if (accounts?.jazzcashNumber) available.push('jazzcash');
  if (accounts?.bankIban) available.push('bank');
  const activeMethod = available.includes(method) ? method : available[0] ?? 'easypaisa';

  function accountValue(m: PayMethod): string | null {
    if (!accounts) return null;
    if (m === 'easypaisa') return accounts.easypaisaNumber ?? null;
    if (m === 'jazzcash') return accounts.jazzcashNumber ?? null;
    return accounts.bankIban
      ? `${accounts.bankName ? `${accounts.bankName} — ` : ''}${accounts.bankIban}`
      : null;
  }

  const underReview = settlement?.status === 'pending_review';
  const wasRejected = settlement?.status === 'rejected';

  async function pickAndSubmit() {
    if (!uid) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload your payment screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const upload = await uploadSettlementProof(uid, result.assets[0].uri);
      const res = await api.submitCancellationFeeSettlement({
        proofPath: upload.path,
        method: activeMethod,
      });
      if (res.status === 'approved') {
        Alert.alert(
          '✅ Fees cleared',
          `Your payment of PKR ${res.amountDue} was verified. Your account is back to normal.`,
        );
      } else if (res.status === 'rejected') {
        Alert.alert(
          '❌ Not verified',
          res.reason ?? 'We could not verify your payment. Please upload a clear, unedited receipt.',
        );
      } else {
        Alert.alert(
          '⏳ Under review',
          'Your payment is being reviewed by our team. Your fees will clear once it is approved.',
        );
      }
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const remainingBeforeBlock = Math.max(0, limit - amount);

  return (
    <View style={[styles.card, blocked && styles.cardBlocked]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, blocked && { color: colors.danger }]}>
          {blocked ? '🔒 Cancellation fees due' : '⚠️ Cancellation fees'}
        </Text>
        <Text style={[styles.amount, blocked && { color: colors.danger }]}>
          {amount.toLocaleString()} PKR
        </Text>
      </View>

      <Text style={styles.body}>
        {blocked
          ? role === 'driver'
            ? 'You owe Velocity for rides you cancelled after accepting them. Pay this off to start accepting rides again.'
            : 'You owe Velocity for rides you cancelled after a driver had accepted. Pay this off to book again.'
          : limit > 0
            ? `Owed to Velocity for cancelling confirmed rides. You can keep ${role === 'driver' ? 'driving' : 'riding'} — but at ${limit.toLocaleString()} PKR outstanding your account is blocked, so you have ${remainingBeforeBlock.toLocaleString()} PKR of room left.`
            : 'Owed to Velocity for cancelling confirmed rides.'}
      </Text>

      {/* How to settle */}
      <Text style={styles.stepsTitle}>How to pay</Text>
      <Text style={styles.step}>
        <Text style={styles.bold}>1.</Text> Send <Text style={styles.bold}>PKR {amount.toLocaleString()}</Text> to Velocity&apos;s account below.
      </Text>
      <Text style={styles.step}>
        <Text style={styles.bold}>2.</Text> Screenshot the successful payment.
      </Text>
      <Text style={styles.step}>
        <Text style={styles.bold}>3.</Text> Upload it here — we verify it and clear your fees automatically.
      </Text>

      {available.length > 0 ? (
        <>
          <View style={styles.methodRow}>
            {available.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                style={[styles.methodChip, activeMethod === m && styles.methodChipActive]}
              >
                <Text style={[styles.methodChipText, activeMethod === m && styles.methodChipTextActive]}>
                  {METHOD_LABEL[m]}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.accountBox}>
            <Text style={styles.accountLabel}>
              Send PKR {amount.toLocaleString()} to{accounts?.accountTitle ? ` ${accounts.accountTitle}` : ''}
            </Text>
            <Text style={styles.accountValue}>{accountValue(activeMethod) ?? '—'}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.noAccounts}>
          Velocity&apos;s payment account isn&apos;t set up yet. Please contact support to pay this off.
        </Text>
      )}

      {underReview && (
        <View style={[styles.statusBox, { borderColor: '#f59e0b' }]}>
          <Text style={[styles.statusText, { color: '#f59e0b' }]}>
            ⏳ Your payment is under review. Your fees will clear as soon as it&apos;s approved.
          </Text>
        </View>
      )}
      {wasRejected && (
        <View style={[styles.statusBox, { borderColor: colors.danger }]}>
          <Text style={[styles.statusText, { color: colors.danger }]}>
            ❌ {settlement?.rejectionReason ?? 'Your last screenshot could not be verified.'} Please upload a clear, unedited receipt.
          </Text>
        </View>
      )}

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.busyText}>Uploading & verifying your payment…</Text>
        </View>
      ) : underReview ? null : (
        <PrimaryButton
          label={wasRejected ? 'Upload a new screenshot' : '📤 Upload payment screenshot'}
          onPress={pickAndSubmit}
          disabled={available.length === 0}
        />
      )}
      <Text style={styles.aiNotice}>
        Your screenshot is checked automatically by an AI system (Anthropic). If it can&apos;t be
        verified confidently, our team reviews it, and you can contest any decision through
        support. See our Privacy Policy for details.
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  cardBlocked: { borderColor: colors.danger, borderWidth: 1.5 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  amount: { fontSize: 20, fontWeight: '900', color: colors.text },
  body: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  bold: { fontWeight: '900', color: colors.text },

  stepsTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 4 },
  step: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  noAccounts: { fontSize: 12, color: colors.danger, lineHeight: 18 },

  methodRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  methodChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
  methodChipText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  methodChipTextActive: { color: colors.primary },
  accountBox: {
    backgroundColor: `${colors.primary}12`,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  accountLabel: { fontSize: 11, fontWeight: '700', color: colors.muted, marginBottom: 2 },
  accountValue: { fontSize: 16, fontWeight: '900', color: colors.text },

  statusBox: { borderRadius: 10, borderWidth: 1, padding: 12 },
  statusText: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  busyText: { fontSize: 13, color: colors.muted },
  aiNotice: { fontSize: 11, color: colors.muted, lineHeight: 16 },
}));
