import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  payout_request: 'Payout',
};

export function WalletScreen({ role }: { role: 'passenger' | 'driver' }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const balance = useWalletBalance(uid);
  const txns = useWalletTransactions(uid);
  const [amount, setAmount] = useState('500');
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      await api.requestPayout({ amount: amt });
      Alert.alert('Payout requested', `${amt} PKR will be transferred to your account.`);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Payout failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Wallet</Text>

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
          {role === 'driver' ? (
            <View style={{ marginTop: 8 }}>
              <PrimaryButton variant="secondary" label="Request payout" onPress={payout} disabled={busy} />
            </View>
          ) : null}
        </Card>

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

        <PrimaryButton
          variant="secondary"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
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
