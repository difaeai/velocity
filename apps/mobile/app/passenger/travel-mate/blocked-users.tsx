/**
 * Travel Mate — blocked users manager.
 *
 * Lists everyone the signed-in user has blocked (live), with one-tap unblock.
 * Blocked people never appear in the feed, comments, search, discover, chats
 * or matches until unblocked here (or from their profile).
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { timeAgo } from '../../../src/lib/timeAgo';
import { colors } from '../../../src/config';

const PINK = '#E8637A';

interface BlockRow {
  id: string;
  blockedId: string;
  blockedName: string;
  blockedPhotoURL: string | null;
  createdAt?: { seconds: number };
}

export default function BlockedUsers() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<BlockRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(
        collection(db, 'travelMateBlocks'),
        where('blockerId', '==', user.uid),
        orderBy('createdAt', 'desc'),
      ),
      snap => {
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }) as BlockRow));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [user?.uid]);

  async function unblock(row: BlockRow) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await api.unblockTravelMateUser({ targetUid: row.blockedId });
    } catch {
      Alert.alert('Error', 'Could not unblock. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate/profile'))}
          style={s.backBtn}
        >
          <Text style={s.backText}>←</Text>
        </Pressable>
        <Text style={s.title}>Blocked users</Text>
        <View style={{ width: 36 }} />
      </View>

      {loaded && rows.length === 0 ? (
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>🚫</Text>
          <Text style={s.emptyTitle}>No blocked users</Text>
          <Text style={s.emptySub}>
            When you block someone from their profile, they will show up here.
            Blocked people disappear from your feed, search, discover and chats.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.id}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => (
            <View style={s.row}>
              {item.blockedPhotoURL ? (
                <Image source={{ uri: item.blockedPhotoURL }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}><Text style={{ fontSize: 18 }}>👤</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.blockedName}</Text>
                <Text style={s.meta}>
                  Blocked {item.createdAt ? timeAgo(item.createdAt.seconds) : ''}
                </Text>
              </View>
              <Pressable
                style={[s.unblockBtn, busyId === item.id && { opacity: 0.5 }]}
                onPress={() => unblock(item)}
                disabled={busyId === item.id}
              >
                <Text style={s.unblockText}>{busyId === item.id ? '…' : 'Unblock'}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  emptyTitle:{ fontSize: 19, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },

  listContent: { padding: 16, gap: 10 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12 },
  avatar:  { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  name:    { fontSize: 15, fontWeight: '800', color: colors.text },
  meta:    { fontSize: 12, color: colors.muted, marginTop: 2 },
  unblockBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99, borderWidth: 1.5, borderColor: PINK },
  unblockText:{ fontSize: 13, fontWeight: '900', color: PINK },
});
