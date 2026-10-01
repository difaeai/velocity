/**
 * Velocity Rapid Response — the complaint list.
 *
 * One screen for passengers and drivers, because a driver with a problem
 * deserves the same desk as a rider with one. "Drivers ki queries ko foran
 * resolve kia jata hai" is a promise about this screen: a driver opens it,
 * files, and gets an answer in seconds rather than an email address.
 *
 * It lists complaints rather than being a single rolling chat. A ticket per
 * problem is what lets each one carry its own status, its own owner and its own
 * resolution — and what stops last week's fare dispute from burying today's
 * safety report.
 */
import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text } from '../../src/ui/Text';
import { useAuth } from '../../src/auth/AuthContext';
import { useSupportTickets, type SupportTicket } from '../../src/hooks/support';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { timeAgo } from '../../src/lib/timeAgo';

/** What the badge says, and in what colour. Status is the whole point of it. */
function statusLabel(t: SupportTicket): { text: string; tone: 'ai' | 'human' | 'done' } {
  if (t.status === 'resolved') return { text: 'Resolved', tone: 'done' };
  if (t.status === 'human_handling') {
    return { text: t.assignedName ? `With ${t.assignedName}` : 'With our team', tone: 'human' };
  }
  if (t.status === 'waiting_human') return { text: 'Waiting for our team', tone: 'human' };
  return { text: 'Rapid Response', tone: 'ai' };
}

export default function SupportTicketsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { tickets, loading } = useSupportTickets(user?.uid);

  const openNew = useCallback(() => router.push('/support/new'), [router]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Help & complaints</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>⚡ Velocity Rapid Response</Text>
            <Text style={styles.heroBody}>
              Tell us what happened and you get an answer in seconds. Anything our
              assistant cannot settle goes straight to a real person — and you can ask
              for one at any point.
            </Text>
            <Pressable style={styles.heroBtn} onPress={openNew}>
              <Text style={styles.heroBtnTxt}>Report a problem</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.empty}>
              No complaints yet. If something goes wrong, this is where to tell us.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const badge = statusLabel(item);
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/support/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardCat}>{item.categoryLabel}</Text>
                <View
                  style={[
                    styles.badge,
                    badge.tone === 'human' && styles.badgeHuman,
                    badge.tone === 'done' && styles.badgeDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeTxt,
                      badge.tone === 'human' && styles.badgeTxtHuman,
                      badge.tone === 'done' && styles.badgeTxtDone,
                    ]}
                  >
                    {badge.text}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardSubject} numberOfLines={1}>
                {item.subject}
              </Text>
              <Text style={styles.cardLast} numberOfLines={2}>
                {item.lastSender === 'user' ? 'You: ' : ''}
                {item.lastMessage}
              </Text>
              <View style={styles.cardFoot}>
                <Text style={styles.cardTime}>
                  {item.lastAt ? timeAgo(item.lastAt.seconds) : ''}
                </Text>
                {item.unreadForUser > 0 ? (
                  <View style={styles.unread}>
                    <Text style={styles.unreadTxt}>
                      {item.unreadForUser > 9 ? '9+' : item.unreadForUser}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { fontSize: 30, color: colors.text, lineHeight: 32 },
    headerTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
    content: { padding: 16, paddingBottom: 40, gap: 10 },

    hero: {
      backgroundColor: colors.primary + '14',
      borderWidth: 1,
      borderColor: colors.primary + '55',
      borderRadius: 16,
      padding: 14,
      marginBottom: 4,
    },
    heroTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
    heroBody: { fontSize: 12.5, color: colors.muted, lineHeight: 19, marginTop: 6 },
    heroBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 12,
    },
    heroBtnTxt: { fontSize: 14.5, fontWeight: '900', color: colors.btnText },

    empty: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 20, lineHeight: 20 },

    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 13,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardCat: {
      fontSize: 10.5,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      flex: 1,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: colors.primary + '22',
    },
    badgeHuman: { backgroundColor: colors.secondary + '28' },
    badgeDone: { backgroundColor: colors.border },
    badgeTxt: { fontSize: 10, fontWeight: '900', color: colors.primary },
    badgeTxtHuman: { color: colors.secondary },
    badgeTxtDone: { color: colors.muted },
    cardSubject: { fontSize: 14.5, fontWeight: '800', color: colors.text, marginTop: 6 },
    cardLast: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: 3 },
    cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    cardTime: { fontSize: 11, color: colors.muted },
    unread: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 5,
    },
    unreadTxt: { fontSize: 11, fontWeight: '900', color: colors.btnText },
  }),
);
