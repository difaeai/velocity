/**
 * The line. What the four of them do, in what order, and where it stops.
 *
 *   standup ─► research ─► script ─► design ─► cut & render ─► distribution
 *                                                                   │
 *                                                            THE APPROVAL QUEUE
 *                                                                   │
 *                                          approve ─► publish   changes ─► back to the line
 *
 * Two rules the rest of this file exists to enforce:
 *
 * 1. **Nothing publishes itself.** Every run ends at `awaiting_approval`. There
 *    is no auto-publish switch, because everything the crew writes is a claim
 *    Velocity is making in public, and the cost of reading one post a day is
 *    nothing next to the cost of the one that should not have gone out.
 * 2. **Every stage writes before the next begins.** A failure halfway through
 *    leaves a post you can open, read and retry, rather than a silent gap in
 *    the calendar. The crew log on the post is what the console renders live.
 *
 * The scheduler ticks hourly and does nothing unless automation is on, the
 * Pakistan hour matches `runHour`, and today does not already have that
 * format's post. Hourly rather than a fixed cron so the run hour can change
 * from the console without a redeploy; the post id carries the date and the
 * format, so a retried tick cannot produce a duplicate.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { dayKey } from '../analytics';
import { loadCredentials, markAccountError, publishableAccounts } from './accounts';
import { postFolder, refreshAssetUrls, storeFile } from './assets';
import { planContent } from './crew';
import { design, DesignError } from './designer';
import { geminiReady } from './gemini';
import { captionFor, planDistribution } from './manager';
import { PlatformError, publishTo } from './platforms';
import { runResearch } from './research';
import { draftPost, gatherFacts, rewriteCaption } from './script';
import { getSocialSettings, nextAngle, nextFormat, recordRun } from './settings';
import { planCut, renderVideo, storeVideo, VideoError } from './video';
import {
  FORMATS,
  FORMAT_SPECS,
  PLATFORMS,
  freshCrewLog,
  postMedia,
  REVISION_SCOPES,
  supports,
  WORKING_STATUSES,
  type AgentId,
  type ContentFormat,
  type MediaAsset,
  type Platform,
  type PostStatus,
  type Revision,
  type RevisionScope,
  type SocialPost,
} from './types';

const REGION = 'asia-south1';
/** Research, four model calls and a render. The run needs room. */
const RUN_TIMEOUT_SECONDS = 900;

const postRef = (id: string) => db.doc(`socialPosts/${id}`);

