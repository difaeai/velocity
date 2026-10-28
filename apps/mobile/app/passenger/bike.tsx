/**
 * Bike — home's right ride tile.
 *
 * Two jobs a motorbike does: carry the rider, or carry their parcel. Each card
 * opens the flow that already exists for it — the booking sheet with Moto
 * picked (solo: a bike seats nobody else), or the courier order.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { Text } from '../../src/ui/Text';
import { MotoIcon } from '../../src/ui/RideIcons';
import { ArrowIcon, CourierIcon } from '../../src/ui/ServiceIcons';

export default function BikeScreen() {
  const router = useRouter();

  const options: { key: string; title: string; body: string; tag: string; href: Href; Icon: typeof MotoIcon }[] = [
    {
      key: 'ride',
      title: 'Book a bike ride',
      body: 'The quickest way through traffic. Just you on the back — name your own fare.',
      tag: 'Travel',
      href: '/passenger/booking?mode=solo&rideType=bike',
      Icon: MotoIcon,
    },
    {
      key: 'parcel',
      title: 'Send a parcel',
      body: 'Documents, parcels and boxes across town. A rider collects it and hands it over.',
      tag: 'Delivery',
      href: '/passenger/couriers',
      Icon: CourierIcon,
    },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          {/* SVG, not the ← glyph: TECNO's font draws that as "IJ". */}
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <ArrowIcon size={22} color={colors.text} />
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bike</Text>
          <Text style={styles.subtitle}>Ride one, or send something on one</Text>
        </View>
      </View>

      <View style={styles.body}>
        {options.map(({ key, title, body, tag, href, Icon }) => (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(href)}
            accessibilityRole="button"
            accessibilityLabel={title}
          >
            <View style={styles.cardTop}>
              <View style={styles.iconWrap}>
                <Icon size={30} color={colors.text} accent={colors.primary} />
              </View>
              <Text style={styles.tag}>{tag}</Text>
            </View>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body}</Text>
            <View style={styles.go}>
              <Text style={styles.goTxt}>Continue</Text>
              <ArrowIcon size={18} color={colors.primary} />
            </View>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  body: { padding: 16, gap: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassLime, borderWidth: 1, borderColor: colors.glassLimeBorder,
  },
  tag: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.6 },
  cardTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginTop: 4 },
  cardBody: { fontSize: 13, fontWeight: '600', color: colors.muted, lineHeight: 19 },
  go: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  goTxt: { fontSize: 14, fontWeight: '900', color: colors.primary },
}));
