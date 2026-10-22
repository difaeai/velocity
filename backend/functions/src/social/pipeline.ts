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
 * 2. **Every run ends at `awaiting_approval`, and by default it stops there.**
 *    Everything the team writes is a claim Velocity is making in public, and
 *    the cost of reading one piece a day is nothing next to the cost of the one
 *    that should not have gone out. `autoPublish` exists for an owner who has
 *    decided otherwise and sends it the moment the team is finished, with no
 *    quality gate in front of it; the piece still passes through the same
 *    state, is still scored, and is still readable afterwards.
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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, storage } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { dayKey } from '../analytics';
import { loadCredentials, markAccountError, publishableAccounts } from './accounts';
import { postFolder, refreshAssetUrls, storeFile } from './assets';
import { planContent } from './crew';
import { design, DesignError } from './designer';
import { activeTeam, assign, creditWork, teamRefs } from './employees';
import { activeEngine, modelReady, type Engine } from './engine';
import { captionFor, planDistribution } from './manager';
import { PlatformError, publishTo } from './platforms';
import { latestPageRead, pageReadBlock } from './insights';
import { planReel, renderReel } from './reel';
import { runResearch } from './research';
import { renderStill, stillCards } from './still';
import { draftPost, gatherFacts, rewriteCaption } from './script';
import { adPass, searchPass, seoPass } from './seo';
import { getSocialSettings, nextAngle, nextFormat, recordRun } from './settings';
import { planCut, storeVideo } from './video';
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
  type PostScript,
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

/**
 * Whether a finished piece may go out with nobody having read it.
 *
 * A one-line rule, pulled out as a function because of what it decides: this is
 * the only code path that puts words in front of an audience under the brand's
 * name with no human in the loop, and a rule like that should be readable and
 * testable on its own rather than inlined in a 400-line run.
 *
 * `autoPublish` off means no, which is the default and the whole design.
 *
 * On, it means yes — with one exception: a piece the **local engine** wrote
 * waits for a person. That is not the quality gate that was deliberately left
 * out, and the argument against that gate still stands: the guards worth having
 * live in the writing, and a score threshold mostly blocks pieces that were
 * fine. This asks a different question, one with a definite answer — was this
 * written by a model, or composed from templates? The second kind is reliable
 * and plain, and plain copy going out unread is a different bargain from the
 * one that was agreed to. Either key lifts the hold — a free model counts,
 * because the question is whether something *thought* about the piece, not who
 * was paid for it.
 *
 * Nothing is lost by waiting: the piece is finished, scored, stamped with its
 * engine, and sitting in the queue with Approve enabled.
 */
