/**
 * Awaaz — the half of the job that happens after the post is up.
 *
 * Every couple of hours: read the comments under everything the desk has
 * published lately, work out what each one actually is, and write a reply.
 * Whether that reply is *sent* is a separate decision — `autoReply` is off by
 * default, and it should stay off until you have read a few dozen of them,
 * because a reply is Velocity talking to a customer in public.
 *
 * Three things this deliberately does not do:
 *
 * - It never replies to a comment it read as a safety issue. Those are marked
 *   `escalated`, drafted with a line that points at support, and left for a
 *   person. An automated "sorry to hear that!" under a comment about a driver
 *   is worse than silence.
 * - It never argues. Complaints get an acknowledgement and a route to support,
 *   never a defence of the platform.
 * - It never invents a fact. Same FACTS rule as the writer: if the answer needs
 *   a number nobody gave it, the reply says a human will come back.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { loadCredentials, markAccountError } from './accounts';
import { systemFor } from './crew';
import { generateJson } from './claude';
import { canListComments, listComments, PlatformError, replyToComment } from './platforms';
import { activeTeam, assign, creditWork } from './employees';
import { getSocialSettings } from './settings';
import {
  PLATFORMS,
  type CommentIntent,
  type CommentStatus,
  type Platform,
  type SocialComment,
  type SocialPost,
  type SocialSettings,
} from './types';

/** How far back to keep pulling comments. Older posts stop getting new ones. */
const LOOKBACK_DAYS = 14;
/** How many comments one drafting call handles. Enough context, one bill. */
const DRAFT_BATCH = 12;

const commentId = (platform: Platform, id: string) => `${platform}_${id.replace(/\//g, '-')}`;
const commentRef = (platform: Platform, id: string) => db.doc(`socialComments/${commentId(platform, id)}`);

/** Everything this desk has published lately, as network media ids per network. */
async function recentlyPublished(): Promise<Map<Platform, { mediaId: string; postId: string }[]>> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
  const snap = await db.collection('socialPosts').where('date', '>=', since).get();

  const byPlatform = new Map<Platform, { mediaId: string; postId: string }[]>();
  for (const doc of snap.docs) {
    const post = doc.data() as SocialPost;
    for (const platform of PLATFORMS) {
      const result = post.results?.[platform];
      if (!result?.ok || !result.id) continue;
      const list = byPlatform.get(platform) ?? [];
      list.push({ mediaId: result.id, postId: doc.id });
      byPlatform.set(platform, list);
    }
  }
  return byPlatform;
}

/**
 * Pull new comments in. Existing rows are left exactly as they are — a comment
 * someone has already answered must not reappear as unread because the sync ran
 * again.
 */
export async function syncComments(): Promise<{ found: number; added: number; errors: string[] }> {
  const published = await recentlyPublished();
  const errors: string[] = [];
  let found = 0;
  let added = 0;

  for (const [platform, media] of published) {
    if (!canListComments(platform)) continue;
    const credentials = await loadCredentials(platform);
    if (!credentials) continue;

    for (const item of media.slice(0, 30)) {
      let comments;
      try {
        comments = await listComments(platform, credentials, item.mediaId);
      } catch (e) {
        const message = e instanceof PlatformError ? e.message : (e as Error).message;
        errors.push(`${platform}: ${message}`);
        if (/token|expired|permission|oauth|scope/i.test(message)) await markAccountError(platform, message);
        continue;
      }

      for (const comment of comments) {
        found++;
        const ref = commentRef(platform, comment.commentId);
        if ((await ref.get()).exists) continue;

        const row: SocialComment = {
          id: commentId(platform, comment.commentId),
          platform,
          mediaId: comment.mediaId,
          postId: item.postId,
          commentId: comment.commentId,
          authorName: comment.authorName.slice(0, 120),
          text: comment.text.slice(0, 2000),
          permalink: comment.permalink,
          createdAtMs: comment.createdAtMs,
          status: 'new',
          intent: null,
          draftReply: null,
          draftedBy: null,
          sentReply: null,
          sentAtMs: null,
          error: null,
        };
        await ref.set({ ...row, syncedAt: FieldValue.serverTimestamp() });
        added++;
      }
    }
  }

  return { found, added, errors };
}

