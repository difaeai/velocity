/**
 * Rang — the designer.
 *
 * Takes the script's frames and draws them: one image per carousel slide, one
 * for a post or a story, and a cover frame for the video formats that Raftar
 * can open on.
 *
 * Two passes rather than one, on purpose. The first asks Rang to *art direct* —
 * to turn "a driver counts cash on his bonnet" into a prompt with a lens, a
 * light, a palette and a type treatment. The second renders those prompts. It
 * costs one extra text call per post and it is the difference between a set of
 * slides that look like one campaign and five unrelated stock images, because
 * the direction pass sees all the frames at once and the render pass never does.
 *
 * When `imageProvider` is `none`, Rang still writes the direction and stops.
 * The prompts are stored on the post, so someone designing by hand gets the
 * brief instead of a blank page.
 */
import { logger } from 'firebase-functions';

import { agentSystem, feedbackBlock, planBlock } from './crew';
import { generateImage, generateJson } from './gemini';
import { postFolder, storeFile } from './assets';
import {
  FORMAT_SPECS,
  type ContentFormat,
  type ContentPlan,
  type MediaAsset,
  type PostScript,
  type SocialSettings,
} from './types';

export class DesignError extends Error {}

export function designerConfigured(settings: SocialSettings): boolean {
  return settings.imageProvider === 'none' || typeof process.env.GEMINI_API_KEY === 'string';
}

/**
 * The house style, appended to every image prompt. Repeated per image rather
 * than assumed, because each render is a fresh call with no memory of the last.
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

/** Ask Rang for the art direction: one render-ready prompt per frame. */
async function directFrames(params: {
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  count: number;
  feedback: string[];
}): Promise<DirectedFrame[]> {
  const spec = FORMAT_SPECS[params.format];

  const { data } = await generateJson<{ frames?: unknown }>({
    model: params.settings.textModel,
    system: `${agentSystem('rang', params.settings)}

You are writing prompts for an image model, not describing a mood. Each prompt names: the subject and what they are doing, the setting, the time of day and light, the lens and framing, and where the lime accent sits. One sentence of story, then the craft.

The overlay text is burned on afterwards by the image model — keep it to the words the writer chose, and say where in the frame it sits so it never covers a face.

Reply with one JSON object and nothing else:
{ "frames": [{ "prompt": "the full image prompt", "overlay": "the words on this frame", "alt": "one-line alt text for a screen reader" }] }`,
    what: 'The art direction',
    temperature: 0.95,
    maxOutputTokens: 2500,
    prompt: [
      `FORMAT: ${spec.label}, ${spec.aspect}. Give me exactly ${params.count} frame${params.count === 1 ? '' : 's'}, in order.`,
      planBlock(params.plan, 'rang'),
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
      prompt: `${source.scene}. ${HOUSE_STYLE}`,
      overlay: source.overlay,
      alt: source.scene.slice(0, 200),
    });
  }

  return directed.slice(0, params.count);
}

/** Render one directed frame and put it in the bucket. */
async function renderFrame(params: {
  settings: SocialSettings;
  postId: string;
  name: string;
  slide: number;
  frame: DirectedFrame;
  aspect: string;
}): Promise<MediaAsset> {
  const prompt = [
    params.frame.prompt,
    params.frame.overlay
      ? `Burn this text into the frame in a heavy modern sans-serif, spelled exactly: "${params.frame.overlay}". Place it clear of faces.`
      : 'No text in this frame.',
    HOUSE_STYLE,
    `Aspect ratio ${params.aspect}.`,
  ].join('\n');

  const image = await generateImage({ model: params.settings.imageModel, prompt, aspect: params.aspect });
  const extension = image.mimeType.includes('jpeg') ? 'jpg' : 'png';
  const stored = await storeFile({
    path: `${postFolder(params.postId)}/${params.name}.${extension}`,
    bytes: image.bytes,
    contentType: image.mimeType,
  });

  return {
    kind: 'image',
    provider: 'gemini-image',
    model: params.settings.imageModel,
    jobId: null,
    storagePath: stored.path,
    url: stored.url,
    urlExpiresAtMs: stored.expiresAtMs,
    durationSec: null,
    aspect: params.aspect,
    slide: params.slide,
    alt: params.frame.alt || params.frame.overlay,
  };
}

export interface DesignResult {
  media: MediaAsset[];
  /** What Rang decided, kept whether or not anything was rendered. */
  direction: DirectedFrame[];
  note: string;
}

/**
 * Design a whole piece.
 *
 * For image formats this is the deliverable. For video formats it is one cover
 * frame — which Raftar opens the cut on, and which is the thumbnail wherever a
 * network wants one.
 */
export async function design(params: {
  settings: SocialSettings;
  postId: string;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  feedback: string[];
  onProgress?: (note: string) => Promise<void>;
}): Promise<DesignResult> {
  const spec = FORMAT_SPECS[params.format];
  const isVideo = spec.kind === 'video';
  const count = isVideo ? 1 : spec.slides;

  const direction = await directFrames({
    settings: params.settings,
    format: params.format,
    script: params.script,
    plan: params.plan,
    count,
    feedback: params.feedback,
  });

  if (params.settings.imageProvider === 'none') {
    return {
      media: [],
      direction,
      note: `Art direction written for ${count} frame${count === 1 ? '' : 's'} — rendering is off, so attach the files by hand.`,
    };
  }

  const media: MediaAsset[] = [];
  for (const [index, frame] of direction.entries()) {
    await params.onProgress?.(
      isVideo ? 'Drawing the cover frame.' : `Drawing ${index + 1} of ${direction.length}.`,
    );
    try {
      media.push(
        await renderFrame({
          settings: params.settings,
          postId: params.postId,
          name: isVideo ? 'cover' : `slide-${index + 1}`,
          slide: index + 1,
          frame,
          aspect: spec.aspect,
        }),
      );
    } catch (e) {
      const message = (e as Error).message;
      logger.error('social: a frame failed to render', { postId: params.postId, index, message });
      // A carousel missing its third slide is still publishable as four; a
      // post whose only frame failed is not, and the caller decides which.
      if (media.length === 0 && index === direction.length - 1) throw new DesignError(message);
    }
  }

  if (!media.length) throw new DesignError('Nothing rendered — the image model refused every frame.');

  return {
    media,
    direction,
    note: isVideo
      ? 'Cover frame drawn.'
      : `${media.length} of ${direction.length} frame${direction.length === 1 ? '' : 's'} drawn.`,
  };
}
