/**
 * The working day. Who does what, in what order, and where it stops.
 *
 *   standup ─► research ─► SEO brief ─► script ─► search metadata
 *           ─► design ─► cut & render ─► ads brief ─► distribution
 *                                   │
 *                          THE APPROVAL QUEUE
 *                                   │
 *          approve ─► publish   changes ─► back to whoever owns that stage
 *
 * Three rules the rest of this file exists to enforce:
 *
 * 1. **Only people who have been hired do work.** Each stage asks the roster
 *    who covers it. If nobody does, the stage is recorded as skipped with the
 *    reason — "no designer on the team" — rather than silently producing
 *    nothing. This is what makes hiring someone actually change the output.
 * 2. **Nothing publishes itself.** Every run ends at `awaiting_approval`.
 *    Everything the team writes is a claim Velocity is making in public, and
 *    the cost of reading one piece a day is nothing next to the cost of the one
 *    that should not have gone out.
 * 3. **Every stage writes before the next begins.** A failure halfway through
 *    leaves a piece you can open, read and retry, rather than a silent gap in
 *    the calendar. The work log on the post is what the console renders live,
 *    with the name of the person whose turn it was.
 *
 * The scheduler ticks hourly and does nothing unless automation is on, the
 * Pakistan hour matches `runHour`, and today does not already have that
 * format's piece. Hourly rather than a fixed cron so the run hour can change
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
import { activeTeam, assign, creditWork, teamRefs } from './employees';
import { geminiReady } from './gemini';
import { captionFor, planDistribution } from './manager';
import { PlatformError, publishTo } from './platforms';
import { runResearch } from './research';
import { draftPost, gatherFacts, rewriteCaption } from './script';
import { adPass, searchPass, seoPass } from './seo';
import { getSocialSettings, nextAngle, nextFormat, recordRun } from './settings';
import { planCut, renderVideo, storeVideo, VideoError } from './video';
import {
  FORMATS,
  FORMAT_SPECS,
  PLATFORMS,
  ROLE_SPECS,
  REVISION_SCOPES,
  STAGE_COVER,
  postMedia,
  supports,
  WORKING_STATUSES,
  type ContentFormat,
  type Employee,
  type MediaAsset,
  type Platform,
  type PostStatus,
  type Revision,
  type RevisionScope,
  type SocialPost,
  type Stage,
  type WorkEntry,
  type WorkState,
} from './types';

const REGION = 'asia-south1';
/** Research, several model calls and a render. The run needs room. */
const RUN_TIMEOUT_SECONDS = 900;

const postRef = (id: string) => db.doc(`socialPosts/${id}`);

