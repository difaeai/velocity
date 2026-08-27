/**
 * Enter a partner's referral code.
 *
 * One screen serves both audiences — reached from the passenger's Settings and
 * from the driver's drawer. It does not ask which fleet you are joining, because
 * that is not the recruit's decision to make: the backend reads your role and
 * puts a driver in the driver fleet and a passenger in the passenger fleet. The
 * same five digits work for both, so there is nothing here to get wrong.
 *
 * The screen is deliberately honest about the two things people ask support:
 * joining costs you nothing, and it stops working once you have completed a
 * ride — so if you have a code, use it now.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '../src/ui/Text';

import { api } from '../src/api/client';
import type { MyReferral } from '../src/api/client';
import { colors } from '../src/config';
import { themed } from '../src/theme';
import { deviceFingerprint } from '../src/hooks/partner';
import { PrimaryButton } from '../src/ui/components';
import { Skeleton } from '../src/ui/partner';

export default function ReferralCodeScreen() {
  const router = useRouter();
  const [existing, setExisting] = useState<MyReferral | null>(null);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ partnerName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getMyReferral({})
      .then(setExisting)
      .catch(() => setExisting({ ok: true, bound: false, type: 'passenger' }));
  }, []);

  // Resolve the code to a name as they finish typing, so they can see WHOSE
  // fleet they are about to join permanently before they commit to it.
  useEffect(() => {
    if (code.length !== 5) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .previewPartnerFleet({ code })
      .then((res) => {
        if (!cancelled) setPreview({ partnerName: res.partnerName });
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function redeem() {
    setBusy(true);
    try {
      const res = await api.claimPartnerReferral({ code, deviceId: deviceFingerprint() });
      Alert.alert(
        'Code applied 🎉',
        `You're now part of ${res.partnerName ?? 'your partner'}'s Velocity fleet. Your fares don't change — they earn from Velocity's side, never from yours.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
      setExisting(await api.getMyReferral({}));
      setCode('');
    } catch (e) {
      Alert.alert('Could not apply that code', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  // The root layout renders a bare <Slot/>, so there is no navigation header —
  // every screen draws its own way back.
  const header = (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={s.back}>←</Text>
      </Pressable>
      <Text style={s.headerTitle}>Referral code</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (!existing) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {header}
        <View style={s.scroll}>
          <Skeleton height={120} radius={16} />
        </View>
      </SafeAreaView>
    );
  }

  // Already in a fleet — show who, and don't offer a second code.
  if (existing.bound) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {header}
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.boundCard}>
            <Text style={s.boundEmoji}>🤝</Text>
            <Text style={s.boundTitle}>You&apos;re in {existing.partnerName}&apos;s fleet</Text>
            <Text style={s.boundCode}>{existing.code}</Text>
            <Text style={s.boundBody}>
              {existing.completedRides ?? 0} of your completed rides have supported them so far — at
              no cost to you. Your fares are exactly what they would be otherwise.
            </Text>
            <Text style={s.boundNote}>
              A fleet link is permanent. If it was set up by mistake, contact support.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Have a referral code?</Text>
        <Text style={s.sub}>
          If a Velocity partner invited you, enter their 5-digit code. It costs you nothing and never
          changes your fare — they earn a share of Velocity&apos;s commission, not of your money.
        </Text>

        <TextInput
          style={s.codeInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 5))}
          placeholder="12345"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          maxLength={5}
        />

        {preview ? (
          <View style={s.preview}>
            <Text style={s.previewText}>
              ✅ This is <Text style={s.previewName}>{preview.partnerName}</Text>&apos;s code.
            </Text>
          </View>
        ) : code.length === 5 ? (
          <Text style={s.notFound}>We don&apos;t recognise that code.</Text>
        ) : null}

        <View style={{ height: 8 }} />
        <PrimaryButton
          label="Apply code"
          onPress={redeem}
          loading={busy}
          disabled={code.length !== 5 || !preview}
        />

        <Text style={s.fine}>
          Referral codes only work before your first completed ride, and the link is permanent once
          set.
        </Text>

        <Pressable onPress={() => router.push('/passenger/earn')}>
          <Text style={s.becomeLink}>Want to earn like this yourself? →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 22, gap: 12, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  back: { color: colors.text, fontSize: 24, fontWeight: '700' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },

  h1: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.4 },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: 8 },

  codeInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    height: 76,
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 12,
    textAlign: 'center',
  },

  preview: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 12,
    padding: 12,
  },
  previewText: { color: colors.text, fontSize: 13 },
  previewName: { fontWeight: '900' },
  notFound: { color: colors.danger, fontSize: 13, fontWeight: '700' },

  fine: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  becomeLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 18,
  },

  boundCard: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  boundEmoji: { fontSize: 40 },
  boundTitle: { color: colors.text, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  boundCode: { color: colors.primary, fontSize: 26, fontWeight: '900', letterSpacing: 4 },
  boundBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  boundNote: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 8, opacity: 0.8 },
}));
