import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { uploadDriverDoc } from '../lib/uploadDoc';
import {
  useLatestCommissionSettlement,
  useSettlementAccounts,
  type CommissionStatus,
  type OpenRequest,
} from '../hooks/driver';
import { PrimaryButton } from './components';

type PayMethod = 'easypaisa' | 'jazzcash' | 'bank';

const METHOD_LABEL: Record<PayMethod, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  bank: 'Bank transfer',
};

/** "F-7 Markaz, Islamabad" → "F-7 ▓▓▓▓▓▓, ▓▓▓▓▓▓▓▓▓" — teases the ride, useless
 * for actually working it. */
function blurText(s: string | undefined, keep = 3): string {
  if (!s) return '▓▓▓▓▓▓▓▓';
  return s.slice(0, keep) + s.slice(keep).replace(/[^\s,]/g, '▓');
}

/**
 * Full-screen takeover shown when the driver's commission cycle is locked.
 * The app is paused here until the driver settles: they transfer the amount due
 * to Velocity's account, upload a screenshot, and an AI check either unlocks
 * them instantly or sends it to our team for review. Incoming rides stay
 * visible but blurred until then.
 */
export function CommissionLock({
  status,
  requests,
  uid,
}: {
  status: CommissionStatus;
  requests: OpenRequest[];
  uid?: string;
}) {
  const accounts = useSettlementAccounts();
  const settlement = useLatestCommissionSettlement(uid);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PayMethod>('easypaisa');

  const { due, rate, cycleGrossFare, cycleCashFare } = status;
  const onlineFare = Math.max(0, cycleGrossFare - cycleCashFare);

  // Which methods we can actually receive on.
  const available: PayMethod[] = [];
  if (accounts?.easypaisaNumber) available.push('easypaisa');
  if (accounts?.jazzcashNumber) available.push('jazzcash');
  if (accounts?.bankIban) available.push('bank');
  const activeMethod = available.includes(method) ? method : available[0] ?? 'easypaisa';

  function accountValue(m: PayMethod): string | null {
    if (!accounts) return null;
    if (m === 'easypaisa') return accounts.easypaisaNumber ?? null;
    if (m === 'jazzcash') return accounts.jazzcashNumber ?? null;
    return accounts.bankIban ? `${accounts.bankName ? `${accounts.bankName} — ` : ''}${accounts.bankIban}` : null;
  }

  // A settlement is awaiting our team; hide the upload button until it resolves.
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
      const upload = await uploadDriverDoc(uid, 'settlement', result.assets[0].uri);
      const res = await api.submitCommissionSettlement({ proofPath: upload.path, method: activeMethod });
      if (res.status === 'approved') {
        Alert.alert('✅ Commission settled', `Your payment of PKR ${res.amountDue} was verified. Your account is unlocked.`);
      } else if (res.status === 'rejected') {
        Alert.alert('❌ Not verified', res.reason ?? 'We could not verify your payment. Please upload a clear, unedited receipt.');
      } else {
        Alert.alert('⏳ Under review', 'Your payment is being reviewed by our team. Your account will unlock once it is approved.');
      }
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      {/* ── Why the app is paused ── */}
      <View style={styles.lockCard}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockTitle}>Settle your commission to continue</Text>
        <Text style={styles.lockBody}>
          Your earnings this cycle reached{' '}
          <Text style={styles.bold}>{cycleGrossFare.toLocaleString()} PKR</Text>. Velocity&apos;s{' '}
          {Math.round(rate * 100)}% commission on the {cycleCashFare.toLocaleString()} PKR you
          collected in cash is due now.
        </Text>
        {onlineFare > 0 && (
          <Text style={styles.lockNote}>
            ✓ Commission on your {onlineFare.toLocaleString()} PKR of online fares was already
            collected automatically — you won&apos;t pay it twice.
          </Text>
        )}
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>Amount due</Text>
          <Text style={styles.dueAmt}>{due.toLocaleString()} PKR</Text>
        </View>
      </View>

      {/* ── How to settle ── */}
      <View style={styles.stepsCard}>
        <Text style={styles.stepsTitle}>How to settle</Text>
        <Text style={styles.step}>
          <Text style={styles.bold}>1.</Text> Send <Text style={styles.bold}>PKR {due.toLocaleString()}</Text> to Velocity&apos;s account below.
        </Text>
        <Text style={styles.step}>
          <Text style={styles.bold}>2.</Text> Take a screenshot of the successful payment.
        </Text>
        <Text style={styles.step}>
          <Text style={styles.bold}>3.</Text> Upload it here — we verify it and unlock your account automatically.
        </Text>

        {/* Velocity's receiving accounts */}
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
                Send PKR {due.toLocaleString()} to{accounts?.accountTitle ? ` ${accounts.accountTitle}` : ''}
              </Text>
              <Text style={styles.accountValue}>{accountValue(activeMethod) ?? '—'}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.noAccounts}>
            Velocity&apos;s payment account isn&apos;t set up yet. Please contact support to settle.
          </Text>
        )}

        {/* Status of the latest attempt */}
        {underReview && (
          <View style={[styles.statusBox, { borderColor: '#f59e0b' }]}>
            <Text style={[styles.statusText, { color: '#f59e0b' }]}>
              ⏳ Your payment is under review. We&apos;ll unlock your account as soon as it&apos;s approved.
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
          Your screenshot is checked automatically by an AI system (Anthropic). If it can&apos;t
          be verified confidently, our team reviews it, and you can contest any decision through
          support. See our Privacy Policy for details.
        </Text>
      </View>

      {/* ── Blurred incoming rides ── */}
      <View style={styles.blurSection}>
        <Text style={styles.blurTitle}>
          {requests.length > 0
            ? `🔔 ${requests.length} new ride${requests.length === 1 ? '' : 's'} waiting`
            : 'Incoming rides'}
        </Text>
        <Text style={styles.blurSub}>Settle the commission above to see and accept them.</Text>
        {requests.slice(0, 3).map((r) => (
          <View key={r.id} style={styles.blurCardWrap}>
            <View style={styles.blurCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.blurRoute} numberOfLines={1}>
                  {blurText(r.pickup?.address)} → {blurText(r.dropoff?.address)}
                </Text>
                <Text style={styles.blurMeta}>{r.seats} seat(s) · {blurText(r.paymentMethod ?? 'cash', 0)}</Text>
              </View>
              <View style={styles.blurFare}>
                <Text style={styles.blurFareAmt}>▓▓▓</Text>
                <Text style={styles.blurFarePkr}>PKR</Text>
              </View>
            </View>
            <View style={styles.blurOverlay} pointerEvents="none">
              <Text style={styles.blurOverlayIcon}>🔒</Text>
            </View>
          </View>
        ))}
        {requests.length === 0 && (
          <View style={styles.blurCardWrap}>
            <View style={styles.blurCard}>
              <Text style={[styles.blurMeta, { flex: 1 }]}>
                New requests will appear here — blurred until you settle.
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  lockCard: {
    backgroundColor: '#2a0a0a',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.danger,
    padding: 16,
    gap: 10,
    alignItems: 'stretch',
  },
  lockIcon: { fontSize: 30, textAlign: 'center' },
  lockTitle: { fontSize: 17, fontWeight: '900', color: colors.danger, textAlign: 'center' },
  lockBody: { fontSize: 13, color: '#ffbbbb', lineHeight: 20, textAlign: 'center' },
  lockNote: { fontSize: 12, color: colors.primary, lineHeight: 18, textAlign: 'center' },
  bold: { fontWeight: '900', color: '#fff' },
  dueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#00000040',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dueLabel: { fontSize: 13, fontWeight: '700', color: '#ffbbbb' },
  dueAmt: { fontSize: 20, fontWeight: '900', color: '#ff6666' },

  stepsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  stepsTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
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

  blurSection: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  blurTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  blurSub: { fontSize: 12, color: colors.muted, marginBottom: 2 },
  blurCardWrap: { position: 'relative' },
  blurCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    opacity: 0.35,
  },
  blurRoute: { fontSize: 13, fontWeight: '700', color: colors.text },
  blurMeta: { fontSize: 11, color: colors.muted, marginTop: 3 },
  blurFare: { alignItems: 'center', backgroundColor: `${colors.primary}18`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  blurFareAmt: { fontSize: 16, fontWeight: '900', color: colors.primary },
  blurFarePkr: { fontSize: 9, fontWeight: '700', color: colors.primary },
  blurOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurOverlayIcon: { fontSize: 20 },
}));
