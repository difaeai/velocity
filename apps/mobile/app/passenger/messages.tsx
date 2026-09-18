/**
 * Messages — one door to every conversation the rider has.
 *
 * Three systems feed this screen and they stay three systems on it: a reply
 * from a shop, a message from the driver outside your gate and a "salaam" from
 * someone you matched with are different enough that folding them into one list
 * would bury whichever one mattered. So the sections are picked with a tap and
 * never mix — useMessagesInbox decides which section a conversation belongs to
 * by the system it lives in, and nothing on this screen can move it.
 *
 * The selector carries its own unread count per section, so the answer to "who
 * is the red dot in the drawer from?" is visible before anything is opened.
 *
 * Opening a conversation:
 *   - Travel Partner and Brands already have full chat screens; rows push to
 *     them, and those screens own sending, attachments, blocking and reporting.
 *   - Ride chat has no screen of its own — it is a modal over the trip screen —
 *     so it opens here as the same ChatModal, which means a finished ride's
 *     conversation is reachable without dragging the rider back to that trip.
 */
import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import {
  MESSAGE_SECTIONS,
  SECTION_META,
  useMessagesInbox,
  type MessageRow,
  type MessageSection,
} from '../../src/hooks/messages';
import { markChatSeen } from '../../src/lib/chatSeen';
import { timeAgo } from '../../src/lib/timeAgo';
import { themed } from '../../src/theme';
import { ChatModal } from '../../src/ui/ChatModal';
import { Text } from '../../src/ui/Text';
import { Skeleton } from '../../src/ui/partner';

/** Deep links (and the offer screen) may ask for a section by name. */
function sectionFromParam(raw: string | string[] | undefined): MessageSection | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return MESSAGE_SECTIONS.includes(value as MessageSection) ? (value as MessageSection) : null;
}

/** What to say, and where to send them, when a section has nothing in it yet. */
const EMPTY_STATE: Record<
  MessageSection,
  { emoji: string; title: string; body: string; cta?: { label: string; href: string } }
> = {
  partner: {
    emoji: '🤝',
    title: 'No Travel Partner chats yet',
    body: 'Match with someone going your way, or join a commute group — your conversations land here.',
    cta: { label: 'Find travel partners', href: '/passenger/travel-mate' },
  },
  drivers: {
    emoji: '🚗',
    title: 'No driver messages yet',
    body: 'While a ride is running you can message your driver from here — "I’m at the blue gate" beats a phone call. Past rides you talked on stay here too.',
    cta: { label: 'Book a ride', href: '/passenger/booking' },
  },
  brands: {
    emoji: '🏷️',
    title: 'No messages from brands yet',
    body: 'When a business near you sends an offer, open it and tap "Ask about this offer". Their answer arrives in this section.',
  },
};

