/**
 * Velocity — Travel Mate — Community feed (callable, v2)
 * ----------------------------------------------------------------------------
 * The social layer of TravelMate: a public feed where riders post text,
 * photos and short videos, follow each other, and gather in city-pinned
 * community groups.
 *
 * createTravelMatePost      — publish a post (text + optional image/video)
 *                             to the general feed or into a city community.
 * deleteTravelMatePost      — author (or admin) removes a post + its media,
 *                             likes and comments.
 * likeTravelMatePost        — toggle a like; the like counter is maintained
 *                             here in a transaction (server-authoritative).
 * commentTravelMatePost     — add a comment; bumps commentCount + pushes FCM
 *                             to the post author.
 * deleteTravelMateComment   — comment author or post author removes a comment.
 * createTravelMateCommunity — start a community group. A CITY IS REQUIRED so
 *                             everyone always sees which city a group belongs to.
 * joinTravelMateCommunity   — join a community (any profile holder).
 * leaveTravelMateCommunity  — leave a community.
 * openTravelMateFeedChat    — open (or reuse) a private 1:1 chat with another
 *                             community member. Reuses the travelMateMatches
 *                             chat infrastructure so the existing chat screen
 *                             and sendTravelMateMessage CF work unchanged.
 * blockTravelMateUser       — block someone: closes any open chat, removes the
 *                             follow edges both ways, and the blocker never
 *                             sees them again (feed/search/discover filter on
 *                             the block list).
 * unblockTravelMateUser     — remove a block from the "Blocked users" screen.
 *
 * Identity wall: only travelMate* collections (+ read-only FCM token lookup).
 *
 * Wire-up (index.ts):
 *   export {
 *     createTravelMatePost, deleteTravelMatePost, likeTravelMatePost,
 *     commentTravelMatePost, deleteTravelMateComment,
 *     createTravelMateCommunity, joinTravelMateCommunity, leaveTravelMateCommunity,
 *     openTravelMateFeedChat,
 *   } from './travelMate/community';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { randomUUID } from 'crypto';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

function pairId(a: string, b: string): string { return [a, b].sort().join('_'); }

/** Best-effort push. Same token layout as social.ts / groupChat.ts. */
async function pushTo(uid: string, title: string, body: string, data: Record<string, string>) {
  try {
    const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
    const tokens: string[] = tokensSnap.docs
      .map(d => (d.data() as { token: string }).token)
      .filter(Boolean);
    if (!tokens.length) return;
    await admin.messaging().sendEachForMulticast({ tokens, notification: { title, body }, data });
  } catch (e) { console.error('pushTo failed', uid, e); }
}

interface ProfileInfo { displayName: string; photoURL: string | null }

/** Loads the caller's TravelMate profile or throws — every community action
 *  requires the unified TravelMate profile to exist first. */
async function requireProfile(uid: string): Promise<ProfileInfo> {
  const snap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'Set up your TravelMate profile first.');
  }
  const d = snap.data()!;
  return { displayName: (d.displayName as string) ?? 'Member', photoURL: (d.photoURL as string) ?? null };
}

/** Throws if either user has blocked the other. The generic message never
 *  reveals which side placed the block. */
export async function assertNotBlocked(a: string, b: string): Promise<void> {
  const [ab, ba] = await Promise.all([
    db.doc(`travelMateBlocks/${a}_${b}`).get(),
    db.doc(`travelMateBlocks/${b}_${a}`).get(),
  ]);
  if (ab.exists || ba.exists) {
    throw new HttpsError('permission-denied', 'This user is unavailable.');
  }
}

// ---------------------------------------------------------------------------
// createTravelMatePost
// ---------------------------------------------------------------------------
// Optional fields are nullish, not optional: the mobile Firebase SDK encodes
// absent optional fields as null on the wire, which plain .optional() rejects.
const CreatePostInput = z.object({
  text: z.string().trim().max(2000).default(''),
  // Image travels as base64 through the callable (proven RN-safe path, ~6 MB).
  imageBase64: z.string().min(10).max(8_000_000).nullish(),
  // Videos are uploaded by the client straight to Storage (rules-capped at
  // 50 MB, video/* only); the post only carries the storage path.
  videoPath: z.string().min(1).max(512).nullish(),
  communityId: z.string().min(1).max(128).nullish(),
}).refine(v => !(v.imageBase64 && v.videoPath), { message: 'Attach an image OR a video, not both.' });

