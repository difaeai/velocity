'use client';

/**
 * Pieces shared across the Manage social pages: how each role, network and
 * format is labelled, the mascots, and the small components (status pill, work
 * log, readiness checklist) that appear on more than one screen.
 *
 * The mascots are hand-drawn SVG rather than generated images on purpose: they
 * render with no key, no network call and no cost, they are crisp at 22px in a
 * queue row and at 96px on the employees page, and they never change between
 * deploys — which is what makes a designer look like a designer at a glance.
 *
 * They belong to the *role*, not the person. Hire three designers and they
 * share a face; what distinguishes them is their name, which is the thing you
 * chose.
 */
import type {
  SocialFormat,
  SocialPlatform,
  SocialPostDoc,
  SocialRole,
  SocialStage,
  SocialWorkEntry,
} from '@/lib/api';
import { SOCIAL_STAGES } from '@/lib/api';
import { colors } from '@/lib/config';

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; glyph: string; brand: string; note: string }
> = {
  facebook: {
    label: 'Facebook Page',
    glyph: 'f',
    brand: '#1877f2',
    note: 'Reels, video, photo posts, carousels and stories.',
  },
  instagram: {
    label: 'Instagram',
    glyph: 'ig',
    brand: '#c13584',
    note: 'Reels, carousels, single posts and stories.',
  },
  youtube: { label: 'YouTube', glyph: '▶', brand: '#ff0000', note: 'Shorts and full-width video.' },
  tiktok: { label: 'TikTok', glyph: '♪', brand: '#010101', note: 'Video, through the Content Posting API.' },
  threads: { label: 'Threads', glyph: '@', brand: '#000000', note: 'Video, images and carousels.' },
  x: { label: 'X', glyph: '𝕏', brand: '#000000', note: 'Single posts with one image.' },
  linkedin: { label: 'LinkedIn', glyph: 'in', brand: '#0a66c2', note: 'Single posts, as the page or a person.' },
};

export const FORMAT_META: Record<SocialFormat, { label: string; glyph: string; note: string }> = {
  reel: { label: 'Reel', glyph: '📱', note: '9:16 video, ~20s. The format that travels.' },
  video: { label: 'Video', glyph: '🎬', note: '16:9 video, ~30s. YouTube and the Facebook feed.' },
  carousel: { label: 'Carousel', glyph: '🖼️', note: '5 swipeable 4:5 slides.' },
  post: { label: 'Post', glyph: '🟩', note: 'One 4:5 image and a caption.' },
  story: { label: 'Story', glyph: '⚡', note: 'One 9:16 frame, gone in 24 hours.' },
};

// ── the jobs ────────────────────────────────────────────────────────────────

export const ROLE_META: Record<
  SocialRole,
  { label: string; short: string; colour: string; stage: SocialStage; does: string }
> = {
  'research-assistant': {
    label: 'Research assistant',
    short: 'Research',
    colour: '#28c76f',
    stage: 'research',
    does: 'Searches every morning: what is travelling on Pakistani feeds, what the other apps are posting, which hook shapes keep coming back. Brings it to standup with the pages it came from.',
  },
  'content-writer': {
    label: 'Content writer',
    short: 'Writing',
    colour: '#ccff00',
    stage: 'script',
    does: 'Writes the hook, the shots or slides, the voiceover and the caption. Ruthless about the first three seconds, and never writes a number nobody gave them.',
  },
  'seo-expert': {
    label: 'SEO expert',
    short: 'SEO',
    colour: '#00cfc1',
    stage: 'seo',
    does: 'Briefs the writer before they write: the query this piece should answer, the phrases that belong in the copy, hashtags people actually search, and real alt text.',
  },
  'google-seo-expert': {
    label: 'Google SEO expert',
    short: 'Search',
    colour: '#4db8ff',
    stage: 'search',
    does: 'Writes the YouTube title, description and tags the video is posted with — used verbatim — and names the one query velocityrides.app should try to own.',
  },
  designer: {
    label: 'Designer',
    short: 'Design',
    colour: '#ff8a3d',
    stage: 'design',
    does: 'Art directs every frame — subject, light, lens, type, where the lime sits — then renders the slides, the post image, the story frame or the video cover.',
  },
  'video-editor': {
    label: 'Video editor',
    short: 'Editing',
    colour: '#b07dff',
    stage: 'video',
    does: 'Writes the second-by-second cut — pacing, the pattern interrupt, the sound bed — and renders it. The reason someone is still watching at second seven.',
  },
  'youtube-ads-expert': {
    label: 'YouTube ads expert',
    short: 'Ads',
    colour: '#ff5c8a',
    stage: 'ads',
    does: 'Writes the campaign brief a human takes into Google Ads: objective, five-second hooks to test, targeting, budget range and what success would look like. Spends nothing itself.',
  },
  'social-manager': {
    label: 'Social media manager',
    short: 'Distribution',
    colour: '#ffd166',
    stage: 'distribute',
    does: 'Rewrites the caption for each network, decides where the piece belongs, publishes once you approve, and drafts a reply to every comment that comes back.',
  },
};

