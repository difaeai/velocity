/**
 * Payment methods — the connected-accounts screen.
 *
 * Shows the instruments the user has authorised Velocity to charge (Active) and
 * the ones the gateway supports but they have not connected yet (Inactive), so
 * adding one is a tap on the thing they were already looking at.
 *
 * Connecting hands off to the gateway: `createPaymentMethodSetup` returns a URL,
 * the user authorises there, and the gateway returns a reusable token to the
 * backend. The token never reaches this screen — everything here is display
 * data (kind, masked tail, default flag).
 *
 * While `savedPaymentMethodsEnabled` is off the whole screen renders in its
 * Coming Soon state: the rails are still listed so users can see what is
 * coming, but nothing is tappable.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text } from './Text';
import { useAuth } from '../auth/AuthContext';
import { api, type SavedMethodKind } from '../api/client';
import { useSavedPaymentMethods, type SavedPaymentMethod } from '../hooks/driver';
import { colors } from '../config';
import { themed } from '../theme';
import { Card } from './components';

/** Every rail we can connect, with the badge each one shows in the list. */
const KIND_META: Record<SavedMethodKind, { label: string; icon: string; tint: string }> = {
  easypaisa: { label: 'Easypaisa',    icon: '📱', tint: '#12b76a' },
  jazzcash:  { label: 'JazzCash',     icon: '📲', tint: '#e11d48' },
  bank:      { label: 'Bank account', icon: '🏦', tint: '#3b82f6' },
  card:      { label: 'Debit / credit card', icon: '💳', tint: '#a855f7' },
};

/** Order the rails are offered in — wallets first, they are what drivers use. */
const KIND_ORDER: SavedMethodKind[] = ['easypaisa', 'jazzcash', 'bank', 'card'];

export function PaymentMethodsScreen({ role }: { role: 'passenger' | 'driver' }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const methods = useSavedPaymentMethods(uid);

  const [comingSoon, setComingSoon] = useState(true);
  const [supportedKinds, setSupportedKinds] = useState<SavedMethodKind[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<SavedMethodKind | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    api.getPaymentMethods({})
      .then((res) => {
        if (cancelled) return;
        setComingSoon(res.comingSoon === true);
        setSupportedKinds(res.supportedKinds ?? []);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(refresh, [refresh]);

  /** Send the user to the gateway to authorise a new instrument. */
  async function connect(kind: SavedMethodKind) {
    setBusyKind(kind);
    try {
      const res = await api.createPaymentMethodSetup({ kind });
      if (res.mock) {
        // Dev/mock gateway: no hosted page exists, so complete it inline. This
        // is what makes the whole flow demoable before a merchant account.
        await api.mockConfirmPaymentMethod({ setupId: res.setupId });
        Alert.alert('Connected', `${KIND_META[kind].label} is now linked to your wallet (mock gateway).`);
      } else {
        await Linking.openURL(res.redirectUrl);
      }
    } catch (e) {
      Alert.alert('Could not connect', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusyKind(null);
    }
  }

  function confirmRemove(method: SavedPaymentMethod) {
    Alert.alert(
      'Remove payment method',
      `${method.label} will be disconnected. You can add it again at any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deletePaymentMethod({ methodId: method.id });
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not remove it.');
            }
          },
        },
      ],
    );
  }

  async function makeDefault(method: SavedPaymentMethod) {
    try {
      await api.setDefaultPaymentMethod({ methodId: method.id });
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update it.');
    }
  }

  const active = methods.filter((m) => m.status !== 'revoked');
  const connectedKinds = new Set(active.map((m) => m.kind));
  // Anything the gateway supports that is not connected yet. While the feature
  // is off we still list every rail so the screen shows what is coming.
  const available = (comingSoon ? KIND_ORDER : KIND_ORDER.filter((k) => supportedKinds.includes(k)))
    .filter((k) => !connectedKinds.has(k));

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
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Payment methods</Text>
        <Text style={styles.subtitle}>Setting up payments for rides</Text>

        {comingSoon ? (
          <View style={styles.comingSoonBanner}>
            <Text style={styles.comingSoonBadgeText}>Coming soon</Text>
            <Text style={styles.comingSoonText}>
              Connecting an account so Velocity can top up your wallet automatically is on its way.
              For now you can still top up manually from the Wallet screen.
            </Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}

        {active.length > 0 ? (
          <>
            <Text style={styles.section}>Active</Text>
            {active.map((m) => (
              <Card key={m.id} style={styles.methodCard}>
                <View style={styles.methodRow}>
                  <View style={[styles.badge, { backgroundColor: `${KIND_META[m.kind]?.tint ?? colors.primary}22` }]}>
                    <Text style={styles.badgeIcon}>{KIND_META[m.kind]?.icon ?? '💳'}</Text>
                  </View>
                  <View style={styles.methodInfo}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    {m.isDefault ? (
                      <Text style={styles.defaultTag}>Default</Text>
                    ) : (
                      <Pressable onPress={() => makeDefault(m)} hitSlop={6}>
                        <Text style={styles.makeDefault}>Make default</Text>
                      </Pressable>
                    )}
                  </View>
                  <Pressable onPress={() => confirmRemove(m)} hitSlop={10} style={styles.removeBtn}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {available.length > 0 ? (
          <>
            <Text style={styles.section}>Inactive</Text>
            {available.map((kind) => (
              <Pressable
                key={kind}
                onPress={() => (comingSoon ? undefined : connect(kind))}
                disabled={comingSoon || busyKind !== null}
                style={({ pressed }) => [
                  styles.availableRow,
                  comingSoon && styles.availableRowDisabled,
                  pressed && !comingSoon && styles.availableRowPressed,
                ]}
              >
                <View style={[styles.badge, { backgroundColor: `${KIND_META[kind].tint}22` }]}>
                  <Text style={styles.badgeIcon}>{KIND_META[kind].icon}</Text>
                </View>
                <Text style={styles.availableLabel}>{KIND_META[kind].label}</Text>
                {busyKind === kind ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.chevron}>{comingSoon ? '' : '›'}</Text>
                )}
              </Pressable>
            ))}
          </>
        ) : null}

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {role === 'driver'
              ? 'Connected accounts top up your wallet, which is what settles the commission you owe on cash rides. '
              : 'Connected accounts top up your wallet, which pays for rides and any fees you owe. '}
            Velocity never sees or stores your PIN, password or full card number — your bank or wallet
            authorises us to charge only the amount you approve, and you can disconnect any method here
            at any time.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  container: { paddingHorizontal: 18, paddingBottom: 32, gap: 10 },
  title: { fontSize: 32, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 8 },
  loader: { marginVertical: 12 },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 14, marginBottom: 4 },
  methodCard: { paddingVertical: 14 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  methodInfo: { flex: 1 },
  methodLabel: { fontSize: 15, fontWeight: '800', color: colors.text },
  defaultTag: { fontSize: 11, fontWeight: '800', color: colors.primary, marginTop: 3, textTransform: 'uppercase' },
  makeDefault: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 3 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  removeText: { fontSize: 12, fontWeight: '800', color: colors.danger },
  badge: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  badgeIcon: { fontSize: 20 },
  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  availableRowDisabled: { opacity: 0.45 },
  availableRowPressed: { borderColor: colors.primary },
  availableLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  chevron: { fontSize: 22, color: colors.muted },
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
  infoBox: {
    marginTop: 18,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: { fontSize: 12, color: colors.muted, lineHeight: 18 },
}));
