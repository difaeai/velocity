/**
 * The daily run — the thing that replaces a writer, an editor and a social
 * media manager.
 *
 *   trigger ─► script (Claude) ─► video (Veo) ─► approval? ─► publish
 *
 * A tick fires every hour and does nothing unless (a) automation is on, (b) the
 * Pakistan hour matches `runHour`, and (c) today has no post yet. Hourly rather
 * than a fixed cron so `runHour` can be changed from the console without
 * redeploying, and idempotent on the date so a retried tick cannot post twice.
 *
 * Each stage writes its outcome to the post document before the next begins, so
 * a failure halfway through leaves a post you can look at and retry rather than
 * a silent gap in the calendar. The whole run is deliberately allowed to end at
 * `awaiting_approval`: with `requireApproval` on — the default — nothing reaches
 * a real audience until a human has read it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { dayKey } from '../analytics';
import { loadCredentials, markAccountError } from './accounts';
import { PlatformError, publishTo } from './platforms';
import { draftPost, gatherFacts, videoPrompt, writerConfigured } from './script';
import { getSocialSettings, nextAngle, recordRun } from './settings';
import { refreshVideoUrl, renderVideo, storeVideo, VideoError } from './video';
import { PLATFORMS, VIDEO_CAPABLE, type Platform, type PostStatus, type SocialPost } from './types';

const REGION = 'asia-south1';
/** Rendering a video takes minutes, so the run needs room. */
const RUN_TIMEOUT_SECONDS = 900;

const postRef = (id: string) => db.doc(`socialPosts/${id}`);

