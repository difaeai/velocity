import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import * as Clipboard from 'expo-clipboard';

import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import {
  useCommissionStatus,
  useDriverProfile,
  useOutstanding,
  useSettlementAccounts,
  useWalletBalance,
  useWalletTransactions,
} from '../hooks/driver';
import { colors } from '../config';
import { themed } from '../theme';
import { Card, PrimaryButton } from './components';
import { OutstandingFees } from './OutstandingFees';

const TXN_LABEL: Record<string, string> = {
  topup: 'Top-up',
  trip_payout: 'Trip earnings',
  trip_cash: 'Cash trip',
  payout_request: 'Payout',
  ride_hold: 'Ride payment',
  ride_hold_refund: 'Ride refund',
  commission_payment: 'Commission paid',
  cancellation_fee: 'Cancellation fee',
  cancellation_fee_paid: 'Cancellation fees cleared',
  debit: 'Subscription',
};

type PayoutMethod = 'jazzcash' | 'easypaisa' | 'bank';
type TopupProvider = 'jazzcash' | 'easypaisa';

const PAYOUT_METHODS: { key: PayoutMethod; label: string }[] = [
  { key: 'easypaisa', label: 'Easypaisa' },
  { key: 'jazzcash', label: 'JazzCash' },
  { key: 'bank', label: 'Bank (IBAN)' },
];

const PROVIDER_LABEL: Record<TopupProvider, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
};

