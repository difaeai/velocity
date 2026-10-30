/**
 * Driver home, "Corporate & Students": the shared rides passengers have booked
 * near this driver, each with how many people are going (owner, 2026-10-30).
 * Tapping one opens "Shared rides to take" (app/driver/shared-pools), where it
 * is accepted. Renders nothing while nobody is booked on any.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, type DriverPoolView } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { useForegroundInterval } from '../hooks/useForegroundInterval';
import { areaLabel } from '../lib/areaLabel';
import { clockLabel } from '../lib/dailyRouteTime';
import { Text } from './Text';

export function SharedRidesStrip({ coords }: { coords: { lat: number; lng: number } | null }) {
  const router = useRouter();
  const [pools, setPools] = useState<DriverPoolView[]>([]);
  useForegroundInterval(
    coords ? () => api.getDriverPools({ lat: coords.lat, lng: coords.lng }).then((r) => setPools(r.pools)).catch(() => {}) : null,
    30_000,
  );

  const going = pools.filter((p) => p.riders > 0).slice(0, 5);
  if (going.length === 0) return null;
  const open = () => router.push('/driver/shared-pools');
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>CORPORATE & STUDENTS · SHARED RIDES</Text>
      {going.map((p) => (
        <Pressable
          key={p.id}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${p.riders} going from ${areaLabel(p.pickup.address)} to ${areaLabel(p.dropoff.address)}`}
        >
          <View style={styles.people}>
            <Text style={styles.peopleNum}>{p.riders}</Text>
            <Text style={styles.peopleLbl}>going</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.route} numberOfLines={1}>
              {areaLabel(p.pickup.address)} to {areaLabel(p.dropoff.address)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {p.departTime ? clockLabel(p.departTime) : 'Now'} · {p.seatsLeft} seat{p.seatsLeft === 1 ? '' : 's'} free · earn
              PKR {p.earnNow}
            </Text>
          </View>
        </Pressable>
      ))}
      <Pressable onPress={open} hitSlop={8} accessibilityRole="button">
        <Text style={styles.all}>See all shared rides</Text>
      </Pressable>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: {
    marginHorizontal: 16, marginTop: 10, padding: 12, gap: 8, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#facc15', backgroundColor: 'rgba(250,204,21,0.08)',
  },
  title: { fontSize: 11, fontWeight: '900', color: '#facc15', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  people: {
    width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background,
  },
  peopleNum: { fontSize: 18, fontWeight: '900', color: colors.text },
  peopleLbl: { fontSize: 9.5, fontWeight: '800', color: colors.muted, marginTop: -2 },
  route: { fontSize: 14, fontWeight: '900', color: colors.text },
  meta: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 1 },
  all: { fontSize: 12.5, fontWeight: '900', color: colors.primary, textAlign: 'right' },
}));