export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ section?: string }>();
  const { rows, unread, loading } = useMessagesInbox();

  const [section, setSection] = useState<MessageSection>(() => sectionFromParam(params.section) ?? 'partner');
  /** The ride conversation being read, if any. Ride chat is a modal, not a route. */
  const [tripChat, setTripChat] = useState<{ tripId: string; driverName: string } | null>(null);

  const meta = SECTION_META[section];
  const list = rows[section];
  const showSkeleton = loading && list.length === 0;

  const header = useMemo(
    () => (
      <View style={styles.headerBlock}>
        {/* The three sections, side by side. Each carries its own unread count,
            so the drawer's red dot can be traced to a section without opening
            anything. */}
        <View style={styles.tabRow}>
          {MESSAGE_SECTIONS.map((key) => {
            const m = SECTION_META[key];
            const active = key === section;
            const count = unread[key];
            return (
              <Pressable
                key={key}
                onPress={() => setSection(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${m.title}${count > 0 ? `, ${count} unread` : ''}`}
                style={({ pressed }) => [
                  styles.tab,
                  active && { borderColor: m.accent, backgroundColor: `${m.accent}1A` },
                  pressed && styles.tabPressed,
                ]}
              >
                <View style={styles.tabIconWrap}>
                  <View
                    style={[
                      styles.tabIcon,
                      { backgroundColor: `${m.accent}1F`, borderColor: active ? m.accent : colors.border },
                    ]}
                  >
                    <Text style={styles.tabEmoji}>{m.emoji}</Text>
                  </View>
                  {count > 0 ? (
                    <View style={styles.tabBadge}>
                      <Text style={styles.tabBadgeText}>{count > 9 ? '9+' : count}</Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.tabLabel, active && { color: colors.text }]}
                  numberOfLines={2}
                >
                  {m.short}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Says in one line what the selected section holds — the difference
            between three tabs and three tabs anyone can tell apart. */}
        <View style={[styles.blurbCard, { borderColor: `${meta.accent}55` }]}>
          <View style={[styles.blurbStripe, { backgroundColor: meta.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.blurbTitle}>{meta.title}</Text>
            <Text style={styles.blurbText}>{meta.blurb}</Text>
          </View>
        </View>
      </View>
    ),
    [section, unread, meta],
  );

  function open(row: MessageRow) {
    if (row.target.kind === 'tripChat') {
      setTripChat({ tripId: row.target.tripId, driverName: row.target.driverName });
      // Opening it is reading it. The modal streams the conversation from here,
      // so nothing else would ever clear this row.
      markChatSeen('trip', row.target.tripId);
      return;
    }
    router.push(row.target.href as Parameters<typeof router.push>[0]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.topTitle}>Messages</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={showSkeleton ? [] : list}
        keyExtractor={(row) => row.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => <Row row={item} accent={meta.accent} onPress={() => open(item)} />}
        ListEmptyComponent={
          showSkeleton ? (
            <View style={{ gap: 10, paddingHorizontal: 16 }}>
              <Skeleton height={74} radius={18} />
              <Skeleton height={74} radius={18} />
              <Skeleton height={74} radius={18} />
            </View>
          ) : (
            <EmptySection section={section} onGo={(href) => router.push(href as Parameters<typeof router.push>[0])} />
          )
        }
      />

      {/* Ride chat. Keyed on the trip so switching conversations never shows the
          previous ride's messages for a frame. */}
      {tripChat ? (
        <ChatModal
          key={tripChat.tripId}
          visible
          roomId={tripChat.tripId}
          myUid={user?.uid ?? ''}
          myName={user?.displayName ?? 'Passenger'}
          otherName={tripChat.driverName}
          onClose={() => {
            markChatSeen('trip', tripChat.tripId);
            setTripChat(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Row({ row, accent, onPress }: { row: MessageRow; accent: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${row.preview}${row.unread ? '. Unread' : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.avatar, { borderColor: `${accent}66` }]}>
        {row.photoURL ? (
          <Image source={{ uri: row.photoURL }} style={styles.avatarImage} alt="" />
        ) : (
          <Text style={styles.avatarEmoji}>{row.emoji}</Text>
        )}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={[styles.rowTitle, row.unread && styles.rowTitleUnread]} numberOfLines={1}>
            {row.title}
          </Text>
          {row.atSeconds ? <Text style={styles.rowTime}>{timeAgo(row.atSeconds)}</Text> : null}
        </View>
        <Text style={[styles.rowPreview, row.unread && styles.rowPreviewUnread]} numberOfLines={1}>
          {row.preview}
        </Text>
        {row.context ? (
          <Text style={[styles.rowContext, { color: accent }]} numberOfLines={1}>
            {row.context}
          </Text>
        ) : null}
      </View>

      {row.count != null ? (
        <View style={styles.rowBadge}>
          <Text style={styles.rowBadgeText}>{row.count > 9 ? '9+' : row.count}</Text>
        </View>
      ) : row.unread ? (
        <View style={styles.rowDot} />
      ) : null}
    </Pressable>
  );
}

function EmptySection({ section, onGo }: { section: MessageSection; onGo: (href: string) => void }) {
  const empty = EMPTY_STATE[section];
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyEmoji}>{empty.emoji}</Text>
      <Text style={styles.emptyTitle}>{empty.title}</Text>
      <Text style={styles.emptyBody}>{empty.body}</Text>
      {empty.cta ? (
        <Pressable style={styles.emptyCta} onPress={() => onGo(empty.cta!.href)}>
          <Text style={styles.emptyCtaText}>{empty.cta.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  topTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  listContent: { paddingBottom: 40 },
  headerBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 12 },

  // ── Section selector ──
  tabRow: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabPressed: { opacity: 0.75 },
  tabIconWrap: { position: 'relative' },
  tabIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabEmoji: { fontSize: 19 },
  tabBadge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 10, fontWeight: '900', color: '#ffffff' },
  tabLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 15,
  },

  // ── Section explainer ──
  blurbCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  blurbStripe: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  blurbTitle: { fontSize: 13, fontWeight: '900', color: colors.text },
  blurbText: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 17, marginTop: 2 },

  // ── Conversation row ──
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 82 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowPressed: { backgroundColor: colors.glassStrong },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarEmoji: { fontSize: 22 },
  rowBody: { flex: 1, gap: 3 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  rowTitleUnread: { fontWeight: '900' },
  rowTime: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  rowPreview: { fontSize: 13, color: colors.muted },
  rowPreviewUnread: { color: colors.text, fontWeight: '700' },
  rowContext: { fontSize: 11, fontWeight: '800' },
  rowDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  rowBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBadgeText: { fontSize: 11, fontWeight: '900', color: '#ffffff' },

  // ── Empty ──
  emptyCard: {
    margin: 16,
    marginTop: 24,
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 8,
  },
  emptyEmoji: { fontSize: 38 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 20, textAlign: 'center' },
  emptyCta: {
    marginTop: 8,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.btnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaText: { fontSize: 14, fontWeight: '900', color: colors.btnText },
}));
