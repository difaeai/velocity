/**
 * Find your Customers — every question people have sent about this business's
 * offers. The home screen shows the newest few; this is the whole inbox.
 *
 * "Waiting" comes first in the filter because it is the only list that asks the
 * business to do something: a customer asked and nobody has answered.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../src/config';
import { useBusinessAdQueries } from '../../../src/hooks/businessAds';
import { themed } from '../../../src/theme';
import { Text } from '../../../src/ui/Text';
import { QueryRow } from '../../../src/ui/businessAds';
import { Segmented, Skeleton } from '../../../src/ui/partner';

type Filter = 'waiting' | 'all' | 'answered';

export default function BusinessAdQueries() {
  const router = useRouter();
  const { threads, loading, error } = useBusinessAdQueries();
  const [filter, setFilter] = useState<Filter>('waiting');

  const waiting = threads.filter((t) => t.status === 'waiting');
  const shown =
    filter === 'all' ? threads : filter === 'waiting' ? waiting : threads.filter((t) => t.status === 'answered');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Queries</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Segmented<Filter>
          options={[
            { key: 'waiting', label: `Waiting${waiting.length ? ` (${waiting.length})` : ''}` },
            { key: 'all', label: 'All' },
            { key: 'answered', label: 'Answered' },
          ]}
          value={filter}
          onChange={setFilter}
        />

        {loading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={72} radius={16} />
            <Skeleton height={72} radius={16} />
          </View>
        ) : error ? (
          <Text style={styles.note}>Could not load your queries. Pull down on the previous screen and try again.</Text>
        ) : shown.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {filter === 'waiting' ? 'All caught up' : 'No queries yet'}
            </Text>
            <Text style={styles.note}>
              {filter === 'waiting'
                ? 'Every question has an answer. New ones arrive here and as a notification.'
                : 'When someone who got your offer asks about it, the conversation shows up here.'}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {shown.map((t, i) => (
              <QueryRow
                key={t.queryId}
                thread={t}
                last={i === shown.length - 1}
                onPress={() => router.push(`/passenger/offer-query/${t.queryId}`)}
              />
            ))}
          </View>
        )}
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { padding: 16, paddingBottom: 40, gap: 14 },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  note: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },
}));
