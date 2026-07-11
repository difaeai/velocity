/**
 * Travel Mate — Community Feed.
 *
 * One page for the whole community: riders post text / photos / videos and
 * their travel experiences, discover people, follow them and message them.
 * City communities appear in a horizontal rail — every group is pinned to a
 * city so members always know where it belongs.
 *
 * Feed filters: "For you" (everyone) and "Following" (people you follow).
 * Blocked users are filtered out of everything.
 *
 * Gated on having a TravelMate profile — the same single profile that powers
 * ride booking, partner discovery and this community.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { appLink } from '../../../src/share/links';
import * as ImagePicker from 'expo-image-picker';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { FirebaseError } from 'firebase/app';

import { db, storage } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { api, type TMCommunity, type TMPost } from '../../../src/api/client';
import { useBlockedSet, useFollowingSet, useMyTMProfile } from '../../../src/hooks/travelMateCommunity';
import { timeAgo } from '../../../src/lib/timeAgo';
import { colors } from '../../../src/config';

const PINK = '#E8637A';
const PAGE_SIZE = 25;

type FeedFilter = 'forYou' | 'following';

// ── Post card (shared with community/profile screens via export) ─────────────
export function PostCard({
  post, liked, onLike, onOpen, onOpenAuthor, onShare, onDelete, isMine,
}: {
  post: TMPost;
  liked: boolean;
  onLike: () => void;
  onOpen: () => void;
  onOpenAuthor: () => void;
  onShare: () => void;
  onDelete?: () => void;
  isMine: boolean;
}) {
  return (
    <View style={s.postCard}>
      {/* Header: avatar · name · community/city · time · ⋯ */}
      <View style={s.postHead}>
        <Pressable onPress={onOpenAuthor} style={s.postHeadLeft}>
          {post.authorPhotoURL ? (
            <Image source={{ uri: post.authorPhotoURL }} style={s.postAvatar} />
          ) : (
            <View style={[s.postAvatar, s.avatarFallback]}><Text style={{ fontSize: 18 }}>👤</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.postAuthor} numberOfLines={1}>{post.authorName}</Text>
            <Text style={s.postMeta} numberOfLines={1}>
              {post.communityName ? `${post.communityName} · ${post.communityCity}` : 'General'}
              {post.createdAt ? ` · ${timeAgo(post.createdAt.seconds)}` : ''}
            </Text>
          </View>
        </Pressable>
        {isMine && onDelete && (
          <Pressable onPress={onDelete} hitSlop={10} style={s.postMenuBtn}>
            <Text style={s.postMenuText}>🗑️</Text>
          </Pressable>
        )}
      </View>

      {/* Body */}
      <Pressable onPress={onOpen}>
        {post.text ? <Text style={s.postText}>{post.text}</Text> : null}
        {post.mediaType === 'image' && post.mediaURL ? (
          <Image source={{ uri: post.mediaURL }} style={s.postImage} />
        ) : null}
        {post.mediaType === 'video' && post.mediaURL ? (
          <View style={s.postVideoTile}>
            <Text style={s.postVideoPlay}>▶️</Text>
            <Text style={s.postVideoLabel}>Tap to play video</Text>
          </View>
        ) : null}
      </Pressable>

      {/* Actions */}
      <View style={s.postActions}>
        <Pressable style={s.actionGroup} onPress={onLike} hitSlop={8}>
          <Text style={s.actionIcon}>{liked ? '❤️' : '🤍'}</Text>
          <Text style={[s.actionCount, liked && { color: PINK }]}>
            {post.likeCount} {post.likeCount === 1 ? 'Like' : 'Likes'}
          </Text>
        </Pressable>
        <Pressable style={s.actionGroup} onPress={onOpen} hitSlop={8}>
          <Text style={s.actionIcon}>💬</Text>
          <Text style={s.actionCount}>{post.commentCount}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onShare} hitSlop={8}>
          <Text style={s.actionIcon}>📤</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TravelMateFeed() {
  const { user } = useAuth();
  const router = useRouter();
  // Composer opens as a bottom sheet in a Modal (outside the SafeAreaView) —
  // pad past the system navigation bar or its toolbar is hidden behind it.
  const insets = useSafeAreaInsets();
  const myProfile = useMyTMProfile();
  const blocked = useBlockedSet();
  const following = useFollowingSet();

  const [filter, setFilter] = useState<FeedFilter>('forYou');
  const [posts, setPosts] = useState<TMPost[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);

  const [communities, setCommunities] = useState<TMCommunity[]>([]);

  // Composer state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [composeImage, setComposeImage] = useState<{ uri: string; base64: string } | null>(null);
  const [composeVideo, setComposeVideo] = useState<{ uri: string; mimeType: string } | null>(null);
  const [composeCommunity, setComposeCommunity] = useState<TMCommunity | null>(null);
  const [posting, setPosting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const myUid = user?.uid ?? '';

  // ── Load helpers ────────────────────────────────────────────────────────────
  const fetchMyLikes = useCallback(async (batch: TMPost[]) => {
    if (!myUid || batch.length === 0) return;
    const results = await Promise.all(
      batch.map(p =>
        getDoc(doc(db, 'travelMatePosts', p.id, 'likes', myUid))
          .then(snap => (snap.exists() ? p.id : null))
          .catch(() => null),
      ),
    );
    setLikedIds(prev => {
      const next = new Set(prev);
      results.forEach(id => { if (id) next.add(id); });
      return next;
    });
  }, [myUid]);

  const loadPage = useCallback(async (reset: boolean) => {
    if (!myUid) return;
    try {
      let base;
      if (filter === 'following') {
        const followedUids = [...following].slice(0, 30);
        if (followedUids.length === 0) {
          setPosts([]);
          setEndReached(true);
          return;
        }
        base = query(
          collection(db, 'travelMatePosts'),
          where('authorId', 'in', followedUids),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE),
        );
      } else {
        base = query(
          collection(db, 'travelMatePosts'),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE),
        );
      }
      const paged = !reset && lastDocRef.current ? query(base, startAfter(lastDocRef.current)) : base;
      const snap = await getDocs(paged);
      const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMPost);
      lastDocRef.current = snap.docs.length ? (snap.docs[snap.docs.length - 1] ?? null) : lastDocRef.current;
      setEndReached(snap.docs.length < PAGE_SIZE);
      setPosts(prev => (reset ? batch : [...prev, ...batch.filter(p => !prev.some(q2 => q2.id === p.id))]));
      fetchMyLikes(batch);
    } catch {
      if (reset) Alert.alert('Error', 'Could not load the feed. Check your connection and try again.');
    }
  }, [myUid, filter, following, fetchMyLikes]);

  const loadCommunities = useCallback(async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'travelMateCommunities'),
        orderBy('city', 'asc'),
        orderBy('memberCount', 'desc'),
        limit(30),
      ));
      setCommunities(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMCommunity));
    } catch { /* rail is non-critical */ }
  }, []);

  // Initial + filter-change load. The Following tab also reloads when the
  // follow list itself changes (it usually arrives just after mount).
  useEffect(() => {
    if (!myUid || myProfile === undefined) return;
    setLoading(true);
    lastDocRef.current = null;
    Promise.all([loadPage(true), loadCommunities()]).finally(() => setLoading(false));
  }, [myUid, filter, myProfile === undefined, filter === 'following' ? following.size : -1]);

  // Refresh feed when returning to the tab (post from another screen, etc.)
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      lastDocRef.current = null;
      loadPage(true);
      loadCommunities();
    }, [loadPage, loadCommunities]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    lastDocRef.current = null;
    await Promise.all([loadPage(true), loadCommunities()]);
    setRefreshing(false);
  }, [loadPage, loadCommunities]);

  const onEndReached = useCallback(async () => {
    if (loading || loadingMore || endReached) return;
    setLoadingMore(true);
    await loadPage(false);
    setLoadingMore(false);
  }, [loading, loadingMore, endReached, loadPage]);

  const visiblePosts = useMemo(
    () => posts.filter(p => !blocked.has(p.authorId)),
    [posts, blocked],
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  async function toggleLike(post: TMPost) {
    if (!myUid) return;
    const wasLiked = likedIds.has(post.id);
    // Optimistic flip
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
      setLikedIds(prev => {
        const next = new Set(prev);
        if (res.liked) next.add(post.id); else next.delete(post.id);
        return next;
      });
    } catch (e: unknown) {
      // Roll back
      setLikedIds(prev => {
        const next = new Set(prev);
        if (wasLiked) next.add(post.id); else next.delete(post.id);
        return next;
      });
      setPosts(prev => prev.map(p =>
        p.id === post.id ? { ...p, likeCount: Math.max(0, p.likeCount + (wasLiked ? 1 : -1)) } : p,
      ));
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your TravelMate profile first.');
      }
    }
  }

  function sharePost(post: TMPost) {
    const link = appLink(`/passenger/travel-mate/post/${post.id}`);
    Share.share({
      message:
        `${post.authorName} on Velocity TravelMate:\n\n` +
        `${post.text ? `"${post.text.slice(0, 140)}"\n\n` : ''}` +
        `See the post: ${link}`,
    }).catch(() => {});
  }

  function confirmDelete(post: TMPost) {
    Alert.alert('Delete post?', 'This removes the post, its likes and comments for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteTravelMatePost({ postId: post.id });
            setPosts(prev => prev.filter(p => p.id !== post.id));
          } catch {
            Alert.alert('Error', 'Could not delete the post. Try again.');
          }
        },
      },
    ]);
  }

  // ── Composer ───────────────────────────────────────────────────────────────
  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach a picture.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      if (result.assets[0].base64.length > 7_500_000) {
        Alert.alert('Too large', 'Please choose a smaller photo (under ~5 MB).');
        return;
      }
      setComposeVideo(null);
      setComposeImage({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
    }
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow media access to attach a video.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      videoMaxDuration: 60,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if ((asset.duration ?? 0) > 61_000) {
        Alert.alert('Too long', 'Videos can be up to 60 seconds.');
        return;
      }
      if ((asset.fileSize ?? 0) > 50 * 1024 * 1024) {
        Alert.alert('Too large', 'Videos must be under 50 MB.');
        return;
      }
      setComposeImage(null);
      setComposeVideo({ uri: asset.uri, mimeType: asset.mimeType ?? 'video/mp4' });
    }
  }

  async function submitPost() {
    if (!myUid || posting) return;
    const text = composeText.trim();
    if (!text && !composeImage && !composeVideo) {
      Alert.alert('Empty post', 'Write something or attach a photo/video.');
      return;
    }
    setPosting(true);
    try {
      let videoPath: string | undefined;
      if (composeVideo) {
        // Videos are too big for the callable — upload straight to Storage
        // (rules allow the owner folder, video/*, < 50 MB), then attach the path.
        setUploadPct(0);
        const ext = composeVideo.mimeType.includes('quicktime') || composeVideo.uri.endsWith('.mov') ? 'mov' : 'mp4';
        videoPath = `travelMateFeedVideos/${myUid}/${Date.now()}.${ext}`;
        const resp = await fetch(composeVideo.uri);
        const blob = await resp.blob();
        const task = uploadBytesResumable(storageRef(storage, videoPath), blob, {
          contentType: composeVideo.mimeType,
        });
        await new Promise<void>((resolve, reject) => {
          task.on(
            'state_changed',
            snap => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            reject,
            () => resolve(),
          );
        });
        setUploadPct(null);
      }

      await api.createTravelMatePost({
        text,
        imageBase64: composeImage?.base64,
        videoPath,
        communityId: composeCommunity?.id,
      });
      setComposeOpen(false);
      setComposeText('');
      setComposeImage(null);
      setComposeVideo(null);
      setComposeCommunity(null);
      lastDocRef.current = null;
      await loadPage(true);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your TravelMate profile first.');
      } else {
        Alert.alert('Could not post', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setPosting(false);
      setUploadPct(null);
    }
  }

  const myCommunities = useMemo(
    () => communities.filter(c => c.members?.includes(myUid)),
    [communities, myUid],
  );

  // ── Gate: needs a TravelMate profile ──────────────────────────────────────
  if (myProfile === null) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.topBar}>
          <Text style={s.screenTitle}>Feed</Text>
        </View>
        <View style={s.gateBox}>
          <Text style={s.gateEmoji}>🌍</Text>
          <Text style={s.gateTitle}>Join the community</Text>
          <Text style={s.gateSub}>
            Share your travel experiences, find people heading your way, follow them and
            chat — all with the same TravelMate profile you use for rides.
          </Text>
          <Pressable style={s.gateBtn} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.gateBtnText}>Create my profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Top bar */}
      <View style={s.topBar}>
        <Text style={s.screenTitle}>Feed</Text>
        <View style={s.topActions}>
          <Pressable
            onPress={() => router.push('/passenger/travel-mate/feed-search' as Parameters<typeof router.push>[0])}
            style={s.topIconBtn}
          >
            <Text style={s.topIcon}>🔍</Text>
          </Pressable>
          <Pressable
            onPress={() => user && router.push(`/passenger/travel-mate/feed-profile/${user.uid}` as Parameters<typeof router.push>[0])}
            style={s.topIconBtn}
          >
            {myProfile?.photoURL ? (
              <Image source={{ uri: myProfile.photoURL }} style={s.topAvatar} />
            ) : (
              <Text style={s.topIcon}>👤</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Filter chips */}
      <View style={s.chipsRow}>
        <Pressable
          style={[s.chip, filter === 'forYou' && s.chipActive]}
          onPress={() => setFilter('forYou')}
        >
          <Text style={[s.chipText, filter === 'forYou' && s.chipTextActive]}>✨ For you</Text>
        </Pressable>
        <Pressable
          style={[s.chip, filter === 'following' && s.chipActive]}
          onPress={() => setFilter('following')}
        >
          <Text style={[s.chipText, filter === 'following' && s.chipTextActive]}>👥 Following</Text>
        </Pressable>
        <Pressable
          style={s.chip}
          onPress={() => router.push('/passenger/travel-mate/communities' as Parameters<typeof router.push>[0])}
        >
          <Text style={s.chipText}>🏙️ City groups</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.centerBox}><ActivityIndicator size="large" color={PINK} /></View>
      ) : (
        <FlatList
          data={visiblePosts}
          keyExtractor={p => p.id}
          contentContainerStyle={s.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PINK} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            communities.length > 0 ? (
              <View style={s.railWrap}>
                <View style={s.railHead}>
                  <Text style={s.railTitle}>Groups by city</Text>
                  <Pressable onPress={() => router.push('/passenger/travel-mate/communities' as Parameters<typeof router.push>[0])}>
                    <Text style={s.railAction}>See all ›</Text>
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
                  {communities.slice(0, 10).map(c => (
                    <Pressable
                      key={c.id}
                      style={s.commCard}
                      onPress={() => router.push(`/passenger/travel-mate/community/${c.id}` as Parameters<typeof router.push>[0])}
                    >
                      <Text style={s.commCity}>📍 {c.city}</Text>
                      <Text style={s.commName} numberOfLines={2}>{c.name}</Text>
                      <Text style={s.commMembers}>
                        {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={s.emptyEmoji}>{filter === 'following' ? '👥' : '📝'}</Text>
              <Text style={s.emptyTitle}>
                {filter === 'following' ? 'Nothing here yet' : 'No posts yet'}
              </Text>
              <Text style={s.emptySub}>
                {filter === 'following'
                  ? 'Follow people to see their posts here. Find them with the 🔍 search.'
                  : 'Be the first to share a travel experience with the community!'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={PINK} style={{ marginVertical: 16 }} /> : <View style={{ height: 90 }} />
          }
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
      )}

      {/* Compose FAB */}
      <Pressable style={s.fab} onPress={() => setComposeOpen(true)}>
        <Text style={s.fabIcon}>＋</Text>
      </Pressable>

      {/* Composer modal */}
      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => !posting && setComposeOpen(false)}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[s.composeBox, { paddingBottom: 20 + insets.bottom }]}>
            <View style={s.composeHead}>
              <Pressable onPress={() => !posting && setComposeOpen(false)} hitSlop={10}>
                <Text style={s.composeCancel}>Cancel</Text>
              </Pressable>
              <Text style={s.composeTitle}>New post</Text>
              <Pressable
                onPress={submitPost}
                disabled={posting}
                style={[s.composeSubmit, posting && { opacity: 0.5 }]}
              >
                <Text style={s.composeSubmitText}>
                  {posting ? (uploadPct !== null ? `${uploadPct}%` : 'Posting…') : 'Post'}
                </Text>
              </Pressable>
            </View>

            <TextInput
              style={s.composeInput}
              value={composeText}
              onChangeText={setComposeText}
              placeholder="Share a travel experience, a tip, or a question…"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={2000}
              editable={!posting}
            />

            {composeImage && (
              <View style={s.attachWrap}>
                <Image source={{ uri: composeImage.uri }} style={s.attachPreview} />
                <Pressable style={s.attachRemove} onPress={() => setComposeImage(null)}>
                  <Text style={s.attachRemoveText}>✕</Text>
                </Pressable>
              </View>
            )}
            {composeVideo && (
              <View style={s.attachWrap}>
                <View style={[s.attachPreview, s.attachVideoTile]}>
                  <Text style={{ fontSize: 30 }}>🎬</Text>
                  <Text style={s.attachVideoLabel}>Video attached</Text>
                </View>
                <Pressable style={s.attachRemove} onPress={() => setComposeVideo(null)}>
                  <Text style={s.attachRemoveText}>✕</Text>
                </Pressable>
              </View>
            )}

            {/* Post into a community */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.composeCommRow}>
              <Pressable
                style={[s.commPill, !composeCommunity && s.commPillActive]}
                onPress={() => setComposeCommunity(null)}
              >
                <Text style={[s.commPillText, !composeCommunity && s.commPillTextActive]}>🌍 General</Text>
              </Pressable>
              {myCommunities.map(c => (
                <Pressable
                  key={c.id}
                  style={[s.commPill, composeCommunity?.id === c.id && s.commPillActive]}
                  onPress={() => setComposeCommunity(c)}
                >
                  <Text style={[s.commPillText, composeCommunity?.id === c.id && s.commPillTextActive]}>
                    {c.name} · {c.city}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={s.composeToolbar}>
              <Pressable style={s.toolBtn} onPress={pickImage} disabled={posting}>
                <Text style={s.toolIcon}>🖼️</Text>
                <Text style={s.toolLabel}>Photo</Text>
              </Pressable>
              <Pressable style={s.toolBtn} onPress={pickVideo} disabled={posting}>
                <Text style={s.toolIcon}>🎬</Text>
                <Text style={s.toolLabel}>Video</Text>
              </Pressable>
              <Text style={s.composeCount}>{composeText.length}/2000</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  topBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  screenTitle: { fontSize: 22, fontWeight: '900', color: colors.text },
  topActions:  { flexDirection: 'row', gap: 10 },
  topIconBtn:  { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  topIcon:     { fontSize: 17 },
  topAvatar:   { width: 38, height: 38, borderRadius: 19 },

  chipsRow:  { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  chip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive:{ borderColor: PINK, backgroundColor: `${PINK}22` },
  chipText:  { fontSize: 13, fontWeight: '800', color: colors.muted },
  chipTextActive: { color: PINK },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },

  // Communities rail
  railWrap:  { marginBottom: 4 },
  railHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  railTitle: { fontSize: 13, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  railAction:{ fontSize: 13, fontWeight: '800', color: PINK },
  rail:      { gap: 10, paddingRight: 8 },
  commCard:  { width: 150, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 12, gap: 4 },
  commCity:  { fontSize: 11, fontWeight: '900', color: PINK },
  commName:  { fontSize: 14, fontWeight: '800', color: colors.text, lineHeight: 18 },
  commMembers: { fontSize: 11, color: colors.muted },

  // Post card
  postCard:   { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  postHead:   { flexDirection: 'row', alignItems: 'center' },
  postHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  postAvatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  postAuthor: { fontSize: 15, fontWeight: '800', color: colors.text },
  postMeta:   { fontSize: 11, color: PINK, marginTop: 1, fontWeight: '700' },
  postMenuBtn: { padding: 4 },
  postMenuText:{ fontSize: 14 },
  postText:   { fontSize: 14.5, color: colors.text, lineHeight: 21 },
  postImage:  { width: '100%', height: 220, borderRadius: 12, marginTop: 8, backgroundColor: colors.glassChip },
  postVideoTile: { width: '100%', height: 180, borderRadius: 12, marginTop: 8, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 6 },
  postVideoPlay: { fontSize: 40 },
  postVideoLabel:{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 2 },
  actionGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIcon:  { fontSize: 17 },
  actionCount: { fontSize: 13, fontWeight: '700', color: colors.muted },

  // Empty / gate
  emptyBox:  { alignItems: 'center', paddingVertical: 48, gap: 8, paddingHorizontal: 24 },
  emptyEmoji:{ fontSize: 44 },
  emptyTitle:{ fontSize: 17, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  gateBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  gateEmoji: { fontSize: 60 },
  gateTitle: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  gateSub:   { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  gateBtn:   { width: '100%', height: 54, borderRadius: 16, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  gateBtnText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  // FAB
  fab:     { position: 'absolute', right: 20, bottom: 24, width: 60, height: 60, borderRadius: 30, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabIcon: { fontSize: 30, color: '#fff', fontWeight: '900', marginTop: -2 },

  // Composer
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  composeBox:   { backgroundColor: colors.glassPanel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, borderWidth: 1, borderColor: colors.border },
  composeHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composeCancel:{ fontSize: 14, fontWeight: '700', color: colors.muted },
  composeTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  composeSubmit:{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 99, backgroundColor: PINK },
  composeSubmitText: { fontSize: 14, fontWeight: '900', color: '#fff' },
  composeInput: { minHeight: 110, maxHeight: 200, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 15, padding: 14, textAlignVertical: 'top' },

  attachWrap:    { position: 'relative', alignSelf: 'flex-start' },
  attachPreview: { width: 110, height: 110, borderRadius: 12, backgroundColor: colors.glassChip },
  attachVideoTile: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  attachVideoLabel:{ fontSize: 11, fontWeight: '700', color: colors.muted },
  attachRemove:  { position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  attachRemoveText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  composeCommRow: { gap: 8 },
  commPill:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  commPillActive: { borderColor: PINK, backgroundColor: `${PINK}22` },
  commPillText:   { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  commPillTextActive: { color: PINK },

  composeToolbar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: Platform.OS === 'ios' ? 14 : 4 },
  toolBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  toolIcon:  { fontSize: 16 },
  toolLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  composeCount: { flex: 1, textAlign: 'right', fontSize: 11, color: colors.muted },
});