export const STAGE_META: Record<SocialStage, { label: string; role: SocialRole }> = {
  research: { label: 'Market read', role: 'research-assistant' },
  seo: { label: 'Search brief', role: 'seo-expert' },
  script: { label: 'The script', role: 'content-writer' },
  search: { label: 'YouTube & Google', role: 'google-seo-expert' },
  design: { label: 'The pictures', role: 'designer' },
  video: { label: 'The cut', role: 'video-editor' },
  ads: { label: 'Campaign brief', role: 'youtube-ads-expert' },
  distribute: { label: 'Where it goes', role: 'social-manager' },
};

/** The mascots. One 64×64 viewBox per role, drawn to read at any size. */
export function Mascot({ role, size = 44 }: { role: SocialRole; size?: number }) {
  const accent = ROLE_META[role].colour;
  const body = '#1a1c1c';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={ROLE_META[role].label}
      style={{ flex: 'none', display: 'block' }}
    >
      <rect x="2" y="2" width="60" height="60" rx="18" fill={body} />

      {role === 'research-assistant' ? (
        <>
          {/* a clipboard being read through a lens */}
          <rect x="14" y="14" width="28" height="36" rx="4" fill={accent} />
          <path d="M22 22h12M22 29h12M22 36h8" stroke={body} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="43" cy="38" r="10" fill="none" stroke="#fff" strokeWidth="3.4" />
          <path d="M50 45l6 6" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        </>
      ) : null}

      {role === 'content-writer' ? (
        <>
          {/* a nib, mid-stroke */}
          <path d="M20 44 L38 16 L46 22 L28 50 Z" fill={accent} />
          <path d="M28 50 L20 44 L18 52 Z" fill="#fff" opacity="0.9" />
          <circle cx="26" cy="26" r="3.2" fill="#fff" />
          <circle cx="36" cy="33" r="2.4" fill={body} />
          <path d="M14 54 Q32 60 52 52" stroke={accent} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      ) : null}

      {role === 'seo-expert' ? (
        <>
          {/* a hashtag climbing */}
          <path
            d="M24 16 L20 48 M40 16 L36 48 M14 26 H46 M12 38 H44"
            stroke={accent}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path d="M40 44 L48 34 L56 40" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="56" cy="40" r="3.4" fill="#fff" />
        </>
      ) : null}

      {role === 'google-seo-expert' ? (
        <>
          {/* a globe, and a results list with the top slot taken */}
          <circle cx="26" cy="30" r="15" fill="none" stroke={accent} strokeWidth="3.6" />
          <path d="M11 30h30M26 15c8 8 8 22 0 30-8-8-8-22 0-30Z" stroke={accent} strokeWidth="2.8" fill="none" />
          <rect x="12" y="48" width="40" height="5" rx="2.5" fill="#fff" />
          <rect x="44" y="20" width="10" height="22" rx="3" fill={accent} />
          <rect x="44" y="14" width="10" height="5" rx="2.5" fill="#fff" />
        </>
      ) : null}

      {role === 'designer' ? (
        <>
          {/* a palette blob with a bitten-out thumb hole */}
          <path
            d="M32 12c11 0 20 8 20 18 0 6-5 8-9 8-3 0-5 2-5 5 0 4-3 7-8 7-11 0-18-9-18-19S21 12 32 12Z"
            fill={accent}
          />
          <circle cx="24" cy="26" r="3.4" fill={body} />
          <circle cx="38" cy="24" r="3.4" fill={body} />
          <circle cx="43" cy="35" r="2.6" fill="#fff" />
          <circle cx="27" cy="38" r="2.6" fill="#fff" />
        </>
      ) : null}

      {role === 'video-editor' ? (
        <>
          {/* a clapper board mid-clap, with speed lines */}
          <rect x="16" y="26" width="34" height="24" rx="4" fill={accent} />
          <path d="M16 24 L48 16 L51 24 L19 32 Z" fill="#fff" />
          <path d="M24 22 L27 30 M33 20 L36 28 M42 18 L45 26" stroke={body} strokeWidth="2.6" />
          <circle cx="27" cy="38" r="3" fill={body} />
          <circle cx="39" cy="38" r="3" fill={body} />
          <path d="M6 34 H13 M4 42 H12" stroke={accent} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : null}

      {role === 'youtube-ads-expert' ? (
        <>
          {/* a play button, and the money it costs */}
          <rect x="10" y="16" width="36" height="26" rx="7" fill={accent} />
          <path d="M26 23 L36 29 L26 35 Z" fill={body} />
          <circle cx="46" cy="44" r="11" fill="#fff" />
          <path
            d="M42 39h7a3.5 3.5 0 0 1 0 7h-7m0 0h8m-8 4h8"
            stroke={body}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </>
      ) : null}

      {role === 'social-manager' ? (
        <>
          {/* a speech bubble that is also a megaphone */}
          <path
            d="M14 18h36a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H30l-10 8v-8h-6a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z"
            fill={accent}
          />
          <circle cx="26" cy="31" r="3.2" fill={body} />
          <circle cx="38" cy="31" r="3.2" fill={body} />
          <path d="M24 39c3 3 13 3 16 0" stroke={body} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

const WORK_STATE_STYLE: Record<SocialWorkEntry['state'] | 'idle', { dot: string; label: string }> = {
  idle: { dot: '#c8d0cb', label: 'Not started' },
  working: { dot: '#2a78d6', label: 'Working' },
  done: { dot: '#0ca30c', label: 'Done' },
  skipped: { dot: '#9aa5a0', label: 'Skipped' },
  failed: { dot: '#d03b3b', label: 'Failed' },
};

/**
 * The working day, live: every stage this format runs, who has it, and what
 * they are doing. This is the answer to "what is actually happening right now",
 * which a single status word never is.
 */
export function WorkLine({
  work,
  format,
  compact = false,
}: {
  work: Partial<Record<SocialStage, SocialWorkEntry>> | undefined;
  format: SocialFormat | undefined;
  compact?: boolean;
}) {
  const still = format === 'carousel' || format === 'post' || format === 'story';
  const stages = SOCIAL_STAGES.filter((s) => !(still && (s === 'video' || s === 'ads')));

  return (
    <div style={{ display: 'grid', gap: compact ? 7 : 11 }}>
      {stages.map((stage) => {
        const entry = work?.[stage];
        const state = WORK_STATE_STYLE[entry?.state ?? 'idle'];
        const role = entry?.role ?? STAGE_META[stage].role;
        return (
          <div key={stage} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Mascot role={role} size={compact ? 22 : 30} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: compact ? 12 : 13, fontWeight: 800 }}>
                  {entry?.name ?? '—'}
                </span>
                <span style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>
                  {STAGE_META[stage].label}
                </span>
                <span
                  aria-hidden
                  style={{ width: 7, height: 7, borderRadius: 999, background: state.dot, flex: 'none' }}
                />
                <span style={{ fontSize: 11, color: colors.muted }}>{state.label}</span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.35 }}>
                {entry?.error ?? entry?.note ?? 'Waiting for their turn.'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlatformBadge({ platform, size = 34 }: { platform: SocialPlatform; size?: number }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: meta.brand,
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: size * 0.42,
        flex: 'none',
      }}
    >
      {meta.glyph}
    </span>
  );
}

export function FormatChip({ format }: { format: SocialFormat | undefined }) {
  const meta = FORMAT_META[format ?? 'reel'];
  return (
    <span
      title={meta.note}
      style={{
        background: `${colors.primary}12`,
        color: colors.primary,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.glyph} {meta.label}
    </span>
  );
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  connected: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Connected' },
  error: { bg: '#d03b3b1a', fg: '#a52c2c', label: 'Needs attention' },
  disconnected: { bg: '#6f7a721a', fg: '#5c665f', label: 'Not connected' },

  active: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'On the team' },
  off_duty: { bg: '#6f7a721a', fg: '#5c665f', label: 'Off duty' },

  planning: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'At standup' },
  researching: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Researching' },
  drafting: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Writing' },
  optimising: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Optimising' },
  designing: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Designing' },
  rendering: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Rendering' },
  awaiting_approval: { bg: '#fab2192e', fg: '#8a6100', label: 'Needs approval' },
  changes_requested: { bg: '#eb68341f', fg: '#a8461f', label: 'Changes asked for' },
  ready: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Approved' },
  publishing: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Publishing' },
  published: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Published' },
  partial: { bg: '#eb68341f', fg: '#a8461f', label: 'Partly published' },
  failed: { bg: '#d03b3b1a', fg: '#a52c2c', label: 'Failed' },
  rejected: { bg: '#6f7a721a', fg: '#5c665f', label: 'Rejected' },

  new: { bg: '#fab2192e', fg: '#8a6100', label: 'Unread' },
  drafted: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Reply drafted' },
  replied: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Replied' },
  ignored: { bg: '#6f7a721a', fg: '#5c665f', label: 'Closed' },
  escalated: { bg: '#d03b3b1a', fg: '#a52c2c', label: 'For a human' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#6f7a721a', fg: '#5c665f', label: status };
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

/**
 * What is wired up and what is not. Shown wherever someone is about to rely on
 * the desk, because the failure everyone hits is switching automation on and
 * finding out at 10am that a key was never added — or that nobody was hired.
 */
export function Readiness({
  readiness,
  connectedCount,
  staffed,
}: {
  readiness: { writer: boolean; designer: boolean; video: boolean; tokenVault: boolean };
  connectedCount: number;
  staffed?: number;
}) {
  const rows = [
    {
      ok: (staffed ?? 0) > 0,
      label: 'Somebody on the team',
      good: `${staffed} employee${staffed === 1 ? '' : 's'} on the books.`,
      bad: 'Nobody works here yet. Hire at least a content writer on the Employees page — an empty office makes nothing.',
    },
    {
      ok: readiness.writer,
      label: 'The engine (Gemini)',
      good: 'GEMINI_API_KEY is set — everyone can work.',
      bad: 'GEMINI_API_KEY is missing. Add it to the backend secrets; nobody can plan, write or draw without it.',
    },
    {
      ok: readiness.tokenVault,
      label: 'Token vault',
      good: 'SOCIAL_TOKEN_KEY is set — access tokens can be stored encrypted.',
      bad: 'SOCIAL_TOKEN_KEY is missing. Generate one with `openssl rand -base64 32`, add it as a GitHub Actions secret and redeploy. Accounts cannot be connected until then.',
    },
    {
      ok: readiness.designer,
      label: 'Image rendering',
      good: 'Pictures are generated for posts, carousels and covers.',
      bad: 'Image rendering is off. The designer still writes the art direction — attach the files yourself from the queue.',
    },
    {
      ok: readiness.video,
      label: 'Video rendering',
      good: 'Videos are rendered.',
      bad: 'Video rendering is off. The editor still writes the cut — attach the file yourself from the queue.',
    },
    {
      ok: connectedCount > 0,
      label: 'Connected accounts',
      good: `${connectedCount} account${connectedCount === 1 ? '' : 's'} connected.`,
      bad: 'No accounts connected yet, so there is nowhere to publish.',
    },
  ].filter((r) => staffed !== undefined || r.label !== 'Somebody on the team');

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span
            aria-hidden
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              flex: 'none',
              marginTop: 1,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 900,
              color: '#fff',
              background: r.ok ? '#0ca30c' : '#fab219',
            }}
          >
            {r.ok ? '✓' : '!'}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{r.label}</div>
            <div style={{ fontSize: 12.5, color: colors.muted }}>{r.ok ? r.good : r.bad}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** `2026-08-24` → `Mon 24 Aug`. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function postSummary(post: SocialPostDoc): string {
  return post.script?.hook || post.plan?.concept || post.caption || '(nothing written yet)';
}
