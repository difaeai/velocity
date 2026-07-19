/**
 * Travel Partner — community profile (own and others').
 *
 * Header: avatar, name, follower/following counts (tappable lists), country +
 * joined date, bio, usual FROM/TO travel locations.
 * Actions: own profile → Edit + Share; someone else → Follow/Unfollow +
 * Message (opens a DM through the existing match-chat infrastructure) and a
 * ⋯ menu with Block / Report.
 * Tabs: Posts · Comments · Likes · Groups.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { appLink } from '../../../../src/share/links';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api, type TMComment, type TMCommunity, type TMPost } from '../../../../src/api/client';
import { useBlockedSet, useFollowingSet, useMyTMProfile } from '../../../../src/hooks/travelMateCommunity';
import { timeAgo, joinedLabel } from '../../../../src/lib/timeAgo';
import { areaSummary } from '../../../../src/lib/areaLabel';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import { PostCard } from '../feed';


interface TravelPoint { lat: number; lng: number; label: string }

interface FullProfile {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  bio?: string;
  active?: boolean;
  createdAt?: { seconds: number };
  travelPrefs?: {
    homeLocations?: TravelPoint[];
    travelToLocations?: TravelPoint[];
  };
}

type Tab = 'posts' | 'comments' | 'likes' | 'groups';

interface FollowRow {
  id: string;
  uid: string;
  name: string;
  photoURL: string | null;
}

export default function FeedProfile() {
  const params = useLocalSearchParams<{ uid: string }>();
  const profileUid = Array.isArray(params.uid) ? params.uid[0] : params.uid;
  const { user } = useAuth();
  const router = useRouter();
  const blocked = useBlockedSet();
  const following = useFollowingSet();
  const myProfile = useMyTMProfile();

  const isOwn = !!user && user.uid === profileUid;
  const isBlockedByMe = !!profileUid && blocked.has(profileUid);

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [followers, setFollowers] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [postCount, setPostCount] = useState<number | null>(null);

  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<TMPost[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<TMComment[]>([]);
  const [likedPosts, setLikedPosts] = useState<TMPost[]>([]);
  const [groups, setGroups] = useState<TMCommunity[]>([]);
  const [tabLoading, setTabLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Followers / following list modal
  const [listMode, setListMode] = useState<'followers' | 'following' | null>(null);
  const [listRows, setListRows] = useState<FollowRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const myUid = user?.uid ?? '';

  // ── Profile + counts ────────────────────────────────────────────────────────
  const loadHeader = useCallback(async () => {
    if (!profileUid) return;
    try {
      const snap = await getDoc(doc(db, 'travelMateProfiles', profileUid));
      if (!snap.exists()) { setNotFound(true); return; }
      setProfile({ uid: profileUid, ...snap.data() } as FullProfile);

      const [fRes, gRes, pRes] = await Promise.all([
        getCountFromServer(query(collection(db, 'travelMateFollows'), where('followedId', '==', profileUid))),
        getCountFromServer(query(collection(db, 'travelMateFollows'), where('followerId', '==', profileUid))),
        getCountFromServer(query(collection(db, 'travelMatePosts'), where('authorId', '==', profileUid))),
      ]);
      setFollowers(fRes.data().count);
      setFollowingCount(gRes.data().count);
      setPostCount(pRes.data().count);
    } catch {
      setNotFound(true);
    }
  }, [profileUid]);

  useFocusEffect(useCallback(() => { loadHeader(); }, [loadHeader]));

  // ── Tab content ────────────────────────────────────────────────────────────
  const loadTab = useCallback(async () => {
    if (!profileUid) return;
    setTabLoading(true);
    try {
      if (tab === 'posts') {
        const snap = await getDocs(query(
          collection(db, 'travelMatePosts'),
          where('authorId', '==', profileUid),
          orderBy('createdAt', 'desc'),
          limit(30),
        ));
        const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMPost);
        setPosts(batch);
        if (myUid) {
          const res = await Promise.all(batch.map(p =>
            getDoc(doc(db, 'travelMatePosts', p.id, 'likes', myUid))
              .then(s2 => (s2.exists() ? p.id : null)).catch(() => null)));
          setLikedIds(new Set(res.filter((x): x is string => !!x)));
        }
      } else if (tab === 'comments') {
        const snap = await getDocs(query(
          collectionGroup(db, 'comments'),
          where('authorId', '==', profileUid),
          orderBy('createdAt', 'desc'),
          limit(30),
        ));
        setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMComment));
      } else if (tab === 'likes') {
        const snap = await getDocs(query(
          collectionGroup(db, 'likes'),
          where('uid', '==', profileUid),
          orderBy('createdAt', 'desc'),
          limit(20),
        ));
        const postIds = snap.docs
          .map(d => d.data().postId as string)
          .filter(Boolean);
        const postSnaps = await Promise.all(
          postIds.map(id => getDoc(doc(db, 'travelMatePosts', id)).catch(() => null)),
        );
        setLikedPosts(postSnaps
          .filter((s2): s2 is NonNullable<typeof s2> => !!s2 && s2.exists())
          .map(s2 => ({ id: s2.id, ...s2.data() }) as TMPost));
      } else {
        const snap = await getDocs(query(
          collection(db, 'travelMateCommunities'),
          where('members', 'array-contains', profileUid),
          limit(30),
        ));
        setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMCommunity));
      }
    } catch { /* tab shows empty state */ }
    setTabLoading(false);
  }, [profileUid, tab, myUid]);

  useEffect(() => { loadTab(); }, [loadTab]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function toggleFollow() {
    if (!user || !profile) return;
    if (!myProfile) {
      Alert.alert('Profile needed', 'Set up your Travel Partner profile first.');
      return;
    }
    const followRef = doc(db, 'travelMateFollows', `${user.uid}_${profile.uid}`);
    const isFollowing = following.has(profile.uid);
    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        setFollowers(n => (n === null ? n : Math.max(0, n - 1)));
      } else {
        await setDoc(followRef, {
          followerId: user.uid,
          followedId: profile.uid,
          followerName: myProfile.displayName,
          followerPhotoURL: myProfile.photoURL ?? null,
          followedName: profile.displayName,
          followedPhotoURL: profile.photoURL ?? null,
          createdAt: serverTimestamp(),
        });
        setFollowers(n => (n === null ? n : n + 1));
      }
    } catch {
      Alert.alert('Error', 'Could not update follow. Try again.');
    }
  }

  async function message() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const { matchId } = await api.openTravelMateFeedChat({ targetUid: profile.uid });
      router.push(`/passenger/travel-mate/chat/${matchId}` as Parameters<typeof router.push>[0]);
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        // Either the caller has no profile yet, or the conversation was closed
        // (unmatch / block) — the CF message says which.
        Alert.alert('Cannot message', e.message);
      } else if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
        Alert.alert('Unavailable', 'You cannot message this user.');
      } else {
        Alert.alert('Error', 'Could not open the chat. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function openMenu() {
    if (!profile) return;
    Alert.alert(profile.displayName, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isBlockedByMe ? 'Unblock user' : 'Block user',
        style: 'destructive',
        onPress: () => (isBlockedByMe ? unblock() : confirmBlock()),
      },
      {
        text: 'Report user',
        onPress: () => {
          Alert.alert('Report user', 'Tell us what happened — our team reviews every report.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Inappropriate content',
              onPress: () => report('Inappropriate content (community feed)'),
            },
            {
              text: 'Harassment or spam',
              onPress: () => report('Harassment or spam (community feed)'),
            },
          ]);
        },
      },
    ]);
  }

  function confirmBlock() {
    if (!profile) return;
    Alert.alert(
      `Block ${profile.displayName}?`,
      'They will no longer appear in your feed, search or discover, any open chat is closed, and you both stop following each other. You can unblock them anytime from Blocked users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.blockTravelMateUser({ targetUid: profile.uid });
            } catch {
              Alert.alert('Error', 'Could not block. Try again.');
            }
          },
        },
      ],
    );
  }

  async function unblock() {
    if (!profile) return;
    try {
      await api.unblockTravelMateUser({ targetUid: profile.uid });
    } catch {
      Alert.alert('Error', 'Could not unblock. Try again.');
    }
  }

  async function report(reason: string) {
    if (!profile) return;
    try {
      await api.reportTravelMateUser({ reportedUid: profile.uid, reason });
      Alert.alert('Thank you', 'Your report was submitted and will be reviewed.');
    } catch {
      Alert.alert('Error', 'Could not submit the report.');
    }
  }

  function shareProfile() {
    if (!profile) return;
    const link = appLink(`/passenger/travel-mate/feed-profile/${profile.uid}`);
    Share.share({
      message: isOwn
        ? `👋 I'm ${profile.displayName} on Velocity Travel Partner. Follow me and see my posts:\n${link}`
        : `Check out ${profile.displayName} on Velocity Travel Partner:\n${link}`,
    }).catch(() => {});
  }

  // ── Followers / following modal ────────────────────────────────────────────
  async function openList(mode: 'followers' | 'following') {
    if (!profileUid) return;
    setListMode(mode);
    setListLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'travelMateFollows'),
        where(mode === 'followers' ? 'followedId' : 'followerId', '==', profileUid),
        orderBy('createdAt', 'desc'),
        limit(100),
      ));
      setListRows(snap.docs.map(d => {
        const data = d.data();
        return mode === 'followers'
          ? { id: d.id, uid: data.followerId, name: data.followerName ?? 'Member', photoURL: data.followerPhotoURL ?? null }
          : { id: d.id, uid: data.followedId, name: data.followedName ?? 'Member', photoURL: data.followedPhotoURL ?? null };
      }).filter(r => !blocked.has(r.uid)));
    } catch {
      setListRows([]);
    } finally {
      setListLoading(false);
    }
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
    } catch { /* refresh will reconcile */ }
  }

  function sharePost(post: TMPost) {
    const link = appLink(`/passenger/travel-mate/post/${post.id}`);
    Share.share({
      message: `${post.authorName} on Velocity Travel Partner:\n\n${post.text ? `"${post.text.slice(0, 140)}"\n\n` : ''}See the post: ${link}`,
    }).catch(() => {});
  }

  function confirmDeletePost(post: TMPost) {
    Alert.alert('Delete post?', 'This removes the post for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => api.deleteTravelMatePost({ postId: post.id })
          .then(() => {
            setPosts(prev => prev.filter(p => p.id !== post.id));
            setPostCount(n => (n === null ? n : Math.max(0, n - 1)));
          })
          .catch(() => Alert.alert('Error', 'Could not delete the post.')),
      },
    ]);
  }

  const isFollowing = !!profile && following.has(profile.uid);

  // ── Render ────────────────────────────────────────────────────────────────
  const TopBar = (
    <View style={s.topBar}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/travel-mate/feed' as Parameters<typeof router.replace>[0]))}
        style={s.iconBtn}
      >
        <Text style={s.iconBtnText}>←</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => router.push('/passenger/travel-mate/feed-search' as Parameters<typeof router.push>[0])}
          style={s.iconBtn}
        >
          <Text style={{ fontSize: 15 }}>🔍</Text>
        </Pressable>
        <Pressable onPress={shareProfile} style={s.iconBtn}>
          <Text style={{ fontSize: 15 }}>📤</Text>
        </Pressable>
        {!isOwn && (
          <Pressable onPress={openMenu} style={s.iconBtn}>
            <Text style={{ fontSize: 15, color: colors.text }}>⋮</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  if (notFound) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>👤</Text>
          <Text style={s.emptyTitle}>Profile not found</Text>
          <Text style={s.emptySub}>This person has not set up a Travel Partner profile.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (isBlockedByMe) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>🚫</Text>
          <Text style={s.emptyTitle}>{profile.displayName} is blocked</Text>
          <Text style={s.emptySub}>You won&apos;t see their posts, comments or profile.</Text>
          <Pressable style={s.unblockBtn} onPress={unblock}>
            <Text style={s.unblockBtnText}>Unblock</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const homeLocs = profile.travelPrefs?.homeLocations ?? [];
  const travelLocs = profile.travelPrefs?.travelToLocations ?? [];
  const joined = joinedLabel(profile.createdAt?.seconds);

  const header = (
    <View style={s.headerWrap}>
      {/* Identity */}
      <View style={s.identityRow}>
        {profile.photoURL ? (
          <Image source={{ uri: profile.photoURL }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarFallback]}><Text style={{ fontSize: 34 }}>👤</Text></View>
        )}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={s.name}>{profile.displayName}</Text>
          <View style={s.statsRow}>
            <Pressable style={s.stat} onPress={() => openList('followers')}>
              <Text style={s.statNum}>{followers ?? '–'}</Text>
              <Text style={s.statLabel}>Followers</Text>
            </Pressable>
            <Pressable style={s.stat} onPress={() => openList('following')}>
              <Text style={s.statNum}>{followingCount ?? '–'}</Text>
              <Text style={s.statLabel}>Following</Text>
            </Pressable>
            <View style={s.stat}>
              <Text style={s.statNum}>{postCount ?? '–'}</Text>
              <Text style={s.statLabel}>Posts</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={s.metaRow}>
        <Text style={s.metaItem}>🇵🇰 Pakistan</Text>
        {joined ? <Text style={s.metaItem}>📅 {joined}</Text> : null}
      </View>

      {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

      {/* Coarse AREA names only — never street/house level */}
      {(areaSummary(homeLocs) || areaSummary(travelLocs)) && (
        <View style={s.routesWrap}>
          {areaSummary(homeLocs) && (
            <Text style={s.routeLine} numberOfLines={1}>
              📍 From: {areaSummary(homeLocs)}
            </Text>
          )}
          {areaSummary(travelLocs) && (
            <Text style={s.routeLine} numberOfLines={1}>
              🧭 To: {areaSummary(travelLocs)}
            </Text>
          )}
        </View>
      )}

      {/* Actions */}
      {isOwn ? (
        <View style={s.actionsRow}>
          <Pressable style={s.primaryAction} onPress={() => router.push('/passenger/travel-mate/setup')}>
            <Text style={s.primaryActionText}>Edit profile</Text>
          </Pressable>
          <Pressable
            style={s.secondaryAction}
            onPress={() => router.push('/passenger/travel-mate/blocked-users' as Parameters<typeof router.push>[0])}
          >
            <Text style={s.secondaryActionText}>🚫 Blocked users</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.actionsRow}>
          <Pressable style={s.secondaryAction} onPress={message} disabled={busy}>
            <Text style={s.secondaryActionText}>{busy ? '…' : '💬 Message'}</Text>
          </Pressable>
          <Pressable
            style={[s.primaryAction, isFollowing && s.followingAction]}
            onPress={toggleFollow}
          >
            <Text style={[s.primaryActionText, isFollowing && s.followingActionText]}>
              {isFollowing ? 'Following ✓' : 'Follow'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Tabs */}
      <View style={s.tabsRow}>
        {(['posts', 'comments', 'likes', 'groups'] as Tab[]).map(t => (
          <Pressable key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'posts' ? 'Posts' : t === 'comments' ? 'Comments' : t === 'likes' ? 'Likes' : 'Groups'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const emptyTab = (
    <View style={s.emptyTab}>
      {tabLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text style={s.emptySub}>
          {tab === 'posts' && (isOwn ? 'You have not posted yet. Share your first travel experience!' : 'No posts yet.')}
          {tab === 'comments' && 'No comments yet.'}
          {tab === 'likes' && 'No liked posts yet.'}
          {tab === 'groups' && 'Not in any city groups yet.'}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={s.safe}>
      {TopBar}

      {tab === 'posts' && (
        <FlatList
          data={tabLoading ? [] : posts}
          keyExtractor={p => p.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyTab}
          ListFooterComponent={<View style={{ height: 24 }} />}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              liked={likedIds.has(item.id)}
              isMine={item.authorId === myUid}
              onLike={() => toggleLike(item)}
              onOpen={() => router.push(`/passenger/travel-mate/post/${item.id}` as Parameters<typeof router.push>[0])}
              onOpenAuthor={() => {}}
              onShare={() => sharePost(item)}
              onDelete={() => confirmDeletePost(item)}
            />
          )}
        />
      )}

      {tab === 'comments' && (
        <FlatList
          data={tabLoading ? [] : comments}
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyTab}
          renderItem={({ item }) => (
            <Pressable
              style={s.commentCard}
              onPress={() => router.push(`/passenger/travel-mate/post/${item.postId}` as Parameters<typeof router.push>[0])}
            >
              <Text style={s.commentText}>💬 {item.text}</Text>
              <Text style={s.commentMeta}>
                {item.createdAt ? timeAgo(item.createdAt.seconds) : ''} · tap to open post
              </Text>
            </Pressable>
          )}
        />
      )}

      {tab === 'likes' && (
        <FlatList
          data={tabLoading ? [] : likedPosts.filter(p => !blocked.has(p.authorId))}
          keyExtractor={p => p.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyTab}
          renderItem={({ item }) => (
            <Pressable
              style={s.commentCard}
              onPress={() => router.push(`/passenger/travel-mate/post/${item.id}` as Parameters<typeof router.push>[0])}
            >
              <Text style={s.commentText} numberOfLines={2}>
                ❤️ {item.authorName}: {item.text || (item.mediaType === 'image' ? '📷 Photo' : '🎬 Video')}
              </Text>
              <Text style={s.commentMeta}>
                {item.likeCount} likes · {item.commentCount} comments
              </Text>
            </Pressable>
          )}
        />
      )}

      {tab === 'groups' && (
        <FlatList
          data={tabLoading ? [] : groups}
          keyExtractor={g => g.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyTab}
          renderItem={({ item }) => (
            <Pressable
              style={s.groupRow}
              onPress={() => router.push(`/passenger/travel-mate/community/${item.id}` as Parameters<typeof router.push>[0])}
            >
              <View style={s.groupIcon}><Text style={{ fontSize: 18 }}>🌆</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.groupName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.groupMeta}>📍 {item.city} · {item.memberCount} members</Text>
              </View>
              <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
            </Pressable>
          )}
        />
      )}

      {/* Followers / following modal */}
      <Modal
        visible={listMode !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setListMode(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>
                {listMode === 'followers' ? 'Followers' : 'Following'}
              </Text>
              <Pressable onPress={() => setListMode(null)} hitSlop={10}>
                <Text style={s.modalClose}>✕</Text>
              </Pressable>
            </View>
            {listLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
            ) : listRows.length === 0 ? (
              <Text style={[s.emptySub, { paddingVertical: 24, textAlign: 'center' }]}>
                {listMode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
              </Text>
            ) : (
              <FlatList
                data={listRows}
                keyExtractor={r => r.id}
                style={{ maxHeight: 420 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.listRow}
                    onPress={() => {
                      setListMode(null);
                      router.push(`/passenger/travel-mate/feed-profile/${item.uid}` as Parameters<typeof router.push>[0]);
                    }}
                  >
                    {item.photoURL ? (
                      <Image source={{ uri: item.photoURL }} style={s.listAvatar} />
                    ) : (
                      <View style={[s.listAvatar, s.avatarFallback]}><Text style={{ fontSize: 15 }}>👤</Text></View>
                    )}
                    <Text style={s.listName}>{item.name}</Text>
                    <Text style={{ fontSize: 16, color: colors.muted }}>›</Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = themed(() => StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: colors.text, fontSize: 18, fontWeight: '700' },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle:{ fontSize: 19, fontWeight: '900', color: colors.text, textAlign: 'center' },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  unblockBtn: { marginTop: 10, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary },
  unblockBtnText: { fontSize: 14, fontWeight: '900', color: '#000' },

  listContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },

  headerWrap:  { gap: 12, paddingTop: 4 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar:      { width: 84, height: 84, borderRadius: 42, borderWidth: 2.5, borderColor: colors.primary },
  avatarFallback: { backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  name:        { fontSize: 22, fontWeight: '900', color: colors.text },
  statsRow:    { flexDirection: 'row', gap: 18 },
  stat:        { alignItems: 'flex-start' },
  statNum:     { fontSize: 16, fontWeight: '900', color: colors.text },
  statLabel:   { fontSize: 11, color: colors.muted, fontWeight: '700' },

  metaRow:  { flexDirection: 'row', gap: 14 },
  metaItem: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  bio:      { fontSize: 14, color: colors.text, lineHeight: 20 },

  routesWrap: { gap: 4, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  routeLine:  { fontSize: 12.5, color: colors.text, fontWeight: '700' },

  actionsRow:     { flexDirection: 'row', gap: 10 },
  primaryAction:  { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { fontSize: 14, fontWeight: '900', color: '#000' },
  followingAction: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
  followingActionText: { color: colors.primary },
  secondaryAction:{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  secondaryActionText: { fontSize: 14, fontWeight: '800', color: colors.text },

  tabsRow:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 4 },
  tabBtn:   { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.primary },
  tabText:  { fontSize: 13.5, fontWeight: '800', color: colors.muted },
  tabTextActive: { color: colors.text },

  emptyTab: { paddingVertical: 36, alignItems: 'center', paddingHorizontal: 24 },

  commentCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  commentText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  commentMeta: { fontSize: 11.5, color: colors.muted },

  groupRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12 },
  groupIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: `${colors.primary}22`, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  groupMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: colors.glassPanel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.border, minHeight: 220 },
  modalHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle:   { fontSize: 17, fontWeight: '900', color: colors.text },
  modalClose:   { fontSize: 16, color: colors.muted, fontWeight: '800' },
  listRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  listAvatar:   { width: 40, height: 40, borderRadius: 20 },
  listName:     { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.text },
}));
