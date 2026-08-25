/**
 * Shared shapes for the social desk — the people you hire, the work they do,
 * the accounts they post to, and the settings that drive all of it.
 *
 * The organising idea: **there is no fixed crew.** The desk is a team you
 * staff. You hire a content writer, name them, and from that moment the writing
 * stage has someone to run it; hire a second one and the two share the work.
 * Hire nobody who designs and the design stage honestly reports that there is
 * no designer, rather than silently producing nothing.
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

// ── the staff ───────────────────────────────────────────────────────────────

/** The jobs you can hire for. */
export const ROLES = [
  'research-assistant',
  'content-writer',
  'seo-expert',
  'google-seo-expert',
  'designer',
  'video-editor',
  'youtube-ads-expert',
  'social-manager',
] as const;

export type Role = (typeof ROLES)[number];

/** The stages of one piece of work, in the order they happen. */
export const STAGES = [
  'research',
  'seo',
  'script',
  'search',
  'design',
  'video',
  'ads',
  'distribute',
] as const;

export type Stage = (typeof STAGES)[number];

export interface RoleSpec {
  label: string;
  /** What this person is for, in one line, for the console. */
  blurb: string;
  /** The stage they own. */
  stage: Stage;
  /** Job titles that make sense, offered when hiring. */
  titles: string[];
  /** Their voice and standards, prepended to every prompt they run. */
  charter: string;
}

export const ROLE_SPECS: Record<Role, RoleSpec> = {
  'research-assistant': {
    label: 'Research assistant',
    blurb: 'Reads the market every morning — what is travelling, and what the other apps are doing.',
    stage: 'research',
    titles: ['Research assistant', 'Market researcher', 'Insights analyst'],
    charter:
      'You are the research assistant. Every morning you search: what short-form content about transport, commuting, fuel prices, driver income and city life in Pakistan is getting traction right now, and what the other ride-hailing and delivery apps are publishing. You report what you actually found, never what sounds plausible — an empty list is a usable answer and an invented one is not. You never suggest copying anyone; you report patterns and gaps.',
  },
  'content-writer': {
    label: 'Content writer',
    blurb: 'Writes the hook, the frames and the caption. Ruthless about the first three seconds.',
    stage: 'script',
    titles: ['Content writer', 'Senior copywriter', 'Creative lead'],
    charter:
      'You are the content writer. You write the hook, the shot or slide list, the voiceover and the caption. You are ruthless about the first three seconds, you write the way people in Pakistan actually speak, and you never write a number you were not given.',
  },
  'seo-expert': {
    label: 'SEO expert',
    blurb: 'Makes a piece findable: search intent, keywords, hashtags people actually search, alt text.',
    stage: 'seo',
    titles: ['SEO expert', 'Organic growth lead', 'Discovery specialist'],
    charter:
      'You are the SEO expert, working on in-platform search rather than Google. Instagram, TikTok and YouTube are search engines now: people type "sasti ride Lahore" into them. Your job is the words that make a piece findable weeks after it is posted — the search intent it should answer, keywords that belong in the spoken and on-screen copy, hashtags chosen because people search them rather than because they are popular, and alt text that is a real description. You never keyword-stuff; a caption that reads like a human wrote it outranks one that does not, because people finish it.',
  },
  'google-seo-expert': {
    label: 'Google SEO expert',
    blurb: 'Google and YouTube search: the title, the description, the tags, and what the site should rank for.',
    stage: 'search',
    titles: ['Google SEO expert', 'Search lead', 'YouTube SEO specialist'],
    charter:
      'You are the Google SEO expert. Two surfaces: YouTube search (the second largest search engine, and where a Short lives for years), and Google itself. For YouTube you write the title, the description and the tags — the title front-loads the phrase someone would actually type, under 60 characters, no clickbait a viewer would resent; the description opens with two lines that answer the query, then the links. For Google you name the one query velocityrides.app should be trying to own with this piece, and you say honestly when there is not one.',
  },
  designer: {
    label: 'Designer',
    blurb: 'Turns the script into pictures — slides, post images, story frames, video covers.',
    stage: 'design',
    titles: ['Designer', 'Art director', 'Senior graphic designer'],
    charter:
      'You are the designer. You turn a script into pictures: what is in the frame, what the light is doing, what words are burned onto it. You think in thumbnails — the picture has to work at 40 pixels wide, in a feed, with the sound off.',
  },
  'video-editor': {
    label: 'Video editor',
    blurb: 'Decides the cut — pacing, the pattern interrupt, the sound bed — and renders it.',
    stage: 'video',
    titles: ['Video editor', 'Senior editor', 'Motion lead'],
    charter:
      'You are the video editor. You decide the cut: what happens in each second, where the pattern interrupt lands, what the camera does, what the audio is doing under it. You are the reason someone is still watching at second seven.',
  },
  'youtube-ads-expert': {
    label: 'YouTube ads expert',
    blurb: 'Writes the campaign brief: objective, hooks to test, targeting, what success looks like.',
    stage: 'ads',
    titles: ['YouTube ads expert', 'Paid media lead', 'Performance marketer'],
    charter:
      'You are the YouTube ads expert. You do not spend money and you do not pretend to — you write the brief a human takes into Google Ads: the objective, the campaign type, the first five seconds that have to survive the skip button, the targeting (Pakistani cities, ages, and interest or in-market segments that actually exist), what to test against what, and what result would mean it worked. You are specific about this market: data costs, phone-first viewing, and the fact that most of the audience skips at second five.',
  },
  'social-manager': {
    label: 'Social media manager',
    blurb: 'Rewrites per network, decides where it goes, posts it, and answers the comments.',
    stage: 'distribute',
    titles: ['Social media manager', 'Community lead', 'Head of social'],
    charter:
      'You are the social media manager. You decide where a piece goes and how it is worded on each network. Once it is up, you are the one talking to the people in the comments — in their language, briefly, and like a human who works here.',
  },
};

