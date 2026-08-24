'use client';

/**
 * Pieces shared across the Manage social pages: the four agents and their
 * mascots, how each network and format is labelled, and the small components
 * (status pill, crew line, readiness checklist) that appear on more than one
 * screen.
 *
 * The mascots are hand-drawn SVG rather than generated images on purpose: they
 * render with no key, no network call and no cost, they are crisp at 28px in a
 * table row and at 96px on the crew page, and they never change between
 * deploys — which is what makes them recognisable as characters rather than
 * decoration.
 */
import type {
  SocialAgent,
  SocialAgentRun,
  SocialFormat,
  SocialPlatform,
  SocialPostDoc,
} from '@/lib/api';
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

// ── the crew ────────────────────────────────────────────────────────────────

export const AGENT_META: Record<
  SocialAgent,
  { name: string; role: string; colour: string; blurb: string; does: string }
> = {
  qalam: {
    name: 'Qalam',
    role: 'Content writer',
    colour: '#ccff00',
    blurb: 'Reads the market, then writes.',
    does: 'Searches what is travelling in Pakistan this week and what the other apps are posting, brings it to standup, and writes the hook, the frames and the caption.',
  },
  rang: {
    name: 'Rang',
    role: 'Designer',
    colour: '#ff8a3d',
    blurb: 'Turns the script into pictures.',
    does: 'Art directs every frame — subject, light, lens, where the lime sits — then renders the slides, the post image or the cover the video opens on.',
  },
  raftar: {
    name: 'Raftar',
    role: 'Video editor',
    colour: '#4db8ff',
    blurb: 'Decides the cut.',
    does: 'Writes the second-by-second edit — pacing, the pattern interrupt, the sound bed — and renders it. The reason someone is still watching at second seven.',
  },
  awaaz: {
    name: 'Awaaz',
    role: 'Social media manager',
    colour: '#b07dff',
    blurb: 'Posts it, then answers everyone.',
    does: 'Rewrites the caption for each network, decides where the piece belongs, publishes once you approve, and drafts a reply to every comment that comes back.',
  },
};

/** The mascots. One 64×64 viewBox each, drawn to read at any size. */
export function Mascot({ agent, size = 44 }: { agent: SocialAgent; size?: number }) {
  const accent = AGENT_META[agent].colour;
  const body = '#1a1c1c';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={AGENT_META[agent].name}
      style={{ flex: 'none', display: 'block' }}
    >
      <rect x="2" y="2" width="60" height="60" rx="18" fill={body} />
      {agent === 'qalam' ? (
        <>
          {/* a nib, mid-stroke */}
          <path d="M20 44 L38 16 L46 22 L28 50 Z" fill={accent} />
          <path d="M28 50 L20 44 L18 52 Z" fill="#fff" opacity="0.9" />
          <circle cx="26" cy="26" r="3.2" fill="#fff" />
          <circle cx="36" cy="33" r="2.4" fill={body} />
          <path d="M14 54 Q32 60 52 52" stroke={accent} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      ) : null}
      {agent === 'rang' ? (
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
      {agent === 'raftar' ? (
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
      {agent === 'awaaz' ? (
        <>
          {/* a speech bubble that is also a megaphone */}
          <path d="M14 18h36a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H30l-10 8v-8h-6a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z" fill={accent} />
          <circle cx="26" cy="31" r="3.2" fill={body} />
          <circle cx="38" cy="31" r="3.2" fill={body} />
          <path d="M24 39c3 3 13 3 16 0" stroke={body} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

const AGENT_STATE_STYLE: Record<SocialAgentRun['state'], { dot: string; label: string }> = {
  idle: { dot: '#c8d0cb', label: 'Waiting' },
  working: { dot: '#2a78d6', label: 'Working' },
  done: { dot: '#0ca30c', label: 'Done' },
  skipped: { dot: '#9aa5a0', label: 'Not needed' },
  failed: { dot: '#d03b3b', label: 'Failed' },
};

/**
 * The assembly line, live. Shown wherever a post is — this is the answer to
 * "what is actually happening right now", which a single status word never is.
 */
export function CrewLine({
  crew,
  compact = false,
}: {
  crew: Partial<Record<SocialAgent, SocialAgentRun>> | undefined;
  compact?: boolean;
}) {
  const agents: SocialAgent[] = ['qalam', 'rang', 'raftar', 'awaaz'];
  return (
    <div style={{ display: 'grid', gap: compact ? 6 : 10 }}>
      {agents.map((agent) => {
        const run = crew?.[agent];
        const state = AGENT_STATE_STYLE[run?.state ?? 'idle'];
        return (
          <div key={agent} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Mascot agent={agent} size={compact ? 22 : 30} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: compact ? 12 : 13, fontWeight: 800 }}>{AGENT_META[agent].name}</span>
                <span
                  aria-hidden
                  style={{ width: 7, height: 7, borderRadius: 999, background: state.dot, flex: 'none' }}
                />
                <span style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>{state.label}</span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.35 }}>
                {run?.error ?? run?.note ?? AGENT_META[agent].blurb}
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

  planning: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'At standup' },
  researching: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Researching' },
  drafting: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Writing' },
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
 * the crew, because the failure everyone hits is switching automation on and
 * finding out at 10am that a key was never added.
 */
export function Readiness({
  readiness,
  connectedCount,
}: {
  readiness: { writer: boolean; designer: boolean; video: boolean; tokenVault: boolean };
  connectedCount: number;
}) {
  const rows = [
    {
      ok: readiness.writer,
      label: 'The crew (Gemini)',
      good: 'GEMINI_API_KEY is set — all four can work.',
      bad: 'GEMINI_API_KEY is missing. Add it to the backend secrets; nothing can be planned, written or drawn without it.',
    },
    {
      ok: readiness.tokenVault,
      label: 'Token vault',
      good: 'SOCIAL_TOKEN_KEY is set — access tokens can be stored encrypted.',
      bad: 'SOCIAL_TOKEN_KEY is missing. Generate one with `openssl rand -base64 32`, add it as a GitHub Actions secret and redeploy. Accounts cannot be connected until then.',
    },
    {
      ok: readiness.designer,
      label: 'Rang can render',
      good: 'Images are generated for posts, carousels and covers.',
      bad: 'Image rendering is off. Rang still writes the art direction — attach the files yourself from the queue.',
    },
    {
      ok: readiness.video,
      label: 'Raftar can render',
      good: 'Videos are rendered.',
      bad: 'Video rendering is off. Raftar still writes the cut — attach the file yourself from the queue.',
    },
    {
      ok: connectedCount > 0,
      label: 'Connected accounts',
      good: `${connectedCount} account${connectedCount === 1 ? '' : 's'} connected.`,
      bad: 'No accounts connected yet, so there is nowhere to publish.',
    },
  ];

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
