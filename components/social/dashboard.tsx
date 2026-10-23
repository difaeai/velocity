'use client';

/**
 * The overview's sections: the numbers, the pieces as boxes, the team as cards,
 * what is travelling this week and what worked.
 *
 * Everything is read from documents the overview already watches. `readDesk`
 * is pure and does all the deciding, so the drawing below only draws.
 */

import { useState } from 'react';
import Link from 'next/link';

import { colors } from '@/lib/config';
import {
  postAssets,
  socialApi,
  type SocialEmployee,
  type SocialPageRead,
  type SocialPostDoc,
  type SocialResearch,
  type SocialRole,
  type SocialStage,
} from '@/lib/api';
import { compact } from '@/components/charts';
import { FormatChip, Mascot, ROLE_META, STAGE_META, StatusPill, longDate, postSummary } from './shared';

const WAITING = ['awaiting_approval', 'partial', 'failed'];
/** Needs you, then being made, then the rest — the order a box is worth looking at. */
const NEEDS_YOU = ['awaiting_approval', 'changes_requested', 'failed', 'partial'];
const MAKING = ['planning', 'researching', 'drafting', 'optimising', 'designing', 'rendering', 'publishing'];

/** Pakistan's calendar day for a moment — post ids and `date` are PKT days. */
export const pktDay = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

export interface Doing {
  now: boolean;
  stage: SocialStage;
  note: string | null;
  atMs: number;
  post: SocialPostDoc;
}

/** Everything the overview shows, decided once from the posts it watches. */
export function readDesk(posts: SocialPostDoc[], nowMs: number) {
  const today = pktDay(nowMs);
  const day = (back: number) => pktDay(nowMs - back * 86_400_000);
  const posted = posts.filter((p) => p.status === 'published' || p.status === 'partial');

  const doing = new Map<string, Doing>();
  for (const post of posts) {
    for (const [stage, w] of Object.entries(post.work ?? {}) as [SocialStage, NonNullable<SocialPostDoc['work']>[SocialStage]][]) {
      if (!w?.employeeId) continue;
      const atMs = (w.state === 'working' ? w.startedAtMs : w.finishedAtMs) ?? w.startedAtMs ?? 0;
      const seen = doing.get(w.employeeId);
      const now = w.state === 'working';
      // Working beats finished; otherwise the latest thing they touched.
      if (!seen || (now && !seen.now) || (now === seen.now && atMs > seen.atMs)) {
        doing.set(w.employeeId, { now, stage, note: w.note, atMs, post });
      }
    }
  }

  const rank = (p: SocialPostDoc) => (NEEDS_YOU.includes(p.status) ? 0 : MAKING.includes(p.status) ? 1 : 2);
  return {
    today,
    postedThisWeek: posted.filter((p) => p.date > day(7)).length,
    postedLastWeek: posted.filter((p) => p.date > day(14) && p.date <= day(7)).length,
    waiting: posts.filter((p) => WAITING.includes(p.status)),
    doing,
    /** The boxes, most urgent first; posts arrive newest first and sort is stable. */
    boxes: [...posts].sort((a, b) => rank(a) - rank(b)).slice(0, 8),
  };
}

export type DeskRead = ReturnType<typeof readDesk>;