async function patch(id: string, fields: Record<string, unknown>): Promise<void> {
  await postRef(id).set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Move one agent's light on the console. */
async function setAgent(
  id: string,
  agent: AgentId,
  state: 'working' | 'done' | 'skipped' | 'failed',
  note: string | null,
  error?: string,
): Promise<void> {
  // A nested map, not a `crew.qalam` key: dotted paths are field paths only in
  // update(), and set({ merge: true }) would write a field literally called
  // "crew.qalam". Merging a nested map leaves the other three agents alone and
  // keeps startedAtMs from the working write.
  await patch(id, {
    crew: {
      [agent]: {
        state,
        note,
        error: error ?? null,
        ...(state === 'working' ? { startedAtMs: Date.now(), finishedAtMs: null } : { finishedAtMs: Date.now() }),
      },
    },
  });
}

/** The hooks of the last fortnight, so the writer doesn't repeat itself. */
async function recentWork(): Promise<{ hooks: string[]; concepts: string[] }> {
  const snap = await db.collection('socialPosts').orderBy('date', 'desc').limit(14).get();
  const hooks: string[] = [];
  const concepts: string[] = [];
  for (const doc of snap.docs) {
    const post = doc.data() as SocialPost;
    if (post.script?.hook) hooks.push(post.script.hook);
    if (post.plan?.concept) concepts.push(post.plan.concept);
  }
  return { hooks, concepts };
}

/** Everything the admin has asked for on this post so far, oldest first. */
function feedbackFrom(post: Partial<SocialPost> | undefined): string[] {
  return (post?.revisions ?? []).map((r) => r.feedback).filter(Boolean);
}

/** `2026-08-24` + `reel` → `2026-08-24-reel`, which is also the idempotency key. */
export function postIdFor(date: string, format: ContentFormat): string {
  return `${date}-${format}`;
}

// ── the run ─────────────────────────────────────────────────────────────────

type Stage = 'plan' | 'script' | 'design' | 'video' | 'distribute';

const ALL_STAGES: Stage[] = ['plan', 'script', 'design', 'video', 'distribute'];

/**
 * Run the crew over one post.
 *
 * `stages` is what makes "ask for changes" cheap: a caption rewrite re-runs
 * nothing, a design note re-runs the designer and the manager, a script note
 * re-runs everything downstream of the script. Re-rendering a video because
 * someone wanted a different word in the caption is how you spend a month's
 * budget in an afternoon.
 */
async function runCrew(params: {
  id: string;
  date: string;
  format: ContentFormat;
  angle: string;
  stages: Stage[];
  /** Only used when the post is being created. */
  targets?: Platform[];
}): Promise<void> {
  const settings = await getSocialSettings();
  const spec = FORMAT_SPECS[params.format];
  const existing = (await postRef(params.id).get()).data() as SocialPost | undefined;
  const feedback = feedbackFrom(existing);

  let plan = existing?.plan ?? null;
  let script = existing?.script ?? null;
  let caption = existing?.caption ?? '';
  let hashtags = existing?.hashtags ?? [];
  let media: MediaAsset[] = existing ? postMedia(existing) : [];
  let facts = existing?.facts ?? {};
  let research = existing?.research ?? null;

  // ── Qalam: read the market, agree the concept, write it ───────────────────
  if (params.stages.includes('plan') || params.stages.includes('script')) {
    await setAgent(params.id, 'qalam', 'working', 'Reading the market.');
    await patch(params.id, { status: 'researching' as PostStatus });

    try {
      facts = await gatherFacts();
      research = await runResearch(settings, params.date);
      await patch(params.id, { facts, research });

      const recent = await recentWork();

      if (params.stages.includes('plan')) {
        await patch(params.id, { status: 'planning' as PostStatus });
        await setAgent(params.id, 'qalam', 'working', 'At standup with the crew.');
        plan = await planContent({
          settings,
          format: params.format,
          angle: params.angle,
          facts,
          research,
          recentConcepts: recent.concepts,
          feedback,
        });
        await patch(params.id, { plan });
        // The standup is the whole crew's, so everyone's light shows it.
        for (const agent of ['rang', 'raftar', 'awaaz'] as AgentId[]) {
          if (!spec.crew.includes(agent)) continue;
          await setAgent(params.id, agent, 'working', plan.notes[agent] ?? 'Briefed at standup.');
        }
      }

      await patch(params.id, { status: 'drafting' as PostStatus });
      await setAgent(params.id, 'qalam', 'working', 'Writing.');
      const drafted = await draftPost({
        settings,
        format: params.format,
        angle: params.angle,
        plan,
        facts,
        research,
        recentHooks: recent.hooks,
        feedback,
      });
      script = drafted.script;
      caption = drafted.caption;
      hashtags = drafted.hashtags;
      await patch(params.id, {
        script,
        caption: `${caption}\n\n${hashtags.map((h) => `#${h}`).join(' ')}`.trim(),
        hashtags,
      });
      await setAgent(params.id, 'qalam', 'done', script.viralHook || script.hook);
    } catch (e) {
      const message = (e as Error).message;
      await setAgent(params.id, 'qalam', 'failed', 'Could not write it.', message);
      await patch(params.id, { status: 'failed' as PostStatus, error: `Writer: ${message}` });
      throw e;
    }
  }

  if (!script) throw new Error('There is no script to work from.');

  // ── Rang: draw it ─────────────────────────────────────────────────────────
  if (params.stages.includes('design')) {
    await patch(params.id, { status: 'designing' as PostStatus });
    await setAgent(params.id, 'rang', 'working', 'Art directing.');
    try {
      const result = await design({
        settings,
        postId: params.id,
        format: params.format,
        script,
        plan,
        feedback,
        onProgress: (note) => setAgent(params.id, 'rang', 'working', note),
      });
      // Replace this format's images; a re-run should not leave slide 6 of a
      // five-slide carousel lying around from the previous version.
      media = [...media.filter((m) => m.kind !== 'image'), ...result.media];
      await patch(params.id, { media, direction: result.direction });
      await setAgent(params.id, 'rang', result.media.length ? 'done' : 'skipped', result.note);
    } catch (e) {
      const message = e instanceof DesignError ? e.message : (e as Error).message;
      await setAgent(params.id, 'rang', 'failed', 'Could not draw it.', message);
      // A failed design is fatal for an image format and survivable for a video
      // one, where the cover frame is a nicety.
      if (spec.kind === 'image') {
        await patch(params.id, { status: 'failed' as PostStatus, error: `Designer: ${message}` });
        throw e;
      }
    }
  }

  // ── Raftar: cut and render ────────────────────────────────────────────────
  if (spec.kind === 'video' && params.stages.includes('video')) {
    await patch(params.id, { status: 'rendering' as PostStatus });
    await setAgent(params.id, 'raftar', 'working', 'Writing the cut.');
    try {
      const cut = await planCut({ settings, format: params.format, script, plan, feedback });
      await patch(params.id, { cut });

      if (settings.videoProvider === 'none') {
        await setAgent(params.id, 'raftar', 'skipped', `${cut.note} Rendering is off — attach a file.`);
      } else {
        await setAgent(params.id, 'raftar', 'working', 'Rendering. This takes a few minutes.');
        const cover = media.find((m) => m.kind === 'image') ?? null;
        const video = await renderVideo({ postId: params.id, cut, settings, format: params.format, cover });
        if (video) {
          media = [...media.filter((m) => m.kind !== 'video'), video];
          await patch(params.id, { media });
        }
        await setAgent(params.id, 'raftar', video ? 'done' : 'skipped', cut.note);
      }
    } catch (e) {
      const message = e instanceof VideoError ? e.message : (e as Error).message;
      await setAgent(params.id, 'raftar', 'failed', 'The render failed.', message);
      // Not fatal: the script and the frames survive, and a file can be
      // attached by hand from the queue.
      await patch(params.id, { error: `Editor: ${message}` });
    }
  } else if (spec.kind === 'image') {
    await setAgent(params.id, 'raftar', 'skipped', 'Nothing to cut on a still format.');
  }

  // ── Awaaz: work out where it goes ─────────────────────────────────────────
  if (params.stages.includes('distribute')) {
    await setAgent(params.id, 'awaaz', 'working', 'Writing the captions per network.');
    try {
      const connected = await publishableAccounts(params.format);
      const candidates = (params.targets ?? existing?.targets ?? settings.platforms).filter(
        (p) => supports(p, params.format) && (connected.length === 0 || connected.includes(p)),
      );
      const distribution = await planDistribution({
        settings,
        format: params.format,
        script,
        plan,
        caption,
        hashtags,
        candidates: candidates.length ? candidates : connected,
        feedback,
      });
      await patch(params.id, { captions: distribution.captions, targets: distribution.targets });
      await setAgent(
        params.id,
        'awaaz',
        'done',
        distribution.targets.length
          ? `${distribution.note} Queued for ${distribution.targets.join(', ')}.`
          : 'Nowhere to post this yet — no connected account takes this format.',
      );
    } catch (e) {
      await setAgent(params.id, 'awaaz', 'failed', 'Could not plan the distribution.', (e as Error).message);
    }
  }

  // The line always ends here. Approval is a human's job.
  await patch(params.id, { status: 'awaiting_approval' as PostStatus });
}

/** Create the document, then run the crew over it. */
async function createPost(opts: {
  date: string;
  format: ContentFormat;
  angle?: string;
  targets?: Platform[];
}): Promise<string> {
  const settings = await getSocialSettings();
  const angle = opts.angle ?? (await nextAngle(settings));
  const id = postIdFor(opts.date, opts.format);

  const targets = (opts.targets ?? settings.platforms).filter(
    (p) => PLATFORMS.includes(p) && supports(p, opts.format),
  );

  await postRef(id).set({
    id,
    date: opts.date,
    format: opts.format,
    angle,
    status: 'planning' as PostStatus,
    plan: null,
    script: null,
    caption: '',
    captions: {},
    hashtags: [],
    facts: {},
    research: null,
    media: [],
    targets,
    results: {},
    crew: freshCrewLog(),
    revisions: [],
    error: null,
    approvedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    publishedAt: null,
  });

  await runCrew({ id, date: opts.date, format: opts.format, angle, stages: ALL_STAGES, targets });
  return id;
}

// ── publishing ──────────────────────────────────────────────────────────────

/** Post one approved piece everywhere it is meant to go. */
async function publishPost(id: string, only?: Platform[]): Promise<{ published: number; failed: number }> {
  const snap = await postRef(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such post.');
  const post = snap.data() as SocialPost;
  const format = post.format ?? 'reel';

  let media = postMedia(post);
  if (!media.length) {
    throw new HttpsError(
      'failed-precondition',
      'That post has nothing to publish yet. Render it, or attach a file, first.',
    );
  }

  // Signed URLs age out; a post retried a week later needs fresh ones.
  const refreshed = await refreshAssetUrls(media);
  if (refreshed.some((m, i) => m.url !== media[i].url)) {
    media = refreshed;
    await patch(id, { media });
  }

  const targets = (only ?? post.targets ?? []).filter((p) => supports(p, format));
  if (!targets.length) {
    throw new HttpsError('failed-precondition', 'None of the selected networks can take this format.');
  }

  await patch(id, { status: 'publishing' as PostStatus });
  await setAgent(id, 'awaaz', 'working', `Posting to ${targets.join(', ')}.`);

  const results: Record<string, unknown> = {};
  let published = 0;
  let failed = 0;

  // Sequential on purpose: five networks pulling the same file at once is how
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
        format,
        media,
        caption: captionFor(platform, post.caption, post.captions),
        title: post.script?.hook ?? 'Velocity',
        tags: post.hashtags ?? [],
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
  await setAgent(
    id,
    'awaaz',
    published > 0 ? 'done' : 'failed',
    `${published} posted, ${failed} failed.`,
    published === 0 ? 'No network accepted it.' : undefined,
  );

  return { published, failed };
}

// ── the trigger ─────────────────────────────────────────────────────────────

/** One scheduled run: whatever formats today calls for, all of them queued. */
async function runDaily(date: string): Promise<string> {
  const wanted = Math.max(1, Math.min((await getSocialSettings()).postsPerDay, FORMATS.length));
  const made: string[] = [];

  for (let i = 0; i < wanted; i++) {
    // Re-read: nextFormat advances the stored index, so a second piece the same
    // morning has to see the first one's advance or it makes the same format
    // twice and then skips itself on the duplicate id.
    const format = await nextFormat(await getSocialSettings());
    const id = postIdFor(date, format);
    if ((await postRef(id).get()).exists) continue;
    try {
      await createPost({ date, format });
      made.push(format);
    } catch (e) {
      logger.error('social: a scheduled piece failed', { date, format, message: (e as Error).message });
    }
  }

  return made.length ? `Queued ${made.join(', ')} for ${date}.` : `Nothing new to queue for ${date}.`;
}

/**
 * Hourly tick. Cheap when there is nothing to do — two document reads — and the
 * date-and-format post id makes a double fire a no-op.
 */
export const socialDailyContent = onSchedule(
  {
    schedule: '0 * * * *',
    timeZone: 'Asia/Karachi',
    region: REGION,
    timeoutSeconds: RUN_TIMEOUT_SECONDS,
    memory: '1GiB',
  },
  async () => {
    const settings = await getSocialSettings();
    if (!settings.enabled) return;

    const nowPkt = new Date(Date.now() + 5 * 3600_000);
    if (nowPkt.getUTCHours() !== settings.runHour) return;

    if (!geminiReady()) {
      await recordRun('Skipped: GEMINI_API_KEY is not configured.');
      return;
    }

    const date = dayKey(Date.now());
    try {
      const outcome = await runDaily(date);
      await recordRun(outcome);
      logger.info('social: daily run finished', { date, outcome });
    } catch (e) {
      const message = (e as Error).message;
      logger.error('social: daily run failed', { date, message });
      await recordRun(`Failed: ${message}`);
    }
  },
);

// ── console actions ─────────────────────────────────────────────────────────

const formatSchema = z.enum(FORMATS);

/** "Brief the crew" — the same run the scheduler does, on demand. */
export const adminGenerateSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '1GiB' },
  async (req) => {
    requireAdmin(req);
    const parsed = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        format: formatSchema.optional(),
        angle: z.string().min(2).max(60).optional(),
        targets: z.array(z.enum(PLATFORMS)).optional(),
        replace: z.boolean().optional(),
      })
      .safeParse(req.data ?? {});
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

    if (!geminiReady()) {
      throw new HttpsError(
        'failed-precondition',
        'GEMINI_API_KEY is not configured, so the crew cannot run. Add it as a backend secret and redeploy.',
      );
    }

    const settings = await getSocialSettings();
    const date = parsed.data.date ?? dayKey(Date.now());
    const format = parsed.data.format ?? (await nextFormat(settings));
    const id = postIdFor(date, format);

    if (!parsed.data.replace && (await postRef(id).get()).exists) {
      throw new HttpsError(
        'already-exists',
        `${date} already has a ${format}. Open it, ask for changes, or pass replace.`,
      );
    }

    try {
      await createPost({ date, format, angle: parsed.data.angle, targets: parsed.data.targets });
      return { ok: true, id, format };
    } catch (e) {
      throw new HttpsError('internal', (e as Error).message);
    }
  },
);

