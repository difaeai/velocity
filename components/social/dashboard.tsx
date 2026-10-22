'use client';

/**
 * The overview's sections: the numbers across the top, the team as cards, what
 * is ready for you, what just happened and what worked.
 *
 * Everything is read from documents the overview already watches. `readDesk`
 * is pure and does all the deciding, so the drawing below only draws — the
 * same split as `readPipeline` in ./pipeline.tsx.
 */

import { useState } from 'react';
import Link from 'next/link';

import { colors } from '@/lib/config';
import {
  postAssets,
  type SocialEmployee,
  type SocialPageRead,
  type SocialPostDoc,
  type SocialRole,
  type SocialStage,
} from '@/lib/api';
import { SERIES, TimeSeries, compact } from '@/components/charts';
import { FormatChip, Mascot, PLATFORM_META, ROLE_META, STAGE_META, StatusPill, longDate, postSummary } from './shared';

const LIME = '#ccff00';
const WAITING = ['awaiting_approval', 'partial', 'failed'];

/** Pakistan's calendar day for a moment — post ids and `date` are PKT days. */
export const pktDay = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

export interface Activity {
  atMs: number;
  who: string;
  role: SocialRole | null;
  what: string;
  postId: string;
  failed: boolean;
}

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

  const activity: Activity[] = [];
  const doing = new Map<string, Doing>();
  for (const post of posts) {
    for (const [stage, w] of Object.entries(post.work ?? {}) as [SocialStage, NonNullable<SocialPostDoc['work']>[SocialStage]][]) {
      if (!w) continue;
      const atMs = (w.state === 'working' ? w.startedAtMs : w.finishedAtMs) ?? w.startedAtMs ?? 0;
      if (w.state !== 'working' && atMs) {
        activity.push({
          atMs,
          who: w.name,
          role: w.role,
          what: `${STAGE_META[stage].label} — ${w.error ?? w.note ?? 'done'}`,
          postId: post.id,
          failed: w.state === 'failed',
        });
      }
      if (!w.employeeId) continue;
      const seen = doing.get(w.employeeId);
      const now = w.state === 'working';
      // Working beats finished; otherwise the latest thing they touched.
      if (!seen || (now && !seen.now) || (now === seen.now && atMs > seen.atMs)) {
        doing.set(w.employeeId, { now, stage, note: w.note, atMs, post });
      }
    }
    for (const [platform, r] of Object.entries(post.results ?? {})) {
      if (r?.ok && r.atMs) {
        activity.push({
          atMs: r.atMs,
          who: 'Posted',
          role: 'social-manager',
          what: `Live on ${PLATFORM_META[platform as keyof typeof PLATFORM_META]?.label ?? platform} — ${postSummary(post)}`,
          postId: post.id,
          failed: false,
        });
      }
    }
  }
  activity.sort((a, b) => b.atMs - a.atMs);

  return {
    today,
    postedThisWeek: posted.filter((p) => p.date > day(7)).length,
    postedLastWeek: posted.filter((p) => p.date > day(14) && p.date <= day(7)).length,
    waiting: posts.filter((p) => WAITING.includes(p.status)),
    activity: activity.slice(0, 8),
    doing,
    /** The week so far, oldest first, for the calendar strip. */
    week: Array.from({ length: 7 }, (_, i) => day(6 - i)),
    /** Fourteen days of made against posted, for the chart. */
    days: Array.from({ length: 14 }, (_, i) => {
      const d = day(13 - i);
      return {
        label: longDate(d).replace(/^\w+ /, ''),
        values: [posts.filter((p) => p.date === d).length, posted.filter((p) => p.date === d).length],
      };
    }),
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

// ── the banner ──────────────────────────────────────────────────────────────

export type QuickAction = 'reel' | 'post' | 'ad';

export function Hero({
  workspace,
  waiting,
  onMake,
}: {
  workspace: string;
  waiting: number;
  onMake: (what: QuickAction) => void;
}) {
  return (
    <section className="sd-hero" aria-label="Your social media team">
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: LIME, marginBottom: 10 }}>{workspace}</div>
        <h2 style={{ fontSize: 26, lineHeight: 1.2, fontWeight: 900, margin: '0 0 10px', color: '#fff' }}>
          Your social media team,
          <br />
          run by AI agents
        </h2>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, color: '#d6e6dc', maxWidth: 380 }}>
          Say what you want. The team writes it, makes the picture or video, posts it, answers comments — and tells you
          what worked.
        </p>
        <button type="button" className="sd-cta" onClick={() => onMake('reel')}>
          Create new post →
        </button>
      </div>

      <div className="sd-hero-art" aria-hidden>
        <span className="sd-orbit">
          {(['content-writer', 'designer', 'video-editor'] as SocialRole[]).map((role, i) => (
            <span key={role} className="sd-face" style={{ left: `${i * 46}px`, top: i === 1 ? 0 : 26 }}>
              <Mascot role={role} size={56} />
            </span>
          ))}
        </span>
        {(['instagram', 'facebook', 'tiktok', 'youtube'] as const).map((p, i) => (
          <span
            key={p}
            className="sd-float sd-badge"
            style={{
              background: PLATFORM_META[p].brand,
              animationDelay: `${i * 0.7}s`,
              ...[{ left: 0, top: 0 }, { right: 0, top: 6 }, { left: 12, bottom: 0 }, { right: 8, bottom: 4 }][i],
            }}
          >
            {PLATFORM_META[p].glyph}
          </span>
        ))}
      </div>

      <div className="sd-quick">
        <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Quick actions</div>
        <button type="button" className="sd-qa" onClick={() => onMake('reel')}>
          <span>📱 Make a reel</span>→
        </button>
        <button type="button" className="sd-qa" onClick={() => onMake('post')}>
          <span>🖼️ Make a post</span>→
        </button>
        <button type="button" className="sd-qa" onClick={() => onMake('ad')}>
          <span>📣 Make a paid ad</span>→
        </button>
        <Link className="sd-qa" href="/dashboard/social/queue">
          <span>✅ Check &amp; approve{waiting ? ` (${waiting})` : ''}</span>→
        </Link>
        <Link className="sd-qa" href="/dashboard/social/performance">
          <span>📈 See what is working</span>→
        </Link>
      </div>
    </section>
  );
}