const DRAFT_SYSTEM = `You are answering comments on Velocity's own social accounts.

Read each comment, decide what it is, and write the reply Velocity should post.

How to classify:
- "praise" — they like it. Reply warmly, one line, no sales pitch.
- "question" — they want to know something. Answer it plainly if the answer is in the brief; otherwise say a human will follow up.
- "complaint" — something went wrong for them. Acknowledge it, do not argue, do not explain the policy, point them at support. One or two lines.
- "safety" — anything about an accident, harassment, a threat, a woman feeling unsafe, a crash, the police. Never defend, never minimise. One short line saying we want the trip details and that support is on it.
- "spam" — promotion, scam links, unrelated nonsense. Reply with an empty string.
- "other" — anything else.

How to write:
- Reply in the language the comment is in. Roman Urdu gets Roman Urdu.
- Under 30 words. Nobody reads a paragraph in a comment thread.
- Sound like a person who works here, not a support macro. No "Dear valued customer".
- Never promise a refund, a fare, an earning figure, or a date.
- Never quote a number that is not in the FACTS block.

Reply with one JSON object and nothing else:
{ "replies": [{ "id": "the comment id you were given", "intent": "praise|question|complaint|safety|spam|other", "reply": "what to post, or an empty string for spam" }] }`;

const INTENTS: CommentIntent[] = ['praise', 'question', 'complaint', 'safety', 'spam', 'other'];

