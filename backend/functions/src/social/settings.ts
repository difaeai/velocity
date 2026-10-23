/**
 * Automation settings — one document, read by the crew and edited from the
 * console.
 *
 * Lives under `system/` rather than `config/` because `config/{doc}` is readable
 * by every signed-in user — ride settings and fares belong there, the marketing
 * brief does not. Every field is validated on write: the daily job runs
 * unattended, so a bad value here is a bad post in front of the whole audience.
 *
 * This document is also where "tell all of them something" lives:
 * `crewInstructions` is prepended to every employee's system prompt on every
 * job. Direction for one *person* is not here — it lives on that employee's own
 * record, because it should follow them and disappear when they do.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { deskCall, sdb } from './workspace';
import { activeTeam, coverageGaps } from './employees';
import { activeEngine } from './engine';
import { tokenVaultReady } from './secrets';
import {
  DEFAULT_SETTINGS,
  EMPTY_BRIEF,
  FORMATS,
  PLATFORMS,
  type ContentFormat,
  type SocialSettings,
} from './types';

const SETTINGS_PATH = 'system/socialAutomation';

export async function getSocialSettings(): Promise<SocialSettings> {
  const snap = await sdb.doc(SETTINGS_PATH).get();
  const stored = (snap.data() as Partial<SocialSettings> | undefined) ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    // A spread would replace the whole brief with whatever subset was last
    // written, so a document saved before a field existed would leave that
    // field undefined and every `.trim()` downstream would throw.
    brief: { ...EMPTY_BRIEF, ...(stored.brief ?? {}) },
  };
}

/** Write settings from the backend itself — the launch sequence, never a person (that is the callable below). */
export async function patchSettings(fields: Partial<SocialSettings>): Promise<void> {
  await sdb.doc(SETTINGS_PATH).set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function recordRun(status: string): Promise<void> {
  await sdb.doc(SETTINGS_PATH).set(
    { lastRunAtMs: Date.now(), lastRunStatus: status.slice(0, 300) },
    { merge: true },
  );
}

/** Advance the angle rotation and return the angle for this run. */
export async function nextAngle(settings: SocialSettings): Promise<string> {
  const angles = settings.angles.length ? settings.angles : DEFAULT_SETTINGS.angles;
  const index = (settings.lastAngleIndex + 1) % angles.length;
  await sdb.doc(SETTINGS_PATH).set({ lastAngleIndex: index }, { merge: true });
  return angles[index];
}

/** Advance the format rotation and return the format for this run. */
export async function nextFormat(settings: SocialSettings): Promise<ContentFormat> {
  const formats = settings.formats.length ? settings.formats : DEFAULT_SETTINGS.formats;
  const index = (settings.lastFormatIndex + 1) % formats.length;
  await sdb.doc(SETTINGS_PATH).set({ lastFormatIndex: index }, { merge: true });
  return formats[index];
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  runHour: z.number().int().min(0).max(23).optional(),
  postsPerDay: z.number().int().min(1).max(5).optional(),
  makeAheadDays: z.number().int().min(0).max(31).optional(),
  dailyStory: z.boolean().optional(),
  autoRenderVideo: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  publishModeChosen: z.boolean().optional(),
  learnFromOwnPage: z.boolean().optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),

  angles: z.array(z.string().min(2).max(60)).min(1).max(30).optional(),
  formats: z.array(z.enum(FORMATS)).min(1).max(20).optional(),

  crewInstructions: z.string().max(4000).optional(),
  // The long brief is read on every job forever, so the limits are generous:
  // a paragraph that stops one bad post a day is worth more than the tokens.
  brief: z
    .object({
      about: z.string().max(6000),
      posts: z.string().max(6000),
      viral: z.string().max(6000),
      comments: z.string().max(6000),
      avoid: z.string().max(6000),
    })
    .partial()
    .optional(),

  researchEnabled: z.boolean().optional(),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(80), url: z.string().max(300) }))
    .max(12)
    .optional(),

  textModel: z.string().min(1).max(120).optional(),

  engagementEnabled: z.boolean().optional(),
  autoReply: z.boolean().optional(),
});

export const adminGetSocialSettings = deskCall('any', async () => {
  const settings = await getSocialSettings();
  return {
    settings,
    /**
     * What is actually wired up. The console shows this as a checklist rather
     * than letting someone switch automation on and discover at 10am that no
     * key was ever added.
     */
    readiness: {
      /**
       * Whether anybody here can produce anything, which is now always yes:
       * with no key the local engine writes instead of the model. It is kept
       * as a field rather than deleted because `engine` below is the part
       * worth reading, and a console that says "the team cannot think" when
       * the team demonstrably just wrote something is worse than no checklist.
       */
      writer: true,
      /** Which of the four engines a run would actually use today. */
      engine: activeEngine(),
      tokenVault: tokenVaultReady(),
    },
    /** What the current roster can and cannot do, in words. */
    coverage: coverageGaps(await activeTeam()),
    staffed: (await activeTeam()).length,
  };
});

export const adminUpdateSocialSettings = deskCall('any', async (req) => {
  const ctx = requireAuth(req);
  const parsed = settingsSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settings.');

  // The key used to be a precondition here, because without one the crew could
  // not produce anything and a schedule that fails every morning is worse than
  // one that was never switched on. The local engine removed that failure, so
  // the guard went with it: a run with no key now writes a weaker piece rather
  // than no piece. An empty desk is still a real stop, and is still checked.

  // A schedule with an empty office produces one failed run a day, forever.
  if (parsed.data.enabled === true && !(await activeTeam()).length) {
    throw new HttpsError(
      'failed-precondition',
      'Automation cannot be enabled: nobody works here yet. Hire at least a content writer first.',
    );
  }

  // Auto-reply publishes words to real customers under Velocity's name. It is
  // allowed, but only with the inbox switched on and a key behind it.
  if (parsed.data.autoReply === true) {
    const current = await getSocialSettings();
    const engagementOn = parsed.data.engagementEnabled ?? current.engagementEnabled;
    if (!engagementOn) {
      throw new HttpsError(
        'failed-precondition',
        'Turn the comment inbox on before letting it reply on its own.',
      );
    }
  }

  await sdb.doc(SETTINGS_PATH).set(
    { ...parsed.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid },
    { merge: true },
  );
  return { ok: true, settings: await getSocialSettings() };
});
