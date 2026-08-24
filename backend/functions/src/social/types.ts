/**
 * Shared shapes for the social desk — connected accounts, the daily content
 * pipeline, and the settings that drive it.
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

export type PostStatus =
  | 'drafting'
  | 'awaiting_approval'
  | 'rendering'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'rejected';

/** The script Claude writes. Shot list included, so the video prompt is derived. */
export interface PostScript {
  /** The first three seconds. Everything hangs off this. */
  hook: string;
  /** 3–5 shots, each a sentence describing what is on screen. */
  beats: string[];
  /** What the voice says, start to finish. */
  voiceover: string;
  /** Big words burned into the frame. */
  onScreenText: string[];
  cta: string;
  /** One-line note on why this angle, kept for the calendar view. */
  rationale: string;
}

export interface VideoAsset {
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
}

export interface PublishResult {
  ok: boolean;
  /** Post/media id at the network. */
  id: string | null;
  url: string | null;
  error: string | null;
  atMs: number;
}

export interface SocialPost {
  id: string;
  /** Pakistan date this post belongs to (`YYYY-MM-DD`). */
  date: string;
  angle: string;
  status: PostStatus;
  script: PostScript | null;
  caption: string;
  hashtags: string[];
  /** The live platform numbers the script was written from, for the audit trail. */
  facts: Record<string, number | string>;
  video: VideoAsset | null;
  targets: Platform[];
  results: Partial<Record<Platform, PublishResult>>;
  error: string | null;
  approvedBy: string | null;
  createdAtMs: number;
  publishedAtMs: number | null;
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

export interface SocialSettings {
  /** Master switch. Off means the scheduler does nothing at all. */
  enabled: boolean;
  /** Hour of the Pakistan day the daily job runs (0–23). */
  runHour: number;
  /** Where a finished post goes. */
  platforms: Platform[];
  /** When true a human must approve before anything is published. */
  requireApproval: boolean;
  /** Video vendor. `none` writes the script and stops — you attach the file. */
  videoProvider: 'veo' | 'none';
  videoModel: string;
  /** 9:16 for Reels/Shorts/TikTok, 16:9 for YouTube proper. */
  aspect: '9:16' | '16:9';
  angles: string[];
  /** Index of the last angle used, so the rotation advances across runs. */
  lastAngleIndex: number;
  /** Free text appended to the prompt — tone, claims to avoid, current promos. */
  brandVoice: string;
  lastRunAtMs: number | null;
  lastRunStatus: string | null;
}

export const DEFAULT_SETTINGS: SocialSettings = {
  enabled: false,
  runHour: 10,
  platforms: ['facebook', 'instagram'],
  requireApproval: true,
  videoProvider: 'none',
  videoModel: 'veo-3.1-generate-preview',
  aspect: '9:16',
  angles: [...DEFAULT_ANGLES],
  lastAngleIndex: -1,
  brandVoice: '',
  lastRunAtMs: null,
  lastRunStatus: null,
};

/**
 * Which networks this backend can actually push a video to today. The rest
 * authenticate and show their follower count, but publishing to them is not
 * implemented — the console says so rather than failing at 6am.
 */
export const VIDEO_CAPABLE: readonly Platform[] = [
  'facebook',
  'instagram',
  'threads',
  'tiktok',
  'youtube',
];