export const createTravelMatePost = onCall(
  { region: REGION, maxInstances: 10 },
  async (req: CallableRequest) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const parsed = CreatePostInput.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid post data.');
    const { text, imageBase64, videoPath, communityId } = parsed.data;

    if (!text && !imageBase64 && !videoPath) {
      throw new HttpsError('invalid-argument', 'A post needs text, a photo or a video.');
    }

    const author = await requireProfile(uid);

    // Community posts: must be a member; denormalise name + city onto the post
    // so feed cards always show which city group a post belongs to.
    let communityName: string | null = null;
    let communityCity: string | null = null;
    if (communityId) {
      const commSnap = await db.doc(`travelMateCommunities/${communityId}`).get();
      if (!commSnap.exists) throw new HttpsError('not-found', 'Community not found.');
      const comm = commSnap.data()!;
      if (!(comm.members as string[] ?? []).includes(uid)) {
        throw new HttpsError('permission-denied', 'Join this community before posting in it.');
      }
      communityName = (comm.name as string) ?? null;
      communityCity = (comm.city as string) ?? null;
    }

    const postRef = db.collection('travelMatePosts').doc();
    const bucket = admin.storage().bucket();

    let mediaType: 'image' | 'video' | null = null;
    let mediaURL: string | null = null;

    if (imageBase64) {
      const path = `travelMateFeedMedia/${uid}/${postRef.id}.jpg`;
      const token = randomUUID();
      await bucket.file(path).save(Buffer.from(imageBase64, 'base64'), {
        metadata: {
          contentType: 'image/jpeg',
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
      mediaType = 'image';
      mediaURL =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
        `/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    } else if (videoPath) {
      // The client may only attach videos from its own upload folder.
      if (!videoPath.startsWith(`travelMateFeedVideos/${uid}/`) || videoPath.includes('..')) {
        throw new HttpsError('permission-denied', 'Invalid video path.');
      }
      const file = bucket.file(videoPath);
      const [exists] = await file.exists();
      if (!exists) throw new HttpsError('not-found', 'Uploaded video not found. Try again.');
      // Ensure a download token exists, then build the permanent URL.
      const [meta] = await file.getMetadata();
      let token = (meta.metadata?.firebaseStorageDownloadTokens as string | undefined)?.split(',')[0];
      if (!token) {
        token = randomUUID();
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
      }
      mediaType = 'video';
      mediaURL =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
        `/o/${encodeURIComponent(videoPath)}?alt=media&token=${token}`;
    }

    await postRef.set({
      authorId: uid,
      authorName: author.displayName,
      authorPhotoURL: author.photoURL,
      text,
      mediaType,
      mediaURL,
      videoPath: videoPath ?? null,
      communityId: communityId ?? null,
      communityName,
      communityCity,
      likeCount: 0,
      commentCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (communityId) {
      db.doc(`travelMateCommunities/${communityId}`)
        .update({ lastPostAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
    }

    return { postId: postRef.id, mediaURL, mediaType };
  },
);

// ---------------------------------------------------------------------------
// deleteTravelMatePost
// ---------------------------------------------------------------------------
const DeletePostInput = z.object({ postId: z.string().min(1).max(128) });

export const deleteTravelMatePost = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = DeletePostInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const postRef = db.doc(`travelMatePosts/${parsed.data.postId}`);
  const snap = await postRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
  const post = snap.data()!;
  const isAdmin = req.auth.token?.role === 'admin';
  if (post.authorId !== uid && !isAdmin) {
    throw new HttpsError('permission-denied', 'You can only delete your own posts.');
  }

  // Media clean-up is best-effort — the post doc is the source of truth.
  const bucket = admin.storage().bucket();
  if (post.mediaType === 'image') {
    bucket.file(`travelMateFeedMedia/${post.authorId}/${postRef.id}.jpg`).delete().catch(() => {});
  } else if (post.mediaType === 'video' && typeof post.videoPath === 'string' && post.videoPath) {
    bucket.file(post.videoPath).delete().catch(() => {});
  }

  // Removes the post together with its likes/comments subcollections.
  await db.recursiveDelete(postRef);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// likeTravelMatePost — toggle
// ---------------------------------------------------------------------------
const LikeInput = z.object({ postId: z.string().min(1).max(128) });

export const likeTravelMatePost = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = LikeInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const me = await requireProfile(uid);
  const postRef = db.doc(`travelMatePosts/${parsed.data.postId}`);
  const likeRef = postRef.collection('likes').doc(uid);

  const preSnap = await postRef.get();
  if (!preSnap.exists) throw new HttpsError('not-found', 'Post not found.');
  await assertCanTouchPost(uid, preSnap.data()!.authorId as string);

  const result = await db.runTransaction(async (tx) => {
    const [postSnap, likeSnap] = await Promise.all([tx.get(postRef), tx.get(likeRef)]);
    if (!postSnap.exists) throw new HttpsError('not-found', 'Post not found.');
    const current: number = postSnap.data()!.likeCount ?? 0;
    if (likeSnap.exists) {
      tx.delete(likeRef);
      tx.update(postRef, { likeCount: Math.max(0, current - 1) });
      return { liked: false, likeCount: Math.max(0, current - 1), authorId: postSnap.data()!.authorId as string };
    }
    tx.set(likeRef, {
      uid,
      postId: postRef.id,
      likerName: me.displayName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(postRef, { likeCount: current + 1 });
    return { liked: true, likeCount: current + 1, authorId: postSnap.data()!.authorId as string };
  });

  if (result.liked && result.authorId !== uid) {
    await pushTo(result.authorId, 'New like ❤️', `${me.displayName} liked your post.`, {
      type: 'travelMate.postLike', postId: parsed.data.postId,
    });
  }

  return { liked: result.liked, likeCount: result.likeCount };
});

// Blocked users cannot interact with each other's posts.
async function assertCanTouchPost(uid: string, postAuthorId: string): Promise<void> {
  if (postAuthorId && postAuthorId !== uid) await assertNotBlocked(uid, postAuthorId);
}

// ---------------------------------------------------------------------------
// commentTravelMatePost
// ---------------------------------------------------------------------------
const CommentInput = z.object({
  postId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(1000),
});

export const commentTravelMatePost = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = CommentInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid comment.');
  const { postId, text } = parsed.data;

  const me = await requireProfile(uid);
  const postRef = db.doc(`travelMatePosts/${postId}`);
  const commentRef = postRef.collection('comments').doc();

  const preSnap = await postRef.get();
  if (!preSnap.exists) throw new HttpsError('not-found', 'Post not found.');
  await assertCanTouchPost(uid, preSnap.data()!.authorId as string);

  const authorId = await db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists) throw new HttpsError('not-found', 'Post not found.');
    tx.set(commentRef, {
      postId,
      authorId: uid,
      authorName: me.displayName,
      authorPhotoURL: me.photoURL,
      text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(postRef, { commentCount: (postSnap.data()!.commentCount ?? 0) + 1 });
    return postSnap.data()!.authorId as string;
  });

  if (authorId !== uid) {
    await pushTo(authorId, `${me.displayName} commented 💬`, text.slice(0, 120), {
      type: 'travelMate.postComment', postId,
    });
  }

  return { commentId: commentRef.id };
});

// ---------------------------------------------------------------------------
// deleteTravelMateComment
// ---------------------------------------------------------------------------
const DeleteCommentInput = z.object({
  postId: z.string().min(1).max(128),
  commentId: z.string().min(1).max(128),
});

export const deleteTravelMateComment = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = DeleteCommentInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { postId, commentId } = parsed.data;

  const postRef = db.doc(`travelMatePosts/${postId}`);
  const commentRef = postRef.collection('comments').doc(commentId);

  await db.runTransaction(async (tx) => {
    const [postSnap, commentSnap] = await Promise.all([tx.get(postRef), tx.get(commentRef)]);
    if (!postSnap.exists) throw new HttpsError('not-found', 'Post not found.');
    if (!commentSnap.exists) throw new HttpsError('not-found', 'Comment not found.');
    const isAdmin = req.auth!.token?.role === 'admin';
    const canDelete = commentSnap.data()!.authorId === uid
      || postSnap.data()!.authorId === uid
      || isAdmin;
    if (!canDelete) throw new HttpsError('permission-denied', 'Not your comment.');
    tx.delete(commentRef);
    tx.update(postRef, { commentCount: Math.max(0, (postSnap.data()!.commentCount ?? 0) - 1) });
  });

  return { deleted: true };
});

// ---------------------------------------------------------------------------
// createTravelMateCommunity — city is REQUIRED
// ---------------------------------------------------------------------------
const CreateCommunityInput = z.object({
  name: z.string().trim().min(3).max(48),
  city: z.string().trim().min(2).max(48),
  description: z.string().trim().max(300).optional(),
});

export const createTravelMateCommunity = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = CreateCommunityInput.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'A community needs a name (3–48 chars) and a city.');
  }
  const { name, city, description } = parsed.data;

  const creator = await requireProfile(uid);

  // One community per (city, name) — avoids ten identical "Lahore Travellers".
  const dupSnap = await db.collection('travelMateCommunities')
    .where('city', '==', city)
    .where('nameLower', '==', name.toLowerCase())
    .limit(1)
    .get();
  if (!dupSnap.empty) {
    throw new HttpsError('already-exists', `A community named "${name}" already exists in ${city}.`);
  }

  const ref = db.collection('travelMateCommunities').doc();
  await ref.set({
    name,
    nameLower: name.toLowerCase(),
    city,
    description: description ?? '',
    createdBy: uid,
    creatorName: creator.displayName,
    members: [uid],
    memberCount: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastPostAt: null,
  });
  return { communityId: ref.id };
});

// ---------------------------------------------------------------------------
// joinTravelMateCommunity / leaveTravelMateCommunity
// ---------------------------------------------------------------------------
const CommunityIdInput = z.object({ communityId: z.string().min(1).max(128) });

export const joinTravelMateCommunity = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = CommunityIdInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  await requireProfile(uid);
  const ref = db.doc(`travelMateCommunities/${parsed.data.communityId}`);

  const joined = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Community not found.');
    const members: string[] = snap.data()!.members ?? [];
    if (members.includes(uid)) return false;
    tx.update(ref, {
      members: admin.firestore.FieldValue.arrayUnion(uid),
      memberCount: members.length + 1,
    });
    return true;
  });

  return { joined: true, alreadyMember: !joined };
});

export const leaveTravelMateCommunity = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = CommunityIdInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const ref = db.doc(`travelMateCommunities/${parsed.data.communityId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Community not found.');
    const members: string[] = snap.data()!.members ?? [];
    if (!members.includes(uid)) return;
    tx.update(ref, {
      members: admin.firestore.FieldValue.arrayRemove(uid),
      memberCount: Math.max(0, members.length - 1),
    });
  });

  return { left: true };
});

// ---------------------------------------------------------------------------
// openTravelMateFeedChat — DM a fellow community user without a swipe match
// ---------------------------------------------------------------------------
const FeedChatInput = z.object({ targetUid: z.string().min(1).max(128) });

export const openTravelMateFeedChat = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = FeedChatInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { targetUid } = parsed.data;
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'You cannot chat with yourself.');

  await assertNotBlocked(uid, targetUid);

  const matchRef = db.doc(`travelMateMatches/${pairId(uid, targetUid)}`);
  const matchSnap = await matchRef.get();
  if (matchSnap.exists) {
    if ((matchSnap.data()!.status ?? 'active') !== 'active') {
      throw new HttpsError('failed-precondition', 'This conversation was closed.');
    }
    return { matchId: matchRef.id, created: false };
  }

  // Both sides must hold a TravelMate profile — messaging is a community
  // feature, and requireProfile keeps ride-only accounts out of DMs.
  const me = await requireProfile(uid);
  const targetSnap = await db.doc(`travelMateProfiles/${targetUid}`).get();
  if (!targetSnap.exists) {
    throw new HttpsError('failed-precondition', 'This user is not on TravelMate yet.');
  }
  const target = targetSnap.data()!;

  await matchRef.set({
    users: [uid, targetUid].sort(),
    userInfo: {
      [uid]: { displayName: me.displayName, photoURL: me.photoURL },
      [targetUid]: {
        displayName: (target.displayName as string) ?? 'Member',
        photoURL: (target.photoURL as string) ?? null,
      },
    },
    status: 'active',
    origin: 'feed',
    matchedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessage: null,
    lastMessageAt: null,
  });

  await pushTo(targetUid, 'New message request 💬', `${me.displayName} wants to chat with you on TravelMate.`, {
    type: 'travelMate.feedChat', matchId: matchRef.id,
  });

  return { matchId: matchRef.id, created: true };
});

