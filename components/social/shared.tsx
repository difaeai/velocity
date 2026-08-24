'use client';

/**
 * Pieces shared across the Manage social pages: how each network is labelled,
 * and the two small components (status pill, readiness checklist) that appear
 * on more than one screen.
 */
import type { SocialPlatform, SocialPostDoc } from '@/lib/api';
import { colors } from '@/lib/config';

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; glyph: string; brand: string; note: string }
> = {
  facebook: { label: 'Facebook Page', glyph: 'f', brand: '#1877f2', note: 'Video posts to the Page timeline.' },
  instagram: { label: 'Instagram', glyph: 'ig', brand: '#c13584', note: 'Reels, shared to the feed.' },
  youtube: { label: 'YouTube', glyph: '▶', brand: '#ff0000', note: 'Uploaded as a public video / Short.' },
  tiktok: { label: 'TikTok', glyph: '♪', brand: '#010101', note: 'Posted through the Content Posting API.' },
  threads: { label: 'Threads', glyph: '@', brand: '#000000', note: 'Video posts.' },
  x: { label: 'X', glyph: '𝕏', brand: '#000000', note: 'Connected for reporting — video posting not built yet.' },
  linkedin: { label: 'LinkedIn', glyph: 'in', brand: '#0a66c2', note: 'Connected for reporting — video posting not built yet.' },
};

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

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  connected: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Connected' },
  error: { bg: '#d03b3b1a', fg: '#a52c2c', label: 'Needs attention' },
  disconnected: { bg: '#6f7a721a', fg: '#5c665f', label: 'Not connected' },

  drafting: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Writing' },
  rendering: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Rendering' },
  awaiting_approval: { bg: '#fab2192e', fg: '#8a6100', label: 'Needs approval' },
  ready: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Ready to post' },
  publishing: { bg: '#2a78d61a', fg: '#1f5ba3', label: 'Publishing' },
  published: { bg: '#0ca30c1a', fg: '#0a7a0a', label: 'Published' },
  partial: { bg: '#eb68341f', fg: '#a8461f', label: 'Partly published' },
  failed: { bg: '#d03b3b1a', fg: '#a52c2c', label: 'Failed' },
  rejected: { bg: '#6f7a721a', fg: '#5c665f', label: 'Rejected' },
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
 * the pipeline, because the failure everyone hits is switching automation on
 * and finding out at 10am that a key was never added.
 */
export function Readiness({
  readiness,
  connectedCount,
}: {
  readiness: { writer: boolean; video: boolean; tokenVault: boolean };
  connectedCount: number;
}) {
  const rows = [
    {
      ok: readiness.writer,
      label: 'Script writer (Claude)',
      good: 'ANTHROPIC_API_KEY is set — scripts can be written.',
      bad: 'ANTHROPIC_API_KEY is missing. Add it to the backend secrets; nothing can be drafted without it.',
    },
    {
      ok: readiness.tokenVault,
      label: 'Token vault',
      good: 'SOCIAL_TOKEN_KEY is set — access tokens can be stored encrypted.',
      bad: 'SOCIAL_TOKEN_KEY is missing. Generate one with `openssl rand -base64 32`, add it as a GitHub Actions secret and redeploy. Accounts cannot be connected until then.',
    },
    {
      ok: readiness.video,
      label: 'Video renderer',
      good: 'A renderer is configured.',
      bad: 'No GEMINI_API_KEY, so videos are not rendered. Scripts are still written — attach the video yourself from the approval queue.',
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
  return post.script?.hook || post.caption || '(no script yet)';
}
