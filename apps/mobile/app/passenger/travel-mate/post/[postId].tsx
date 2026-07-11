/**
 * Travel Mate — post detail + comments.
 *
 * Deep-link target for shared posts:
 *   velocity://passenger/travel-mate/post/{postId}
 *
 * Live comments (onSnapshot), like toggle, share, delete-own-comment /
 * delete-own-post. Videos play inline through a WebView (no extra native
 * module needed, so existing builds keep working).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ExpoLinking from 'expo-linking';
import { WebView } from 'react-native-webview';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';

import { db } from '../../../../src/firebase';
import { useAuth } from '../../../../src/auth/AuthContext';
import { api, type TMComment, type TMPost } from '../../../../src/api/client';
import { useBlockedSet } from '../../../../src/hooks/travelMateCommunity';
import { timeAgo } from '../../../../src/lib/timeAgo';
import { colors } from '../../../../src/config';

const PINK = '#E8637A';

/** Minimal dark page hosting a native <video> element. */
function videoHtml(url: string): string {
  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>html,body{margin:0;padding:0;background:#000;height:100%;}
    video{width:100%;height:100%;object-fit:contain;background:#000;}</style>
    </head><body>
    <video src="${url.replace(/"/g, '&quot;')}" controls playsinline preload="metadata"></video>
    </body></html>`;
}

export default function PostDetail() {
  const params = useLocalSearchParams<{ postId: string }>();
  const postId = Array.isArray(params.postId) ? params.postId[0] : params.postId;
  const { user } = useAuth();
  const router = useRouter();
  const blocked = useBlockedSet();

  const [post, setPost] = useState<TMPost | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<TMComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);

  const myUid = user?.uid ?? '';

  // Live post doc (keeps counters fresh)
  useEffect(() => {
    if (!postId) return;
    return onSnapshot(
      doc(db, 'travelMatePosts', postId),
      snap => {
        if (snap.exists()) setPost({ id: snap.id, ...snap.data() } as TMPost);
        else setNotFound(true);
      },
      () => setNotFound(true),
    );
  }, [postId]);

  // My like state
  useEffect(() => {
    if (!postId || !myUid) return;
    getDoc(doc(db, 'travelMatePosts', postId, 'likes', myUid))
      .then(snap => setLiked(snap.exists()))
      .catch(() => {});
  }, [postId, myUid]);

  // Live comments
  useEffect(() => {
    if (!postId) return;
    return onSnapshot(
      query(collection(db, 'travelMatePosts', postId, 'comments'), orderBy('createdAt', 'asc')),
      snap => setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TMComment)),
      () => {},
    );
  }, [postId]);

  const visibleComments = useMemo(
    () => comments.filter(c => !blocked.has(c.authorId)),
    [comments, blocked],
  );

  async function toggleLike() {
    if (!post) return;
    const was = liked;
    setLiked(!was);
    try {
      const res = await api.likeTravelMatePost({ postId: post.id });
      setLiked(res.liked);
    } catch (e: unknown) {
      setLiked(was);
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your TravelMate profile first.');
      }
    }
  }

  async function submitComment() {
    const text = commentText.trim();
    if (!text || !post || sending) return;
    setSending(true);
    try {
      await api.commentTravelMatePost({ postId: post.id, text });
      setCommentText('');
    } catch (e: unknown) {
      if (e instanceof FirebaseError && e.code === 'functions/failed-precondition') {
        Alert.alert('Profile needed', 'Set up your TravelMate profile first.');
      } else if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
        Alert.alert('Unavailable', 'You cannot comment on this post.');
      } else {
        Alert.alert('Error', 'Could not send your comment. Try again.');
      }
    } finally {
      setSending(false);
    }
  }

  function deleteComment(c: TMComment) {
    Alert.alert('Delete comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          api.deleteTravelMateComment({ postId: post!.id, commentId: c.id })
            .catch(() => Alert.alert('Error', 'Could not delete the comment.')),
      },
    ]);
  }

  function sharePost() {
    if (!post) return;
    const link = ExpoLinking.createURL(`/passenger/travel-mate/post/${post.id}`);
    Share.share({
      message:
        `${post.authorName} on Velocity TravelMate:\n\n` +
        `${post.text ? `"${post.text.slice(0, 140)}"\n\n` : ''}` +
        `See the post: ${link}`,
    }).catch(() => {});
  }

  function deletePost() {
    if (!post) return;
    Alert.alert('Delete post?', 'This removes the post, its likes and comments for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteTravelMatePost({ postId: post.id });
            router.back();
          } catch {
            Alert.alert('Error', 'Could not delete the post.');
          }
        },
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
      <Text style={s.title}>Post</Text>
      <Pressable onPress={sharePost} style={s.backBtn}>
        <Text style={{ fontSize: 15 }}>📤</Text>
      </Pressable>
    </View>
  );

  if (notFound || (post && blocked.has(post.authorId))) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}>
          <Text style={{ fontSize: 44 }}>🔗</Text>
          <Text style={s.emptyTitle}>Post unavailable</Text>
          <Text style={s.emptySub}>This post was removed or is not available to you.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={s.safe}>
        {TopBar}
        <View style={s.centerBox}><ActivityIndicator size="large" color={PINK} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {TopBar}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <FlatList
          data={visibleComments}
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={
            <View style={s.postCard}>
              <Pressable
                style={s.postHead}
                onPress={() => router.push(`/passenger/travel-mate/feed-profile/${post.authorId}` as Parameters<typeof router.push>[0])}
              >
                {post.authorPhotoURL ? (
                  <Image source={{ uri: post.authorPhotoURL }} style={s.postAvatar} />
                ) : (
                  <View style={[s.postAvatar, s.avatarFallback]}><Text style={{ fontSize: 18 }}>👤</Text></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.postAuthor}>{post.authorName}</Text>
                  <Text style={s.postMeta}>
                    {post.communityName ? `${post.communityName} · ${post.communityCity}` : 'General'}
                    {post.createdAt ? ` · ${timeAgo(post.createdAt.seconds)}` : ''}
                  </Text>
                </View>
                {post.authorId === myUid && (
                  <Pressable onPress={deletePost} hitSlop={10}>
                    <Text style={{ fontSize: 15 }}>🗑️</Text>
                  </Pressable>
                )}
              </Pressable>

              {post.text ? <Text style={s.postText}>{post.text}</Text> : null}

              {post.mediaType === 'image' && post.mediaURL ? (
                <Image source={{ uri: post.mediaURL }} style={s.postImage} resizeMode="cover" />
              ) : null}

              {post.mediaType === 'video' && post.mediaURL ? (
                <View style={s.videoBox}>
                  <WebView
                    source={{ html: videoHtml(post.mediaURL) }}
                    style={s.video}
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction
                    allowsFullscreenVideo
                    originWhitelist={['*']}
                  />
                </View>
              ) : null}

              <View style={s.postActions}>
                <Pressable style={s.actionGroup} onPress={toggleLike} hitSlop={8}>
                  <Text style={s.actionIcon}>{liked ? '❤️' : '🤍'}</Text>
                  <Text style={[s.actionCount, liked && { color: PINK }]}>
                    {post.likeCount} {post.likeCount === 1 ? 'Like' : 'Likes'}
                  </Text>
                </Pressable>
                <View style={s.actionGroup}>
                  <Text style={s.actionIcon}>💬</Text>
                  <Text style={s.actionCount}>
                    {post.commentCount} {post.commentCount === 1 ? 'Comment' : 'Comments'}
                  </Text>
                </View>
              </View>
              <View style={s.divider} />
            </View>
          }
          ListEmptyComponent={
            <View style={s.emptyComments}>
              <Text style={s.emptySub}>No comments yet — start the conversation!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.commentRow}>
              <Pressable
                onPress={() => router.push(`/passenger/travel-mate/feed-profile/${item.authorId}` as Parameters<typeof router.push>[0])}
              >
                {item.authorPhotoURL ? (
                  <Image source={{ uri: item.authorPhotoURL }} style={s.commentAvatar} />
                ) : (
                  <View style={[s.commentAvatar, s.avatarFallback]}><Text style={{ fontSize: 14 }}>👤</Text></View>
                )}
              </Pressable>
              <View style={s.commentBubble}>
                <View style={s.commentHead}>
                  <Text style={s.commentAuthor}>{item.authorName}</Text>
                  <Text style={s.commentTime}>
                    {item.createdAt ? timeAgo(item.createdAt.seconds) : ''}
                  </Text>
                </View>
                <Text style={s.commentText}>{item.text}</Text>
              </View>
              {(item.authorId === myUid || post.authorId === myUid) && (
                <Pressable onPress={() => deleteComment(item)} hitSlop={10} style={s.commentDelete}>
                  <Text style={{ fontSize: 12 }}>✕</Text>
                </Pressable>
              )}
            </View>
          )}
        />

        {/* Comment composer */}
        <View style={s.composerRow}>
          <TextInput
            style={s.composerInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Write a comment…"
            placeholderTextColor={colors.muted}
            maxLength={1000}
            multiline
          />
          <Pressable
            style={[s.sendBtn, (!commentText.trim() || sending) && { opacity: 0.4 }]}
            onPress={submitComment}
            disabled={!commentText.trim() || sending}
          >
            <Text style={s.sendIcon}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  topBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backText:{ color: colors.text, fontSize: 18, fontWeight: '700' },
  title:   { fontSize: 18, fontWeight: '900', color: colors.text },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle:{ fontSize: 19, fontWeight: '900', color: colors.text },
  emptySub:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },

  listContent: { paddingHorizontal: 16, paddingBottom: 12 },

  postCard:   { gap: 10, paddingBottom: 4 },
  postHead:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postAvatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { backgroundColor: colors.glassChip, alignItems: 'center', justifyContent: 'center' },
  postAuthor: { fontSize: 15, fontWeight: '800', color: colors.text },
  postMeta:   { fontSize: 11, color: PINK, marginTop: 1, fontWeight: '700' },
  postText:   { fontSize: 15, color: colors.text, lineHeight: 22 },
  postImage:  { width: '100%', height: 280, borderRadius: 14, backgroundColor: colors.glassChip },
  videoBox:   { width: '100%', height: 240, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  video:      { flex: 1, backgroundColor: '#000' },
  postActions:{ flexDirection: 'row', alignItems: 'center', gap: 22 },
  actionGroup:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIcon: { fontSize: 17 },
  actionCount:{ fontSize: 13, fontWeight: '700', color: colors.muted },
  divider:    { height: 1, backgroundColor: colors.border, marginTop: 6 },

  emptyComments: { paddingVertical: 24, alignItems: 'center' },

  commentRow:    { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'flex-start' },
  commentAvatar: { width: 34, height: 34, borderRadius: 17 },
  commentBubble: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 },
  commentHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentAuthor: { fontSize: 13, fontWeight: '800', color: colors.text },
  commentTime:   { fontSize: 10.5, color: colors.muted },
  commentText:   { fontSize: 13.5, color: colors.text, lineHeight: 19 },
  commentDelete: { padding: 6 },

  composerRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  composerInput: { flex: 1, minHeight: 42, maxHeight: 110, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn:       { width: 42, height: 42, borderRadius: 21, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center' },
  sendIcon:      { color: '#fff', fontSize: 17, fontWeight: '900' },
});
