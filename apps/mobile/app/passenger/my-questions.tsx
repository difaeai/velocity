/**
 * My questions — every offer this rider has asked a business about.
 *
 * The customer's half of Queries. Without it the only ways back into a
 * conversation were the reply notification or the offer screen, and a business
 * deleting its offer took the second one away.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../src/config';
import { useMyBusinessAdQuestions } from '../../src/hooks/businessAds';
import { themed } from '../../src/theme';
import { Text } from '../../src/ui/Text';
import { QueryRow } from '../../src/ui/businessAds';
import { Skeleton } from '../../src/ui/partner';

export default function MyQuestionsScreen() {
  const router = useRouter();
  const { threads, unread, loading, error } = useMyBusinessAdQuestions();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My questions</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Questions you asked businesses about their offers.
          {unread > 0 ? ` ${unread} with a new reply.` : ''}
        </Text>

        {loading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={72} radius={16} />
            <Skeleton height={72} radius={16} />
          </View>
        ) : error ? (
          <Text style={styles.note}>Could not load your questions. Check your connection and try again.</Text>
        ) : threads.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyTitle}>No questions yet</Text>
            <Text style={[styles.note, { textAlign: 'center' }]}>
              When a business near you sends an offer, open it and tap “Ask about this
              offer”. The business’s answer shows up here.
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {threads.map((t, i) => (
              <QueryRow
                key={t.queryId}
                thread={t}
                side="customer"
                last={i === threads.length - 1}
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
  intro: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19 },
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
    padding: 22,
    gap: 6,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 30 },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },
  note: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },
}));
