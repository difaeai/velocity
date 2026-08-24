/**
 * Shared shapes for the social desk — the crew of four agents, the connected
 * accounts, the content they plan and make in every format a network accepts,
 * and the settings that drive all of it.
 */

/** Every network the desk knows about. The doc id in `socialAccounts` is this. */
export const PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'threads',
  'x',
  'linkedin',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface PlatformProfile {
  /** How the network labels this page/channel/profile. */
  displayName: string;
  /** @handle or vanity name, where the network has one. */
  handle: string | null;
  /** The id publishing calls address — page id, IG user id, channel id, open id. */
  externalId: string;
  followers: number | null;
  avatarUrl: string | null;
}

/**
 * What a network needs before it will accept a post from us. Connecting is a
 * paste of these values; the backend proves them against the live API before
 * anything is stored, so a typo fails at the desk instead of at 6am.
 */
export interface PlatformCredentials {
  /** Long-lived user/page access token, or (YouTube) the OAuth refresh token. */
  accessToken: string;
  /** Page id / IG user id / channel id. Optional where the API can discover it. */
  externalId?: string;
  /** YouTube only — a refresh token is useless without the app that issued it. */
  clientId?: string;
  clientSecret?: string;
}

export type AccountStatus = 'connected' | 'error' | 'disconnected';

/** The public half of a connection — safe for the admin console to read. */
export interface SocialAccount extends PlatformProfile {
  platform: Platform;
  status: AccountStatus;
  /** False for networks we can authenticate but not yet post video to. */
  canPublishVideo: boolean;
  scopes: string[];
  /** Null when the network issues non-expiring tokens. */
  tokenExpiresAtMs: number | null;
  lastVerifiedAtMs: number | null;
  lastError: string | null;
  connectedBy: string | null;
}

// ── the crew ────────────────────────────────────────────────────────────────

/**
 * Four agents, each owning one stage of the line. They are named rather than
 * numbered because the console shows the line running live, and "Rang is
 * drawing slide 3 of 5" is something an operator can act on where "stage 2/4"
 * is not.
 *
 *   qalam  (قلم, the pen)    — reads the market and writes
 *   rang   (رنگ, the colour) — designs the frames
 *   raftar (رفتار, the pace) — cuts the video
 *   awaaz  (آواز, the voice) — posts, and answers the people who reply
 *
 * Every run starts with all four agreeing a concept (see `ContentPlan`), so
 * the designer is not decorating a script it never saw and the editor is not
 * cutting to a hook nobody chose.
 */
export const AGENTS = ['qalam', 'rang', 'raftar', 'awaaz'] as const;
export type AgentId = (typeof AGENTS)[number];

export const AGENT_NAMES: Record<AgentId, string> = {
  qalam: 'Qalam',
  rang: 'Rang',
  raftar: 'Raftar',
  awaaz: 'Awaaz',
};

export const AGENT_ROLES: Record<AgentId, string> = {
  qalam: 'Content writer',
  rang: 'Designer',
  raftar: 'Video editor',
  awaaz: 'Social media manager',
};

export type AgentState = 'idle' | 'working' | 'done' | 'skipped' | 'failed';

