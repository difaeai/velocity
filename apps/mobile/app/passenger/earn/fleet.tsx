/**
 * Earn with Velocity — a fleet's roster.
 *
 * Serves both fleets off `?type=`, because a driver roster and a passenger
 * roster differ only in whether "online right now" is a meaningful column. Two
 * near-identical screens would drift apart within a release.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import type { FleetMember, FleetType } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { Segmented, Skeleton, StatTile, formatPKR } from '../../../src/ui/partner';
import { timeAgo } from '../../../src/lib/timeAgo';

type Sort = 'recent' | 'rides' | 'earnings';

export default function FleetRoster() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: FleetType = params.type === 'passenger' ? 'passenger' : 'driver';

  const [members, setMembers] = useState<FleetMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    api
      .getPartnerFleetMembers({ type, limit: 200 })
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your fleet.');
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const visible = useMemo(() => {
    if (!members) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
    const sorted = [...filtered];
    if (sort === 'rides') sorted.sort((a, b) => b.completedRides - a.completedRides);
    else if (sort === 'earnings') sorted.sort((a, b) => b.fleetCommissionGenerated - a.fleetCommissionGenerated);
    else sorted.sort((a, b) => (b.lastRideAt ?? b.joinedAt ?? 0) - (a.lastRideAt ?? a.joinedAt ?? 0));
    return sorted;
  }, [members, query, sort]);

  const stats = useMemo(() => {
    const list = members ?? [];
    return {
      total: list.length,
      active: list.filter((m) => m.active).length,
      inactive: list.filter((m) => !m.active).length,
      online: list.filter((m) => m.online).length,
    };
  }, [members]);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={visible}
        keyExtractor={(m) => m.uid}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 6 }}>
            <View style={s.tiles}>
              <StatTile label={type === 'driver' ? 'Total drivers' : 'Total passengers'} value={String(stats.total)} />
              <StatTile label="Active (30d)" value={String(stats.active)} accent={colors.primary} />
              <StatTile label="Inactive" value={String(stats.inactive)} />
              {type === 'driver' ? (
                <StatTile label="Online now" value={String(stats.online)} />
              ) : null}
            </View>

            <TextInput
              style={s.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name"
              placeholderTextColor={colors.muted}
            />
            <Segmented
              options={[
                { key: 'recent', label: 'Recent' },
                { key: 'rides', label: 'Rides' },
                { key: 'earnings', label: 'Earnings' },
              ]}
              value={sort}
              onChange={setSort}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() => router.push({ pathname: '/passenger/earn/member/[uid]', params: { uid: item.uid, name: item.name } })}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
              {type === 'driver' && item.online ? <View style={s.onlineDot} /> : null}
            </View>

            <View style={{ flex: 1 }}>
              <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
              <Text style={s.rowMeta} numberOfLines={1}>
                {item.completedRides} ride{item.completedRides === 1 ? '' : 's'} ·{' '}
                {item.lastRideAt ? `last ${timeAgo(item.lastRideAt / 1000)}` : 'no rides yet'}
              </Text>
              {item.flaggedRides > 0 ? (
                <Text style={s.rowFlag}>
                  {item.flaggedRides} flagged ride{item.flaggedRides === 1 ? '' : 's'} — paid zero
                </Text>
              ) : null}
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.rowEarn}>{formatPKR(item.fleetCommissionGenerated)}</Text>
              <Text style={s.rowEarnLabel}>you earned</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          members === null ? (
            <View style={{ gap: 10 }}>
              <Skeleton height={64} radius={14} />
              <Skeleton height={64} radius={14} />
              <Skeleton height={64} radius={14} />
            </View>
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                {error ??
                  (query
                    ? 'Nobody in your fleet matches that name.'
                    : `Nobody has joined your ${type} fleet yet. Share your code from the Referral centre.`)}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 18, gap: 10, paddingBottom: 40 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.glassChip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontWeight: '900', fontSize: 16 },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: colors.background,
  },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowFlag: { color: '#f97316', fontSize: 11, fontWeight: '700', marginTop: 2 },
  rowEarn: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  rowEarnLabel: { color: colors.muted, fontSize: 10 },

  empty: { padding: 30, alignItems: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
}));
