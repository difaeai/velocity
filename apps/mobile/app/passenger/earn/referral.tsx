/**
 * Earn with Velocity — the referral centre.
 *
 * ONE code, five digits, minted when the partner was approved. Both of their
 * fleets carry it, and which fleet a recruit lands in is decided by who the
 * recruit is: a driver who redeems it joins the driver fleet, a passenger who
 * redeems it joins the passenger fleet.
 *
 * That is why this screen shows a single code and not two. A partner has to say
 * their code out loud, write it on a poster, and forward it on WhatsApp — and a
 * partner juggling two codes eventually gives somebody the wrong one, at which
 * point the recruit bounces off a code that does not fit them.
 *
 * The share message says what the recruit gets, not what the partner gets.
 * "Join my fleet so I earn 2%" recruits nobody.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import type { FleetType } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import { appLink } from '../../../src/share/links';
import { ErrorState, LevelBadge, SectionTitle, Segmented, Skeleton, formatPKR } from '../../../src/ui/partner';

export default function ReferralCentre() {
  const { data, loading, error, reload } = usePartnerDashboard();
  const [audience, setAudience] = useState<FleetType>('driver');

  if (loading && !data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <Skeleton height={300} radius={20} />
        </View>
      </SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ErrorState message={error ?? 'Could not load your referral centre.'} onRetry={reload} />
      </SafeAreaView>
    );
  }

  const code = data.partner.referralCode;
  if (!code) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <Text style={s.empty}>
            Your referral code is minted when your application is approved. Hang tight.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const link = appLink(`/passenger/earn/join/${code}`);
  const driverFleet = data.fleets.driver;
  const passengerFleet = data.fleets.passenger;

  async function share() {
    const message =
      audience === 'driver'
        ? `Drive with Velocity and start earning.\n\nSign up, then enter my referral code ${code} in Driver menu → Referral code.\n\n${link}`
        : `Ride with Velocity — real fares, real drivers.\n\nSign up, then enter my referral code ${code} in Settings → Referral code.\n\n${link}`;
    try {
      await Share.share({ message });
    } catch {
      /* user dismissed the sheet */
    }
  }

  async function copy(text: string, what: string) {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${what} copied to your clipboard.`);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.card}>
          <Text style={s.codeLabel}>Your referral code</Text>
          <Text style={s.code}>{code}</Text>
          <LevelBadge level={data.partner.level} size="sm" />

          <View style={s.qrPad}>
            {/* White quiet zone regardless of theme — a QR on a dark card is
                unreadable to half the scanners in the wild. */}
            <QRCode value={link} size={168} backgroundColor="#ffffff" color="#000000" />
          </View>

          <Text style={s.oneCode}>
            One code for both fleets. A driver who enters it joins your driver fleet; a passenger
            who enters it joins your passenger fleet.
          </Text>
        </View>

        <View style={s.fleetsRow}>
          <FleetStat
            emoji="🚗"
            label="Driver fleet"
            members={driverFleet?.members ?? 0}
            earnings={data.revenue.driver.lifetime}
          />
          <FleetStat
            emoji="👤"
            label="Passenger fleet"
            members={passengerFleet?.members ?? 0}
            earnings={data.revenue.passenger.lifetime}
          />
        </View>

        <SectionTitle>Share it</SectionTitle>
        <Segmented
          options={[
            { key: 'driver', label: 'To drivers' },
            { key: 'passenger', label: 'To passengers' },
          ]}
          value={audience}
          onChange={setAudience}
        />

        <View style={s.shareGrid}>
          <ShareTile emoji="🟢" label="WhatsApp & more" onPress={share} />
          <ShareTile emoji="🔗" label="Copy link" onPress={() => copy(link, 'Referral link')} />
          <ShareTile emoji="#️⃣" label="Copy code" onPress={() => copy(code!, 'Referral code')} />
          <ShareTile
            emoji="📋"
            label="Copy message"
            onPress={() =>
              copy(
                audience === 'driver'
                  ? `Drive with Velocity. Use my referral code ${code}: ${link}`
                  : `Ride with Velocity. Use my referral code ${code}: ${link}`,
                'Message',
              )
            }
          />
        </View>

        <View style={s.rules}>
          <Text style={s.rulesTitle}>Where they enter it</Text>
          <Text style={s.rulesText}>
            • Passengers: Settings → Referral code{'\n'}
            • Drivers: menu → Referral code{'\n'}
            {'\n'}
            • The code only works before their first completed ride.{'\n'}
            • Once someone joins your fleet, they stay in it permanently.{'\n'}
            • You cannot use your own code, and one phone cannot enrol an endless supply of
              &quot;recruits&quot;.{'\n'}
            • You earn only when they complete a genuine ride.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FleetStat({
  emoji,
  label,
  members,
  earnings,
}: {
  emoji: string;
  label: string;
  members: number;
  earnings: number;
}) {
  return (
    <View style={s.fleetStat}>
      <Text style={s.fleetEmoji}>{emoji}</Text>
      <Text style={s.fleetLabel}>{label}</Text>
      <Text style={s.fleetMembers}>
        {members} member{members === 1 ? '' : 's'}
      </Text>
      <Text style={s.fleetEarn}>{formatPKR(earnings)}</Text>
    </View>
  );
}

function ShareTile({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={s.shareTile} onPress={onPress}>
      <Text style={s.shareEmoji}>{emoji}</Text>
      <Text style={s.shareLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, gap: 16, paddingBottom: 40 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  codeLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  code: { color: colors.primary, fontSize: 44, fontWeight: '900', letterSpacing: 6 },
  qrPad: { backgroundColor: '#ffffff', padding: 12, borderRadius: 14, marginTop: 8 },
  oneCode: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },

  fleetsRow: { flexDirection: 'row', gap: 10 },
  fleetStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 2,
  },
  fleetEmoji: { fontSize: 20 },
  fleetLabel: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  fleetMembers: { color: colors.muted, fontSize: 12 },
  fleetEarn: { color: colors.primary, fontSize: 15, fontWeight: '900', marginTop: 4 },

  shareGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  shareTile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  shareEmoji: { fontSize: 20 },
  shareLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },

  rules: { backgroundColor: colors.glassChip, borderRadius: 14, padding: 14, gap: 6 },
  rulesTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  rulesText: { color: colors.muted, fontSize: 12, lineHeight: 20 },

  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', padding: 30, lineHeight: 21 },
});
