/**
 * A business offer, as the person who got the notification sees it.
 *
 * Opening this screen IS the click the advertiser is paying to measure, so the
 * tap is recorded once on mount and never again on a re-render — a screen that
 * double-counted would inflate the one number an advertiser makes decisions on.
 *
 * The ad doc is read straight from Firestore rather than through a callable:
 * businessAds is readable by any signed-in user (see firestore.rules), the
 * notification already carries the id, and a live snapshot means an offer taken
 * down by moderation stops showing the moment it is taken down.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { db } from '../../../src/firebase';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { Skeleton } from '../../../src/ui/partner';

interface OfferDoc {
  title: string;
  businessName: string;
  offerDetails: string;
  imageUrl: string;
  status: string;
  contactPhone: string | null;
  city: string | null;
}

export default function OfferScreen() {
  const router = useRouter();
  const { adId } = useLocalSearchParams<{ adId: string }>();
  const [offer, setOffer] = useState<OfferDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    if (!adId) return;
    const unsub = onSnapshot(
      doc(db, 'businessAds', adId),
      (snap) => {
        if (!snap.exists()) {
          setMissing(true);
          return;
        }
        setOffer(snap.data() as OfferDoc);
      },
      () => setMissing(true),
    );
    return unsub;
  }, [adId]);

  useEffect(() => {
    if (!adId || counted.current) return;
    counted.current = true;
    api.recordBusinessAdClick({ adId }).catch(() => {
      // The advertiser's counter missing one tap is not worth telling the rider
      // about — they came here to read an offer.
    });
  }, [adId]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Offer near you</Text>
        <View style={{ width: 22 }} />
      </View>

      {missing ? (
        <View style={styles.center}>
          <Text style={styles.goneTitle}>This offer has ended</Text>
          <Text style={styles.goneBody}>The business is no longer running it.</Text>
        </View>
      ) : !offer ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={220} radius={18} />
          <Skeleton height={80} />
        </View>
      ) : offer.status === 'removed' ? (
        <View style={styles.center}>
          <Text style={styles.goneTitle}>This offer has ended</Text>
          <Text style={styles.goneBody}>The business is no longer running it.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {offer.imageUrl ? (
            <Image source={{ uri: offer.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : null}

          <View style={styles.bizRow}>
            <Text style={styles.biz}>{offer.businessName}</Text>
            {offer.city ? <Text style={styles.city}>{offer.city}</Text> : null}
          </View>
          <Text style={styles.title}>{offer.title}</Text>
          <Text style={styles.details}>{offer.offerDetails}</Text>

          {offer.contactPhone ? (
            <Pressable
              style={styles.callBtn}
              onPress={() => {
                Linking.openURL(`tel:${offer.contactPhone}`).catch(() => {});
              }}
            >
              <Text style={styles.callTxt}>📞 Call {offer.businessName}</Text>
            </Pressable>
          ) : null}

          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerTxt}>
              This is a paid offer from a business near you, not from Velocity. Terms
              are between you and the business.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
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
  image: {
    width: '100%',
    height: 240,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  biz: { fontSize: 12, fontWeight: '900', color: colors.primary, letterSpacing: 0.4 },
  city: { fontSize: 11, fontWeight: '700', color: colors.muted },
  title: { fontSize: 24, fontWeight: '900', color: colors.text, lineHeight: 30 },
  details: { fontSize: 14, fontWeight: '600', color: colors.muted, lineHeight: 21 },

  callBtn: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callTxt: { fontSize: 15, fontWeight: '900', color: '#000' },

  disclaimer: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  disclaimerTxt: { fontSize: 11, fontWeight: '600', color: colors.muted, lineHeight: 16 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
  goneTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
  goneBody: { fontSize: 13, fontWeight: '600', color: colors.muted },
}));