export function shouldAutoPublish(autoPublish: boolean, modelReady: boolean): boolean {
  return autoPublish && modelReady;
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
        pageRead: settings.learnFromOwnPage ? pageReadBlock(await latestPageRead()) : '',
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
        facts,
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
        // Stamped here rather than at the end of the run: this is the stage
        // where the engine actually decided what the piece says.
        engine: activeEngine(),
        quality: drafted.quality,
      });
      // The scorecard goes in the work log too, so the console shows what the
      // checks thought next to the name of whoever wrote it.
      await done(
        'script',
        writer,
        `${script.viralHook || script.hook} — checks: ${Math.round(drafted.quality.score)}/100 ${drafted.quality.verdict}${
          drafted.note ? ` · ${drafted.note}` : ''
        }`,
      );
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
        angle: params.angle,
        facts,
        feedback,
      });
      await patch(params.id, { search });
      if (search) await done('search', expert, search.note || search.youtube?.title || search.webAngle);
      else await failed('search', expert, 'The search metadata came back unusable.');
    }
  }

  // ── design ────────────────────────────────────────────────────────────────
  //
  // Two jobs, kept apart on purpose: the designer's brief (a person, a model
  // call) and the pictures themselves (ffmpeg and the script). The pictures
  // used to happen only inside a successful brief, so a designer off shift or
  // one refused model call meant a post with no image — "sometimes it just
  // doesn't make one". Now the brief is the designer's and the drawing always
  // happens.
  if (wanted.includes('design')) {
    await patch(params.id, { status: 'designing' as PostStatus });
    const designer = await who('design');
    let direction = existing?.direction ?? null;
    let briefNote = '';
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
        });
        direction = result.direction;
        briefNote = result.note;
        await patch(params.id, { direction });
        // 'briefed' until the pictures exist: a green tick on a stage nobody has
        // finished is how a piece reaches the queue looking ready when it is not.
        // A reel's cover idea is the whole job — the video is the editor's.
        await setWork(params.id, 'design', {
          state: spec.kind === 'image' ? 'briefed' : 'done',
          employeeId: designer.id,
          name: designer.name,
          role: designer.role,
          note: briefNote,
        });
        await creditWork(designer.id);
      } catch (e) {
        const message = e instanceof DesignError ? e.message : (e as Error).message;
        await failed('design', designer, message);
      }
    }

    // Drawn from the brief's words when there is a brief, from the script's when
    // there is not. Anything attached by hand is left alone.
    if (settings.autoRenderVideo && spec.kind === 'image') {
      const drawn = await renderStillsAndAttach({ id: params.id, format: params.format, script, direction });
      if (drawn.made) {
        await setWork(params.id, 'design', {
          state: 'done',
          employeeId: designer?.id ?? null,
          name: designer?.name ?? 'The desk',
          role: designer?.role ?? null,
          note: `${briefNote} Drew ${drawn.made} picture${drawn.made === 1 ? '' : 's'}.`.trim(),
        });
      } else if (drawn.error) {
        await patch(params.id, {
          error: `Pictures: ${drawn.error} — the desk tries again in a few minutes, or press "Make the picture".`,
        });
      }
    }
  }

  // ── the cut ─────────────────────────────────────────────────────────────
  //
  // Same split: the editor's cut brief is a model call that can fail; the reel
  // needs only the script, so it is cut whether or not an editor is on shift
  // and whether or not their brief came back.
  if (wanted.includes('video')) {
    await patch(params.id, { status: 'rendering' as PostStatus });
    const editor = await who('video');
    let cutNote: string | null = null;
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
        cutNote = cut.note;
        await creditWork(editor.id);
      } catch (e) {
        await failed('video', editor, (e as Error).message);
      }
    }

    // A file attached by hand still wins: `renderAndAttach` leaves one alone.
    const rendered = settings.autoRenderVideo
      ? await renderAndAttach({ id: params.id, format: params.format, script })
      : null;
    if (rendered || cutNote !== null) {
      await setWork(params.id, 'video', {
        // No render and no error with rendering on means a video uploaded by hand was kept.
        state: rendered?.error ? 'failed' : rendered?.line || settings.autoRenderVideo ? 'done' : 'briefed',
        employeeId: editor?.id ?? null,
        name: editor?.name ?? 'The desk',
        role: editor?.role ?? null,
        // The render's own last words: "make the video" alone hides why the
        // desk did not, and that is the question asked first.
        note: [
          cutNote,
          rendered?.line
            ? `Video made — ${rendered.line}.`
            : rendered?.error
              ? 'Could not make the video. The desk tries again in a few minutes, or upload your own.'
              : settings.autoRenderVideo
                ? 'Kept the video you uploaded.'
                : 'Upload the video from the queue.',
        ]
          .filter(Boolean)
          .join(' '),
        error: rendered?.error ?? null,
      });
    }
    if (rendered?.error) {
      await patch(params.id, {
        error: `Video: ${rendered.error} — the desk tries again in a few minutes, or press "Make the video".`,
      });
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
        angle: params.angle,
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

  await patch(params.id, { status: 'awaiting_approval' as PostStatus });


  // ── and out, if that is how this desk is run ──────────────────────────────
  //
  // The default is still that a person reads it. Switched on, `autoPublish`
  // sends it the moment the team is finished, with nothing in front of it —
  // no score threshold, no hold-back. The guards that remain are the ones in
  // the writing rather than in a gate: the FACTS rule, no competitor named, no
  // promised income. The scorecard is still computed and still stored, so a
  // weak piece that went out can be found afterwards; it is simply not stopped.
  //
  // A piece made with "Make one now" carries the choice made on that button,
  // which beats the desk-wide setting for that one piece.
  const finished = (await postRef(params.id).get()).data() as (SocialPost & { autoPublish?: boolean | null }) | undefined;
  const publishWhenDone = finished?.autoPublish ?? settings.autoPublish;
  if (!shouldAutoPublish(publishWhenDone, modelReady())) {
    // Deliberately not written to `error`: the queue renders that in red, and
    // a finished piece waiting to be read is not a failure. The `engine` stamp
    // is already on the document and the queue says what it means.
    if (publishWhenDone) {
      logger.info('social: holding a locally written piece for approval', { id: params.id });
    }
    return;
  }

  {
    const quality = finished?.quality ?? null;
    try {
      const { published, failed: failures } = await publishPost(params.id);
      // `auto` rather than a uid, because "who approved this" is a question
      // somebody asks a year later and "nobody did" is the honest answer.
      await patch(params.id, { approvedBy: 'auto' });
      logger.info('social: published without approval', {
        id: params.id,
        published,
        failed: failures,
        score: quality ? Math.round(quality.score) : null,
        verdict: quality?.verdict ?? null,
      });
    } catch (e) {
      // A failed publish leaves the piece exactly where a normal run would:
      // readable, in the queue, retryable by hand — and says why, because an
      // auto-post that silently did not happen looks exactly like one that did.
      const message = (e as Error).message;
      logger.error('social: auto-publish failed', { id: params.id, message });
      await patch(params.id, { error: `Could not post it on its own: ${message}` });
    }
  }
}