async function patch(id: string, fields: Record<string, unknown>): Promise<void> {
  await postRef(id).set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/**
 * Put someone's name against a stage, live.
 *
 * A nested map rather than a `work.design` key: dotted paths are field paths
 * only in update(), and set({ merge: true }) would write a field literally
 * called "work.design". Merging a nested map leaves the other stages alone.
 */
async function setWork(
  id: string,
  stage: Stage,
  entry: Partial<WorkEntry> & { state: WorkState; name: string },
): Promise<void> {
  await patch(id, {
    work: {
      [stage]: {
        stage,
        employeeId: entry.employeeId ?? null,
        name: entry.name,
        role: entry.role ?? null,
        state: entry.state,
        note: entry.note ?? null,
        error: entry.error ?? null,
        ...(entry.state === 'working'
          ? { startedAtMs: Date.now(), finishedAtMs: null }
          : { finishedAtMs: Date.now() }),
      },
    },
  });
}

/** Nobody holds this job, and nobody covers it. Say so on the piece. */
async function noteNobody(id: string, stage: Stage): Promise<void> {
  const role = ROLE_SPECS[STAGE_COVER[stage].primary].label;
  await setWork(id, stage, {
    state: 'skipped',
    name: 'Nobody',
    note: `No ${role.toLowerCase()} on the team — hire one and this stage starts running.`,
  });
}

/** The hooks and concepts of the last fortnight, so the team doesn't repeat itself. */
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

/** Everything the admin has asked for on this piece so far, oldest first. */
function feedbackFrom(post: Partial<SocialPost> | undefined): string[] {
  return (post?.revisions ?? []).map((r) => r.feedback).filter(Boolean);
}

/** `2026-08-24` + `reel` → `2026-08-24-reel`, which is also the idempotency key. */
export function postIdFor(date: string, format: ContentFormat): string {
  return `${date}-${format}`;
}

// ── the run ─────────────────────────────────────────────────────────────────

const ALL_STAGES: Stage[] = ['research', 'seo', 'script', 'search', 'design', 'video', 'ads', 'distribute'];

/**
 * Run the team over one piece.
 *
 * `stages` is what makes "ask for changes" cheap: a caption note re-runs one
 * call, a design note re-runs the designer and the manager, a script note
 * re-runs everything downstream of the script. Re-rendering a video because
 * someone wanted a different word in the caption is how you spend a month's
 * budget in an afternoon.
 */
async function runTeam(params: {
  id: string;
  date: string;
  format: ContentFormat;
  angle: string;
  stages: Stage[];
  /** Only used when the piece is being created. */
  targets?: Platform[];
  /** Re-hold the standup. False when only a later stage is being redone. */
  standup: boolean;
}): Promise<void> {
  const settings = await getSocialSettings();
  const spec = FORMAT_SPECS[params.format];
  const team = await activeTeam();
  const existing = (await postRef(params.id).get()).data() as SocialPost | undefined;
  const feedback = feedbackFrom(existing);

  if (!team.length) {
    await patch(params.id, {
      status: 'failed' as PostStatus,
      error: 'Nobody works here yet. Hire at least a content writer on the Employees page.',
    });
    throw new Error('The team is empty.');
  }

  await patch(params.id, { team: teamRefs(team) });

  /** Only the stages this format needs, in run order, that were asked for. */
  const wanted = ALL_STAGES.filter((s) => spec.stages.includes(s) && params.stages.includes(s));

  /** Who is on this stage — and record it, or record that nobody is. */
  const who = async (stage: Stage): Promise<Employee | null> => {
    const picked = assign(team, stage);
    if (!picked) {
      await noteNobody(params.id, stage);
      return null;
    }
    await setWork(params.id, stage, {
      state: 'working',
      employeeId: picked.employee.id,
      name: picked.employee.name,
      role: picked.employee.role,
      note: picked.covering
        ? `Covering ${ROLE_SPECS[STAGE_COVER[stage].primary].label.toLowerCase()} — nobody is hired into it.`
        : 'Starting.',
    });
    return picked.employee;
  };

  const done = async (stage: Stage, employee: Employee, note: string) => {
    await setWork(params.id, stage, {
      state: 'done',
      employeeId: employee.id,
      name: employee.name,
      role: employee.role,
      note,
    });
    await creditWork(employee.id);
  };

  const failed = async (stage: Stage, employee: Employee, message: string) => {
    await setWork(params.id, stage, {
      state: 'failed',
      employeeId: employee.id,
      name: employee.name,
      role: employee.role,
      note: 'Could not finish it.',
      error: message,
    });
  };

  let plan = existing?.plan ?? null;
  let script = existing?.script ?? null;
  let caption = existing?.caption ?? '';
  let hashtags = existing?.hashtags ?? [];
  let media: MediaAsset[] = existing ? postMedia(existing) : [];
  let facts = existing?.facts ?? {};
  let research = existing?.research ?? null;
  let seo = existing?.seo ?? null;
  let search = existing?.search ?? null;

  // ── research ──────────────────────────────────────────────────────────────
  if (wanted.includes('research')) {
    await patch(params.id, { status: 'researching' as PostStatus });
    facts = await gatherFacts();
    const researcher = await who('research');
    research = await runResearch({ settings, date: params.date, employee: researcher });
    await patch(params.id, { facts, research });
    if (researcher) {
      await done(
        'research',
        researcher,
        research.error ? `Could not read the market: ${research.error}` : `${research.trends.length} things moving.`,
      );
    }
  }

  // ── standup ───────────────────────────────────────────────────────────────
  if (params.standup) {
    await patch(params.id, { status: 'planning' as PostStatus });
    const { concepts } = await recentWork();
    try {
      plan = await planContent({
        settings,
        team,
        format: params.format,
        angle: params.angle,
        facts,
        research,
        recentConcepts: concepts,
        feedback,
      });
      await patch(params.id, { plan });
    } catch (e) {
      await patch(params.id, { status: 'failed' as PostStatus, error: `Standup: ${(e as Error).message}` });
      throw e;
    }
  }

  // ── the SEO brief, before anything is written ─────────────────────────────
  if (wanted.includes('seo')) {
    await patch(params.id, { status: 'optimising' as PostStatus });
    const expert = await who('seo');
    if (expert) {
      seo = await seoPass({
        employee: expert,
        settings,
        format: params.format,
        angle: params.angle,
        plan,
        research,
        feedback,
      });
      await patch(params.id, { seo });
      if (seo) await done('seo', expert, seo.note || `Targeting: ${seo.searchIntent}`);
      else await failed('seo', expert, 'The search brief came back unusable.');
    }
  }

  // ── the script ────────────────────────────────────────────────────────────
  if (wanted.includes('script')) {
    await patch(params.id, { status: 'drafting' as PostStatus });
    const writer = await who('script');
    if (!writer) {
      await patch(params.id, {
        status: 'failed' as PostStatus,
        error: 'No content writer on the team, so nothing can be written. Hire one on the Employees page.',
      });
      throw new Error('No content writer.');
    }
    try {
      const { hooks } = await recentWork();
      const drafted = await draftPost({
        employee: writer,
        settings,
        format: params.format,
        angle: params.angle,
        plan,
        facts,
        research,
        seo,
        recentHooks: hooks,
        feedback,
      });
      script = drafted.script;
      caption = drafted.caption;
      // The SEO desk's tags win where they exist: they were chosen because
      // somebody searches them, which the writer's were not.
      hashtags = seo?.hashtags.length ? seo.hashtags : drafted.hashtags;
      await patch(params.id, {
        script,
        caption: `${caption}\n\n${hashtags.map((h) => `#${h}`).join(' ')}`.trim(),
        hashtags,
      });
      await done('script', writer, script.viralHook || script.hook);
    } catch (e) {
      const message = (e as Error).message;
      await failed('script', writer, message);
      await patch(params.id, { status: 'failed' as PostStatus, error: `Writing: ${message}` });
      throw e;
    }
  }

  if (!script) throw new Error('There is no script to work from.');

  // ── YouTube and Google metadata ───────────────────────────────────────────
  if (wanted.includes('search')) {
    await patch(params.id, { status: 'optimising' as PostStatus });
    const expert = await who('search');
    if (expert) {
      search = await searchPass({
        employee: expert,
        settings,
        format: params.format,
        script,
        caption,
        seo,
        plan,
        feedback,
      });
      await patch(params.id, { search });
      if (search) await done('search', expert, search.note || search.youtube?.title || search.webAngle);
      else await failed('search', expert, 'The search metadata came back unusable.');
    }
  }

  // ── design ────────────────────────────────────────────────────────────────
  if (wanted.includes('design')) {
    await patch(params.id, { status: 'designing' as PostStatus });
    const designer = await who('design');
    if (designer) {
      try {
        const result = await design({
          employee: designer,
          settings,
          postId: params.id,
          format: params.format,
          script,
          plan,
          seo,
          feedback,
          onProgress: (note) =>
            setWork(params.id, 'design', {
              state: 'working',
              employeeId: designer.id,
              name: designer.name,
              role: designer.role,
              note,
            }),
        });
        // Replace this format's images; a re-run should not leave slide 6 of a
        // five-slide carousel lying around from the previous version.
        media = [...media.filter((m) => m.kind !== 'image'), ...result.media];
        await patch(params.id, { media, direction: result.direction });
        await done('design', designer, result.note);
      } catch (e) {
        const message = e instanceof DesignError ? e.message : (e as Error).message;
        await failed('design', designer, message);
        // A failed design is fatal for an image format and survivable for a
        // video one, where the cover frame is a nicety.
        if (spec.kind === 'image') {
          await patch(params.id, { status: 'failed' as PostStatus, error: `Design: ${message}` });
          throw e;
        }
      }
    }
  }

  // ── the cut and the render ────────────────────────────────────────────────
  if (wanted.includes('video')) {
    await patch(params.id, { status: 'rendering' as PostStatus });
    const editor = await who('video');
    if (editor) {
      try {
        const cut = await planCut({
          employee: editor,
          settings,
          format: params.format,
          script,
          plan,
          search,
          feedback,
        });
        await patch(params.id, { cut });

        if (settings.videoProvider === 'none') {
          await setWork(params.id, 'video', {
            state: 'skipped',
            employeeId: editor.id,
            name: editor.name,
            role: editor.role,
            note: `${cut.note} Rendering is switched off — attach a file.`,
          });
        } else {
          await setWork(params.id, 'video', {
            state: 'working',
            employeeId: editor.id,
            name: editor.name,
            role: editor.role,
            note: 'Rendering. This takes a few minutes.',
          });
          const cover = media.find((m) => m.kind === 'image') ?? null;
          const video = await renderVideo({
            postId: params.id,
            cut,
            settings,
            format: params.format,
            cover,
          });
          if (video) {
            media = [...media.filter((m) => m.kind !== 'video'), video];
            await patch(params.id, { media });
          }
          await done('video', editor, cut.note);
        }
      } catch (e) {
        const message = e instanceof VideoError ? e.message : (e as Error).message;
        await failed('video', editor, message);
        // Not fatal: the script and the frames survive, and a file can be
        // attached by hand from the queue.
        await patch(params.id, { error: `Editing: ${message}` });
      }
    }
  }

  // ── the ads brief ─────────────────────────────────────────────────────────
  if (wanted.includes('ads')) {
    await patch(params.id, { status: 'optimising' as PostStatus });
    const buyer = await who('ads');
    if (buyer) {
      const ads = await adPass({
        employee: buyer,
        settings,
        format: params.format,
        script,
        facts,
        plan,
        search,
        feedback,
      });
      await patch(params.id, { ads });
      if (ads) await done('ads', buyer, `${ads.campaignType} — ${ads.objective}`.slice(0, 200));
      else await failed('ads', buyer, 'The campaign brief came back unusable.');
    }
  }

  // ── where it goes ─────────────────────────────────────────────────────────
  if (wanted.includes('distribute')) {
    await patch(params.id, { status: 'optimising' as PostStatus });
    const manager = await who('distribute');
    if (manager) {
      try {
        const connected = await publishableAccounts(params.format);
        const candidates = (params.targets ?? existing?.targets ?? settings.platforms).filter(
          (p) => supports(p, params.format) && (connected.length === 0 || connected.includes(p)),
        );
        const distribution = await planDistribution({
          employee: manager,
          settings,
          format: params.format,
          script,
          plan,
          caption,
          hashtags,
          search,
          candidates: candidates.length ? candidates : connected,
          feedback,
        });
        await patch(params.id, { captions: distribution.captions, targets: distribution.targets });
        await done(
          'distribute',
          manager,
          distribution.targets.length
            ? `${distribution.note} Queued for ${distribution.targets.join(', ')}.`
            : 'Nowhere to post this yet — no connected account takes this format.',
        );
      } catch (e) {
        await failed('distribute', manager, (e as Error).message);
      }
    }
  }

  // The day always ends here. Approval is a human's job.
  await patch(params.id, { status: 'awaiting_approval' as PostStatus });
}

/** Create the document, then put the team on it. */
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
    team: [],
    work: {},
    plan: null,
    script: null,
    caption: '',
    captions: {},
    hashtags: [],
    facts: {},
    research: null,
    seo: null,
    search: null,
    ads: null,
    direction: null,
    cut: null,
    media: [],
    targets,
    results: {},
    revisions: [],
    error: null,
    approvedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    publishedAt: null,
  });

  await runTeam({
    id,
    date: opts.date,
    format: opts.format,
    angle,
    stages: ALL_STAGES,
    targets,
    standup: true,
  });
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
      'That piece has nothing to publish yet. Render it, or attach a file, first.',
    );
  }

  // Signed URLs age out; a piece retried a week later needs fresh ones.
  const refreshed = await refreshAssetUrls(media);
  if (refreshed.some((m, i) => m.url !== media[i].url)) {
    media = refreshed;
    await patch(id, { media });
  }

  const targets = (only ?? post.targets ?? []).filter((p) => supports(p, format));
  if (!targets.length) {
    throw new HttpsError('failed-precondition', 'None of the selected networks can take this format.');
  }

  // Whoever manages social signs the post — and it is their name in the log.
  const team = await activeTeam();
  const manager = assign(team, 'distribute')?.employee ?? null;

  await patch(id, { status: 'publishing' as PostStatus });
  await setWork(id, 'distribute', {
    state: 'working',
    employeeId: manager?.id ?? null,
    name: manager?.name ?? 'The desk',
    role: manager?.role ?? null,
    note: `Posting to ${targets.join(', ')}.`,
  });

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
        youtube: post.search?.youtube ?? null,
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
  await setWork(id, 'distribute', {
    state: published > 0 ? 'done' : 'failed',
    employeeId: manager?.id ?? null,
    name: manager?.name ?? 'The desk',
    role: manager?.role ?? null,
    note: `${published} posted, ${failed} failed.`,
    error: published === 0 ? 'No network accepted it.' : null,
  });
  if (manager && published > 0) await creditWork(manager.id);

  return { published, failed };
}

