/**
 * Velocity — Travel Partner — Admin community moderation (callable, v2)
 * ----------------------------------------------------------------------------
 * Full admin CRUD over the community feed, complementing the user-facing CFs
 * (deleteTravelMatePost / deleteTravelMateComment already honour the admin
 * role for deletes):
 *
 * adminUpdateTravelMatePost      — edit/censor a post's text.
 * adminUpsertTravelMateCommunity — create a community, or update an existing
 *                                  one's name / city / description.
 * adminDeleteTravelMateCommunity — delete a community; its posts are detached
 *                                  back into the general feed (user content is
 *                                  not destroyed).
 *
 * All entry points require the admin custom claim. Reads happen directly from
 * the dashboard (rules allow signed-in reads on posts/communities).
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

function requireAdmin(req: CallableRequest): void {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (req.auth.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
}

// ---------------------------------------------------------------------------
const UpdatePostInput = z.object({
  postId: z.string().min(1).max(128),
  text: z.string().trim().max(2000),
});

export const adminUpdateTravelMatePost = onCall({ region: REGION }, async (req: CallableRequest) => {
  requireAdmin(req);
  const parsed = UpdatePostInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid post update.');

  const ref = db.doc(`travelMatePosts/${parsed.data.postId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');

  await ref.update({
    text: parsed.data.text,
    editedByAdmin: true,
    editedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { updated: true };
});

// ---------------------------------------------------------------------------
const UpsertCommunityInput = z.object({
  communityId: z.string().min(1).max(128).optional(),
  name: z.string().trim().min(3).max(48),
  city: z.string().trim().min(2).max(48),
  description: z.string().trim().max(300).optional(),
});

export const adminUpsertTravelMateCommunity = onCall({ region: REGION }, async (req: CallableRequest) => {
  requireAdmin(req);
  const parsed = UpsertCommunityInput.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'A community needs a name (3–48 chars) and a city.');
  }
  const { communityId, name, city, description } = parsed.data;

  if (communityId) {
    const ref = db.doc(`travelMateCommunities/${communityId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Community not found.');
    await ref.update({
      name,
      nameLower: name.toLowerCase(),
      city,
      ...(description !== undefined ? { description } : {}),
    });
    // Keep the denormalised community name/city on its posts in sync.
    await detachOrRetagPosts(communityId, { communityName: name, communityCity: city });
    return { communityId, created: false };
  }

  const ref = db.collection('travelMateCommunities').doc();
  await ref.set({
    name,
    nameLower: name.toLowerCase(),
    city,
    description: description ?? '',
    createdBy: req.auth!.uid,
    creatorName: 'Velocity Team',
    members: [],
    memberCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastPostAt: null,
  });
  return { communityId: ref.id, created: true };
});

// ---------------------------------------------------------------------------
const DeleteCommunityInput = z.object({ communityId: z.string().min(1).max(128) });

export const adminDeleteTravelMateCommunity = onCall({ region: REGION }, async (req: CallableRequest) => {
  requireAdmin(req);
  const parsed = DeleteCommunityInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { communityId } = parsed.data;

  const ref = db.doc(`travelMateCommunities/${communityId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Community not found.');

  // Posts survive in the general feed — only the community tag is removed.
  const detached = await detachOrRetagPosts(communityId, {
    communityId: null, communityName: null, communityCity: null,
  });
  await ref.delete();
  return { deleted: true, postsDetached: detached };
});

/** Applies a patch to every post tagged with the community, in pages of 300. */
async function detachOrRetagPosts(
  communityId: string,
  patch: Record<string, string | null>,
): Promise<number> {
  let total = 0;
  // Loop until no tagged posts remain. When the patch clears communityId the
  // same query naturally drains; when retagging, paginate by document ID.
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('travelMatePosts')
      .where('communityId', '==', communityId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(300);
    if (lastDoc) q = q.startAfter(lastDoc);
    const page = await q.get();
    if (page.empty) break;
    const batch = db.batch();
    page.docs.forEach(d => batch.update(d.ref, patch));
    await batch.commit();
    total += page.size;
    lastDoc = page.docs[page.docs.length - 1];
    if (page.size < 300) break;
  }
  return total;
}