/**
 * Render the reel and hang it on the piece.
 *
 * Returns a line for the work log, or null if nothing was made — a failure
 * here is never fatal. The brief, the script and the frames all survive, the
 * queue still offers the upload control it always did, and the next morning's
 * run is unaffected. A missing video is a worse post; a failed run is no post.
 *
 * A video somebody attached by hand is never overwritten. If somebody shot the
 * real thing, that is the piece, and a generated one replacing it overnight
 * would be the single most annoying thing this desk could do. A reel this desk
 * cut is cut again: the only way back here with one is a change request, and
 * keeping it posted the old words under the new caption.
 */
async function renderAndAttach(params: {
  id: string;
  format: ContentFormat;
  script: PostScript;
}): Promise<{ line: string | null; error: string | null } | null> {
  const spec = FORMAT_SPECS[params.format];
  if (spec.kind !== 'video') return null;

  const existing = (await postRef(params.id).get()).data() as SocialPost | undefined;
  const media = postMedia(existing ?? {});
  if (media.some((m) => m.kind === 'video' && m.url && m.provider !== 'velocity-render')) return null;

  try {
    // Slides already attached to this piece become the backdrop. Almost always
    // there are none, which is the case the typography is built for.
    const images = media.filter((m) => m.kind === 'image' && m.storagePath).slice(0, 6);
    const local = await downloadForRender(images);

    try {
      const plan = planReel({ script: params.script, format: params.format });
      const bytes = await renderReel(plan, { localImages: local.paths });
      const stored = await storeVideo(params.id, bytes);

      const asset: MediaAsset = {
        kind: 'video',
        provider: 'velocity-render',
        model: null,
        jobId: null,
        storagePath: stored.path,
        url: stored.url,
        urlExpiresAtMs: stored.expiresAtMs,
        durationSec: plan.seconds,
        aspect: spec.aspect,
        slide: 1,
        alt: params.script.hook,
      };

      // Slides stay: a carousel's images and the reel made from them are both
      // the piece, and the publisher picks by format.
      // error: a failed render's message would otherwise sit under a finished reel.
      await patch(params.id, { media: [...media.filter((m) => m.kind !== 'video'), asset], error: null });
      return { line: `${plan.seconds}s, ${(bytes.length / 1024 / 1024).toFixed(1)} MB`, error: null };
    } finally {
      await local.cleanup();
    }
  } catch (e) {
    const message = (e as Error).message;
    logger.error('social: could not render the reel', { id: params.id, message });
    // The old reel says the old words: better nothing to post than that.
    await patch(params.id, { media: media.filter((m) => m.kind !== 'video') });
    return { line: null, error: message.slice(0, 240) };
  }
}

/**
 * Draw the pictures a still piece needs and hang them on it.
 *
 * Slides somebody attached by hand are never touched. Slides this desk drew
 * before are drawn again, because the only way back here for a piece that
 * already has them is a "redraw it" note, and that note is about the words.
 * Never fatal: a failure returns its message for the work log.
 */