/**
 * Ask for changes.
 *
 * The scope decides what actually re-runs, and therefore what it costs: a
 * caption note is one cheap call, a script note re-runs the writer and
 * everything downstream of it. The feedback is kept on the post forever and
 * fed to every agent on every later run, so "stop saying 'seamless'" said once
 * keeps being true.
 */
export const adminRequestSocialChanges = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '1GiB' },
  async (req) => {
    const ctx = requireAdmin(req);
    const parsed = z
      .object({
        postId: z.string().min(1).max(64),
        feedback: z.string().min(3).max(2000),
        scope: z.array(z.enum(REVISION_SCOPES)).min(1).max(REVISION_SCOPES.length),
      })
      .safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what you want changed, and on what.');
    const { postId, feedback, scope } = parsed.data;

    const snap = await postRef(postId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such post.');
    const post = snap.data() as SocialPost;
    if (WORKING_STATUSES.includes(post.status)) {
      throw new HttpsError('failed-precondition', 'The crew is still working on that one.');
    }

    const revision: Revision = { atMs: Date.now(), by: ctx.uid, feedback, scope: scope as RevisionScope[] };
    await patch(postId, {
      revisions: FieldValue.arrayUnion(revision),
      status: 'changes_requested' as PostStatus,
      error: null,
    });

    // Caption-only notes never touch the media. Everything else re-runs the
    // stages downstream of what was criticised.
    if (scope.length === 1 && scope[0] === 'caption') {
      const settings = await getSocialSettings();
      if (!post.script) throw new HttpsError('failed-precondition', 'That post has no script to rewrite.');
      await setAgent(postId, 'qalam', 'working', 'Rewriting the caption.');
      const rewritten = await rewriteCaption({
        settings,
        script: post.script,
        currentCaption: post.caption,
        hashtags: post.hashtags ?? [],
        feedback: [...feedbackFrom(post), feedback],
      });
      await patch(postId, {
        caption: `${rewritten.caption}\n\n${rewritten.hashtags.map((h) => `#${h}`).join(' ')}`.trim(),
        hashtags: rewritten.hashtags,
        status: 'awaiting_approval' as PostStatus,
      });
      await setAgent(postId, 'qalam', 'done', 'Caption rewritten.');
      return { ok: true, reran: ['caption'] };
    }

    const stages: Stage[] = [];
    if (scope.includes('script')) stages.push('plan', 'script', 'design', 'video');
    if (scope.includes('design') && !stages.includes('design')) stages.push('design');
    if (scope.includes('video') && !stages.includes('video')) stages.push('video');
    stages.push('distribute');

    try {
      await runCrew({
        id: postId,
        date: post.date,
        format: post.format ?? 'reel',
        angle: post.angle,
        stages,
      });
      return { ok: true, reran: stages };
    } catch (e) {
      throw new HttpsError('internal', (e as Error).message);
    }
  },
);

