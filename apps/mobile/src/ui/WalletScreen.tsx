import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useWalletBalance, useWalletTransactions } from '../hooks/driver';
import { colors } from '../config';
import { Card, PrimaryButton } from './components';

const TXN_LABEL: Record<string, string> = {
  topup: 'Top-up',
  trip_payout: 'Trip earnings',
  trip_cash: 'Cash trip',
  payout_request: 'Payout',
  ride_hold: 'Ride payment',
  ride_hold_refund: 'Ride refund',
  commission_payment: 'Commission paid',
  debit: 'Subscription',
};

type PayoutMethod = 'jazzcash' | 'easypaisa' | 'bank';

const PAYOUT_METHODS: { key: PayoutMethod; label: string }[] = [
  { key: 'easypaisa', label: 'Easypaisa' },
  { key: 'jazzcash', label: 'JazzCash' },
  { key: 'bank', label: 'Bank (IBAN)' },
];

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

  async function topup() {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 100) {
      Alert.alert('Invalid amount', 'Minimum top-up is 100 PKR.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.createTopupIntent({ amount: amt });
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
        </Card>

        <Card>
          <Text style={styles.label}>Amount (PKR)</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            style={styles.input}
          />
          <PrimaryButton label="Add money" onPress={topup} loading={busy} />
        </Card>

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

const styles = StyleSheet.create({
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
});