async function renderStillsAndAttach(params: {
  id: string;
  format: ContentFormat;
  script: PostScript;
  direction: { overlay: string; alt: string }[] | null;
}): Promise<{ made: number; error: string | null }> {
  const spec = FORMAT_SPECS[params.format];
  if (spec.kind !== 'image') return { made: 0, error: null };

  const existing = postMedia(((await postRef(params.id).get()).data() as SocialPost | undefined) ?? {});
  const byHand = new Set(
    existing.filter((m) => m.kind === 'image' && m.url && m.provider !== 'velocity-render').map((m) => m.slide),
  );

  const made: MediaAsset[] = [];
  try {
    const cards = stillCards({ format: params.format, script: params.script, direction: params.direction });
    for (const [i, card] of cards.entries()) {
      const slide = i + 1;
      if (byHand.has(slide)) continue;
      const stored = await storeFile({
        path: `${postFolder(params.id)}/slide-${slide}.jpg`,
        bytes: await renderStill(card),
        contentType: 'image/jpeg',
      });
      made.push({
        kind: 'image',
        provider: 'velocity-render',
        model: null,
        jobId: null,
        storagePath: stored.path,
        url: stored.url,
        urlExpiresAtMs: stored.expiresAtMs,
        durationSec: null,
        aspect: spec.aspect,
        slide,
        alt: params.direction?.[i]?.alt || params.script.hook,
      });
    }
  } catch (e) {
    const message = (e as Error).message;
    logger.error('social: could not draw the pictures', { id: params.id, message });
    if (!made.length) {
      // Pictures drawn for an earlier version show its words, so they go too.
      await patch(params.id, {
        media: existing.filter((m) => !(m.kind === 'image' && m.provider === 'velocity-render')),
      });
      return { made: 0, error: message.slice(0, 240) };
    }
  }

  if (made.length) {
    const drawn = new Set(made.map((m) => m.slide));
    const kept = existing.filter((m) => !(m.kind === 'image' && drawn.has(m.slide)));
    await patch(params.id, { media: [...kept, ...made].sort((a, b) => a.slide - b.slide), error: null });
  }
  return { made: made.length, error: null };
}

/** Pull attached slides onto local disk so ffmpeg can read them. */
async function downloadForRender(
  images: MediaAsset[],
): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  if (!images.length) return { paths: [], cleanup: async () => {} };

  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-slides-'));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const paths: string[] = [];
    for (const [i, image] of images.entries()) {
      const [bytes] = await storage.bucket().file(image.storagePath as string).download();
      const file = path.join(dir, `slide-${i}.png`);
      await writeFile(file, bytes);
      paths.push(file);
    }
    return { paths, cleanup };
  } catch (e) {
    // A slide that will not download is not worth losing the video over: the
    // typography render needs no images at all.
    logger.warn('social: could not fetch the slides for the render', { message: (e as Error).message });
    await cleanup();
    return { paths: [], cleanup: async () => {} };
  }
}