export interface AgentRun {
  state: AgentState;
  /** One line, written for a human watching the line run. */
  note: string | null;
  error: string | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

export const IDLE_RUN: AgentRun = {
  state: 'idle',
  note: null,
  error: null,
  startedAtMs: null,
  finishedAtMs: null,
};

export type CrewLog = Record<AgentId, AgentRun>;

export function freshCrewLog(): CrewLog {
  return {
    qalam: { ...IDLE_RUN },
    rang: { ...IDLE_RUN },
    raftar: { ...IDLE_RUN },
    awaaz: { ...IDLE_RUN },
  };
}

// ── formats ─────────────────────────────────────────────────────────────────

/** Everything the desk can make. The format decides who on the crew works. */
export const FORMATS = ['reel', 'video', 'carousel', 'post', 'story'] as const;
export type ContentFormat = (typeof FORMATS)[number];

export type MediaKind = 'video' | 'image';
export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

export interface FormatSpec {
  label: string;
  /** What the file at the end of the line is. */
  kind: MediaKind;
  aspect: Aspect;
  /** How many images the designer makes. 1 for a post, 3–7 for a carousel. */
  slides: number;
  /** Seconds of video, where there is video. */
  seconds: number | null;
  /** Which of the crew this format needs. */
  crew: AgentId[];
  /** What the writer is being asked for, in one line. */
  brief: string;
}

export const FORMAT_SPECS: Record<ContentFormat, FormatSpec> = {
  reel: {
    label: 'Reel',
    kind: 'video',
    aspect: '9:16',
    slides: 1,
    seconds: 20,
    crew: ['qalam', 'rang', 'raftar', 'awaaz'],
    brief:
      'A vertical short. The first three seconds decide everything; the rest pays off what they promised.',
  },
  video: {
    label: 'Video',
    kind: 'video',
    aspect: '16:9',
    slides: 1,
    seconds: 30,
    crew: ['qalam', 'rang', 'raftar', 'awaaz'],
    brief:
      'A landscape video for YouTube and the Facebook feed. Room for one idea, explained properly.',
  },
  carousel: {
    label: 'Carousel',
    kind: 'image',
    aspect: '4:5',
    slides: 5,
    seconds: null,
    crew: ['qalam', 'rang', 'awaaz'],
    brief:
      'A swipeable set. Slide one is the hook, the middle slides carry one idea each, the last one asks for the tap.',
  },
  post: {
    label: 'Post',
    kind: 'image',
    aspect: '4:5',
    slides: 1,
    seconds: null,
    crew: ['qalam', 'rang', 'awaaz'],
    brief: 'One image and a caption. The image has to work alone in a feed with the sound off.',
  },
  story: {
    label: 'Story',
    kind: 'image',
    aspect: '9:16',
    slides: 1,
    seconds: null,
    crew: ['qalam', 'rang', 'awaaz'],
    brief: 'A 24-hour vertical frame. One line, one image, one tap — nothing that needs reading twice.',
  },
};

/**
 * Which formats each network will actually take from this backend. Absent
 * rather than faked: the console greys out what an adapter cannot do, instead
 * of everyone finding out at publish time.
 */
export const PLATFORM_FORMATS: Record<Platform, ContentFormat[]> = {
  facebook: ['reel', 'video', 'carousel', 'post', 'story'],
  instagram: ['reel', 'carousel', 'post', 'story'],
  youtube: ['reel', 'video'],
  tiktok: ['reel', 'video'],
  threads: ['reel', 'post', 'carousel'],
  x: ['post'],
  linkedin: ['post'],
};

export function platformsForFormat(format: ContentFormat): Platform[] {
  return PLATFORMS.filter((p) => PLATFORM_FORMATS[p].includes(format));
}

export function supports(platform: Platform, format: ContentFormat): boolean {
  return PLATFORM_FORMATS[platform].includes(format);
}

// ── what the crew produces ──────────────────────────────────────────────────

export type PostStatus =
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'designing'
  | 'rendering'
  | 'awaiting_approval'
  | 'changes_requested'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'rejected';

/** Statuses where the crew is still working and nobody should be editing. */
export const WORKING_STATUSES: readonly PostStatus[] = [
  'planning',
  'researching',
  'drafting',
  'designing',
  'rendering',
  'publishing',
];

/** One slide/shot the designer has to draw or the editor has to shoot. */
export interface Frame {
  /** What is in the picture. */
  scene: string;
  /** The words burned into it. Short — this is read at a glance. */
  overlay: string;
}

/** The script. One shape for every format; unused parts are empty. */
export interface PostScript {
  /** The first three seconds. Everything hangs off this. */
  hook: string;
  /** Alternatives, so a weak hook can be swapped without a re-run. */
  hookVariants: string[];
  /** Shots (video) or slides (carousel/post/story), in order. */
  frames: Frame[];
  /** What the voice says, start to finish. Empty for still formats. */
  voiceover: string;
  cta: string;
  /** One-line note on why this angle, kept for the calendar view. */
  rationale: string;
  /** The writer's own case for why this travels. The queue keeps it honest. */
  viralHook: string;
}

/**
 * What the four of them agreed before any of them started. Written by one
 * model call that argues the concept out in the voices of all four agents, so
 * each stage inherits a decision rather than re-deciding it.
 */
export interface ContentPlan {
  atMs: number;
  /** The idea, in one sentence a human can veto. */
  concept: string;
  audience: string;
  /** Why this, today. */
  why: string;
  /** The shape of the hook, not the hook itself — Qalam still writes that. */
  hookDirection: string;
  /** The look Rang is going for. */
  visualDirection: string;
  /** How Raftar cuts it. Empty for still formats. */
  editDirection: string;
  /** What Awaaz will do with it once it is up. */
  distribution: string;
  /** One line per agent, in their own voice, for the console. */
  notes: Partial<Record<AgentId, string>>;
}

export interface MediaAsset {
  kind: MediaKind;
  /** `veo`, `gemini-image`, or `manual` for a file someone attached. */
  provider: string;
  model: string | null;
  /** Provider-side long-running operation, kept for support tickets. */
  jobId: string | null;
  /** Where the finished file lives in our own bucket. */
  storagePath: string | null;
  /** Time-limited public URL — the networks pull the file from here. */
  url: string | null;
  urlExpiresAtMs: number | null;
  durationSec: number | null;
  aspect: string;
  /** Position in a carousel, 1-based. Always 1 for single-media formats. */
  slide: number;
  /** Alt text, for the networks that take it. */
  alt: string;
}

export interface PublishResult {
  ok: boolean;
  /** Post/media id at the network. */
  id: string | null;
  url: string | null;
  error: string | null;
  atMs: number;
}

export interface ResearchSource {
  title: string;
  url: string;
}

/** What the writer found before it wrote anything. Stored, so claims trace back. */
export interface ContentResearch {
  atMs: number;
  /** What is working on Pakistani feeds this week. */
  trends: string[];
  /** What the named competitors are actually doing. */
  competitorMoves: string[];
  /** Gaps we can take. */
  opportunities: string[];
  /** Hook shapes seen travelling, as patterns rather than copy. */
  hookPatterns: string[];
  avoid: string[];
  sources: ResearchSource[];
  /** Set when research was asked for but could not run. */
  error: string | null;
}

/** A round of admin feedback, and what the crew did about it. */
export interface Revision {
  atMs: number;
  by: string;
  /** What the admin actually wrote. Fed to every agent that re-runs. */
  feedback: string;
  /** Which stages were asked to run again. */
  scope: RevisionScope[];
}

export const REVISION_SCOPES = ['script', 'design', 'video', 'caption'] as const;
export type RevisionScope = (typeof REVISION_SCOPES)[number];

export interface SocialPost {
  id: string;
  /** Pakistan date this post belongs to (`YYYY-MM-DD`). */
  date: string;
  format: ContentFormat;
  angle: string;
  status: PostStatus;
  plan: ContentPlan | null;
  script: PostScript | null;
  caption: string;
  /** Per-network rewrites from the manager. Falls back to `caption`. */
  captions: Partial<Record<Platform, string>>;
  hashtags: string[];
  /** The live platform numbers the script was written from, for the audit trail. */
  facts: Record<string, number | string>;
  research: ContentResearch | null;
  /** The designer's art direction, kept whether or not anything was rendered. */
  direction: { prompt: string; overlay: string; alt: string }[] | null;
  /** The editor's cut. The prompt the renderer was given, and a line about it. */
  cut: { prompt: string; note: string } | null;
  /** Everything the crew made, in publish order. Slides 1..n for a carousel. */
  media: MediaAsset[];
  targets: Platform[];
  results: Partial<Record<Platform, PublishResult>>;
  crew: CrewLog;
  /** Every round of feedback this post has been through. */
  revisions: Revision[];
  error: string | null;
  approvedBy: string | null;
  createdAtMs: number;
  publishedAtMs: number | null;
}

/**
 * Posts written before formats existed carry a single `video` field and no
 * `media`. One shim rather than a migration: these documents are a calendar
 * archive, and rewriting history to make an old post look like a new one buys
 * nothing.
 */
export function postMedia(post: Partial<SocialPost> & { video?: MediaAsset | null }): MediaAsset[] {
  if (post.media?.length) return post.media;
  return post.video ? [post.video] : [];
}

/**
 * The rotation. One angle per day keeps the feed from becoming the same post
 * with different words, and each maps to a genuinely different audience:
 * riders, drivers, fleet owners, and people who have never heard of us.
 */
export const DEFAULT_ANGLES = [
  'driver-earnings',
  'fleet-owner-maths',
  'rider-savings',
  'safety',
  'how-it-works',
  'pooling',
  'intercity',
  'couriers',
  'partner-program',
  'city-spotlight',
] as const;

/**
 * The format rotation. Weighted towards reels because that is what travels,
 * with carousels and posts in between so the grid is not five videos deep.
 */
export const DEFAULT_FORMATS: ContentFormat[] = ['reel', 'carousel', 'reel', 'post', 'reel', 'story'];

export interface Competitor {
  name: string;
  /** A page the writer can point its research at. */
  url: string;
}

/** Who else is in this market. The writer reads around these, never copies them. */
export const DEFAULT_COMPETITORS: Competitor[] = [
  { name: 'Careem', url: 'https://www.careem.com/pk' },
  { name: 'inDrive', url: 'https://indrive.com/en-pk/' },
  { name: 'Bykea', url: 'https://bykea.com/' },
  { name: 'Yango', url: 'https://yango.com/en_pk/' },
];

// ── engagement ──────────────────────────────────────────────────────────────

export type CommentStatus = 'new' | 'drafted' | 'replied' | 'ignored' | 'escalated';

/** How the manager read a comment, before it decided what to say back. */
export type CommentIntent = 'praise' | 'question' | 'complaint' | 'safety' | 'spam' | 'other';

export interface SocialComment {
  id: string;
  platform: Platform;
  /** The network's id for the media the comment sits under. */
  mediaId: string;
  /** Our own post id, when the media came from this desk. */
  postId: string | null;
  commentId: string;
  authorName: string;
  text: string;
  permalink: string | null;
  createdAtMs: number;
  status: CommentStatus;
  intent: CommentIntent | null;
  /** What Awaaz would say. Editable before it is sent. */
  draftReply: string | null;
  sentReply: string | null;
  sentAtMs: number | null;
  error: string | null;
}

// ── settings ────────────────────────────────────────────────────────────────

export interface SocialSettings {
  /** Master switch. Off means the scheduler does nothing at all. */
  enabled: boolean;
  /** Hour of the Pakistan day the daily job runs (0–23). */
  runHour: number;
  /** How many posts a day the crew plans, each the next format up. */
  postsPerDay: number;
  /** Where a finished post goes — filtered per format by what each takes. */
  platforms: Platform[];

