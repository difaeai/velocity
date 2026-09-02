/**
 * The design stage — whoever holds the designer job runs it.
 *
 * They take the script's frames and turn them into a brief: one prompt per
 * carousel slide, one for a post or a story, and a cover frame for a video.
 *
 * **Nothing is drawn here.** Pictures are made by hand, outside this backend,
 * and attached to the piece from the queue. So what this stage owes you is a
 * brief good enough to make a picture from without asking a second question —
 * which is why it survived the renderer being removed and the render call did
 * not. The direction pass sees all the frames at once, which is the difference
 * between a set of slides that look like one campaign and five unrelated ones.
 *
 * The prompt stored on the post is therefore the *whole* prompt: the art
 * direction, the overlay instruction, the house style and the aspect ratio,
 * composed and ready to paste into whatever tool you draw with. Splitting those
 * apart made sense while something downstream reassembled them; now the person
 * reading it is the renderer.
 */
import { feedbackBlock, planBlock, systemFor } from './crew';
import { generateJson } from './claude';
import {
  FORMAT_SPECS,
  type ContentFormat,
  type ContentPlan,
  type Employee,
  type PostScript,
  type SeoPack,
  type SocialSettings,
} from './types';

export class DesignError extends Error {}

/**
 * The house style, carried on every prompt. Repeated per frame rather than
 * stated once, because each frame is drawn on its own and nothing remembers
 * what the last one looked like.
 */
const HOUSE_STYLE = [
  'Photographic, editorial quality, shot on a full-frame camera. Natural Pakistani daylight, real streets, real people, nothing that looks like stock photography.',
  'Brand palette: near-black #1a1c1c grounds the frame, bright lime #ccff00 is the single accent — a jacket, a sign, a highlight, never the whole image.',
  'No watermarks. No gibberish text. No fake app screenshots. No Western suburbs.',
].join(' ');

interface DirectedFrame {
  prompt: string;
  overlay: string;
  alt: string;
}

/** Ask the designer for the art direction: one prompt per frame. */
async function directFrames(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  count: number;
  /** Alt text the SEO desk already wrote, if they were round before us. */
  seo: SeoPack | null;
  feedback: string[];
}): Promise<DirectedFrame[]> {
  const spec = FORMAT_SPECS[params.format];

  const { data } = await generateJson<{ frames?: unknown }>({
    model: params.settings.textModel,
    system: `${systemFor(params.employee, params.settings)}

You are writing prompts for whoever makes this picture, not describing a mood. Each prompt names: the subject and what they are doing, the setting, the time of day and light, the lens and framing, and where the lime accent sits. One sentence of story, then the craft. It has to work as a brief for a person and as a prompt for an image tool, because it will be used as both.

The overlay text is added to the frame afterwards — keep it to the words the writer chose, and say where in the frame it sits so it never covers a face.

Reply with one JSON object and nothing else:
{ "frames": [{ "prompt": "the full image prompt", "overlay": "the words on this frame", "alt": "one-line alt text for a screen reader" }] }`,
    what: 'The art direction',
    prompt: [
      `FORMAT: ${spec.label}, ${spec.aspect}. Give me exactly ${params.count} frame${params.count === 1 ? '' : 's'}, in order.`,
      planBlock(params.plan, params.employee),
      '',
      `HOOK: ${params.script.hook}`,
      params.script.cta ? `CLOSES ON: ${params.script.cta}` : '',
      '',
      'THE FRAMES THE WRITER ASKED FOR:',
      ...params.script.frames.slice(0, params.count).map((f, i) => `${i + 1}. ${f.scene}${f.overlay ? ` — overlay: "${f.overlay}"` : ''}`),
      '',
      params.format === 'carousel'
        ? 'These are swiped in sequence: they must look like one set — same light, same treatment, same type — while each says something new.'
        : '',
      params.seo?.altTexts.length
        ? `The SEO desk has written alt text for these frames — keep the pictures true to it:\n${params.seo.altTexts
            .map((a, i) => `${i + 1}. ${a}`)
            .join('\n')}`
        : '',
      feedbackBlock(params.feedback),
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const raw = Array.isArray(data.frames) ? (data.frames as unknown[]) : [];
  const directed = raw
    .map((f) => {
      const obj = (f ?? {}) as Record<string, unknown>;
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      return { prompt: str(obj.prompt, 2000), overlay: str(obj.overlay, 80), alt: str(obj.alt, 200) };
    })
    .filter((f) => f.prompt);

  if (!directed.length) throw new DesignError('The designer returned no usable frames.');

  // A short answer is survivable — pad from the writer's own frames rather than
  // failing a whole run because the model gave four slides instead of five.
  while (directed.length < params.count) {
    const source = params.script.frames[directed.length] ?? params.script.frames[0];
    directed.push({
      prompt: source.scene,
      overlay: source.overlay,
      alt: source.scene.slice(0, 200),
    });
  }

  return directed.slice(0, params.count);
}

/**
 * Compose one frame into the brief that gets stored. Everything a renderer used
 * to be handed at the last moment is folded in here instead.
 */
function briefFor(frame: DirectedFrame, aspect: string): string {
  return [
    frame.prompt,
    frame.overlay
      ? `Text on this frame, in a heavy modern sans-serif, spelled exactly: "${frame.overlay}". Place it clear of faces.`
      : 'No text on this frame.',
    HOUSE_STYLE,
    `Aspect ratio ${aspect}.`,
  ].join('\n');
}

export interface DesignResult {
  /** What Rang decided — this is the deliverable. */
  direction: DirectedFrame[];
  note: string;
}

/**
 * Design a whole piece.
 *
 * For image formats this is the brief for every slide. For video formats it is
 * one cover frame — the thumbnail wherever a network wants one, and the frame
 * the cut opens on.
 */
export async function design(params: {
  employee: Employee;
  settings: SocialSettings;
  postId: string;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  seo: SeoPack | null;
  feedback: string[];
}): Promise<DesignResult> {
  const spec = FORMAT_SPECS[params.format];
  const isVideo = spec.kind === 'video';
  const count = isVideo ? 1 : spec.slides;

  const directed = await directFrames({
    employee: params.employee,
    settings: params.settings,
    format: params.format,
    script: params.script,
    plan: params.plan,
    count,
    seo: params.seo,
    feedback: params.feedback,
  });

  const direction = directed.map((frame, index) => ({
    prompt: briefFor(frame, spec.aspect),
    overlay: frame.overlay,
    alt: params.seo?.altTexts[index] || frame.alt,
  }));

  return {
    direction,
    note: isVideo
      ? 'Cover frame briefed — make it and attach it from the queue.'
      : `${count} frame${count === 1 ? '' : 's'} briefed — make them and attach them from the queue.`,
  };
}