export function WalletScreen({ role }: { role: 'passenger' | 'driver' }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const balance = useWalletBalance(uid);
  const txns = useWalletTransactions(uid);
  const [amount, setAmount] = useState('500');
  const [busy, setBusy] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('easypaisa');
  const [payoutAccount, setPayoutAccount] = useState('');
  const [topupProviders, setTopupProviders] = useState<TopupProvider[]>([]);
  const [topupProvider, setTopupProvider] = useState<TopupProvider | undefined>(undefined);
  const [topupComingSoon, setTopupComingSoon] = useState(false);

  // Commission cycle — only meaningful for drivers.
  const driverProfile = useDriverProfile(role === 'driver' ? uid : undefined);
  const commission = useCommissionStatus(driverProfile);
  // Velocity's official receiving accounts — where drivers send commission and
  // dues manually (same admin-maintained accounts the commission lock shows).
  const velocityAccounts = useSettlementAccounts();
  // Unpaid cancellation fees — both roles can owe these.
  const outstanding = useOutstanding(uid);

  // Which gateways the backend has configured. `comingSoon` = top-ups are off
  // for launch (feature flag); we show a Coming Soon card instead of the form.
  useEffect(() => {
    let cancelled = false;
    api.getPaymentOptions({})
      .then((res) => {
        if (cancelled) return;
        setTopupComingSoon(res.comingSoon === true);
        setTopupProviders(res.providers);
        setTopupProvider(res.providers[0]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function topup() {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 100) {
      Alert.alert('Invalid amount', 'Minimum top-up is 100 PKR.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.createTopupIntent({ amount: amt, provider: topupProvider });
      if (res.mock) {
        await api.mockConfirmTopup({ intentId: res.intentId });
        Alert.alert('Wallet topped up', `${amt} PKR added (mock provider).`);
      } else if (res.redirectUrl) {
        await Linking.openURL(res.redirectUrl);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  }

  async function payout() {
    const amt = parseInt(amount, 10);
    if (!amt || amt > balance) {
      Alert.alert('Invalid amount', 'Enter an amount within your balance.');
      return;
    }
    const account = payoutAccount.trim();
    if (account.length < 5) {
      Alert.alert(
        'Account required',
        payoutMethod === 'bank'
          ? 'Enter the IBAN the money should be sent to.'
          : `Enter your ${payoutMethod === 'easypaisa' ? 'Easypaisa' : 'JazzCash'} mobile number.`,
      );
      return;
    }
    setBusy(true);
    try {
      await api.requestPayout({ amount: amt, method: payoutMethod, account });
      Alert.alert(
        'Payout requested',
        `${amt} PKR will be transferred to your ${PAYOUT_METHODS.find((m) => m.key === payoutMethod)?.label} account (${account}).`,
      );
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Payout failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.container}>

        <Card style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <Text style={styles.balance}>{balance} PKR</Text>
          {outstanding.amount > 0 ? (
            <Text style={styles.balanceOwed}>
              −{outstanding.amount.toLocaleString()} PKR outstanding to Velocity
            </Text>
          ) : null}
        </Card>

        {/* Cancellation fees owed to Velocity — passengers and drivers alike */}
        {outstanding.amount > 0 ? (
          <OutstandingFees status={outstanding} uid={uid} role={role} />
        ) : null}

        {/* Commission cycle — drivers settle Velocity's cut from the wallet */}
        {role === 'driver' && commission.cycleGrossFare > 0 ? (
          <Card style={commission.locked ? styles.commCardLocked : undefined}>
            <Text style={styles.label}>
              {commission.locked ? '🔒 Commission due' : 'Commission cycle'}
            </Text>
            <View style={styles.commRow}>
              <Text style={styles.commMeta}>Cycle earnings</Text>
              <Text style={styles.commMeta}>
                {commission.cycleGrossFare.toLocaleString()} / {commission.threshold.toLocaleString()} PKR
              </Text>
            </View>
            <View style={styles.commTrack}>
              <View
                style={[
                  styles.commFill,
                  { width: `${Math.min((commission.cycleGrossFare / commission.threshold) * 100, 100)}%` },
                  commission.locked && { backgroundColor: colors.danger },
                ]}
              />
            </View>
            <View style={styles.commRow}>
              <Text style={styles.commMeta}>
                Velocity commission ({Math.round(commission.rate * 100)}% of cash fares)
              </Text>
              <Text style={[styles.commDue, commission.locked && { color: colors.danger }]}>
                {commission.due.toLocaleString()} PKR
              </Text>
            </View>
            {commission.locked ? (
              <>
                <PrimaryButton
                  label="Settle commission →"
                  onPress={() => router.replace('/driver')}
                />
                <Text style={styles.payoutHint}>
                  Go to your Home screen to pay Velocity and upload your payment screenshot. Your
                  account unlocks once it&apos;s verified.
                </Text>
              </>
            ) : (
              <Text style={styles.payoutHint}>
                When cycle earnings reach {commission.threshold.toLocaleString()} PKR you&apos;ll settle
                by paying Velocity and uploading a screenshot. Commission on online rides is collected
                automatically.
              </Text>
            )}
          </Card>
        ) : null}

        {/* Velocity's official accounts — where the driver sends commission /
            dues manually before uploading the payment screenshot. */}
        {role === 'driver' &&
        (velocityAccounts?.easypaisaNumber || velocityAccounts?.jazzcashNumber || velocityAccounts?.bankIban) ? (
          <Card>
            <Text style={styles.label}>Pay Velocity — official accounts</Text>
            <Text style={styles.accountsIntro}>
              Send your commission or dues to one of these accounts
              {velocityAccounts.accountTitle ? (
                <>
                  {' '}(account title: <Text style={styles.accountsTitleName}>{velocityAccounts.accountTitle}</Text>)
                </>
              ) : null}
              , then upload the payment screenshot when the app asks for it.
            </Text>
            {velocityAccounts.easypaisaNumber ? (
              <AccountRow label="📱 Easypaisa" value={velocityAccounts.easypaisaNumber} />
            ) : null}
            {velocityAccounts.jazzcashNumber ? (
              <AccountRow label="📲 JazzCash" value={velocityAccounts.jazzcashNumber} />
            ) : null}
            {velocityAccounts.bankIban ? (
              <AccountRow
                label={`🏦 ${velocityAccounts.bankName ?? 'Bank'} (IBAN)`}
                value={velocityAccounts.bankIban}
              />
            ) : null}
          </Card>
        ) : null}

        {topupComingSoon ? (
          <Card>
            <View style={styles.comingSoonRow}>
              <Text style={styles.label}>Add money</Text>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonBadgeText}>Coming soon</Text>
              </View>
            </View>
            <Text style={styles.comingSoonText}>
              Wallet top-ups with JazzCash and Easypaisa are on the way. You&apos;ll be able to load
              your wallet and pay for rides from it here soon.
            </Text>
          </Card>
        ) : (
          <Card>
            <Text style={styles.label}>Amount (PKR)</Text>
            {topupProviders.length > 0 ? (
              <View style={styles.methodRow}>
                {topupProviders.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setTopupProvider(p)}
                    style={[styles.methodChip, topupProvider === p && styles.methodChipActive]}
                  >
                    <Text style={[styles.methodChipText, topupProvider === p && styles.methodChipTextActive]}>
                      {PROVIDER_LABEL[p]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              style={styles.input}
            />
            <PrimaryButton label="Add money" onPress={topup} loading={busy} />
          </Card>
        )}

        {role === 'driver' ? (
          <Card>
            <Text style={styles.label}>Withdraw earnings</Text>
            <View style={styles.methodRow}>
              {PAYOUT_METHODS.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => setPayoutMethod(m.key)}
                  style={[styles.methodChip, payoutMethod === m.key && styles.methodChipActive]}
                >
                  <Text style={[styles.methodChipText, payoutMethod === m.key && styles.methodChipTextActive]}>
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={payoutAccount}
              onChangeText={setPayoutAccount}
              placeholder={payoutMethod === 'bank' ? 'IBAN (PK…)' : 'Mobile number (03…)'}
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              keyboardType={payoutMethod === 'bank' ? 'default' : 'phone-pad'}
              style={styles.input}
            />
            <PrimaryButton variant="secondary" label="Request payout" onPress={payout} disabled={busy} />
            <Text style={styles.payoutHint}>
              The amount above will be sent to this account after admin verification.
            </Text>
          </Card>
        ) : null}

        <Text style={styles.section}>Recent transactions</Text>
        {txns.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No transactions yet.</Text>
          </Card>
        ) : (
          txns.map((t) => (
            <View key={t.id} style={styles.txnRow}>
              <Text style={styles.txnLabel}>{TXN_LABEL[t.type] ?? t.type}</Text>
              <Text style={[styles.txnAmt, { color: t.amount < 0 ? colors.danger : colors.primary }]}>
                {t.amount < 0 ? '' : '+'}
                {t.amount} PKR
              </Text>
            </View>
          ))
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

/** One official account: label, number/IBAN, and a copy button. */
function AccountRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await Clipboard.setStringAsync(value).catch(() => {});
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

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  container: { padding: 18, gap: 14 },
  title: { fontSize: 24, fontWeight: '900', color: colors.text },
  balanceCard: { backgroundColor: colors.primary },
  balanceLabel: { color: '#cdebd9', fontSize: 13, fontWeight: '700' },
  balance: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  balanceOwed: { color: '#ffdada', fontSize: 12, fontWeight: '800', marginTop: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  section: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 4 },
  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  methodChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
  methodChipText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  methodChipTextActive: { color: colors.primary },
  payoutHint: { fontSize: 11, color: colors.muted, marginTop: 8 },
  accountsIntro: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 10 },
  accountsTitleName: { fontWeight: '800', color: colors.text },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: `${colors.primary}12`,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  accountRowLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },
  accountRowValue: { fontSize: 15, fontWeight: '900', color: colors.text, marginTop: 2 },
  copyBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  commCardLocked: { borderColor: colors.danger, borderWidth: 1.5 },
  commRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  commMeta: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  commDue: { fontSize: 15, fontWeight: '900', color: colors.text },
  commTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginBottom: 10 },
  commFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  comingSoonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  comingSoonBadge: { backgroundColor: `${colors.primary}20`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${colors.primary}50` },
  comingSoonBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary, textTransform: 'uppercase' },
  comingSoonText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  muted: { fontSize: 13, color: colors.muted },
  txnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txnLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  txnAmt: { fontSize: 14, fontWeight: '800' },
}));
