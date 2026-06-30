import { useEffect, useMemo, useState } from 'react';
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
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';

type MatchStatus = 'active' | 'unmatched';
interface TravelMatch {
  id: string;
  users: string[];
  userInfo: Record<string, { displayName: string; photoURL: string | null }>;
  status: MatchStatus;
  lastMessage?: string | null;
  lastMessageAt?: { seconds: number } | null;
  matchedAt?: { seconds: number };
}

function timeAgo(seconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TravelMateChats() {
  const { user } = useAuth();
  const router = useRouter();
  const [matches, setMatches] = useState<TravelMatch[]>([]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateMatches'), where('users', 'array-contains', user.uid)),
      snap => setMatches(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TravelMatch)),
    );
  }, [user?.uid]);

  // Only show active matches — sorted newest message first
  const chatList = useMemo(
    () => [...matches]
      .filter(m => m.status === 'active')
      .sort((a, b) => (b.lastMessageAt?.seconds ?? b.matchedAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? a.matchedAt?.seconds ?? 0)),
    [matches],
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

      {chatList.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>💬</Text>
          <Text style={s.emptyTitle}>No conversations yet</Text>
          <Text style={s.emptySub}>Once you match with someone, your chats will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={chatList}
          keyExtractor={m => m.id}
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
                  <Text style={s.chatName}>{other?.displayName ?? 'Travel Mate'}</Text>
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

  chatRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  avatarWrap: { position: 'relative' },
  avatar:     { width: 54, height: 54, borderRadius: 27 },
  avatarFallback: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dot:        { position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.background },
  dotActive:  { backgroundColor: '#4ade80' },
  dotNew:     { backgroundColor: '#E8637A' },

  chatInfo:    { flex: 1, gap: 3 },
  chatName:    { fontSize: 15, fontWeight: '800', color: colors.text },
  chatPreview: { fontSize: 13, color: colors.muted },
  chatTime:    { fontSize: 11, color: colors.muted },
});
