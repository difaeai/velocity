/**
 * Business — the hub for the two things a business does with Velocity.
 *
 * The drawer entry used to go straight to the freight quote form, which quietly
 * decided that "business" meant "sending things". It also means being found: a
 * shop paying to push an offer to the riders who pass its door is the same
 * customer, doing the other half of the job. So the drawer lands here, and the
 * quote form is one of two doors rather than the only one.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { Text } from '../../src/ui/Text';

export default function BusinessHub() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Business</Text>
        <Pressable
          style={styles.closeBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
        >
          <Text style={styles.closeTxt}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lede}>
          Move your goods, or bring customers to your door. Pick one.
        </Text>

        <Pressable style={styles.card} onPress={() => router.push('/passenger/business-delivery')}>
          <View style={styles.cardIcon}>
            <Text style={styles.cardEmoji}>💼</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Business delivery</Text>
            <Text style={styles.cardSub}>
              Bulk and priority deliveries with a quote confirmed by our team.
            </Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>

        <Pressable
          style={[styles.card, styles.cardFeatured]}
          onPress={() => router.push('/passenger/business-ads')}
        >
          <View style={[styles.cardIcon, styles.cardIconFeatured]}>
            <Text style={styles.cardEmoji}>📣</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>Find your Customers</Text>
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeTxt}>NEW</Text>
              </View>
            </View>
            <Text style={styles.cardSub}>
              Send your offer to Velocity users near your shop — and see how many
              opened it.
            </Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>How Find your Customers works</Text>
          <Text style={styles.noteLine}>1. Pick how far around your shop to reach — up to 5 km.</Text>
          <Text style={styles.noteLine}>2. Pay for 3, 6 or 12 months and upload the receipt.</Text>
          <Text style={styles.noteLine}>3. Once approved, publish your offer.</Text>
          <Text style={styles.noteLine}>
            4. Anyone who comes into your radius gets it as a notification.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  closeBtn: { padding: 6 },
  closeTxt: { fontSize: 20, color: colors.muted },

  body: { padding: 16, gap: 12 },
  lede: { fontSize: 13, color: colors.muted, fontWeight: '600', marginBottom: 2 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardFeatured: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconFeatured: { backgroundColor: colors.background },
  cardEmoji: { fontSize: 22 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  cardSub: { fontSize: 12, color: colors.muted, fontWeight: '600', marginTop: 3, lineHeight: 17 },
  cardArrow: { fontSize: 24, color: colors.muted },
  newBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  newBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 0.8 },

  note: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
    marginTop: 4,
  },
  noteTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 2 },
  noteLine: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },
}));