// ---------------------------------------------------------------------------
// blockTravelMateUser / unblockTravelMateUser
// ---------------------------------------------------------------------------
const BlockInput = z.object({ targetUid: z.string().min(1).max(128) });

export const blockTravelMateUser = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = BlockInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { targetUid } = parsed.data;
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'You cannot block yourself.');

  // Denormalise the target's name/photo so the "Blocked users" screen renders
  // without extra reads (and still works if they later delete their profile).
  const targetSnap = await db.doc(`travelMateProfiles/${targetUid}`).get();
  const target = targetSnap.exists ? targetSnap.data()! : {};

  const batch = db.batch();
  batch.set(db.doc(`travelMateBlocks/${uid}_${targetUid}`), {
    blockerId: uid,
    blockedId: targetUid,
    blockedName: (target.displayName as string) ?? 'User',
    blockedPhotoURL: (target.photoURL as string) ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Sever the social graph both ways.
  batch.delete(db.doc(`travelMateFollows/${uid}_${targetUid}`));
  batch.delete(db.doc(`travelMateFollows/${targetUid}_${uid}`));
  await batch.commit();

  // Close any open chat/match so neither side can keep messaging.
  const matchRef = db.doc(`travelMateMatches/${pairId(uid, targetUid)}`);
  const matchSnap = await matchRef.get();
  if (matchSnap.exists && (matchSnap.data()!.status ?? 'active') === 'active') {
    await matchRef.update({
      status: 'unmatched',
      unmatchedBy: uid,
      unmatchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { blocked: true };
});

export const unblockTravelMateUser = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = BlockInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  await db.doc(`travelMateBlocks/${uid}_${parsed.data.targetUid}`).delete();
  return { unblocked: true };
});