/**
 * Who covers a stage when the person who owns it has not been hired.
 *
 * Small teams really do work like this: with no researcher the writer reads
 * around the subject themselves, and with no SEO specialist the writer does
 * what they can. What has no fallback simply does not happen, and the run says
 * so rather than pretending.
 */
export const STAGE_COVER: Record<Stage, { primary: Role; fallbacks: Role[] }> = {
  research: {
    primary: 'research-assistant',
    fallbacks: ['seo-expert', 'google-seo-expert', 'content-writer'],
  },
  script: { primary: 'content-writer', fallbacks: [] },
  seo: { primary: 'seo-expert', fallbacks: ['google-seo-expert'] },
  search: { primary: 'google-seo-expert', fallbacks: ['seo-expert'] },
  design: { primary: 'designer', fallbacks: [] },
  video: { primary: 'video-editor', fallbacks: [] },
  ads: { primary: 'youtube-ads-expert', fallbacks: [] },
  distribute: { primary: 'social-manager', fallbacks: ['content-writer'] },
};

export type EmployeeStatus = 'active' | 'off_duty';

/** One person on the team. Hired, named and briefed by an admin. */
export interface Employee {
  id: string;
  /** Whatever the admin called them. */
  name: string;
  role: Role;
  /** Free text — "Senior reel editor", "Karachi copy lead". */
  title: string;
  status: EmployeeStatus;
  /** Direction for this person only, read on every job they run. */
  instructions: string;
  /** Console colour, for the roster and the work log. */
  colour: string;
  hiredAtMs: number;
  hiredBy: string | null;
  lastWorkedAtMs: number | null;
  piecesWorked: number;
}

/** How the team is credited on a finished piece — kept even if someone leaves. */
export interface TeamMemberRef {
  id: string;
  name: string;
  role: Role;
  title: string;
}

export type WorkState = 'working' | 'done' | 'skipped' | 'failed';

/** One person's turn on one piece. This is what the console renders live. */
export interface WorkEntry {
  stage: Stage;
  employeeId: string | null;
  name: string;
  role: Role | null;
  state: WorkState;
  /** One line, written for a human watching the work happen. */
  note: string | null;
  error: string | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

export type WorkLog = Partial<Record<Stage, WorkEntry>>;

// ── formats ─────────────────────────────────────────────────────────────────

/** Everything the desk can make. The format decides which stages run. */
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
  /** Which stages this format needs at all. */
  stages: Stage[];
  /** What the writer is being asked for, in one line. */
  brief: string;
}