async function patch(id: string, fields: Record<string, unknown>): Promise<void> {
  await postRef(id).set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** The hooks of the last fortnight, so the writer doesn't repeat itself. */
async function recentHooks(): Promise<string[]> {
  const snap = await db.collection('socialPosts').orderBy('date', 'desc').limit(14).get();
  return snap.docs
    .map((d) => (d.data() as SocialPost).script?.hook)
    .filter((h): h is string => typeof h === 'string' && h.length > 0);
}

/** Draft the script and, if a provider is configured, render the video. */
async function createPost(opts: { date: string; angle?: string; targets?: Platform[] }): Promise<string> {
  const settings = await getSocialSettings();
  const angle = opts.angle ?? (await nextAngle(settings));
  const id = opts.date;

  const targets = (opts.targets ?? settings.platforms).filter((p) => PLATFORMS.includes(p));

  await postRef(id).set({
    id,
    date: opts.date,
    angle,
    status: 'drafting' as PostStatus,
    script: null,
    caption: '',
    hashtags: [],
    facts: {},
    video: null,
    targets,
    results: {},
    error: null,
    approvedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    publishedAt: null,
  });

  let draft;
  try {
    const facts = await gatherFacts();
    draft = await draftPost({
      angle,
      facts,
      brandVoice: settings.brandVoice,
      recentHooks: await recentHooks(),
    });
    await patch(id, {
      script: draft.script,
      caption: `${draft.caption}\n\n${draft.hashtags.map((h) => `#${h}`).join(' ')}`.trim(),
      hashtags: draft.hashtags,
      facts,
    });
  } catch (e) {
    await patch(id, { status: 'failed', error: `Script: ${(e as Error).message}` });
    throw e;
  }

  if (settings.videoProvider === 'none') {
    // No renderer configured — the script is the deliverable, and someone
    // attaches a file before this can go anywhere.
    await patch(id, { status: 'awaiting_approval' });
    return id;
  }

  await patch(id, { status: 'rendering' });
  try {
    const video = await renderVideo({
      postId: id,
      prompt: videoPrompt(draft.script, settings.aspect),
      settings,
    });
    await patch(id, {
      video,
      status: settings.requireApproval ? 'awaiting_approval' : 'ready',
    });
  } catch (e) {
    const message = e instanceof VideoError ? e.message : (e as Error).message;
    await patch(id, { status: 'failed', error: `Video: ${message}` });
    throw e;
  }

  return id;
}

/** Post one finished video everywhere it is meant to go. */
async function publishPost(id: string, only?: Platform[]): Promise<{ published: number; failed: number }> {
  const snap = await postRef(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such post.');
  const post = snap.data() as SocialPost;

  if (!post.video?.url) {
    throw new HttpsError(
      'failed-precondition',
      'That post has no video yet. Render one, or attach a file, before publishing.',
    );
  }

  // Signed URLs age out; a post retried a week later needs a fresh one.
  const video = await refreshVideoUrl(post.video);
  if (video.url !== post.video.url) await patch(id, { video });

  const targets = (only ?? post.targets).filter((p) => VIDEO_CAPABLE.includes(p));
  if (!targets.length) {
    throw new HttpsError('failed-precondition', 'None of the selected networks can take a video post.');
  }

  await patch(id, { status: 'publishing' });

  const results: Record<string, unknown> = {};
  let published = 0;
  let failed = 0;

  // Sequential on purpose: four networks pulling the same file at once is how
  // you find out about rate limits, and one failure should not abort the rest.
  for (const platform of targets) {
    const credentials = await loadCredentials(platform);
    if (!credentials) {
      results[platform] = { ok: false, id: null, url: null, error: 'Not connected.', atMs: Date.now() };
      failed++;
      continue;
    }
    try {
      const out = await publishTo(platform, credentials, {
        videoUrl: video.url!,
        caption: post.caption,
        title: post.script?.hook ?? 'Velocity',
        tags: post.hashtags,
      });
      results[platform] = { ok: true, id: out.id, url: out.url, error: null, atMs: Date.now() };
      published++;
    } catch (e) {
      const message = e instanceof PlatformError ? e.message : (e as Error).message;
      logger.error('social: publish failed', { platform, postId: id, message });
      results[platform] = { ok: false, id: null, url: null, error: message.slice(0, 500), atMs: Date.now() };
      failed++;
      // A rejected credential is an account problem, not a post problem — flag
      // it on the account so the console stops showing it as healthy.
      if (/token|expired|permission|oauth|scope/i.test(message)) await markAccountError(platform, message);
    }
  }

  const status: PostStatus = published === 0 ? 'failed' : failed > 0 ? 'partial' : 'published';
  await patch(id, {
    status,
    results: { ...post.results, ...results },
    publishedAt: published > 0 ? FieldValue.serverTimestamp() : null,
    error: published === 0 ? 'Every network rejected the post — see the per-network errors.' : null,
  });

  return { published, failed };
}

/** One end-to-end run: draft, render, and publish if approval isn't required. */
async function runDaily(date: string): Promise<string> {
  const settings = await getSocialSettings();
  const id = await createPost({ date });

  if (settings.requireApproval) {
    await recordRun(`Drafted ${date}; waiting for approval.`);
    return 'awaiting_approval';
  }

  const { published, failed } = await publishPost(id);
  await recordRun(`Published ${date} to ${published} network(s), ${failed} failed.`);
  return published > 0 ? 'published' : 'failed';
}

// ── the trigger ─────────────────────────────────────────────────────────────

/**
 * Hourly tick. Cheap when there is nothing to do — two document reads — and
 * the date-keyed post id makes a double fire a no-op.
 */
export const socialDailyContent = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '1GiB' },
  async () => {
    const settings = await getSocialSettings();
    if (!settings.enabled) return;

    const nowPkt = new Date(Date.now() + 5 * 3600_000);
    if (nowPkt.getUTCHours() !== settings.runHour) return;

    const date = dayKey(Date.now());
    if ((await postRef(date).get()).exists) {
      logger.info('social: today already has a post', { date });
      return;
    }

    if (!writerConfigured()) {
      await recordRun('Skipped: ANTHROPIC_API_KEY is not configured.');
      return;
    }

    try {
      const outcome = await runDaily(date);
      logger.info('social: daily run finished', { date, outcome });
    } catch (e) {
      const message = (e as Error).message;
      logger.error('social: daily run failed', { date, message });
      await recordRun(`Failed: ${message}`);
    }
  },
);

