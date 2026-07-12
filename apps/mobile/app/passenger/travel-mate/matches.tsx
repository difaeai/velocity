import { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
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
import { useBlockedSet } from '../../../src/hooks/travelMateCommunity';
import { colors } from '../../../src/config';

const { width } = Dimensions.get('window');
const TILE = (width - 48) / 2;

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
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function TravelMateMatches() {
  const { user } = useAuth();
  const router = useRouter();
  const blocked = useBlockedSet();
  const [matches, setMatches] = useState<TravelMatch[]>([]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'travelMateMatches'), where('users', 'array-contains', user.uid)),
      snap => setMatches(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TravelMatch)),
    );
  }, [user?.uid]);

  const activeMatches = useMemo(
    () => [...matches]
      .filter(m => m.status === 'active')
      .filter(m => !m.users.some(u => u !== user?.uid && blocked.has(u)))
      .sort((a, b) => (b.lastMessageAt?.seconds ?? b.matchedAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? a.matchedAt?.seconds ?? 0)),
    [matches, blocked, user?.uid],
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Book Ride</Text>
        </Pressable>
        <Text style={s.title}>Matches</Text>
        <View style={{ width: 80 }} />
      </View>

      {activeMatches.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyEmoji}>❤️</Text>
          <Text style={s.emptyTitle}>No matches yet</Text>
          <Text style={s.emptySub}>Keep swiping — your matches will appear here when you and someone else both swipe right.</Text>
        </View>
      ) : (
        <FlatList
          data={activeMatches}
          keyExtractor={m => m.id}
          numColumns={2}
          contentContainerStyle={s.grid}
          columnWrapperStyle={s.row}
          renderItem={({ item: match }) => {
            const otherId = match.users.find(u => u !== user?.uid) ?? '';
            const other = match.userInfo?.[otherId];
            const ts = match.lastMessageAt ?? match.matchedAt;
            const hasChat = !!match.lastMessageAt;
            return (
              <Pressable
                style={s.tile}
                onPress={() => router.push(`/passenger/travel-mate/chat/${match.id}` as Parameters<typeof router.push>[0])}
              >
                {other?.photoURL ? (
                  <Image source={{ uri: other.photoURL }} style={s.tilePhoto} />
                ) : (
                  <View style={s.tilePhotoPlaceholder}>
                    <Text style={{ fontSize: 40 }}>👤</Text>
                  </View>
                )}
                {/* Gradient overlay */}
                <View style={s.tileOverlay}>
                  <Text style={s.tileName} numberOfLines={1}>{other?.displayName ?? 'Travel Partner'}</Text>
                  {ts && <Text style={s.tileTime}>{hasChat ? '💬 ' : '❤️ '}{timeAgo(ts.seconds)}</Text>}
                </View>
                {/* Unread indicator */}
                {!hasChat && (
                  <View style={s.newBadge}><Text style={s.newBadgeText}>NEW</Text></View>
                )}
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

  grid: { padding: 16, gap: 12 },
  row:  { gap: 12 },

  tile: {
    width: TILE,
    height: TILE * 1.3,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tilePhoto:            { width: '100%', height: '100%', resizeMode: 'cover' },
  tilePhotoPlaceholder: { width: '100%', height: '100%', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  tileOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  tileName: { fontSize: 14, fontWeight: '900', color: '#fff' },
  tileTime: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },

  newBadge:     { position: 'absolute', top: 10, right: 10, backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
});