const STILL_STAGES: Stage[] = ['research', 'seo', 'script', 'search', 'design', 'distribute'];
const VIDEO_STAGES: Stage[] = [
  'research',
  'seo',
  'script',
  'search',
  'design',
  'video',
  'ads',
  'distribute',
];

export const FORMAT_SPECS: Record<ContentFormat, FormatSpec> = {
  reel: {
    label: 'Reel',
    kind: 'video',
    aspect: '9:16',
    slides: 1,
    seconds: 20,
    stages: VIDEO_STAGES,
    brief:
      'A vertical short. The first three seconds decide everything; the rest pays off what they promised.',
  },
  video: {
    label: 'Video',
    kind: 'video',
    aspect: '16:9',
    slides: 1,
    seconds: 30,
    stages: VIDEO_STAGES,
    brief:
      'A landscape video for YouTube and the Facebook feed. Room for one idea, explained properly.',
  },
  carousel: {
    label: 'Carousel',
    kind: 'image',
    aspect: '4:5',
    slides: 5,
    seconds: null,
    stages: STILL_STAGES,
    brief:
      'A swipeable set. Slide one is the hook, the middle slides carry one idea each, the last one asks for the tap.',
  },
  post: {
    label: 'Post',
    kind: 'image',
    aspect: '4:5',
    slides: 1,
    seconds: null,
    stages: STILL_STAGES,
    brief: 'One image and a caption. The image has to work alone in a feed with the sound off.',
  },
  story: {
    label: 'Story',
    kind: 'image',
    aspect: '9:16',
    slides: 1,
    seconds: null,
    stages: STILL_STAGES,
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

// ── what the team produces ──────────────────────────────────────────────────

export type PostStatus =
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'optimising'
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

/** Statuses where the team is still working and nobody should be editing. */
export const WORKING_STATUSES: readonly PostStatus[] = [
  'planning',
  'researching',
  'drafting',
  'optimising',
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
 * What the team agreed at standup, before any of them started. Written by one
 * model call that argues the concept out in the voices of everyone on shift,
 * so each stage inherits a decision rather than re-deciding it.
 */
export interface ContentPlan {
  atMs: number;
  /** The idea, in one sentence a human can veto. */
  concept: string;
  audience: string;
  /** Why this, today. */
  why: string;
  /** The shape of the hook, not the hook itself — the writer still writes that. */
  hookDirection: string;
  /** The look the designer is going for. */
  visualDirection: string;
  /** How the editor cuts it. Empty for still formats. */
  editDirection: string;
  /** What the manager will do with it once it is up. */
  distribution: string;
  /** One line per person who was at standup, in their own voice, keyed by id. */
  notes: Record<string, string>;
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

/** What the researcher found before anyone wrote anything. */
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

/** The SEO expert's work: the words that make this findable later. */
export interface SeoPack {
  /** The query this piece should answer. */
  searchIntent: string;
  /** Phrases that belong in the spoken and on-screen copy. */
  keywords: string[];
  /** Chosen because they are searched, not because they are popular. */
  hashtags: string[];
  /** One per slide, in order. Real descriptions, not keyword lists. */
  altTexts: string[];
  note: string;
}

/** The Google SEO expert's work: YouTube metadata, and the web angle. */
export interface SearchPack {
  youtube: { title: string; description: string; tags: string[] } | null;
  /** The one query velocityrides.app should try to own with this. */
  webAngle: string;
  note: string;
}

/**
 * The YouTube ads expert's brief. Deliberately a *brief*: this backend holds no
 * Google Ads credential and does not spend money. A human takes this into Ads
 * Manager, which is also the only way anyone stays accountable for the budget.
 */
export interface AdPlan {
  objective: string;
  campaignType: string;
  /** The first five seconds, in versions, because that is what gets tested. */
  hookVariants: string[];
  targeting: { locations: string[]; ages: string; interests: string[] };
  budgetNote: string;
  cta: string;
  whatToTest: string;
  successLooksLike: string;
}

/** A round of admin feedback, and what the team did about it. */
export interface Revision {
  atMs: number;
  by: string;
  /** What the admin actually wrote. Fed to everyone who re-runs. */
  feedback: string;
  /** Which stages were asked to run again. */
  scope: RevisionScope[];
}

export const REVISION_SCOPES = ['script', 'design', 'video', 'caption', 'seo', 'ads'] as const;
export type RevisionScope = (typeof REVISION_SCOPES)[number];

export interface SocialPost {
  id: string;
  /** Pakistan date this post belongs to (`YYYY-MM-DD`). */
  date: string;
  format: ContentFormat;
  angle: string;
  status: PostStatus;
  /** Who was on shift for this piece, as they were at the time. */
  team: TeamMemberRef[];
  /** Stage → who did it and how it went. */
  work: WorkLog;
  plan: ContentPlan | null;
  script: PostScript | null;
  caption: string;
  /** Per-network rewrites from the manager. Falls back to `caption`. */
  captions: Partial<Record<Platform, string>>;
  hashtags: string[];
  /** The live platform numbers the script was written from, for the audit trail. */
  facts: Record<string, number | string>;
  research: ContentResearch | null;
  seo: SeoPack | null;
  search: SearchPack | null;
  ads: AdPlan | null;
  /** The designer's art direction, kept whether or not anything was rendered. */
  direction: { prompt: string; overlay: string; alt: string }[] | null;
  /** The editor's cut. The prompt the renderer was given, and a line about it. */
  cut: { prompt: string; note: string } | null;
  /** Everything the team made, in publish order. Slides 1..n for a carousel. */
  media: MediaAsset[];
  targets: Platform[];
  results: Partial<Record<Platform, PublishResult>>;
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
  /** A page the researcher can point at. */
  url: string;
}

/** Who else is in this market. The team reads around these, never copies them. */
export const DEFAULT_COMPETITORS: Competitor[] = [
  { name: 'Careem', url: 'https://www.careem.com/pk' },
  { name: 'inDrive', url: 'https://indrive.com/en-pk/' },
  { name: 'Bykea', url: 'https://bykea.com/' },
  { name: 'Yango', url: 'https://yango.com/en_pk/' },
];

// ── engagement ──────────────────────────────────────────────────────────────

export type CommentStatus = 'new' | 'drafted' | 'replied' | 'ignored' | 'escalated';

/** How the manager read a comment, before deciding what to say back. */
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
  /** What the manager would say. Editable before it is sent. */
  draftReply: string | null;
  /** Who drafted it, so the inbox can say whose words these are. */
  draftedBy: string | null;
  sentReply: string | null;
  sentAtMs: number | null;
  error: string | null;
}

// ── settings ────────────────────────────────────────────────────────────────

export interface SocialSettings {
  /** Master switch. Off means the scheduler does nothing at all. */
  enabled: boolean;
  /** Hour of the Pakistan day the team starts (0–23). */
  runHour: number;
  /** How many pieces a day, each the next format up. */
  postsPerDay: number;
  /** Where a finished post goes — filtered per format by what each takes. */
  platforms: Platform[];

  /** The rotations. */
  angles: string[];
  lastAngleIndex: number;
  formats: ContentFormat[];
  lastFormatIndex: number;

  /**
   * Standing instructions every employee reads, on every job — tone, claims to
   * avoid, this month's promotion, words you never want to see again.
   */
  crewInstructions: string;

  /** The researcher reads around these. */
  researchEnabled: boolean;
  competitors: Competitor[];

  /** The designer draws, or leaves the frames to be attached by hand. */
  imageProvider: 'gemini' | 'none';
  /** The editor renders, or leaves the file to be attached by hand. */
  videoProvider: 'veo' | 'none';

  /**
   * Model ids, editable so a rename is a settings change and not a deploy.
   * `textModel` is a Claude model (everything written or decided); the other
   * two are Google's, because Claude renders neither pictures nor video.
   */
  textModel: string;
  imageModel: string;
  videoModel: string;

  /** The manager watches the comments. */
  engagementEnabled: boolean;
  /** Send replies without a human reading them first. Off by default. */
  autoReply: boolean;

  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastEngagementAtMs: number | null;
  lastEngagementStatus: string | null;
}

/** What the desk writes and decides with unless the console says otherwise. */
export const DEFAULT_TEXT_MODEL = 'claude-opus-5';

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

  researchEnabled: true,
  competitors: [...DEFAULT_COMPETITORS],

  imageProvider: 'gemini',
  videoProvider: 'none',

  textModel: DEFAULT_TEXT_MODEL,
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
