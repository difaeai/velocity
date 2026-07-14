/**
 * Earn with Velocity — the recruit's landing screen.
 *
 * Where a shared link or a scanned QR lands. The visitor is usually NOT signed
 * in yet — this is the first thing they ever see of Velocity — so the code is
 * stashed and replayed after sign-in rather than demanding an account up front.
 * Asking a stranger to register before telling them what they are joining is how
 * a referral link converts nobody.
 *
 * The screen never asks whether they are a driver or a passenger. It does not
 * need to: the backend puts them in whichever fleet matches the role their
 * account already has.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../../src/api/client';
import type { PartnerLevel } from '../../../../src/api/client';
import { useAuth } from '../../../../src/auth/AuthContext';
import { colors } from '../../../../src/config';
import { deviceFingerprint, stashReferralCode } from '../../../../src/hooks/partner';
import { PrimaryButton } from '../../../../src/ui/components';
import { LevelBadge } from '../../../../src/ui/partner';

interface Preview {
  code: string;
  partnerName: string;
  partnerLevel: PartnerLevel;
}

export default function JoinFleet() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!code) return;
    api
      .previewPartnerFleet({ code })
      .then((res) =>
        setPreview({
          code: res.code,
          partnerName: res.partnerName,
          partnerLevel: res.partnerLevel,
        }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : 'That referral code is not valid.'));
  }, [code]);

  async function join() {
    if (!code) return;
    setJoining(true);
    try {
      if (!user) {
        // Park it and send them to sign in — the code is replayed the moment an
        // account exists (see hooks/partner → claimStashedReferral).
        await stashReferralCode(code);
        router.push('/auth/sign-in');
        return;
      }
      await api.claimPartnerReferral({ code, deviceId: deviceFingerprint() });
      setJoined(true);
    } catch (e) {
      Alert.alert('Could not join', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoining(false);
    }
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.center}>
          <Text style={s.emoji}>🤷</Text>
          <Text style={s.title}>{error}</Text>
          <PrimaryButton label="Continue to Velocity" onPress={() => router.replace('/passenger/home')} />
        </View>
      </SafeAreaView>
    );
  }

  if (!preview) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (joined) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.center}>
          <Text style={s.emoji}>🎉</Text>
          <Text style={s.title}>You&apos;re in {preview.partnerName}&apos;s fleet</Text>
          <Text style={s.body}>
            Your fares are unchanged — they earn from Velocity&apos;s side, never from your pocket.
          </Text>
          <PrimaryButton label="Start riding" onPress={() => router.replace('/passenger/home')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.center}>
        <Text style={s.emoji}>🎟️</Text>

        <Text style={s.invited}>{preview.partnerName} invited you</Text>
        <LevelBadge level={preview.partnerLevel} size="sm" />

        <Text style={s.title}>Join Velocity</Text>
        <Text style={s.body}>
          Real fares, real drivers, across Pakistan. Ride with us, or sign up to drive — either way
          this code puts you in {preview.partnerName}&apos;s fleet.
        </Text>

        <View style={s.codeBox}>
          <Text style={s.codeLabel}>Referral code</Text>
          <Text style={s.code}>{preview.code}</Text>
        </View>

        {/* Say the quiet part plainly: joining costs the recruit nothing. */}
        <Text style={s.fine}>
          Joining a fleet is free and never changes your fare. The partner earns a share of
          Velocity&apos;s own commission, not of your money.
        </Text>

        <PrimaryButton
          label={user ? 'Join this fleet' : 'Sign up and join'}
          onPress={join}
          loading={joining}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', padding: 26, gap: 12, alignItems: 'center' },

  emoji: { fontSize: 46 },
  invited: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  title: { color: colors.text, fontSize: 25, fontWeight: '900', textAlign: 'center', letterSpacing: -0.4 },
  body: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 21 },

  codeBox: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 34,
    alignItems: 'center',
    marginVertical: 6,
  },
  codeLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  code: { color: colors.primary, fontSize: 30, fontWeight: '900', letterSpacing: 5, marginTop: 2 },

  fine: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 17, marginBottom: 8 },
});
