import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { colors } from '../config';
import {
  useSettlementAccounts,
  type CommissionStatus,
  type OpenRequest,
} from '../hooks/driver';
import { PrimaryButton } from './components';

type TopupProvider = 'jazzcash' | 'easypaisa';

const PROVIDER_LABEL: Record<TopupProvider, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
};

/** "F-7 Markaz, Islamabad" → "F-7 ▓▓▓▓▓▓, ▓▓▓▓▓▓▓▓▓" — readable enough to
 * tease the ride, useless for actually working it. */
function blurText(s: string | undefined, keep = 3): string {
  if (!s) return '▓▓▓▓▓▓▓▓';
  return s.slice(0, keep) + s.slice(keep).replace(/[^\s,]/g, '▓');
}

/**
 * Full-screen takeover shown when the driver's commission cycle is locked.
 * The app is paused on this settle flow: incoming rides stay visible but
 * blurred until the commission is paid to Velocity from the wallet.
 */
export function CommissionLock({
  status,
  balance,
  requests,
}: {
  status: CommissionStatus;
  balance: number;
  requests: OpenRequest[];
}) {
  const accounts = useSettlementAccounts();
  const [busy, setBusy] = useState(false);
  const [topupProviders, setTopupProviders] = useState<TopupProvider[]>([]);
  const [topupProvider, setTopupProvider] = useState<TopupProvider | undefined>(undefined);

  const { due, rate, cycleGrossFare, cycleCashFare } = status;
  const onlineFare = Math.max(0, cycleGrossFare - cycleCashFare);
  const shortfall = Math.max(0, due - balance);
  // Backend minimum top-up is 100 PKR.
  const topupAmount = Math.max(100, shortfall);

  useEffect(() => {
    let cancelled = false;
    api.getPaymentOptions({})
      .then((res) => {
        if (cancelled) return;
        setTopupProviders(res.providers);
        setTopupProvider(res.providers[0]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function topupShortfall() {
    setBusy(true);
    try {
      const res = await api.createTopupIntent({ amount: topupAmount, provider: topupProvider });
      if (res.mock) {
        await api.mockConfirmTopup({ intentId: res.intentId });
        Alert.alert('Wallet topped up', `${topupAmount} PKR added (mock provider).`);
      } else if (res.redirectUrl) {
        await Linking.openURL(res.redirectUrl);
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    setBusy(true);
    try {
      const res = await api.payCommission({});
      Alert.alert(
        'Commission settled ✅',
        `${res.amountPaid} PKR paid to Velocity. Your account is unlocked — incoming rides are visible again.`,
      );
    } catch (e) {
      Alert.alert('Could not settle', e instanceof Error ? e.message : 'Payment failed.');
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
            ✓ Commission on your {onlineFare.toLocaleString()} PKR of online (wallet) fares was
            already collected automatically — you won&apos;t pay it twice.
          </Text>
        )}
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>Amount due</Text>
          <Text style={styles.dueAmt}>{due.toLocaleString()} PKR</Text>
        </View>
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>Wallet balance</Text>
          <Text style={[styles.dueBalance, { color: balance >= due ? colors.primary : colors.danger }]}>
            {balance.toLocaleString()} PKR
          </Text>
        </View>

        {balance >= due ? (
          <PrimaryButton
            label={busy ? 'Processing…' : `Pay ${due.toLocaleString()} PKR & unlock`}
            disabled={busy}
            onPress={settle}
          />
        ) : (
          <>
            <Text style={styles.shortfall}>
              Top up {shortfall.toLocaleString()} PKR to your wallet to settle. The top-up goes to
              Velocity&apos;s account through the payment gateway.
            </Text>
            {topupProviders.length > 0 && (
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
            )}
            <PrimaryButton
              label={busy ? 'Processing…' : `Top up ${topupAmount.toLocaleString()} PKR`}
              disabled={busy}
              onPress={topupShortfall}
            />
          </>
        )}
      </View>

      {/* ── Velocity's receiving accounts ── */}
      {accounts && (accounts.easypaisaNumber || accounts.jazzcashNumber || accounts.bankIban) ? (
        <View style={styles.accountsCard}>
          <Text style={styles.accountsTitle}>Velocity official accounts</Text>
          <Text style={styles.accountsSub}>
            Your commission is paid to Velocity ({accounts.accountTitle ?? 'Velocity'}). For
            reference:
          </Text>
          {accounts.easypaisaNumber ? (
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>Easypaisa</Text>
              <Text style={styles.accountValue}>{accounts.easypaisaNumber}</Text>
            </View>
          ) : null}
          {accounts.jazzcashNumber ? (
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>JazzCash</Text>
              <Text style={styles.accountValue}>{accounts.jazzcashNumber}</Text>
            </View>
          ) : null}
          {accounts.bankIban ? (
            <View style={styles.accountRow}>
              <Text style={styles.accountLabel}>{accounts.bankName ?? 'Bank'}</Text>
              <Text style={styles.accountValue}>{accounts.bankIban}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

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

const styles = StyleSheet.create({
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
  dueBalance: { fontSize: 16, fontWeight: '900' },
  shortfall: { fontSize: 12, color: '#ffbbbb', lineHeight: 18, textAlign: 'center' },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffffff30',
    alignItems: 'center',
  },
  methodChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
  methodChipText: { fontSize: 12, fontWeight: '700', color: '#ffbbbb' },
  methodChipTextActive: { color: colors.primary },

  accountsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  accountsTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  accountsSub: { fontSize: 11, color: colors.muted, lineHeight: 16 },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountLabel: { fontSize: 13, fontWeight: '700', color: colors.muted },
  accountValue: { fontSize: 13, fontWeight: '800', color: colors.text },

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
});