/**
 * Approve or reject. Approving marks it ready; `publishNow` takes it all the
 * way out to the networks.
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
      await patch(postId, { status: 'rejected' as PostStatus, approvedBy: ctx.uid });
      return { ok: true, status: 'rejected' };
    }

    await patch(postId, {
      status: 'ready' as PostStatus,
      approvedBy: ctx.uid,
      ...(caption !== undefined ? { caption } : {}),
      ...(targets ? { targets } : {}),
    });

    if (!publishNow) return { ok: true, status: 'ready' };

    const { published, failed } = await publishPost(postId, targets);
    return { ok: published > 0, published, failed };
  },
);

/** Publish (or re-publish to the networks that failed) an approved post. */
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
 * Attach media made somewhere else — a phone, an editor, a designer. The file
 * is uploaded to Storage by the console and handed over as a path, so it goes
 * through exactly the same publish path as a rendered one.
 */
export const adminAttachSocialMedia = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z
    .object({
      postId: z.string().min(1).max(64),
      /** A path inside the default bucket, e.g. `socialUploads/abc.mp4`. */
      storagePath: z.string().min(3).max(300),
      kind: z.enum(['video', 'image']).optional(),
      /** Which carousel slide this is. Ignored for video. */
      slide: z.number().int().min(1).max(10).optional(),
      alt: z.string().max(300).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const { postId, storagePath, slide, alt } = parsed.data;
  const snap = await postRef(postId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such post.');
  const post = snap.data() as SocialPost;
  const format = post.format ?? 'reel';
  const kind = parsed.data.kind ?? (FORMAT_SPECS[format].kind === 'video' ? 'video' : 'image');

  const { storage } = await import('../lib/firebase');
  const source = storage.bucket().file(storagePath);
  const [exists] = await source.exists();
  if (!exists) throw new HttpsError('not-found', 'No file at that path.');

  const [bytes] = await source.download();

  const stored =
    kind === 'video'
      ? await storeVideo(postId, bytes)
      : await storeFile({
          path: `${postFolder(postId)}/slide-${slide ?? 1}.png`,
          bytes,
          contentType: 'image/png',
        });

  const asset: MediaAsset = {
    kind,
    provider: 'manual',
    model: null,
    jobId: null,
    storagePath: stored.path,
    url: stored.url,
    urlExpiresAtMs: stored.expiresAtMs,
    durationSec: null,
    aspect: FORMAT_SPECS[format].aspect,
    slide: kind === 'video' ? 1 : (slide ?? 1),
    alt: alt ?? '',
  };

  const media = postMedia(post).filter((m) => !(m.kind === asset.kind && m.slide === asset.slide));
  await patch(postId, {
    media: [...media, asset].sort((a, b) => a.slide - b.slide),
    status: 'awaiting_approval' as PostStatus,
    error: null,
  });
  await setAgent(postId, asset.kind === 'video' ? 'raftar' : 'rang', 'done', 'File attached by hand.');
  return { ok: true };
});

export const adminDeleteSocialPost = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z.object({ postId: z.string().min(1).max(64) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  await postRef(parsed.data.postId).delete();
  return { ok: true };
});