/** Write replies for everything unread. Sends them only when told to. */
export async function draftReplies(
  settings: SocialSettings,
): Promise<{ drafted: number; sent: number; failed: number; by: string | null }> {
  // Whoever is on the social desk answers. With nobody hired into it, nothing
  // is drafted at all — an unanswered comment is better than one answered by
  // a system with no name against it.
  const manager = assign(await activeTeam(), 'distribute')?.employee ?? null;
  if (!manager) return { drafted: 0, sent: 0, failed: 0, by: null };

  const snap = await db
    .collection('socialComments')
    .where('status', '==', 'new')
    .limit(DRAFT_BATCH * 3)
    .get();
  if (snap.empty) return { drafted: 0, sent: 0, failed: 0, by: manager.name };

  const rows = snap.docs.map((d) => d.data() as SocialComment);
  let drafted = 0;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += DRAFT_BATCH) {
    const batch = rows.slice(i, i + DRAFT_BATCH);

    let replies: { id?: unknown; intent?: unknown; reply?: unknown }[] = [];
    try {
      const { data } = await generateJson<{ replies?: unknown }>({
        model: settings.textModel,
        system: `${systemFor(manager, settings)}\n\n${DRAFT_SYSTEM}`,
        what: 'The comment replies',
        prompt: [
          'COMMENTS:',
          ...batch.map((c) => `- id: ${c.id}\n  network: ${c.platform}\n  from: ${c.authorName}\n  said: ${c.text}`),
        ].join('\n'),
      });
      replies = Array.isArray(data.replies) ? (data.replies as typeof replies) : [];
    } catch (e) {
      logger.error('social: could not draft comment replies', { message: (e as Error).message });
      continue;
    }

    for (const row of batch) {
      const match = replies.find((r) => typeof r.id === 'string' && r.id === row.id);
      const intent = INTENTS.includes(match?.intent as CommentIntent) ? (match!.intent as CommentIntent) : 'other';
      const reply = typeof match?.reply === 'string' ? match.reply.trim().slice(0, 500) : '';

      // Spam is closed, safety is escalated, everything else is drafted. The
      // status is what decides whether autoReply is even allowed to look at it.
      let status: CommentStatus = 'drafted';
      if (intent === 'spam' || !reply) status = 'ignored';
      else if (intent === 'safety') status = 'escalated';

      await commentRef(row.platform, row.commentId).set(
        {
          intent,
          draftReply: reply || null,
          draftedBy: manager.name,
          status,
          draftedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      drafted++;

      if (status === 'drafted' && settings.autoReply) {
        const result = await sendReply(row.platform, row.commentId, reply);
        if (result.ok) sent++;
        else failed++;
      }
    }
  }

  if (drafted > 0) await creditWork(manager.id);
  return { drafted, sent, failed, by: manager.name };
}

/** Post one reply. Used by the scheduler and by the console's Send button. */
export async function sendReply(
  platform: Platform,
  networkCommentId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const ref = commentRef(platform, networkCommentId);
  const credentials = await loadCredentials(platform);
  if (!credentials) {
    await ref.set({ error: 'That account is not connected.' }, { merge: true });
    return { ok: false, error: 'That account is not connected.' };
  }

  try {
    await replyToComment(platform, credentials, networkCommentId, text);
    await ref.set(
      {
        status: 'replied' as CommentStatus,
        sentReply: text,
        sentAtMs: Date.now(),
        error: null,
        repliedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  } catch (e) {
    const message = e instanceof PlatformError ? e.message : (e as Error).message;
    logger.error('social: reply failed', { platform, message });
    await ref.set({ error: message.slice(0, 400) }, { merge: true });
    if (/token|expired|permission|oauth|scope/i.test(message)) await markAccountError(platform, message);
    return { ok: false, error: message };
  }
}

/** One pass of the inbox: pull, read, draft, and send if that is switched on. */
export async function runEngagement(): Promise<string> {
  const settings = await getSocialSettings();
  if (!settings.engagementEnabled) return 'Engagement is off.';

  const sync = await syncComments();
  const drafts = await draftReplies(settings);

  const summary = [
    `${sync.added} new comment${sync.added === 1 ? '' : 's'} of ${sync.found} read`,
    drafts.by ? `${drafts.drafted} drafted by ${drafts.by}` : 'nobody on the social desk to draft replies',
    settings.autoReply ? `${drafts.sent} sent, ${drafts.failed} failed` : 'replies held for approval',
    sync.errors.length ? `errors: ${sync.errors.slice(0, 3).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  await db.doc('system/socialAutomation').set(
    { lastEngagementAtMs: Date.now(), lastEngagementStatus: summary.slice(0, 300) },
    { merge: true },
  );
  return summary;
}

/**
 * Every two hours. Comments do not need to be answered in ten seconds, and a
 * schedule that reads seven inboxes every minute is a bill, not a feature.
 */
export const socialEngagement = onSchedule(
  {
    schedule: '0 */2 * * *',
    timeZone: 'Asia/Karachi',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const settings = await getSocialSettings();
    if (!settings.enabled || !settings.engagementEnabled) return;
    try {
      const summary = await runEngagement();
      logger.info('social: engagement pass finished', { summary });
    } catch (e) {
      logger.error('social: engagement pass failed', { message: (e as Error).message });
    }
  },
);

// ── console actions ─────────────────────────────────────────────────────────

/** "Check the comments now" — the same pass the scheduler does, on demand. */
export const adminSyncSocialComments = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (req) => {
    requireAdmin(req);
    const summary = await runEngagement();
    return { ok: true, summary };
  },
);

/**
 * Send a reply. The text is whatever is in the box — Awaaz's draft, or the
 * admin's rewrite of it — because the person who has to stand behind the reply
 * should be the one choosing its words.
 */
export const adminReplySocialComment = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      platform: z.enum(PLATFORMS),
      commentId: z.string().min(1).max(200),
      text: z.string().min(1).max(500),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const result = await sendReply(parsed.data.platform, parsed.data.commentId, parsed.data.text);
  if (!result.ok) throw new HttpsError('internal', result.error ?? 'The network refused the reply.');
  return { ok: true };
});

/** Close a comment without answering it — spam, or something already handled. */
export const adminSetCommentStatus = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      platform: z.enum(PLATFORMS),
      commentId: z.string().min(1).max(200),
      status: z.enum(['new', 'drafted', 'ignored', 'escalated']),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  await commentRef(parsed.data.platform, parsed.data.commentId).set(
    { status: parsed.data.status, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true };
});