/** Create the document, then put the team on it. */
async function createPost(opts: {
  /** Defaults to the date-and-format id the scheduler relies on. */
  id?: string;
  date: string;
  format: ContentFormat;
  angle?: string;
  targets?: Platform[];
  /** What the person asked for in their own words. Read by everyone on it. */
  brief?: { text: string; by: string };
  /** Overrides the desk-wide `autoPublish` for this one piece. */
  publishWhenDone?: boolean;
}): Promise<string> {
  const settings = await getSocialSettings();
  const angle = opts.angle ?? (await nextAngle(settings));
  const id = opts.id ?? postIdFor(opts.date, opts.format);

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
    quality: null,
    // A brief rides the same rail as a change request: every stage is handed
    // the revisions, and the prompts already treat them as orders.
    revisions: opts.brief
      ? [
          {
            atMs: Date.now(),
            by: opts.brief.by,
            feedback: `What this piece must be about: ${opts.brief.text}`,
            scope: ['script'],
          } satisfies Revision,
        ]
      : [],
    autoPublish: opts.publishWhenDone ?? null,
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

/**
 * A claim on a piece that is going out, older than this, belongs to a function
 * that died: it is longer than the longest run is allowed to live.
 */
const STALE_PUBLISH_MS = (RUN_TIMEOUT_SECONDS + 60) * 1000;

/**
 * Take the piece for publishing — and decide where it still has to go — or
 * refuse.
 *
 * All of it inside one transaction, on the document as it is at that instant.
 * Two publishers can reach the same piece at once — a double-click, the
 * approve call and the sweep — and one that read the piece a moment before the
 * other finished would otherwise see no results and post it a second time. On
 * an account this size a duplicate post is a public mistake, not a log line.
 */
export async function claimForPublish(id: string, only?: Platform[]): Promise<{ post: SocialPost; targets: Platform[] }> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef(id));
    const post = snap.data() as (SocialPost & { publishingSinceMs?: number }) | undefined;
    if (!post) throw new HttpsError('not-found', 'No such post.');
    if (post.status === 'publishing' && Date.now() - (post.publishingSinceMs ?? 0) < STALE_PUBLISH_MS) {
      throw new HttpsError('already-exists', 'It is already going out — the queue shows each network as it lands.');
    }
    if (!postMedia(post).length) {
      throw new HttpsError('failed-precondition', 'That piece has nothing to publish yet. Make the picture or video, or upload your own, first.');
    }

    const format = post.format ?? 'reel';
    const live = (p: Platform) => post.results?.[p]?.ok === true;
    const targets = (only ?? post.targets ?? []).filter((p) => supports(p, format) && !live(p));
    if (!targets.length) {
      throw new HttpsError(
        'failed-precondition',
        (post.targets ?? []).some(live)
          ? 'It is already live everywhere it was meant to go.'
          : 'None of the selected networks can take this format.',
      );
    }

    tx.set(
      postRef(id),
      { status: 'publishing', publishingSinceMs: Date.now(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { post, targets };
  });
}

/**
 * Post one approved piece everywhere it is meant to go.
 *
 * A network that already took it is skipped, so pressing Post again after a
 * partial failure retries only the ones that refused — never a second copy on
 * the ones that worked.
 */
