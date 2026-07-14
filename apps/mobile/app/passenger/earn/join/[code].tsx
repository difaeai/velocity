/**
 * Earn with Velocity — the recruit's landing screen.
 *
 * Where a shared link or a scanned QR lands. The visitor is usually NOT signed
 * in yet — this is the first thing they ever see of Velocity — so the code is
 * stashed and replayed after sign-in rather than demanding an account up front.
 * Asking a stranger to register before telling them what they are joining is how
 * a referral link converts nobody.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../../src/api/client';
import type { FleetType, PartnerLevel } from '../../../../src/api/client';
import { useAuth } from '../../../../src/auth/AuthContext';
import { colors } from '../../../../src/config';
import { claimStashedReferral, deviceFingerprint, stashReferralCode } from '../../../../src/hooks/partner';
import { PrimaryButton } from '../../../../src/ui/components';
import { LevelBadge } from '../../../../src/ui/partner';

interface Preview {
  code: string;
  type: FleetType;
  fleetName: string;
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
          type: res.type,
          fleetName: res.fleetName,
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
        // account exists (see AuthContext / claimStashedReferral).
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

  // A signed-in user who arrived with a stashed code from a cold start.
  useEffect(() => {
    if (user && code) void claimStashedReferral();
  }, [user, code]);

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
          <Text style={s.title}>You're in {preview.partnerName}'s fleet</Text>
          <Text style={s.body}>
            {preview.type === 'driver'
              ? 'Complete your driver registration and start earning. Your rides also support the partner who invited you — at no cost to you.'
              : 'Book your first ride. Your fares are unchanged — the partner who invited you earns from Velocity’s side, never from your pocket.'}
          </Text>
          <PrimaryButton
            label={preview.type === 'driver' ? 'Become a driver' : 'Book a ride'}
            onPress={() =>
              router.replace(preview.type === 'driver' ? '/passenger/become-driver' : '/passenger/home')
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.center}>
        <Text style={s.emoji}>{preview.type === 'driver' ? '🚗' : '🎟️'}</Text>

        <Text style={s.invited}>{preview.partnerName} invited you</Text>
        <LevelBadge level={preview.partnerLevel} size="sm" />

        <Text style={s.title}>
          {preview.type === 'driver' ? 'Drive with Velocity' : 'Ride with Velocity'}
        </Text>

        <Text style={s.body}>
          {preview.type === 'driver'
            ? 'Join as a driver, keep your fares, and get support from a local fleet owner.'
            : 'Real fares, real drivers, across Pakistan.'}
        </Text>

        <View style={s.codeBox}>
          <Text style={s.codeLabel}>Referral code</Text>
          <Text style={s.code}>{preview.code}</Text>
        </View>

        {/* Say the quiet part plainly: joining costs the recruit nothing. */}
        <Text style={s.fine}>
          Joining a fleet is free and never changes your fare. The partner earns a share of
          Velocity's own commission, not of your money.
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
    paddingHorizontal: 28,
    alignItems: 'center',
    marginVertical: 6,
  },
  codeLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  code: { color: colors.primary, fontSize: 24, fontWeight: '900', letterSpacing: 2, marginTop: 2 },

  fine: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 17, marginBottom: 8 },
});
