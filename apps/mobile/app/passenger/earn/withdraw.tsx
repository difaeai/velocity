/**
 * Earn with Velocity — withdraw.
 *
 * Requesting a withdrawal debits the balance immediately (server-side, in the
 * same transaction that creates the request), so two requests can never be
 * funded by the same rupees while an admin takes a day to approve the first.
 * The screen says so, because money leaving the balance before it arrives in a
 * bank account looks like a bug if nobody explains it.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { api } from '../../../src/api/client';
import type { WithdrawalMethod } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { db } from '../../../src/firebase';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import { PrimaryButton } from '../../../src/ui/components';
import { formatPKR } from '../../../src/ui/partner';

const METHODS: { key: WithdrawalMethod; label: string; emoji: string }[] = [
  { key: 'easypaisa', label: 'Easypaisa', emoji: '📱' },
  { key: 'jazzcash', label: 'JazzCash', emoji: '📲' },
  { key: 'bank', label: 'Bank transfer', emoji: '🏦' },
];

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#3b82f6',
  paid: '#22c55e',
  rejected: '#ef4444',
};

interface WithdrawRequest {
  id: string;
  amount: number;
  method: WithdrawalMethod;
  status: string;
  rejectionReason?: string | null;
  createdAt?: { seconds: number } | null;
}

export default function Withdraw() {
  const router = useRouter();
  const { user } = useAuth();
  const { data, reload } = usePartnerDashboard();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>('easypaisa');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<WithdrawRequest[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'withdraw_requests'),
      where('partnerId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    return onSnapshot(
      q,
      (snap) => setHistory(snap.docs.map((d) => ({ ...(d.data() as Omit<WithdrawRequest, 'id'>), id: d.id }))),
      () => setHistory([]),
    );
  }, [user]);

  const balance = data?.wallet.balance ?? 0;
  const value = Number(amount.replace(/\D/g, '')) || 0;
  const valid =
    value > 0 &&
    value <= balance &&
    accountName.trim().length >= 2 &&
    accountNumber.trim().length >= 5 &&
    (method !== 'bank' || bankName.trim().length >= 2);

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    try {
      await api.requestPartnerWithdrawal({
        amount: value,
        method,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        ...(method === 'bank' ? { bankName: bankName.trim() } : {}),
      });
      await reload();
      setAmount('');
      Alert.alert(
        'Withdrawal requested',
        'Your request is with our team. The amount has already left your balance and will be paid once approved.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Could not request that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>Available to withdraw</Text>
          <Text style={s.balance}>{formatPKR(balance)}</Text>
          {(data?.wallet.pending ?? 0) > 0 ? (
            <Text style={s.balanceHint}>
              {formatPKR(data!.wallet.pending)} is still clearing and cannot be withdrawn yet.
            </Text>
          ) : null}
        </View>

        <Text style={s.label}>Amount (PKR)</Text>
        <TextInput
          style={s.input}
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
        />
        {value > balance ? (
          <Text style={s.error}>That is more than your available balance.</Text>
        ) : null}
        <Pressable onPress={() => setAmount(String(balance))}>
          <Text style={s.max}>Withdraw everything ({formatPKR(balance)})</Text>
        </Pressable>

        <Text style={s.label}>Method</Text>
        <View style={s.methods}>
          {METHODS.map((m) => (
            <Pressable
              key={m.key}
              style={[s.method, method === m.key && s.methodOn]}
              onPress={() => setMethod(m.key)}
            >
              <Text style={s.methodEmoji}>{m.emoji}</Text>
              <Text style={[s.methodLabel, method === m.key && s.methodLabelOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Account title</Text>
        <TextInput
          style={s.input}
          value={accountName}
          onChangeText={setAccountName}
          placeholder="Name on the account"
          placeholderTextColor={colors.muted}
        />

        <Text style={s.label}>{method === 'bank' ? 'Account / IBAN' : 'Mobile number'}</Text>
        <TextInput
          style={s.input}
          value={accountNumber}
          onChangeText={setAccountNumber}
          placeholder={method === 'bank' ? 'PK00 XXXX 0000 0000 0000' : '03001234567'}
          placeholderTextColor={colors.muted}
          keyboardType={method === 'bank' ? 'default' : 'phone-pad'}
          autoCapitalize="characters"
        />

        {method === 'bank' ? (
          <>
            <Text style={s.label}>Bank</Text>
            <TextInput
              style={s.input}
              value={bankName}
              onChangeText={setBankName}
              placeholder="Meezan Bank"
              placeholderTextColor={colors.muted}
            />
          </>
        ) : null}

        <View style={{ height: 10 }} />
        <PrimaryButton label="Request withdrawal" onPress={submit} loading={submitting} disabled={!valid} />

        {history.length > 0 ? (
          <>
            <Text style={s.historyTitle}>Past requests</Text>
            {history.map((h) => (
              <View key={h.id} style={s.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.historyAmount}>{formatPKR(h.amount)}</Text>
                  <Text style={s.historyMeta}>
                    {METHODS.find((m) => m.key === h.method)?.label ?? h.method}
                    {h.createdAt
                      ? ` · ${new Date(h.createdAt.seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                      : ''}
                  </Text>
                  {h.rejectionReason ? (
                    <Text style={s.historyReason}>{h.rejectionReason}</Text>
                  ) : null}
                </View>
                <View
                  style={[
                    s.historyPill,
                    { backgroundColor: `${STATUS_COLOR[h.status] ?? colors.muted}22` },
                  ]}
                >
                  <Text style={[s.historyPillText, { color: STATUS_COLOR[h.status] ?? colors.muted }]}>
                    {h.status}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, paddingBottom: 44 },

  balanceCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 18,
    padding: 18,
    gap: 3,
    marginBottom: 6,
  },
  balanceLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  balance: { color: colors.text, fontSize: 30, fontWeight: '900' },
  balanceHint: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },

  label: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: 6, fontWeight: '700' },
  max: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 8 },

  methods: { flexDirection: 'row', gap: 8 },
  method: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  methodEmoji: { fontSize: 18 },
  methodLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  methodLabelOn: { color: colors.text },

  historyTitle: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 26, marginBottom: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  historyAmount: { color: colors.text, fontSize: 15, fontWeight: '800' },
  historyMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  historyReason: { color: colors.danger, fontSize: 11, marginTop: 3 },
  historyPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  historyPillText: { fontSize: 11, fontWeight: '900', textTransform: 'capitalize' },
}));