async function publishPost(id: string, only?: Platform[]): Promise<{ published: number; failed: number }> {
  const { post, targets } = await claimForPublish(id, only);
  const format = post.format ?? 'reel';
  const live = (p: Platform) => post.results?.[p]?.ok === true;
  let media = postMedia(post);

  // Signed URLs age out; a piece retried a week later needs fresh ones.
  const refreshed = await refreshAssetUrls(media);
  if (refreshed.some((m, i) => m.url !== media[i].url)) {
    media = refreshed;
    await patch(id, { media });
  }

  // Whoever manages social signs the post — and it is their name in the log.
  const team = await activeTeam();
  const manager = assign(team, 'distribute')?.employee ?? null;
  const signed = { employeeId: manager?.id ?? null, name: manager?.name ?? 'The desk', role: manager?.role ?? null };

  const results: Record<string, unknown> = {};
  let published = 0;
  let failed = 0;

  // Sequential on purpose: five networks pulling the same file at once is how
  // you find out about rate limits, and one failure should not abort the rest.
  for (const [i, platform] of targets.entries()) {
    // Said per network, because Instagram takes a minute or two over a reel and
    // a log that reads "posting" for that long looks exactly like a hang.
    await setWork(id, 'distribute', {
      state: 'working',
      ...signed,
      note: `Posting to ${platform}${targets.length > 1 ? ` (${i + 1} of ${targets.length})` : ''}…`,
    });
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
        title: post.script?.hook ?? 'Velocity Rides',
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

  // Judged over every network the piece was meant for, counting the ones an
  // earlier attempt already got it onto.
  const merged = { ...post.results, ...results } as SocialPost['results'];
  const meant = (post.targets ?? []).filter((p) => supports(p, format));
  const liveNow = meant.filter((p) => merged[p]?.ok).length;
  const status: PostStatus = liveNow === 0 ? 'failed' : liveNow < meant.length ? 'partial' : 'published';
  await patch(id, {
    status,
    results: merged,
    ...(published > 0 && !meant.some(live) ? { publishedAt: FieldValue.serverTimestamp() } : {}),
    error: liveNow === 0 ? 'Every network rejected the post — see the per-network errors.' : null,
  });
  await setWork(id, 'distribute', {
    state: published > 0 ? 'done' : 'failed',
    ...signed,
    note: `${published} posted, ${failed} failed.`,
    error: published === 0 ? 'No network accepted it.' : null,
  });
  if (manager && published > 0) await creditWork(manager.id);

  return { published, failed };
}

// ── the trigger ─────────────────────────────────────────────────────────────

/** One scheduled day: whatever formats today calls for, all of them queued. */
async function runDaily(date: string): Promise<string> {
  const settings = await getSocialSettings();
  const wanted = Math.max(1, Math.min(settings.postsPerDay, FORMATS.length));
  const made: string[] = [];

  /** Queue one piece, unless this date already has that format. */
  const queue = async (format: ContentFormat): Promise<void> => {
    const id = postIdFor(date, format);
    if ((await postRef(id).get()).exists) return;
    try {
      await createPost({ date, format });
      made.push(format);
    } catch (e) {
      logger.error('social: a scheduled piece failed', { date, format, message: (e as Error).message });
    }
  };

  for (let i = 0; i < wanted; i++) {
    // Re-read: nextFormat advances the stored index, so a second piece the same
    // morning has to see the first one's advance or it makes the same format
    // twice and then skips itself on the duplicate id.
    await queue(await nextFormat(await getSocialSettings()));
  }

  // The story is not part of the rotation — it goes out every day the desk
  // runs, because an account with a ring on it most days reads as a company
  // somebody works at. `queue` is a no-op if the rotation already landed on a
  // story this morning, so this never doubles up.
  if (settings.dailyStory) await queue('story');

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
    // 2GiB rather than 1 because a run can now end in an ffmpeg render, and
    // on Cloud Functions the memory tier is what buys the CPU that finishes
    // it in seconds rather than minutes.
    memory: '2GiB',
  },
  async () => {
    const settings = await getSocialSettings();
    if (!settings.enabled) return;

    const nowPkt = new Date(Date.now() + 5 * 3600_000);
    if (nowPkt.getUTCHours() !== settings.runHour) return;

    if (!(await activeTeam()).length) {
      await recordRun('Skipped: nobody is on the team. Hire someone on the Employees page.');
      return;
    }

    const date = dayKey(Date.now());
    try {
      const outcome = await runDaily(date);
      // Which engine ran is recorded with the outcome: the four produce
      // visibly different work, and "why does today read like a template"
      // should be answerable from the run log rather than guessed at. Claude
      // gets no suffix because it is the one everything else is compared to.
      const RAN: Record<Engine, string> = {
        claude: '',
        gemini: ' (written by Gemini’s free tier)',
        free: ' (written by the free model)',
        local: ' (written locally, no model)',
      };
      await recordRun(`${outcome}${RAN[activeEngine()]}`);
      logger.info('social: daily run finished', { date, outcome });
    } catch (e) {
      const message = (e as Error).message;
      logger.error('social: daily run failed', { date, message });
      await recordRun(`Failed: ${message}`);
    }
  },
);

/** A written piece still missing its picture or video, with automatic tries left. */
export function needsMedia(post: Partial<SocialPost> & { renderTries?: number }): boolean {
  if (!post.script || (post.renderTries ?? 0) >= 3) return false;
  const kind = FORMAT_SPECS[post.format ?? 'reel'].kind;
  return !postMedia(post).some((m) => m.kind === kind && m.url);
}

/** Make a piece's pictures or video from its script. The queue's button and the sweep share it. */
async function makeMedia(postId: string, post: SocialPost): Promise<{ made: number; error: string | null }> {
  const format = post.format ?? 'reel';
  const script = post.script as PostScript;
  if (FORMAT_SPECS[format].kind === 'video') {
    const out = await renderAndAttach({ id: postId, format, script });
    if (out?.line) await setWork(postId, 'video', { state: 'done', name: 'The desk', note: `Video made — ${out.line}.` });
    return { made: out?.line ? 1 : 0, error: out?.error ?? null };
  }
  const out = await renderStillsAndAttach({ id: postId, format, script, direction: post.direction });
  if (out.made) {
    await setWork(postId, 'design', {
      state: 'done',
      name: 'The desk',
      note: `Drew ${out.made} picture${out.made === 1 ? '' : 's'}.`,
    });
  }
  return out;
}

