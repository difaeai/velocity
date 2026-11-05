/**
 * Driver home on "Corporate & Students": Right now in green boxes, Coming up
 * next in red ones (owner, 2026-11-05). The sorting is src/lib/corporateBoard.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, type CommuteDemandSlot, type DriverPoolView } from '../api/client';
import type { OpenRequest } from '../hooks/driver';
import { colors } from '../config';
import { useForegroundInterval } from '../hooks/useForegroundInterval';
import { corporateBoard, type BoardBox } from '../lib/corporateBoard';
import { clockLabel, toHHMM } from '../lib/dailyRouteTime';
import { themed } from '../theme';
import { Text } from './Text';

const GREEN = '#16a34a';
const RED = '#dc2626';

function whenLabel(atMs: number | null): string {
  if (atMs === null) return 'Now';
  const d = new Date(atMs);
  const day = d.toDateString() === new Date().toDateString() ? '' : 'Tomorrow ';
  return `${day}${clockLabel(toHHMM(d))}`;
}

export function CorporateBoard({
  coords,
  requests,
  onOpenRequest,
}: {
  coords: { lat: number; lng: number } | null;
  requests: OpenRequest[];
  onOpenRequest: (tripId: string) => void;
}) {
  const router = useRouter();
  const [pools, setPools] = useState<DriverPoolView[]>([]);
  const [demand, setDemand] = useState<CommuteDemandSlot[]>([]);
  useForegroundInterval(
    coords ? () => api.getDriverPools({ lat: coords.lat, lng: coords.lng }).then((r) => setPools(r.pools)).catch(() => {}) : null,
    30_000,
  );
  useForegroundInterval(
    coords
      ? () => api.getCommuteDemand({ lat: coords.lat, lng: coords.lng, radiusKm: 10 }).then((r) => setDemand(r.demand)).catch(() => {})
      : null,
    60_000,
  );

  const board = corporateBoard({ requests, pools, demand }, Date.now());
  const open = (b: BoardBox) =>
    b.open === 'shared-pools' ? router.push('/driver/shared-pools')
      : b.open === 'demand' ? router.push('/driver/demand')
      : onOpenRequest(b.open.tripId);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: GREEN }]}>RIGHT NOW</Text>
      {board.now.length === 0 ? (
        <Text style={styles.empty}>Nothing leaving in the next 30 minutes near you.</Text>
      ) : (
        <View style={styles.grid}>{board.now.map((b) => <Box key={b.key} box={b} color={GREEN} onPress={() => open(b)} />)}</View>
      )}

      <Text style={[styles.heading, { color: RED }]}>COMING UP NEXT</Text>
      {board.next.length === 0 ? (
        <Text style={styles.empty}>No later corporate or student rides near you yet.</Text>
      ) : (
        <View style={styles.grid}>{board.next.map((b) => <Box key={b.key} box={b} color={RED} onPress={() => open(b)} />)}</View>
      )}
    </View>
  );
}

function Box({ box: b, color, onPress }: { box: BoardBox; color: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.box, { backgroundColor: color }, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${whenLabel(b.atMs)}, ${b.people} people, ${b.from} to ${b.to}`}
    >
      <View style={styles.boxHead}>
        <Text style={styles.when}>{whenLabel(b.atMs)}</Text>
        {b.mine ? <Text style={styles.mine}>YOURS</Text> : null}
      </View>
      <Text style={styles.route} numberOfLines={2}>{b.from} to {b.to}</Text>
      <Text style={styles.meta}>
        {b.people} {b.people === 1 ? 'person' : 'people'} · {b.earn === null ? 'not booked yet' : `PKR ${b.earn}`}
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, gap: 8 },
  heading: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8, marginTop: 8 },
  empty: { fontSize: 13, fontWeight: '600', color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  box: { width: '48%', borderRadius: 14, padding: 12, gap: 4 },
  boxHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  when: { fontSize: 16, fontWeight: '900', color: '#fff' },
  mine: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.6 },
  route: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  meta: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
}));
