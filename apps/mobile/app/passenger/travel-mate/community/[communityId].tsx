/**
 * Travel Partner — community group page.
 *
 * Header shows the group's name, the CITY it belongs to (always visible),
 * member count and description. Members can post into the group; everyone
 * signed-in can read. Join / leave via CFs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { appLink } from '../../../../src/share/links';
import { Share } from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api, type TMCommunity, type TMPost } from '../../../../src/api/client';
import { useBlockedSet } from '../../../../src/hooks/travelMateCommunity';
import { colors } from '../../../../src/config';
import { PostCard } from '../feed';

const PAGE_SIZE = 25;

export default function CommunityPage() {
  const params = useLocalSearchParams<{ communityId: string }>();
  const communityId = Array.isArray(params.communityId) ? params.communityId[0] : params.communityId;
  const { user } = useAuth();
  const router = useRouter();
  const blocked = useBlockedSet();

  const [community, setCommunity] = useState<TMCommunity | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [posts, setPosts] = useState<TMPost[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const [endReached, setEndReached] = useState(false);

  const myUid = user?.uid ?? '';
  const isMember = !!community && !!myUid && community.members?.includes(myUid);

  // Live community doc (member count updates immediately on join/leave)
  useEffect(() => {
    if (!communityId) return;
    return onSnapshot(
      doc(db, 'travelMateCommunities', communityId),
      snap => {
        if (snap.exists()) setCommunity({ id: snap.id, ...snap.data() } as TMCommunity);
        else setNotFound(true);
      },
      () => setNotFound(true),
    );
  }, [communityId]);

  const loadPosts = useCallback(async (reset: boolean) => {
    if (!communityId) return;
    try {
      const base = query(
        collection(db, 'travelMatePosts'),
        where('communityId', '==', communityId),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
      const paged = !reset && lastDocRef.current ? query(base, startAfter(lastDocRef.current)) : base;
      const snap = await getDocs(paged);
      const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMPost);
      lastDocRef.current = snap.docs.length ? (snap.docs[snap.docs.length - 1] ?? null) : lastDocRef.current;
      setEndReached(snap.docs.length < PAGE_SIZE);
      setPosts(prev => (reset ? batch : [...prev, ...batch.filter(p => !prev.some(q2 => q2.id === p.id))]));
      if (myUid) {
        const results = await Promise.all(batch.map(p =>
          getDoc(doc(db, 'travelMatePosts', p.id, 'likes', myUid))
            .then(s2 => (s2.exists() ? p.id : null)).catch(() => null)));
        setLikedIds(prev => {
          const next = new Set(prev);
          results.forEach(id => { if (id) next.add(id); });
          return next;
        });
      }
    } catch { /* surfaced via empty state */ }
  }, [communityId, myUid]);

  useEffect(() => {
    setLoadingPosts(true);
    lastDocRef.current = null;
    loadPosts(true).finally(() => setLoadingPosts(false));
  }, [loadPosts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    lastDocRef.current = null;
    await loadPosts(true);
    setRefreshing(false);
  }, [loadPosts]);

  const visiblePosts = useMemo(
    () => posts.filter(p => !blocked.has(p.authorId)),
    [posts, blocked],
  );

  async function joinLeave() {
    if (!community || busy) return;
    setBusy(true);
    try {
      if (isMember) {
        await api.leaveTravelMateCommunity({ communityId: community.id });
      } else {
        await api.joinTravelMateCommunity({ communityId: community.id });
      }
    } catch (e: unknown) {
      Alert.alert(
        isMember ? 'Could not leave' : 'Could not join',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function shareCommunity() {
    if (!community) return;
    const link = appLink(`/passenger/travel-mate/community/${community.id}`);
    Share.share({
      message:
        `Join "${community.name}" — a Velocity Travel Partner community in ${community.city}.\n\n${link}`,
    }).catch(() => {});
  }

  async function toggleLike(post: TMPost) {
    const wasLiked = likedIds.has(post.id);
    setLikedIds(prev => {
      const next = new Set(prev);
      if (wasLiked) next.delete(post.id); else next.add(post.id);
      return next;
    });
    setPosts(prev => prev.map(p =>
      p.id === post.id ? { ...p, likeCount: Math.max(0, p.likeCount + (wasLiked ? -1 : 1)) } : p,
    ));
    try {
      const res = await api.likeTravelMatePost({ postId: post.id });
      setPosts(prev => prev.map(p => (p.id === post.id ? { ...p, likeCount: res.likeCount } : p)));
    } catch {
      setLikedIds(prev => {
        const next = new Set(prev);
        if (wasLiked) next.add(post.id); else next.delete(post.id);
        return next;
      });
      setPosts(prev => prev.map(p =>
        p.id === post.id ? { ...p, likeCount: Math.max(0, p.likeCount + (wasLiked ? 1 : -1)) } : p,
      ));
    }
  }

  function sharePost(post: TMPost) {
    const link = appLink(`/passenger/travel-mate/post/${post.id}`);
    Share.share({
      message: `${post.authorName} on Velocity Travel Partner:\n\n${post.text ? `"${post.text.slice(0, 140)}"\n\n` : ''}See the post: ${link}`,
    }).catch(() => {});
  }

  function confirmDelete(post: TMPost) {
    Alert.alert('Delete post?', 'This removes the post for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => api.deleteTravelMatePost({ postId: post.id })
          .then(() => setPosts(prev => prev.filter(p => p.id !== post.id)))
          .catch(() => Alert.alert('Error', 'Could not delete the post.')),
      },
    ]);
  }

  const TopBar = (
    <View style={s.topBar}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate/feed' as Parameters<typeof router.replace>[0]))}
        style={s.backBtn}
      >
        <Text style={s.backText}>←</Text>
      </Pressable>
      <Text style={s.title} numberOfLines={1}>{community?.name ?? 'Community'}</Text>
      <Pressable onPress={shareCommunity} style={s.backBtn}>
        <Text style={{ fontSize: 15 }}>📤</Text>
      </Pressable>
    </View>
  );

  if (notFound) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>🏙️</Text>
          <Text style={s.emptyTitle}>Group not found</Text>
          <Text style={s.emptySub}>This community was removed or the link is invalid.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!community) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {TopBar}
      <FlatList
        data={visiblePosts}
        keyExtractor={p => p.id}
        contentContainerStyle={s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        onEndReached={() => { if (!endReached && !loadingPosts) loadPosts(false); }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.cityBadge}>
              <Text style={s.cityBadgeText}>📍 {community.city}</Text>
            </View>
            <Text style={s.commName}>{community.name}</Text>
            {community.description ? <Text style={s.commDesc}>{community.description}</Text> : null}
            <Text style={s.commMeta}>
              {community.memberCount} {community.memberCount === 1 ? 'member' : 'members'}
              {community.creatorName ? ` · created by ${community.creatorName}` : ''}
            </Text>
            <Pressable
              style={[s.joinBtn, isMember && s.leaveBtn, busy && { opacity: 0.5 }]}
              onPress={joinLeave}
              disabled={busy}
            >
              <Text style={[s.joinBtnText, isMember && s.leaveBtnText]}>
                {busy ? '…' : isMember ? 'Leave group' : 'Join group'}
              </Text>
            </Pressable>
            <View style={s.divider} />
            <Text style={s.postsHead}>Posts</Text>
          </View>
        }
        ListEmptyComponent={
          loadingPosts ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : (
            <View style={s.emptyPosts}>
              <Text style={{ fontSize: 36 }}>📝</Text>
              <Text style={s.emptySub}>
                {isMember
                  ? 'No posts yet — share something with the group from the Feed composer.'
                  : 'No posts yet. Join the group to post here.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: 24 }} />}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            liked={likedIds.has(item.id)}
            isMine={item.authorId === myUid}
            onLike={() => toggleLike(item)}
            onOpen={() => router.push(`/passenger/travel-mate/post/${item.id}` as Parameters<typeof router.push>[0])}
            onOpenAuthor={() => router.push(`/passenger/travel-mate/feed-profile/${item.authorId}` as Parameters<typeof router.push>[0])}
            onShare={() => sharePost(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { flex: 1, fontSize: 17, fontWeight: '900', color: colors.text, textAlign: 'center' },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle:{ fontSize: 19, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },

  listContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },

  header:    { gap: 8, paddingTop: 4 },
  cityBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, backgroundColor: `${colors.primary}22`, borderWidth: 1, borderColor: `${colors.primary}55` },
  cityBadgeText: { fontSize: 12, fontWeight: '900', color: colors.primary },
  commName:  { fontSize: 24, fontWeight: '900', color: colors.text },
  commDesc:  { fontSize: 13.5, color: colors.muted, lineHeight: 19 },
  commMeta:  { fontSize: 12, color: colors.muted },
  joinBtn:   { height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  joinBtnText: { fontSize: 14, fontWeight: '900', color: '#000' },
  leaveBtn:  { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
  leaveBtnText: { color: colors.muted },
  divider:   { height: 1, backgroundColor: colors.border, marginTop: 10 },
  postsHead: { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 },

  emptyPosts: { alignItems: 'center', paddingVertical: 32, gap: 10, paddingHorizontal: 24 },
});
