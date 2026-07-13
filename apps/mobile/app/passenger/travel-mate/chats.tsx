/**
 * Travel Partner — chats list.
 *
 * Shows conversations you can actually talk in: mutual-swipe matches, plus
 * message requests that were accepted. A request you sent that hasn't been
 * accepted yet is NOT here — there's nothing to continue until they answer.
 * Requests sent *to* you live behind the header row at the top of this list.
 */
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../../src/auth/AuthContext';
import { useTravelMateThreads, type TravelThread } from '../../../src/hooks/travelMateCommunity';
import { colors } from '../../../src/config';

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Display name of whoever sent a request, for the single-request preview line. */
function firstRequesterName(thread: TravelThread | undefined): string | undefined {
  if (!thread?.requestFrom) return undefined;
  return thread.userInfo?.[thread.requestFrom]?.displayName;
}

export default function TravelMateChats() {
  const { user } = useAuth();
  const router = useRouter();
  const { chats, requests } = useTravelMateThreads();

  const requestsRow = requests.length > 0 && (
    <Pressable
      style={s.requestsRow}
      onPress={() => router.push('/passenger/travel-mate/message-requests')}
    >
      <View style={s.requestsIcon}><Text style={{ fontSize: 18 }}>✉️</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.requestsTitle}>Message requests</Text>
        <Text style={s.requestsSub} numberOfLines={1}>
          {requests.length === 1
            ? `${firstRequesterName(requests[0]) ?? 'Someone'} wants to chat`
            : `${requests.length} people want to chat`}
        </Text>
      </View>
      <View style={s.requestsBadge}>
        <Text style={s.requestsBadgeText}>{requests.length}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Book Ride</Text>
        </Pressable>
        <Text style={s.title}>Chats</Text>
        <View style={{ width: 80 }} />
      </View>

      {chats.length === 0 ? (
        <>
          {requestsRow}
          <View style={s.emptyBox}>
            <Text style={s.emptyEmoji}>💬</Text>
            <Text style={s.emptyTitle}>No conversations yet</Text>
            <Text style={s.emptySub}>
              Match with someone by both swiping right, or accept a message request — your chats will appear here.
            </Text>
          </View>
        </>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={m => m.id}
          ListHeaderComponent={requestsRow || null}
          ItemSeparatorComponent={() => <View style={s.divider} />}
          renderItem={({ item: match }) => {
            const otherId = match.users.find(u => u !== user?.uid) ?? '';
            const other = match.userInfo?.[otherId];
            const ts = match.lastMessageAt ?? match.matchedAt;
            const hasChat = !!match.lastMessageAt;
            return (
              <Pressable
                style={s.chatRow}
                onPress={() => router.push(`/passenger/travel-mate/chat/${match.id}` as Parameters<typeof router.push>[0])}
              >
                <View style={s.avatarWrap}>
                  {other?.photoURL ? (
                    <Image source={{ uri: other.photoURL }} style={s.avatar} />
                  ) : (
                    <View style={s.avatarFallback}><Text style={{ fontSize: 22 }}>👤</Text></View>
                  )}
                  <View style={[s.dot, hasChat ? s.dotActive : s.dotNew]} />
                </View>
                <View style={s.chatInfo}>
                  <Text style={s.chatName}>{other?.displayName ?? 'Travel Partner'}</Text>
                  <Text style={s.chatPreview} numberOfLines={1}>
                    {hasChat
                      ? (match.lastMessage ?? 'Tap to continue chatting…')
                      : '👋 Say hello — you matched!'}
                  </Text>
                </View>
                <Text style={s.chatTime}>{ts ? timeAgo(ts.seconds) : ''}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.primary}18`, borderWidth: 1.5, borderColor: `${colors.primary}40` },
  backBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },

  emptyBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  emptyEmoji:{ fontSize: 56 },
  emptyTitle:{ fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:  { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 22 },

  divider: { height: 1, backgroundColor: colors.border, marginLeft: 84 },

  // Message requests — the Instagram-style inbox row above the conversations.
  requestsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  requestsIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestsTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  requestsSub:   { fontSize: 13, color: colors.muted, marginTop: 3 },
  requestsBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestsBadgeText: { fontSize: 12, fontWeight: '900', color: '#000' },

  chatRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  avatarWrap: { position: 'relative' },
  avatar:     { width: 54, height: 54, borderRadius: 27 },
  avatarFallback: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dot:        { position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.background },
  dotActive:  { backgroundColor: colors.primary },
  dotNew:     { backgroundColor: colors.primary },

  chatInfo:    { flex: 1, gap: 3 },
  chatName:    { fontSize: 15, fontWeight: '800', color: colors.text },
  chatPreview: { fontSize: 13, color: colors.muted },
  chatTime:    { fontSize: 11, color: colors.muted },
});