/**
 * Every five minutes: post what was approved, and free what got stuck.
 *
 * Approving used to post only while the browser tab waited for it, so a closed
 * tab or a slow network left a piece in `ready` — "going out" on the overview —
 * forever. Only pieces approved since this sweep existed carry
 * `publishQueuedAtMs`; an older `ready` piece may already have been posted by
 * hand, so it is left for a person rather than risked as a duplicate.
 */
export const socialPublishSweep = onSchedule(
  // 2GiB because it may cut a reel, and on Cloud Functions the memory tier buys the CPU.
  { schedule: 'every 5 minutes', region: REGION, timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '2GiB' },
  async () => {
    // A picture or video the run could not make is made here, so nobody has to
    // press for it. Recent pieces only, two a pass (a reel takes a minute), and
    // `needsMedia` stops after three tries. Before the posting below, so an
    // approved piece that was missing its file goes out in the same pass.
    if ((await getSocialSettings()).autoRenderVideo) {
      const recent = await db
        .collection('socialPosts')
        .where('date', '>=', dayKey(Date.now() - 3 * 86_400_000))
        .get();
      const due = recent.docs
        .filter((d) => ['awaiting_approval', 'ready', 'failed'].includes(d.get('status')) && needsMedia(d.data()))
        .slice(0, 2);
      for (const doc of due) {
        await patch(doc.id, { renderTries: FieldValue.increment(1) });
        const out = await makeMedia(doc.id, doc.data() as SocialPost);
        if (out.made && doc.get('status') === 'failed') await patch(doc.id, { status: 'awaiting_approval' as PostStatus });
        if (out.error) await patch(doc.id, { error: `Could not make the picture or video: ${out.error}` });
      }
    }

    const MAKING: PostStatus[] = ['planning', 'researching', 'drafting', 'optimising', 'designing', 'rendering'];
    const snap = await db
      .collection('socialPosts')
      .where('status', 'in', ['ready', 'publishing', ...MAKING])
      .limit(30)
      .get();
    for (const doc of snap.docs) {
      const post = doc.data() as SocialPost & {
        publishingSinceMs?: number;
        publishQueuedAtMs?: number;
        updatedAt?: { toMillis(): number };
      };

      // A run killed by its own timeout leaves the piece "being made" forever —
      // the overview shows it in production and nobody can act on it. Every
      // stage writes as it goes, so one untouched for longer than a run may
      // live belongs to a function that is gone.
      if (MAKING.includes(post.status)) {
        if (Date.now() - (post.updatedAt?.toMillis() ?? 0) < STALE_PUBLISH_MS) continue;
        await patch(doc.id, {
          status: 'failed' as PostStatus,
          error: post.script
            ? 'The team ran out of time on this one. The desk finishes the picture or video on its own, or ask for changes.'
            : 'The team ran out of time before anything was written. Make it again.',
        });
        continue;
      }

      if (post.status === 'publishing') {
        if (Date.now() - (post.publishingSinceMs ?? 0) < STALE_PUBLISH_MS) continue;
        await patch(doc.id, {
          status: 'failed' as PostStatus,
          error: 'Posting stopped part-way. Press Post again — networks that already have it are skipped.',
        });
        continue;
      }

      if (!post.publishQueuedAtMs || Date.now() - post.publishQueuedAtMs > 24 * 3600_000) continue;
      try {
        await publishPost(doc.id);
      } catch (e) {
        if (e instanceof HttpsError && e.code === 'already-exists') continue;
        // Back to the person, with the reason, rather than retried every five
        // minutes for a piece that cannot go out as it stands.
        await patch(doc.id, { status: 'awaiting_approval' as PostStatus, error: (e as Error).message });
      }
    }
  },
);

// ── console actions ─────────────────────────────────────────────────────────

const formatSchema = z.enum(FORMATS);

