/**
 * Earn with Velocity — the referral centre.
 *
 * One code per fleet, wrapped three ways: typed, tapped, or scanned. They all
 * resolve to the same code, so a poster in a tea shop and a WhatsApp forward
 * bind a recruit identically.
 *
 * The share message says what the recruit gets, not what the partner gets.
 * "Join my fleet so I earn 1%" recruits nobody.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { api } from '../../../src/api/client';
import type { FleetSummary, FleetType } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { usePartnerDashboard } from '../../../src/hooks/partner';
import { appLink } from '../../../src/share/links';
import { PrimaryButton } from '../../../src/ui/components';
import { SectionTitle, Segmented, Skeleton } from '../../../src/ui/partner';

export default function ReferralCentre() {
  const router = useRouter();
  const { data, loading, reload } = usePartnerDashboard();
  const [type, setType] = useState<FleetType>('driver');
  const [creating, setCreating] = useState(false);

  const fleet: FleetSummary | null = data ? data.fleets[type] : null;
  const link = fleet ? appLink(`/passenger/earn/join/${fleet.code}`) : '';

  async function createFleet() {
    setCreating(true);
    try {
      await api.createPartnerFleet({ type });
      await reload();
    } catch (e) {
      Alert.alert('Could not create the fleet', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function share(channel?: 'whatsapp') {
    if (!fleet) return;
    const message =
      type === 'driver'
        ? `Drive with Velocity and start earning.\n\nSign up with my code ${fleet.code} and join my driver fleet:\n${link}`
        : `Ride with Velocity — real fares, real drivers.\n\nSign up with my code ${fleet.code}:\n${link}`;

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
        <Segmented
          options={[
            { key: 'driver', label: '🚗 Driver fleet' },
            { key: 'passenger', label: '👤 Passenger fleet' },
          ]}
          value={type}
          onChange={setType}
        />

        {loading && !data ? (
          <Skeleton height={280} radius={20} />
        ) : fleet ? (
          <>
            <View style={s.card}>
              <Text style={s.codeLabel}>Your {type} fleet code</Text>
              <Text style={s.code}>{fleet.code}</Text>

              <View style={s.qrWrap}>
                {/* White quiet zone regardless of theme — a QR on a dark card is
                    unreadable to half the scanners in the wild. */}
                <View style={s.qrPad}>
                  <QRCode value={link} size={168} backgroundColor="#ffffff" color="#000000" />
                </View>
              </View>

              <Text style={s.qrHint}>
                {fleet.members} member{fleet.members === 1 ? '' : 's'} joined with this code
              </Text>
            </View>

            <SectionTitle>Share it</SectionTitle>
            <View style={s.shareGrid}>
              <ShareTile emoji="🟢" label="WhatsApp" onPress={() => share('whatsapp')} />
              <ShareTile emoji="📤" label="More apps" onPress={() => share()} />
              <ShareTile emoji="🔗" label="Copy link" onPress={() => copy(link, 'Referral link')} />
              <ShareTile emoji="#️⃣" label="Copy code" onPress={() => copy(fleet.code, 'Referral code')} />
            </View>

            <View style={s.rules}>
              <Text style={s.rulesTitle}>The rules, so nobody is surprised</Text>
              <Text style={s.rulesText}>
                • The code only works during a recruit's first registration.{'\n'}
                • Once someone joins your fleet, they stay in it permanently.{'\n'}
                • You cannot use your own code, and one phone cannot enrol an endless
                  supply of "recruits".{'\n'}
                • You earn only when they complete a genuine ride.
              </Text>
            </View>
          </>
        ) : (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>{type === 'driver' ? '🚗' : '👤'}</Text>
            <Text style={s.emptyTitle}>
              No {type} fleet yet
            </Text>
            <Text style={s.emptyBody}>
              {type === 'driver'
                ? 'Create a driver fleet to recruit drivers. You earn a share of Velocity’s commission on every genuine ride they complete.'
                : 'Create a passenger fleet to recruit riders. You earn a share of Velocity’s commission on every genuine ride they take.'}
            </Text>
            <PrimaryButton
              label={`Create ${type} fleet`}
              onPress={createFleet}
              loading={creating}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
    gap: 6,
  },
  codeLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  code: { color: colors.primary, fontSize: 30, fontWeight: '900', letterSpacing: 2 },

  qrWrap: { marginTop: 12 },
  qrPad: { backgroundColor: '#ffffff', padding: 12, borderRadius: 14 },
  qrHint: { color: colors.muted, fontSize: 12, marginTop: 12 },

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

  empty: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
});