  /** The rotations. */
  angles: string[];
  lastAngleIndex: number;
  formats: ContentFormat[];
  lastFormatIndex: number;

  /**
   * Standing instructions every agent reads, on every run — tone, claims to
   * avoid, this month's promotion, words you never want to see again.
   */
  crewInstructions: string;
  /** Extra direction for one agent only. */
  agentNotes: Record<AgentId, string>;

  /** Qalam: read around the market before writing. */
  researchEnabled: boolean;
  competitors: Competitor[];

  /** Rang: draw the frames, or leave them to be attached by hand. */
  imageProvider: 'gemini' | 'none';
  /** Raftar: cut the video, or leave it to be attached by hand. */
  videoProvider: 'veo' | 'none';

  /** Model ids, editable so a Google rename is a settings change, not a deploy. */
  textModel: string;
  imageModel: string;
  videoModel: string;

  /** Awaaz: watch the comments. */
  engagementEnabled: boolean;
  /** Send replies without a human reading them first. Off by default, and it should stay off. */
  autoReply: boolean;

  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastEngagementAtMs: number | null;
  lastEngagementStatus: string | null;
}

export const DEFAULT_SETTINGS: SocialSettings = {
  enabled: false,
  runHour: 10,
  postsPerDay: 1,
  platforms: ['facebook', 'instagram'],

  angles: [...DEFAULT_ANGLES],
  lastAngleIndex: -1,
  formats: [...DEFAULT_FORMATS],
  lastFormatIndex: -1,

  crewInstructions: '',
  agentNotes: { qalam: '', rang: '', raftar: '', awaaz: '' },

  researchEnabled: true,
  competitors: [...DEFAULT_COMPETITORS],

  imageProvider: 'gemini',
  videoProvider: 'none',

  textModel: 'gemini-2.5-pro',
  imageModel: 'gemini-2.5-flash-image',
  videoModel: 'veo-3.1-generate-preview',

  engagementEnabled: false,
  autoReply: false,

  lastRunAtMs: null,
  lastRunStatus: null,
  lastEngagementAtMs: null,
  lastEngagementStatus: null,
};

/**
 * Which networks this backend can push a *video* to. Kept for the accounts
 * screen, which labels a connection by the heaviest thing it can do.
 */
export const VIDEO_CAPABLE: readonly Platform[] = PLATFORMS.filter(
  (p) => PLATFORM_FORMATS[p].includes('reel') || PLATFORM_FORMATS[p].includes('video'),
);