// ── the trigger ─────────────────────────────────────────────────────────────

/** One scheduled day: whatever formats today calls for, all of them queued. */
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
    if (!(await activeTeam()).length) {
      await recordRun('Skipped: nobody is on the team. Hire someone on the Employees page.');
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

/** "Put the team on it" — the same run the scheduler does, on demand. */
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
        'GEMINI_API_KEY is not configured, so nobody can work. Add it as a backend secret and redeploy.',
      );
    }
    const team = await activeTeam();
    if (!team.length) {
      throw new HttpsError(
        'failed-precondition',
        'Nobody works here yet. Hire at least a content writer on the Employees page.',
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

/** Which stages a change request re-runs. The cost of a note is this list. */
const SCOPE_STAGES: Record<RevisionScope, Stage[]> = {
  script: ['seo', 'script', 'search', 'design', 'video', 'ads'],
  design: ['design'],
  video: ['video', 'ads'],
  seo: ['seo', 'search'],
  ads: ['ads'],
  caption: [],
};

/**
 * Ask for changes.
 *
 * The scope decides who is called back in, and therefore what it costs: a
 * caption note is one cheap call to the writer, a script note puts most of the
 * team back on it. The feedback is kept on the piece forever and fed to
 * everyone who touches it later, so "stop saying seamless" said once keeps
 * being true.
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
      throw new HttpsError('failed-precondition', 'The team is still working on that one.');
    }

    const revision: Revision = { atMs: Date.now(), by: ctx.uid, feedback, scope: scope as RevisionScope[] };
    await patch(postId, {
      revisions: FieldValue.arrayUnion(revision),
      status: 'changes_requested' as PostStatus,
      error: null,
    });

    // A caption-only note never touches the media, and never re-runs a render.
    if (scope.length === 1 && scope[0] === 'caption') {
      const settings = await getSocialSettings();
      if (!post.script) throw new HttpsError('failed-precondition', 'That piece has no script to rewrite.');
      const writer = assign(await activeTeam(), 'script')?.employee;
      if (!writer) throw new HttpsError('failed-precondition', 'No content writer on the team to rewrite it.');

      await setWork(postId, 'script', {
        state: 'working',
        employeeId: writer.id,
        name: writer.name,
        role: writer.role,
        note: 'Rewriting the caption.',
      });
      const rewritten = await rewriteCaption({
        employee: writer,
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
      await setWork(postId, 'script', {
        state: 'done',
        employeeId: writer.id,
        name: writer.name,
        role: writer.role,
        note: 'Caption rewritten.',
      });
      await creditWork(writer.id);
      return { ok: true, reran: ['caption'] };
    }

    const stages = new Set<Stage>();
    for (const s of scope) for (const stage of SCOPE_STAGES[s]) stages.add(stage);
    stages.add('distribute');

    try {
      await runTeam({
        id: postId,
        date: post.date,
        format: post.format ?? 'reel',
        angle: post.angle,
        stages: [...stages],
        // A script rewrite is a new idea, so the team meets again. A design or
        // ads note is not, so nobody's morning is interrupted for it.
        standup: scope.includes('script'),
      });
      return { ok: true, reran: [...stages] };
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

/** Publish (or re-publish to the networks that failed) an approved piece. */
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
    alt: alt ?? post.seo?.altTexts[(slide ?? 1) - 1] ?? '',
  };

  const media = postMedia(post).filter((m) => !(m.kind === asset.kind && m.slide === asset.slide));
  await patch(postId, {
    media: [...media, asset].sort((a, b) => a.slide - b.slide),
    status: 'awaiting_approval' as PostStatus,
    error: null,
  });
  await setWork(postId, kind === 'video' ? 'video' : 'design', {
    state: 'done',
    name: 'Attached by hand',
    note: `A ${kind} was uploaded from the queue.`,
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
