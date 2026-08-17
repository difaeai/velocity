/**
 * The demo offer, as the person who got the demo notification sees it.
 *
 * Deliberately NOT `offer/[adId]`: that screen reads a real `businessAds` doc and
 * records the tap as a click an advertiser is charged for. This one has no doc
 * and no advertiser, so it renders from a constant and counts nothing. Expo
 * Router prefers the static segment, so `/passenger/offer/demo` lands here and
 * never on the dynamic route.
 *
 * It says DEMO at the top for the obvious reason: the notification names a real
 * restaurant, and nobody should be able to arrive here from the shade and think
 * Velocity is running a KFC promotion.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_OFFER } from '../../../src/ads/demoOffer';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';

export default function DemoOfferScreen() {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  function openDirections() {
    const { lat, lng } = DEMO_OFFER.center;
    const label = `${DEMO_OFFER.businessName} ${DEMO_OFFER.branch}`;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {});
    });
  }

  async function sendAgain() {
    setSending(true);
    try {
      await api.sendBusinessAdDemoNotification({ delaySeconds: 10 });
    } catch (e) {
      Alert.alert('Could not send it', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/passenger/business-ads')
          }
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Offer near you</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerTxt}>
            DEMO · This is a sample offer, not a real KFC promotion. It is what
            your own offer will look like to people near your shop.
          </Text>
        </View>

        <Image source={{ uri: DEMO_OFFER.imageUrl }} style={styles.image} resizeMode="cover" />

        <View style={styles.bizRow}>
          <Text style={styles.biz}>{DEMO_OFFER.businessName}</Text>
          <Text style={styles.city}>{DEMO_OFFER.city}</Text>
        </View>
        <Text style={styles.title}>{DEMO_OFFER.title}</Text>
        <Text style={styles.details}>{DEMO_OFFER.offerDetails}</Text>

        <View style={styles.infoCard}>
          <InfoRow icon="📍" label={DEMO_OFFER.branch} value={DEMO_OFFER.address} />
          <View style={styles.divider} />
          <InfoRow icon="🚶" label="Distance from you" value={`${DEMO_OFFER.distanceKm} km away`} />
          <View style={styles.divider} />
          <InfoRow icon="🕐" label="When" value={DEMO_OFFER.hours} />
        </View>

        <Pressable style={styles.dirBtn} onPress={openDirections}>
          <Text style={styles.dirTxt}>🧭 Get directions</Text>
        </Pressable>

        <View style={{ height: 4 }} />
        <PrimaryButton
          label={sending ? 'Close the app now…' : 'Send it again in 10 seconds'}
          onPress={sendAgain}
          loading={sending}
        />

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTxt}>
            A real offer here comes from a business near you, not from Velocity —
            terms are between you and the business. This sample was sent only to
            this phone, because you asked for it.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },

  body: { padding: 16, paddingBottom: 40, gap: 10 },

  demoBanner: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 12,
  },
  demoBannerTxt: { fontSize: 11, fontWeight: '800', color: colors.text, lineHeight: 17 },

  image: { width: '100%', height: 200, borderRadius: 18, backgroundColor: colors.surface },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  biz: { fontSize: 12, fontWeight: '900', color: colors.primary, letterSpacing: 0.4 },
  city: { fontSize: 11, fontWeight: '700', color: colors.muted },
  title: { fontSize: 24, fontWeight: '900', color: colors.text, lineHeight: 30 },
  details: { fontSize: 14, fontWeight: '600', color: colors.muted, lineHeight: 21 },

  infoCard: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  infoIcon: { fontSize: 18 },
  infoLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.3 },
  infoValue: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 12 },

  dirBtn: {
    marginTop: 6,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirTxt: { fontSize: 14, fontWeight: '900', color: colors.primary },

  disclaimer: {
    marginTop: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  disclaimerTxt: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 16 },
}));