// ── console actions ─────────────────────────────────────────────────────────

/** "Generate now" — the same run the scheduler does, on demand. */
export const adminGenerateSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '1GiB' },
  async (req) => {
    requireAdmin(req);
    const parsed = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        angle: z.string().min(2).max(60).optional(),
        replace: z.boolean().optional(),
      })
      .safeParse(req.data ?? {});
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

    const date = parsed.data.date ?? dayKey(Date.now());
    if (!parsed.data.replace && (await postRef(date).get()).exists) {
      throw new HttpsError('already-exists', `${date} already has a post. Delete it first, or pass replace.`);
    }

    try {
      const id = await createPost({ date, angle: parsed.data.angle });
      return { ok: true, id };
    } catch (e) {
      throw new HttpsError('internal', (e as Error).message);
    }
  },
);

/**
 * Approve or reject a draft. Approving with auto-publish off marks it ready;
 * `publishNow` takes it all the way out.
 */
export const adminReviewSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '512MiB' },
  async (req) => {
    const ctx = requireAdmin(req);
    const parsed = z
      .object({
        postId: z.string().min(1).max(64),
        approve: z.boolean(),
        caption: z.string().max(3000).optional(),
        targets: z.array(z.enum(PLATFORMS)).optional(),
        publishNow: z.boolean().optional(),
      })
      .safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
    const { postId, approve, caption, targets, publishNow } = parsed.data;

    if (!approve) {
      await patch(postId, { status: 'rejected', approvedBy: ctx.uid });
      return { ok: true, status: 'rejected' };
    }

    await patch(postId, {
      status: 'ready',
      approvedBy: ctx.uid,
      ...(caption !== undefined ? { caption } : {}),
      ...(targets ? { targets } : {}),
    });

    if (!publishNow) return { ok: true, status: 'ready' };

    const { published, failed } = await publishPost(postId, targets);
    return { ok: published > 0, published, failed };
  },
);

/** Publish (or re-publish to the networks that failed) an already-ready post. */
export const adminPublishSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '512MiB' },
  async (req) => {
    requireAdmin(req);
    const parsed = z
      .object({ postId: z.string().min(1).max(64), platforms: z.array(z.enum(PLATFORMS)).optional() })
      .safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

    const { published, failed } = await publishPost(parsed.data.postId, parsed.data.platforms);
    return { ok: published > 0, published, failed };
  },
);

/**
 * Attach a video made somewhere else — Creatify, a phone, an editor. The file
 * is uploaded to Storage by the console and handed over as a Storage path, so
 * it goes through exactly the same publish path as a rendered one.
 */
export const adminAttachSocialVideo = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      postId: z.string().min(1).max(64),
      /** A path inside the default bucket, e.g. `socialUploads/abc.mp4`. */
      storagePath: z.string().min(3).max(300),
      aspect: z.enum(['9:16', '16:9']).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const { postId, storagePath, aspect } = parsed.data;
  const { storage } = await import('../lib/firebase');
  const source = storage.bucket().file(storagePath);
  const [exists] = await source.exists();
  if (!exists) throw new HttpsError('not-found', 'No file at that path.');

  // Re-save it under the post's own name so every video lives in one place and
  // the publish path never has to care where a file came from.
  const [bytes] = await source.download();
  const stored = await storeVideo(postId, bytes);

  await patch(postId, {
    video: {
      provider: 'manual',
      model: null,
      jobId: null,
      storagePath: stored.path,
      url: stored.url,
      urlExpiresAtMs: stored.expiresAtMs,
      durationSec: null,
      aspect: aspect ?? '9:16',
    },
    status: 'awaiting_approval',
    error: null,
  });
  return { ok: true };
});

export const adminDeleteSocialPost = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z.object({ postId: z.string().min(1).max(64) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  await postRef(parsed.data.postId).delete();
  return { ok: true };
});
