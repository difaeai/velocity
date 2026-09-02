/**
 * The editing stage — whoever holds the video-editor job runs it.
 *
 * One job now: the cut. A model call in the editor's own voice that turns the
 * writer's shots and the designer's cover frame into a second-by-second edit —
 * what moves, where the interrupt lands, what the audio is doing. The file
 * itself is shot, edited or rendered somewhere else and attached to the piece
 * from the queue, and goes out through exactly the same publish path either way.
 *
 * The cut is a model call rather than a template because a video brief is where
 * a piece is won or lost. "Driver counts cash" gets you a man holding money;
 * "hold on his hands for 1.5s, cut wide as the note count lands, lime text
 * stamps in on the beat" gets you something someone watches twice. That is true
 * of a person reading it and of any tool you paste it into.
 */
import { logger } from 'firebase-functions';

import { feedbackBlock, planBlock, systemFor } from './crew';
import { postFolder, storeFile } from './assets';
import { generateJson } from './claude';
import {
  FORMAT_SPECS,
  type ContentFormat,
  type ContentPlan,
  type Employee,
  type PostScript,
  type SearchPack,
  type SocialSettings,
} from './types';

// ── the cut ─────────────────────────────────────────────────────────────────

export interface Cut {
  /** The brief handed to whoever makes the file. */
  prompt: string;
  /** One line for the console, so an operator can see what was cut. */
  note: string;
}

/**
 * The editor writes the edit. Falls back to assembling the script directly if
 * the model call fails — a plainer video is a better outcome than no video.
 */
export async function planCut(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  /** The YouTube title, when the search desk has already written one. */
  search: SearchPack | null;
  feedback: string[];
}): Promise<Cut> {
  const spec = FORMAT_SPECS[params.format];

  try {
    const { data } = await generateJson<{ prompt?: unknown; note?: unknown }>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings)}

You are writing a single brief for whoever makes this video — a person with a camera and an editor, or a text-to-video tool. Assume no second take and no chance to ask you a question, so the brief carries everything: the shot order with rough timings, camera movement, lighting, wardrobe, the spoken voiceover verbatim, the on-screen text verbatim, and what the audio bed is doing.

Write it as directions, not as prose. Never ask for more than the seconds allow.

Reply with one JSON object and nothing else:
{ "prompt": "the full video prompt", "note": "one line describing the cut, for the console" }`,
      what: 'The cut',
      prompt: [
        `FORMAT: ${spec.label}, ${spec.aspect}, ${spec.seconds} seconds.`,
        planBlock(params.plan, params.employee),
        '',
        `HOOK (this is second zero): ${params.script.hook}`,
        'SHOTS:',
        ...params.script.frames.map(
          (f, i) => `${i + 1}. ${f.scene}${f.overlay ? ` — on screen: "${f.overlay}"` : ''}`,
        ),
        '',
        params.script.voiceover ? `VOICEOVER, spoken exactly:\n"${params.script.voiceover}"` : '',
        params.script.cta ? `ENDS ON: ${params.script.cta}` : '',
        params.search?.youtube?.title
          ? `This is going out on YouTube as: "${params.search.youtube.title}" — the opening has to deliver that promise.`
          : '',
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const prompt = typeof data.prompt === 'string' ? data.prompt.trim().slice(0, 4000) : '';
    if (prompt) {
      return {
        prompt,
        note: (typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '') || 'Cut written.',
      };
    }
  } catch (e) {
    logger.warn('social: the editor could not write a cut; falling back to the script', {
      message: (e as Error).message,
    });
  }

  return { prompt: assembleCut(params.script, spec.aspect), note: 'Cut assembled straight from the script.' };
}

/**
 * The fallback prompt, built without a model call. Kept because a render that
 * happens is worth more than one that waited for a second opinion.
 */
export function assembleCut(script: PostScript, aspect: string): string {
  return [
    `A ${aspect} short-form advert for Velocity, a ride-hailing app in Pakistan.`,
    'Look: modern Pakistani city streets — Lahore, Karachi, Islamabad — real cars, real drivers, natural daylight.',
    'Brand palette: near-black (#1a1c1c) and bright lime (#ccff00). Clean, confident, no stock-footage cheesiness.',
    '',
    'Shots:',
    ...script.frames.map((f, i) => `${i + 1}. ${f.scene}`),
    '',
    script.voiceover ? `Spoken voiceover: "${script.voiceover}"` : '',
    script.frames.some((f) => f.overlay)
      ? `On-screen text overlays: ${script.frames.map((f) => f.overlay).filter(Boolean).join(' / ')}`
      : '',
    script.cta ? `Ends on: ${script.cta}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Put a finished MP4 in the bucket under the post it belongs to. */
export async function storeVideo(
  postId: string,
  bytes: Buffer,
): Promise<{ path: string; url: string; expiresAtMs: number }> {
  return storeFile({ path: `${postFolder(postId)}/video.mp4`, bytes, contentType: 'video/mp4' });
}