/** "Put the team on it" — the same run the scheduler does, on demand. */
export const adminGenerateSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '2GiB' },
  async (req) => {
    const ctx = requireAdmin(req);
    const parsed = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        format: formatSchema.optional(),
        angle: z.string().min(2).max(60).optional(),
        targets: z.array(z.enum(PLATFORMS)).optional(),
        replace: z.boolean().optional(),
        /** "Make one about…", in the person's own words. */
        brief: z.string().trim().min(3).max(1500).optional(),
        /** Post it the moment it is finished, or wait in the queue. */
        publishWhenDone: z.boolean().optional(),
      })
      .safeParse(req.data ?? {});
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

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
    let id = postIdFor(date, format);

    const existing = (await postRef(id).get()).data() as SocialPost | undefined;
    if (existing && !parsed.data.replace) {
      throw new HttpsError(
        'already-exists',
        `${date} already has a ${format}. Open it, ask for changes, or pass replace.`,
      );
    }
    // "Replace" writes over a piece that failed or was turned down, and nothing
    // else. A draft somebody asked for an hour ago, an approved piece or a live
    // one (whose record holds the links and the numbers) all stay; a second
    // piece the same day takes the next free id instead.
    if (existing && !['failed', 'rejected'].includes(existing.status)) {
      let free: string | null = null;
      for (let n = 2; n < 100 && !free; n++) {
        const candidate = `${postIdFor(date, format)}-${n}`;
        if (!(await postRef(candidate).get()).exists) free = candidate;
      }
      if (!free) throw new HttpsError('resource-exhausted', `${date} already has too many of those.`);
      id = free;
    }

    try {
      await createPost({
        id,
        date,
        format,
        angle: parsed.data.angle,
        targets: parsed.data.targets,
        brief: parsed.data.brief ? { text: parsed.data.brief, by: ctx.uid } : undefined,
        publishWhenDone: parsed.data.publishWhenDone,
      });
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
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '2GiB' },
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
      // A new version earns the sweep's three tries at its picture or video again.
      renderTries: 0,
    });

    // A caption-only note never touches the media, and never re-briefs a stage.
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
        quality: rewritten.quality,
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

    // Approved means it goes out. `publishQueuedAtMs` is what the sweep below
    // looks for, so a piece approved without "now" — or whose tab was closed
    // mid-post — is still posted within minutes rather than sitting in `ready`.
    await patch(postId, {
      status: 'ready' as PostStatus,
      approvedBy: ctx.uid,
      publishQueuedAtMs: Date.now(),
      error: null,
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
 * "Render it" — make the pictures or the reel now, for a piece that has none.
 *
 * The same two renderers the run uses, on demand: a piece written before the
 * desk drew its own stills, or one whose render failed, can be finished from
 * the queue without re-running the team. A failure answers with the renderer's
 * own last words rather than "something went wrong".
 */
export const adminRenderSocialPost = onCall(
  { timeoutSeconds: RUN_TIMEOUT_SECONDS, memory: '2GiB' },
  async (req) => {
    requireAdmin(req);
    const parsed = z.object({ postId: z.string().min(1).max(64) }).safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
    const { postId } = parsed.data;

    const post = (await postRef(postId).get()).data() as SocialPost | undefined;
    if (!post) throw new HttpsError('not-found', 'No such post.');
    if (!post.script) throw new HttpsError('failed-precondition', 'Nothing is written yet, so there is nothing to draw.');
    if (WORKING_STATUSES.includes(post.status)) {
      throw new HttpsError('failed-precondition', 'The team is still working on that one.');
    }

    const out = await makeMedia(postId, post);
    if (out.error) throw new HttpsError('internal', `Could not make it: ${out.error}`);
    return { ok: true, made: out.made };
  },
);

/**
 * Instagram publishes JPEG and nothing else ("JPEG is the only image format
 * supported"), so an attached PNG or WebP is converted here rather than refused
 * there, after the approval. Phone photos are turned upright first, because the
 * EXIF tag that says which way is up does not survive the re-encode; 1440 is
 * Instagram's own maximum width and keeps the file under its 8 MB cap.
 */
async function asJpeg(bytes: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  try {
    return await sharp(bytes)
      .rotate()
      .resize({ width: 1440, withoutEnlargement: true })
      .flatten()
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new HttpsError('invalid-argument', 'That image could not be read. Export it as a JPEG or PNG and attach it again.');
  }
}

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
          path: `${postFolder(postId)}/slide-${slide ?? 1}.jpg`,
          bytes: await asJpeg(bytes),
          contentType: 'image/jpeg',
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