export function ago(ms: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

// ── the numbers across the top ──────────────────────────────────────────────

export function Kpi({
  icon,
  tint,
  label,
  value,
  delta,
  hint,
}: {
  icon: string;
  tint: string;
  label: string;
  value: string;
  delta?: number | null;
  hint: string;
}) {
  return (
    <div className="sd-card sd-lift" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <span
        aria-hidden
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          fontSize: 22,
          background: tint,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{value}</span>
          {delta != null && delta !== 0 ? (
            <span style={{ fontSize: 12, fontWeight: 800, color: delta > 0 ? colors.success : colors.danger }}>
              {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: colors.muted }}>{hint}</div>
      </div>
    </div>
  );
}

// ── the pieces, as boxes ───────────────────────────────────────────────────

/**
 * What the team made, one box each, most urgent first. A box waiting for you
 * can be approved right here; everything else opens in the queue.
 */
export function PostBoxes({ posts, direct }: { posts: SocialPostDoc[]; direct: boolean }) {
  return (
    <div className="sd-card">
      <SectionHead
        title="What the team made"
        href="/dashboard/social/queue"
        link="All posts"
        sub={
          direct
            ? 'Finished pieces post themselves. Anything that could not go out waits here.'
            : 'Check a piece and press Approve — it goes live within five minutes.'
        }
      />
      {posts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>
          Nothing yet. Ask for something above and it shows up here.
        </p>
      ) : (
        <div className="sd-boxes">
          {posts.map((p) => (
            <PostBox key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostBox({ post }: { post: SocialPostDoc }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const assets = postAssets(post);
  const image = assets.find((a) => a.kind === 'image' && a.url);
  const video = assets.find((a) => a.kind === 'video' && a.url);
  const open = `/dashboard/social/queue?open=${post.id}`;
  // The queue refuses an approve with nothing to post; so does the box.
  const canApprove = post.status === 'awaiting_approval' && assets.length > 0;

  async function approve() {
    setBusy(true);
    setSaid(null);
    try {
      const res = await socialApi.review({
        postId: post.id,
        approve: true,
        caption: post.caption,
        targets: post.targets,
        publishNow: true,
      });
      setSaid(
        res.status === 'scheduled' && res.dueAtMs
          ? `Goes out ${new Date(res.dueAtMs).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
          : res.failed
            ? `${res.failed} network(s) failed — open it`
            : 'Posted',
      );
    } catch (e) {
      setSaid(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sd-box sd-lift">
      <Link href={open} className="sd-box-media" aria-label={`Open ${postSummary(post)}`}>
        {video ? (
          <video
            src={video.url ?? undefined}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        ) : image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url ?? ''} alt={image.alt ?? ''} />
        ) : (
          <span>{MAKING.includes(post.status) ? 'Being made…' : 'No picture yet'}</span>
        )}
        {video ? <span className="sd-box-play">▶</span> : null}
      </Link>
      <div style={{ display: 'grid', gap: 7, padding: 11 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormatChip format={post.format} />
          <StatusPill status={post.status} />
        </span>
        <span className="sd-clip2" style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, minHeight: 35 }}>
          {postSummary(post)}
        </span>
        <span style={{ fontSize: 11.5, color: colors.muted }}>{longDate(post.date)}</span>
        {said ? <span style={{ fontSize: 12, fontWeight: 700, color: colors.success }}>{said}</span> : null}
        {canApprove && !said ? (
          <button type="button" className="sd-box-go" onClick={approve} disabled={busy}>
            {busy ? 'Posting…' : 'Approve & post'}
          </button>
        ) : (
          <Link href={open} className="sd-box-open">
            {NEEDS_YOU.includes(post.status) ? 'Open & fix →' : 'Open →'}
          </Link>
        )}
      </div>
    </div>
  );
}

// ── travelling this week ────────────────────────────────────────────────────

/** A YouTube link is the one kind of address the team can watch for "make one like this". */
export const isYouTube = (url: string) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url);

/**
 * Real posts the morning search found travelling this week, and why. A YouTube
 * one can go straight into the box above as "make one like this".
 */
export function ViralFinds({
  research,
  onLike,
}: {
  research: SocialResearch | null;
  onLike: (url: string, title: string) => void;
}) {
  const finds = research?.viral ?? [];
  return (
    <div className="sd-card">
      <SectionHead
        title="Viral this week"
        sub="Found by the research agent this morning. Open one, or have the team make one like it."
      />
      {finds.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
          {research?.error
            ? `No list today: ${research.error}`
            : 'The research agent lists what is travelling after its next morning search.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {finds.map((f) => (
            <div key={f.url} className="sd-top">
              <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: 'inherit' }}>
                {f.title} ↗
              </a>
              {f.why ? <span style={{ fontSize: 12, color: colors.muted, lineHeight: 1.45 }}>{f.why}</span> : null}
              {isYouTube(f.url) ? (
                <button
                  type="button"
                  className="sd-box-open"
                  style={{ justifySelf: 'start' }}
                  onClick={() => onLike(f.url, f.title)}
                >
                  🎬 Make one like this
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the team ────────────────────────────────────────────────────────────────

/** What you can tell each role — the answer to "what do I say to them?". */
const TELL: Record<SocialRole, string> = {
  'research-assistant': 'Which topics, cities or rival pages to watch.',
  'content-writer': 'What to make next, the tone, words never to use.',
  'seo-expert': 'The searches you want to be found for.',
  'google-seo-expert': 'What your YouTube titles should aim at.',
  designer: 'Colours, faces and the look of every picture.',
  'video-editor': 'Pace, length and the mood of the reels.',
  'youtube-ads-expert': 'Budget range and who the ads should reach.',
  'social-manager': 'Where to post and how to answer comments.',
};

export function AgentGrid({
  staff,
  desk,
  nowMs,
}: {
  staff: SocialEmployee[];
  desk: DeskRead;
  nowMs: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const active = staff.filter((e) => e.status === 'active').length;

  return (
    <div className="sd-card">
      <SectionHead
        title="AI agents"
        badge={`${active} on duty`}
        href="/dashboard/social/employees"
        link="Manage the team"
        sub="Each one has one job. Click a card to see what they are doing and what you can tell them."
      />
      {staff.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>
          Nobody is hired yet.{' '}
          <Link href="/dashboard/social/employees" style={{ color: colors.secondary, fontWeight: 700 }}>
            Hire the team
          </Link>{' '}
          — it takes one click.
        </p>
      ) : (
        <div className="sd-agents">
          {staff.map((e) => {
            const meta = ROLE_META[e.role];
            const d = desk.doing.get(e.id);
            const on = e.status === 'active';
            const expanded = open === e.id;
            return (
              <button
                key={e.id}
                type="button"
                className="sd-agent sd-lift"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : e.id)}
                style={{ opacity: on ? 1 : 0.62 }}
              >
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="sd-avatar" style={{ background: `${meta.colour}33` }}>
                    <Mascot role={e.role} size={34} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: 13.5 }}>{e.name}</strong>
                    <span style={{ fontSize: 11.5, color: colors.muted }}>{meta.label}</span>
                  </span>
                </span>

                <span className="sd-clip2" style={{ fontSize: 12, color: colors.text, lineHeight: 1.45, minHeight: 35 }}>
                  {!on
                    ? 'Off duty — not working on anything.'
                    : d?.now
                      ? `Now: ${STAGE_META[d.stage].label.toLowerCase()} for “${postSummary(d.post)}”`
                      : d
                        ? `Last: ${d.note ?? STAGE_META[d.stage].label} · ${ago(d.atMs, nowMs)}`
                        : 'Waiting for the first job.'}
                </span>

                {expanded ? (
                  <span style={{ display: 'grid', gap: 6, fontSize: 12, lineHeight: 1.5, color: colors.muted }}>
                    <span>{meta.does}</span>
                    <span>
                      <strong style={{ color: colors.text }}>You can tell them: </strong>
                      {TELL[e.role]}
                    </span>
                    {e.instructions ? (
                      <span>
                        <strong style={{ color: colors.text }}>Your instructions: </strong>
                        {e.instructions}
                      </span>
                    ) : null}
                    <span>{e.piecesWorked} pieces worked on.</span>
                    <Link
                      href="/dashboard/social/employees"
                      onClick={(ev) => ev.stopPropagation()}
                      style={{ color: colors.secondary, fontWeight: 800 }}
                    >
                      Give {e.name} instructions →
                    </Link>
                  </span>
                ) : null}

                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800 }}>
                  <span
                    className={d?.now && on ? 'sd-dot sd-pulse' : 'sd-dot'}
                    style={{ background: !on ? '#9aa5a0' : d?.now ? '#0ca30c' : '#7fd17f' }}
                  />
                  <span style={{ color: on ? colors.success : colors.muted }}>
                    {!on ? 'Off duty' : d?.now ? 'Working now' : 'On duty'}
                  </span>
                  <span style={{ marginLeft: 'auto', color: colors.muted }}>{expanded ? '▴' : '▾'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── the right column ────────────────────────────────────────────────────────

export function TopContent({ read }: { read: SocialPageRead | null }) {
  const best = read?.best.slice(0, 3) ?? [];
  return (
    <div className="sd-card">
      <SectionHead title="Top performing" href="/dashboard/social/performance" link="View all" />
      {best.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
          Numbers show here a day after the first posts go live.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {best.map((p) => (
            <a key={p.mediaId} href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="sd-top">
              <span className="sd-clip2" style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
                {p.hook || 'Untitled post'}
              </span>
              <span style={{ display: 'flex', gap: 10, fontSize: 11.5, color: colors.muted, flexWrap: 'wrap' }}>
                <span>👁 {compact(p.reach)}</span>
                <span>🔖 {compact(p.saves)}</span>
                <span>📤 {compact(p.sends)}</span>
                <span>💬 {compact(p.comments)}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 800, color: colors.success }}>
                  {p.multiple.toFixed(1)}× usual
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionHead({
  title,
  sub,
  badge,
  href,
  link,
}: {
  title: string;
  sub?: string;
  badge?: string;
  href?: string;
  link?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{title}</h2>
        {badge ? <span className="sd-badge-pill">{badge}</span> : null}
        {href && link ? (
          <Link href={href} style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: colors.secondary }}>
            {link} →
          </Link>
        ) : null}
      </div>
      {sub ? <p style={{ margin: '4px 0 0', fontSize: 12.5, color: colors.muted }}>{sub}</p> : null}
    </div>
  );
}

export const DASH_CSS = `
.sd-card { background: ${colors.surface}; border: 1px solid ${colors.border}; border-radius: 16px; padding: 18px; min-width: 0; }
.sd-lift { transition: box-shadow .18s ease, transform .18s ease; }
.sd-lift:hover { box-shadow: 0 10px 28px rgba(0, 57, 36, .10); transform: translateY(-2px); }
.sd-stack { display: grid; gap: 18px; margin-bottom: 18px; }
.sd-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.sd-grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
.sd-col { display: grid; gap: 18px; min-width: 0; }
.sd-clip { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-clip2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.sd-boxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.sd-box { display: grid; grid-template-rows: auto 1fr; border: 1px solid ${colors.border}; border-radius: 14px;
  overflow: hidden; background: ${colors.surface}; min-width: 0; }
.sd-box-media { position: relative; display: grid; place-items: center; aspect-ratio: 4 / 5; background: #1a1c1c;
  color: #ccff00; font-size: 12.5px; font-weight: 700; overflow: hidden; }
.sd-box-media img, .sd-box-media video { width: 100%; height: 100%; object-fit: cover; display: block; }
.sd-box-play { position: absolute; right: 8px; bottom: 8px; width: 26px; height: 26px; border-radius: 50%;
  background: rgba(0, 0, 0, .55); color: #fff; display: grid; place-items: center; font-size: 11px; pointer-events: none; }
.sd-box-go { border: 0; border-radius: 9px; padding: 8px 10px; background: ${colors.primary}; color: #fff;
  font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.sd-box-go:disabled { opacity: .6; cursor: wait; }
.sd-box-open { border: 1px solid ${colors.border}; border-radius: 9px; padding: 7px 10px; background: ${colors.surface};
  color: ${colors.primary}; font: inherit; font-size: 12.5px; font-weight: 800; text-align: center; cursor: pointer; }

.sd-agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 12px; align-items: start; }
.sd-agent { display: grid; gap: 10px; align-content: start; text-align: left; font: inherit; color: inherit;
  background: ${colors.surface}; border: 1px solid ${colors.border}; border-radius: 14px; padding: 13px; cursor: pointer; }
.sd-avatar { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; flex: none; }
.sd-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sd-badge-pill { font-size: 11.5px; font-weight: 800; color: ${colors.success}; background: ${colors.success}14;
  border-radius: 999px; padding: 2px 9px; }
.sd-top { display: grid; gap: 5px; padding: 10px; border-radius: 12px; border: 1px solid ${colors.border}; color: inherit;
  transition: border-color .15s ease; }
.sd-top:hover { border-color: ${colors.primary}; }

.sd-pulse { animation: sd-pulse 1.6s ease-out infinite; }
@keyframes sd-pulse { 0% { box-shadow: 0 0 0 0 rgba(12, 163, 12, .55); } 75%, 100% { box-shadow: 0 0 0 7px rgba(12, 163, 12, 0); } }

@media (max-width: 1240px) { .sd-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 900px) { .sd-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) {
  .sd-kpis { grid-template-columns: minmax(0, 1fr); }
  .sd-boxes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .sd-pulse { animation: none; }
  .sd-lift:hover { transform: none; }
}
`;