// ── ready for you ───────────────────────────────────────────────────────────

/** What is waiting, and the three steps between "made" and "live". */
export function ReadyForYou({ waiting, direct }: { waiting: SocialPostDoc[]; direct: boolean }) {
  const steps = [
    { n: 1, title: 'The team makes it', text: 'Words, picture or video, captions — about ten minutes.' },
    direct
      ? { n: 2, title: 'It posts itself', text: 'You chose "post directly". Anything that could not go out waits here.' }
      : { n: 2, title: 'You check it', text: 'Open it, read it, press Approve & post — or say what to fix.' },
    { n: 3, title: 'It goes live', text: 'On Instagram and Facebook within five minutes. Numbers follow next day.' },
  ];
  return (
    <div className="sd-card">
      <SectionHead title="Ready for you" href="/dashboard/social/queue" link="Open the queue" />
      <ol className="sd-steps">
        {steps.map((s) => (
          <li key={s.n}>
            <span className="sd-step-n">{s.n}</span>
            <span>
              <strong style={{ display: 'block', fontSize: 13 }}>{s.title}</strong>
              <span style={{ fontSize: 12, color: colors.muted, lineHeight: 1.45 }}>{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {waiting.length === 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: colors.muted }}>Nothing is waiting for you.</p>
      ) : (
        <div style={{ display: 'grid', gap: 2, marginTop: 12 }}>
          {waiting.slice(0, 4).map((p) => {
            const thumb = postAssets(p).find((a) => a.kind === 'image' && a.url);
            const video = postAssets(p).some((a) => a.kind === 'video' && a.url);
            return (
              <Link key={p.id} href={`/dashboard/social/queue?open=${p.id}`} className="sd-row">
                <span className="sd-thumb">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb.url ?? ''} alt="" />
                  ) : video ? (
                    '▶'
                  ) : (
                    '…'
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                    <FormatChip format={p.format} />
                    <span style={{ fontSize: 11.5, color: colors.muted }}>{longDate(p.date)}</span>
                  </span>
                  <span className="sd-clip" style={{ fontSize: 13, fontWeight: 700 }}>
                    {postSummary(p)}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.primary, whiteSpace: 'nowrap' }}>
                  {p.status === 'awaiting_approval' ? 'Review & post →' : 'Fix →'}
                </span>
              </Link>
            );
          })}
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

// ── the week ────────────────────────────────────────────────────────────────

export function WeekStrip({ posts, desk }: { posts: SocialPostDoc[]; desk: DeskRead }) {
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? desk.today;
  const onDay = posts.filter((p) => p.date === day);
  return (
    <div className="sd-card">
      <SectionHead title="This week" href="/dashboard/social/calendar" link="Calendar" />
      <div className="sd-days" role="tablist" aria-label="Days">
        {desk.week.map((d) => {
          const n = posts.filter((p) => p.date === d).length;
          const [wd, dm, mon] = longDate(d).split(' ');
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              className={d === day ? 'sd-day sd-day-on' : 'sd-day'}
              onClick={() => setPicked(d)}
            >
              <span style={{ fontWeight: 800 }}>{wd.replace(',', '')}</span>
              <span>
                {dm} {mon}
              </span>
              <span className="sd-day-n">{n || '·'}</span>
            </button>
          );
        })}
      </div>
      {onDay.length === 0 ? (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: colors.muted }}>Nothing made on this day.</p>
      ) : (
        <div style={{ display: 'grid', gap: 2, marginTop: 8 }}>
          {onDay.map((p) => (
            <Link key={p.id} href={`/dashboard/social/queue?open=${p.id}`} className="sd-row">
              <FormatChip format={p.format} />
              <span className="sd-clip" style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>
                {postSummary(p)}
              </span>
              <StatusPill status={p.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function MadeChart({ desk }: { desk: DeskRead }) {
  return (
    <div className="sd-card">
      <SectionHead title="Made and posted" sub="The last 14 days" />
      <TimeSeries
        points={desk.days}
        series={[
          { key: 'made', label: 'Made', color: SERIES[0] },
          { key: 'posted', label: 'Posted', color: '#0ca30c' },
        ]}
        height={170}
      />
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: colors.muted, marginTop: 6 }}>
        <span>
          <span className="sd-key" style={{ background: SERIES[0] }} /> Made
        </span>
        <span>
          <span className="sd-key" style={{ background: '#0ca30c' }} /> Posted
        </span>
      </div>
    </div>
  );
}

// ── the right column ────────────────────────────────────────────────────────

export function RecentActivity({ desk, nowMs }: { desk: DeskRead; nowMs: number }) {
  return (
    <div className="sd-card">
      <SectionHead title="Recent activity" href="/dashboard/social/queue" link="View all" />
      {desk.activity.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>Nothing has happened yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {desk.activity.map((a, i) => (
            <Link key={i} href={`/dashboard/social/queue?open=${a.postId}`} style={{ display: 'flex', gap: 10 }}>
              <span className="sd-avatar sd-avatar-sm" style={{ background: a.role ? `${ROLE_META[a.role].colour}33` : colors.bg }}>
                {a.role ? <Mascot role={a.role} size={24} /> : null}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', gap: 6 }}>
                  <strong style={{ fontSize: 12.5, flex: 1 }}>{a.who}</strong>
                  <span style={{ fontSize: 11, color: colors.muted, whiteSpace: 'nowrap' }}>{ago(a.atMs, nowMs)}</span>
                </span>
                <span className="sd-clip2" style={{ fontSize: 12, color: a.failed ? colors.danger : colors.muted, lineHeight: 1.4 }}>
                  {a.what}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

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
.sd-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.sd-grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
.sd-col { display: grid; gap: 18px; min-width: 0; }
.sd-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }

.sd-hero { position: relative; overflow: hidden; border-radius: 18px; padding: 26px; display: grid;
  grid-template-columns: minmax(0, 1fr) 170px 250px; gap: 18px; align-items: center;
  background: radial-gradient(120% 140% at 0% 0%, #0b6b45 0%, ${colors.primary} 45%, ${colors.primaryDark} 100%); }
.sd-hero::after { content: ''; position: absolute; inset: auto -60px -80px auto; width: 260px; height: 260px;
  border-radius: 50%; background: ${LIME}; opacity: .07; }
.sd-cta { background: ${LIME}; color: #10210f; border: 0; border-radius: 10px; padding: 10px 18px; font-weight: 900;
  font-size: 14px; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.sd-cta:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(204, 255, 0, .35); }
.sd-hero-art { position: relative; height: 150px; }
.sd-orbit { position: absolute; left: 50%; top: 50%; width: 148px; height: 82px; transform: translate(-50%, -50%); }
.sd-face { position: absolute; width: 60px; height: 60px; border-radius: 50%; background: #fff; display: grid;
  place-items: center; box-shadow: 0 6px 18px rgba(0, 0, 0, .25); }
.sd-badge { position: absolute; width: 30px; height: 30px; border-radius: 9px; color: #fff; display: grid;
  place-items: center; font-weight: 900; font-size: 13px; box-shadow: 0 4px 12px rgba(0, 0, 0, .3); }
.sd-quick { position: relative; z-index: 1; background: rgba(0, 0, 0, .22); border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 14px; padding: 14px; display: grid; gap: 7px; }
.sd-qa { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: rgba(255, 255, 255, .06); color: #fff; border: 1px solid rgba(255, 255, 255, .14); border-radius: 9px;
  padding: 8px 11px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s ease, border-color .15s ease; }
.sd-qa:hover { background: rgba(204, 255, 0, .14); border-color: ${LIME}; }

.sd-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.sd-steps li { display: flex; gap: 9px; background: ${colors.bg}; border-radius: 12px; padding: 10px; }
.sd-step-n { flex: none; width: 24px; height: 24px; border-radius: 50%; background: ${colors.primary}; color: ${LIME};
  display: grid; place-items: center; font-weight: 900; font-size: 12px; }
.sd-row { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; color: inherit; min-width: 0;
  transition: background .15s ease; }
.sd-row:hover { background: ${colors.bg}; }
.sd-thumb { width: 36px; height: 46px; flex: none; border-radius: 7px; overflow: hidden; background: #1a1c1c;
  color: ${LIME}; display: grid; place-items: center; font-size: 13px; }
.sd-thumb img { width: 100%; height: 100%; object-fit: cover; }
.sd-clip { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-clip2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.sd-agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 12px; align-items: start; }
.sd-agent { display: grid; gap: 10px; align-content: start; text-align: left; font: inherit; color: inherit;
  background: ${colors.surface}; border: 1px solid ${colors.border}; border-radius: 14px; padding: 13px; cursor: pointer; }
.sd-avatar { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; flex: none; }
.sd-avatar-sm { width: 30px; height: 30px; border-radius: 9px; }
.sd-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sd-badge-pill { font-size: 11.5px; font-weight: 800; color: ${colors.success}; background: ${colors.success}14;
  border-radius: 999px; padding: 2px 9px; }

.sd-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.sd-day { display: grid; gap: 1px; justify-items: center; padding: 7px 2px; border-radius: 10px; font: inherit;
  font-size: 11px; color: ${colors.muted}; background: ${colors.bg}; border: 1px solid transparent; cursor: pointer; }
.sd-day:hover { border-color: ${colors.border}; }
.sd-day-on { background: ${colors.primary}; color: #fff; }
.sd-day-n { font-weight: 900; font-size: 12.5px; color: inherit; }
.sd-key { display: inline-block; width: 10px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
.sd-top { display: grid; gap: 5px; padding: 10px; border-radius: 12px; border: 1px solid ${colors.border}; color: inherit;
  transition: border-color .15s ease; }
.sd-top:hover { border-color: ${colors.primary}; }

.sd-pulse { animation: sd-pulse 1.6s ease-out infinite; }
@keyframes sd-pulse { 0% { box-shadow: 0 0 0 0 rgba(12, 163, 12, .55); } 75%, 100% { box-shadow: 0 0 0 7px rgba(12, 163, 12, 0); } }
.sd-float { animation: sd-float 5s ease-in-out infinite; }
@keyframes sd-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }

@media (max-width: 1240px) {
  .sd-grid { grid-template-columns: minmax(0, 1fr); }
  .sd-hero { grid-template-columns: minmax(0, 1fr) 250px; }
  .sd-hero-art { display: none; }
}
@media (max-width: 900px) {
  .sd-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sd-row2, .sd-hero, .sd-steps { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) { .sd-kpis { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) {
  .sd-pulse, .sd-float { animation: none; }
  .sd-lift:hover, .sd-cta:hover { transform: none; }
}
`;
