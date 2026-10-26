'use client';

/**
 * The overview's sections: the hero with the team, the approval choice, the
 * numbers, how the ads are running and how the sales agents are doing — plus
 * the viral finds, which live on the content page now.
 *
 * Everything is read from documents the pages already watch. `readDesk` is
 * pure and does all the deciding, so the drawing below only draws.
 */

import Link from 'next/link';

import { colors } from '@/lib/config';
import type {
  AdCampaignDoc,
  AdsConfigDoc,
  SalesLeadDoc,
  SalesSettingsDoc,
  SocialEmployee,
  SocialPostDoc,
  SocialResearch,
  SocialSettings,
  SocialStage,
} from '@/lib/api';
import { Mascot, ROLE_META, longDate } from './shared';
import { GRADE_META, adMoney, tone } from './ads';
import { localHourLabel } from './launch';
import { AreaSpark, CountUp, Ring } from './fx';

const WAITING = ['awaiting_approval', 'partial', 'failed'];
const DAY_MS = 86_400_000;

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
  const day = (back: number) => pktDay(nowMs - back * DAY_MS);
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

  return {
    today,
    postedThisWeek: posted.filter((p) => p.date > day(7)).length,
    postedLastWeek: posted.filter((p) => p.date > day(14) && p.date <= day(7)).length,
    /** Posted per day, the last fourteen days, oldest first — the sparkline. */
    perDay: Array.from({ length: 14 }, (_, i) => day(13 - i)).map((d) => posted.filter((p) => p.date === d).length),
    waiting: posts.filter((p) => WAITING.includes(p.status)),
    doing,
  };
}

export type DeskRead = ReturnType<typeof readDesk>;

const vars = (i: number) => ({ ['--i' as string]: i }) as React.CSSProperties;

// ── the hero ────────────────────────────────────────────────────────────────

export function Hero({
  greeting,
  name,
  today,
  summary,
  running,
  waiting,
  staff,
  desk,
}: {
  greeting: string;
  name: string | null;
  today: string | null;
  summary: string;
  running: boolean;
  waiting: number;
  staff: SocialEmployee[];
  desk: DeskRead;
}) {
  const team = staff.filter((e) => e.status === 'active');
  const working = team.filter((e) => desk.doing.get(e.id)?.now).length;
  return (
    <section className="fx-hero fx-rise" style={vars(0)}>
      <span className="fx-orb a" />
      <span className="fx-orb b" />
      <span className="fx-orb c" />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="fx-eyebrow">Manage social · your AI team</div>
          <h1>
            {greeting}
            {name ? `, ${name}` : ''} <span className="fx-wave">👋</span>
          </h1>
          <p>{summary}</p>
          {team.length ? (
            <div className="fx-team" aria-label="Your AI team">
              {team.map((e, i) => {
                const busy = desk.doing.get(e.id)?.now;
                return (
                  <Link
                    key={e.id}
                    href="/dashboard/social/employees"
                    className="fx-mate fx-bob"
                    style={vars(i)}
                    title={`${e.name} — ${ROLE_META[e.role].label}${busy ? ', working now' : ''}`}
                    aria-label={`${e.name}, ${ROLE_META[e.role].label}${busy ? ', working now' : ''}`}
                  >
                    <Mascot role={e.role} size={32} />
                    {busy ? <span className="busy" /> : null}
                  </Link>
                );
              })}
              <Link href="/dashboard/social/employees" className="fx-hero-chip" style={{ marginLeft: 4 }}>
                {working ? `${working} working now` : `${team.length} on duty`} →
              </Link>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          {today ? <span className="fx-hero-chip">📅 {longDate(today)}</span> : null}
          <span className="fx-hero-chip">
            <span className={running ? 'fx-live lime' : 'fx-live off'} /> {running ? 'Posting every day' : 'Daily run paused'}
          </span>
          {waiting ? (
            <Link href="/dashboard/social/queue" className="fx-hero-chip warn">
              <span className="fx-wiggle">🔔</span> {waiting} waiting for you →
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── the approval choice ─────────────────────────────────────────────────────

const pieces = (n: number) => `${n} piece${n === 1 ? '' : 's'}`;

/**
 * The one question that decides how the desk behaves: ask before every post,
 * or post on its own every day. Choosing the second also starts the daily run;
 * the switch underneath starts or pauses that run for either answer.
 */
export function ApprovalBox({
  settings,
  waiting,
  busy,
  noTeam,
  networks,
  nextRun,
  coverage,
  onChoose,
  onRunning,
}: {
  settings: SocialSettings;
  waiting: number;
  busy: boolean;
  noTeam: boolean;
  networks: string;
  nextRun: string | null;
  coverage: string | null;
  onChoose: (direct: boolean) => void;
  onRunning: (on: boolean) => void;
}) {
  const chosen = Boolean(settings.publishModeChosen);
  const ask = chosen && !settings.autoPublish;
  const direct = chosen && settings.autoPublish;
  const running = Boolean(settings.enabled);
  return (
    <section className="fx-card fx-rise" style={vars(2)} aria-labelledby="approval-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: '#eef8d2' }} aria-hidden>
          ✅
        </span>
        <div>
          <h2 id="approval-h" className="fx-h2">
            Approval
          </h2>
          <p className="fx-sub">How should the team post?</p>
        </div>
        {!chosen ? (
          <span className="fx-pill" style={{ marginLeft: 'auto', background: 'var(--lime)', color: 'var(--ink)' }}>
            <span className="fx-live" /> Choose one
          </span>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="How the team posts" style={{ display: 'grid', gap: 10 }}>
        <button type="button" role="radio" aria-checked={ask} className="fx-opt" disabled={busy} onClick={() => onChoose(false)}>
          <span className="ico" aria-hidden>
            🛡️
          </span>
          <span>
            <strong style={{ display: 'block', fontSize: 14.5 }}>Ask me before every post</strong>
            <span className="fx-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              Each piece waits for your Approve, then goes out at once.
            </span>
          </span>
          <span className="tick" aria-hidden>
            {ask ? '✓' : ''}
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={direct}
          className="fx-opt"
          disabled={busy || noTeam}
          onClick={() => onChoose(true)}
        >
          <span className="ico" aria-hidden>
            ⚡
          </span>
          <span>
            <strong style={{ display: 'block', fontSize: 14.5 }}>Post on its own, every day</strong>
            <span className="fx-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              Makes {pieces(settings.postsPerDay)}
              {settings.dailyStory ? ' and a story' : ''} every day at {localHourLabel(settings.runHour)} and posts them
              straight to {networks}.
            </span>
          </span>
          <span className="tick" aria-hidden>
            {direct ? '✓' : ''}
          </span>
        </button>
      </div>

      {waiting ? (
        <Link href="/dashboard/social/queue" className="fx-waiting">
          <span className="fx-wiggle" aria-hidden>
            🔔
          </span>
          <span style={{ flex: 1 }}>
            {waiting} piece{waiting === 1 ? '' : 's'} waiting for your Approve
          </span>
          <span>Review →</span>
        </Link>
      ) : null}

      <div className="fx-runrow">
        <button
          type="button"
          role="switch"
          aria-checked={running}
          aria-label="Daily run"
          className="fx-switch"
          disabled={busy || noTeam}
          onClick={() => onRunning(!running)}
        />
        <span style={{ fontSize: 13, lineHeight: 1.4, minWidth: 0 }}>
          <strong>Daily run {running ? 'on' : 'off'}</strong>
          <span className="fx-muted" style={{ display: 'block', fontSize: 12 }}>
            {noTeam
              ? 'Hire the AI team first.'
              : running
                ? `Next: ${nextRun ?? localHourLabel(settings.runHour)}`
                : 'Nothing is made unless you ask for it.'}
          </span>
        </span>
        <Link href="/dashboard/social/automation" className="fx-link">
          Settings
        </Link>
      </div>
      {coverage ? <p style={{ fontSize: 12, color: colors.warn, margin: '8px 0 0', lineHeight: 1.5 }}>{coverage}</p> : null}
    </section>
  );
}

// ── the numbers ─────────────────────────────────────────────────────────────

export function KpiTile({
  i,
  icon,
  tint,
  label,
  value,
  format,
  delta,
  hint,
  href,
  children,
}: {
  i: number;
  icon: string;
  tint: string;
  label: string;
  value: number | null;
  format?: (n: number) => string;
  delta?: number | null;
  hint: string;
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="fx-ico" style={{ background: tint }} aria-hidden>
          {icon}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--muted)' }}>{label}</span>
        {delta ? (
          <span className={`fx-delta ${delta > 0 ? 'up' : 'down'}`} style={{ marginLeft: 'auto' }}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
          </span>
        ) : null}
      </span>
      <span className="fx-num">{value == null ? '—' : <CountUp value={value} format={format} />}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</span>
      {children}
    </>
  );
  const style = { ...vars(i), display: 'grid', gap: 8, alignContent: 'start', color: 'inherit' };
  return href ? (
    <Link href={href} className="fx-card fx-lift fx-rise" style={style}>
      {body}
    </Link>
  ) : (
    <div className="fx-card fx-lift fx-rise" style={style}>
      {body}
    </div>
  );
}

// ── how the ads are running ─────────────────────────────────────────────────

/** Our light-card colours, readable on the dark ads card. */
const onDark = (c: string) =>
  c === colors.success ? '#86efac' : c === colors.danger ? '#fca5a5' : c === colors.secondary ? '#93c5fd' : c === colors.warn ? '#fcd34d' : '#ffffff';

/** Running first, then waiting for an Approve, then paused, then the rest. */
const campaignRank = (c: AdCampaignDoc, nowMs: number) =>
  c.status === 'ACTIVE' && !(c.endMs && nowMs && c.endMs < nowMs) ? 0 : c.approval === 'pending' ? 1 : c.status === 'PAUSED' ? 2 : 3;

export function AdsSection({
  ads,
  campaigns,
  nowMs,
  house,
  i,
}: {
  ads: AdsConfigDoc | null;
  campaigns: AdCampaignDoc[];
  nowMs: number;
  house: boolean;
  i: number;
}) {
  const connected = Boolean(ads?.adAccountId);
  const acc = ads?.account;
  const cur = ads?.currency ?? 'PKR';
  const live = campaigns.filter((c) => campaignRank(c, nowMs) === 0);
  const shown = [...campaigns].sort((a, b) => campaignRank(a, nowMs) - campaignRank(b, nowMs)).slice(0, 4);
  const w = acc?.week;
  const b = acc?.bench ?? undefined;
  const roas = house ? (acc?.blended?.roas ?? null) : (w?.roas ?? null);

  return (
    <section className="fx-card fx-dark fx-rise" style={vars(i)} aria-labelledby="ads-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: 'rgba(204,255,0,.14)' }} aria-hidden>
          📣
        </span>
        <div>
          <h2 id="ads-h" className="fx-h2">
            Meta Ad Expert
          </h2>
          <p className="fx-sub">How your ads are running</p>
        </div>
        <span className="fx-pill" style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.08)', color: '#eaf5ee' }}>
          <span className={live.length ? 'fx-live lime' : 'fx-live off'} />
          {connected ? (live.length ? `${live.length} running` : 'Nothing running') : 'Not connected'}
        </span>
      </div>

      {!connected ? (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0 4px' }}>
          <div className="fx-radar" aria-hidden>
            <span />
            <span />
            <span />
            <b>📣</b>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong style={{ fontSize: 16 }}>See what every rupee buys</strong>
            <p className="fx-muted" style={{ fontSize: 13, lineHeight: 1.55, margin: '4px 0 12px' }}>
              Connect the Meta ad account once. Then this card shows the spend, the clicks, what each click costs and
              which campaign is winning — read every three hours.
            </p>
            <Link href="/dashboard/social/accounts#meta-ads" className="fx-btn lime small">
              Connect the ad account
            </Link>
          </div>
        </div>
      ) : !acc || !w ? (
        <p className="fx-muted" style={{ fontSize: 13, margin: '0 0 6px' }}>
          Connected to {ads?.accountName}. The first numbers arrive with the next reading — or press Refresh on the Ads page.
        </p>
      ) : (
        <>
          <div className="fx-stats">
            <Cell
              label="Spent · 7 days"
              value={w.spend}
              format={(n) => adMoney(n, cur)}
              hint={ads!.dailyCap ? `limit ${adMoney(ads!.dailyCap, cur)}/day` : 'no daily limit set yet'}
            />
            <Cell label="Link clicks" value={w.linkClicks} format={(n) => Math.round(n).toLocaleString('en-PK')} />
            <Cell
              label="Per click · CPC"
              value={w.cpc}
              format={(n) => (n ? adMoney(n, cur) : '—')}
              colour={onDark(tone(w.cpc, b?.cpc))}
              hint={b ? `normal ${adMoney(b.cpc.low, cur)}–${adMoney(b.cpc.high, cur)}` : undefined}
            />
            <Cell
              label="Click rate · CTR"
              value={w.ctr}
              format={(n) => (w.impressions ? `${n.toFixed(2)}%` : '—')}
              colour={onDark(tone(w.ctr, b?.ctr, true))}
            />
            <Cell
              label="Return · ROAS"
              value={roas ?? 0}
              format={(n) => (roas == null ? '—' : `${n.toFixed(2)}×`)}
              colour={roas == null ? '#fff' : roas >= 1 ? '#86efac' : '#fca5a5'}
              hint={house ? 'commission ÷ spend' : 'worth ÷ spend'}
            />
          </div>

          {acc.daily.length >= 2 ? (
            <div className="fx-chart">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 800 }} className="fx-muted">
                <span>Spend per day</span>
                <span>
                  {adMoney(Math.max(...acc.daily.map((d) => d.spend)), cur)} best day
                </span>
              </div>
              <AreaSpark values={acc.daily.map((d) => d.spend)} color="#ccff00" height={84} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }} className="fx-muted">
                <span>{acc.daily[0].date.slice(5)}</span>
                <span>{acc.daily[acc.daily.length - 1].date.slice(5)}</span>
              </div>
            </div>
          ) : null}
        </>
      )}

      {connected && shown.length ? (
        <div style={{ marginTop: 2 }}>
          {shown.map((c) => {
            const grade = c.verdict ? GRADE_META[c.verdict.grade] : null;
            const running = campaignRank(c, nowMs) === 0;
            const span = c.endMs && c.createdAtMs ? c.endMs - c.createdAtMs : 0;
            const done = span ? Math.min(1, Math.max(0, (nowMs - c.createdAtMs!) / span)) : 0;
            const m = c.week && c.week.impressions ? c.week : c.lifetime;
            return (
              <div key={c.id} className="fx-camp">
                <span className={running ? 'fx-live lime' : 'fx-live off'} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</strong>
                    {grade && c.verdict?.grade !== 'idle' ? (
                      <span className="fx-pill" style={{ background: `${onDark(grade.colour)}22`, color: onDark(grade.colour) }}>
                        {grade.label}
                      </span>
                    ) : c.approval === 'pending' && c.status !== 'ACTIVE' ? (
                      <span className="fx-pill" style={{ background: '#fcd34d22', color: '#fcd34d' }}>
                        Waiting for Approve
                      </span>
                    ) : null}
                  </span>
                  {span ? (
                    <span className="fx-bar" style={{ display: 'block', height: 5, marginTop: 7 }} title={`${Math.round(done * 100)}% of its days`}>
                      <i style={{ width: `${done * 100}%`, background: 'linear-gradient(90deg,#19c37d,#ccff00)' }} />
                    </span>
                  ) : null}
                </span>
                <span style={{ textAlign: 'right', fontSize: 12 }}>
                  <strong style={{ display: 'block', fontSize: 13 }}>{c.dailyBudget ? `${adMoney(c.dailyBudget, cur)}/day` : '—'}</strong>
                  <span className="fx-muted">{m?.results ? `${m.results.toLocaleString('en-PK')} results` : c.status.toLowerCase()}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {connected && ads?.review?.summary ? (
        <div className="fx-note">
          <span aria-hidden style={{ fontSize: 18 }}>
            💡
          </span>
          <span className="fx-clip3">{ads.review.summary}</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <Link href="/dashboard/social/ads#design" className="fx-btn lime small">
          ✨ Design a campaign
        </Link>
        <Link href="/dashboard/social/ads" className="fx-btn ghost small">
          All campaigns →
        </Link>
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  format,
  hint,
  colour = '#fff',
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  hint?: string;
  colour?: string;
}) {
  return (
    <div className="fx-stat">
      <div className="k">{label}</div>
      <div className="v" style={{ color: colour }}>
        <CountUp value={value} format={format} />
      </div>
      {hint ? <div className="h">{hint}</div> : null}
    </div>
  );
}

// ── how the sales agents are doing ──────────────────────────────────────────

export function SalesSection({
  sales,
  leads,
  nowMs,
  i,
}: {
  sales: SalesSettingsDoc | null;
  leads: SalesLeadDoc[];
  nowMs: number;
  i: number;
}) {
  const setUp = Boolean(sales?.product && sales?.senderCompany);
  const found = leads.length;
  const steps = [
    { label: 'Businesses found', n: found, colour: 'linear-gradient(90deg,#60a5fa,#93c5fd)' },
    { label: 'Emails written', n: leads.filter((l) => l.draft).length, colour: 'linear-gradient(90deg,#34d399,#86efac)' },
    { label: 'Sent', n: leads.filter((l) => l.sentAtMs).length, colour: 'linear-gradient(90deg,#19c37d,#4ade80)' },
    {
      label: 'Replied',
      n: leads.filter((l) => l.reply || l.status === 'replied' || l.status === 'won').length,
      colour: 'linear-gradient(90deg,#f59e0b,#fcd34d)',
    },
    { label: 'Won', n: leads.filter((l) => l.status === 'won').length, colour: 'linear-gradient(90deg,#84cc16,#ccff00)' },
  ];
  const agents = sales?.callAgents ?? [];
  const weekAgo = nowMs - 7 * DAY_MS;
  const calls = leads.flatMap((l) => l.calls ?? []).filter((c) => c.atMs > weekAgo);
  const interested = calls.filter((c) => c.outcome === 'interested').length;
  const today = nowMs ? pktDay(nowMs) : '';
  const mailbox = sales?.mode === 'mailbox' && Boolean(sales.smtp);
  const sentToday = sales && sales.sentDay === today ? sales.sentCount : 0;

  return (
    <section className="fx-card fx-rise" style={vars(i)} aria-labelledby="sales-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: '#e6eefc' }} aria-hidden>
          🤝
        </span>
        <div>
          <h2 id="sales-h" className="fx-h2">
            Sales agents
          </h2>
          <p className="fx-sub">How they are doing</p>
        </div>
        <Link href="/dashboard/social/sales" className="fx-link">
          Open →
        </Link>
      </div>

      {!setUp ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="fx-radar light" aria-hidden>
            <span />
            <span />
            <span />
            <b>🤝</b>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong style={{ fontSize: 15 }}>Your sales team, on autopilot</strong>
            <p className="fx-muted" style={{ fontSize: 13, lineHeight: 1.55, margin: '4px 0 12px' }}>
              Say what you sell and who buys it. The agent finds businesses, writes to each one, follows up — and its calling
              agents write what to say on the phone.
            </p>
            <Link href="/dashboard/social/sales" className="fx-btn small">
              Set up the sales agent
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="fx-funnel">
            {steps.map((s, k) => (
              <div key={s.label} className="fx-funnel-row">
                <span className="fx-muted">{s.label}</span>
                <span className="fx-bar">
                  <i style={{ width: `${found ? Math.max(s.n ? 4 : 0, (s.n / found) * 100) : 0}%`, background: s.colour, ...vars(k) }} />
                </span>
                <span className="n">
                  <CountUp value={s.n} />
                </span>
              </div>
            ))}
          </div>

          {mailbox ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <Ring value={sales!.dailyCap ? sentToday / sales!.dailyCap : 0} size={52} stroke={6} color="#19c37d">
                <span style={{ fontSize: 12, fontWeight: 900 }}>{sentToday}</span>
              </Ring>
              <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong>
                  {sentToday} of {sales!.dailyCap} emails today
                </strong>
                <span className="fx-muted" style={{ display: 'block' }}>
                  From {sales!.smtp!.from}
                  {sales!.followUps ? ' · follows up twice' : ''}
                </span>
              </span>
            </div>
          ) : null}

          <Link href="/dashboard/social/sales#calling" className="fx-agents" style={{ color: 'inherit' }}>
            <span style={{ display: 'flex' }} aria-hidden>
              {agents.length ? (
                agents.slice(0, 4).map((a) => (
                  <span key={a.id} className="fx-avatar" style={{ background: a.voice === 'female' ? '#fce7f3' : '#dbeafe' }}>
                    {a.voice === 'female' ? '👩🏻‍💼' : '👨🏻‍💼'}
                  </span>
                ))
              ) : (
                <span className="fx-avatar" style={{ background: '#fff' }}>
                  📞
                </span>
              )}
            </span>
            <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, minWidth: 0 }}>
              <strong style={{ display: 'block' }}>
                {agents.length ? `${agents.length} calling agent${agents.length === 1 ? '' : 's'}` : 'Calling agents'}
              </strong>
              <span className="fx-muted">
                {agents.length
                  ? `${calls.length} call${calls.length === 1 ? '' : 's'} this week · ${interested} interested`
                  : 'Set one up: it writes the call for every business'}
              </span>
            </span>
            <span style={{ fontWeight: 900, color: colors.secondary }}>→</span>
          </Link>
          {sales?.lastStatus ? (
            <p className="fx-muted fx-clip2" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
              Last run: {sales.lastStatus}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ── travelling this week (the content page) ─────────────────────────────────

/** A YouTube link is the one kind of address the team can watch for "make one like this". */
export const isYouTube = (url: string) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url);

/**
 * Real posts the morning search found travelling this week, and why. A YouTube
 * one opens the overview's box filled in as "make one like this".
 */
export function ViralFinds({ research }: { research: SocialResearch | null }) {
  const finds = research?.viral ?? [];
  return (
    <section className="fx-card">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: '#fde8ea' }} aria-hidden>
          🔥
        </span>
        <div>
          <h2 className="fx-h2">Viral this week</h2>
          <p className="fx-sub">Found by the research agent this morning — ideas for the next piece.</p>
        </div>
      </div>
      {finds.length === 0 ? (
        <p className="fx-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          {research?.error ? `No list today: ${research.error}` : 'The research agent lists what is travelling after its next morning search.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {finds.map((f) => (
            <div key={f.url} className="fx-card fx-lift" style={{ padding: 12, display: 'grid', gap: 6, borderRadius: 14 }}>
              <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 800 }}>
                {f.title} ↗
              </a>
              {f.why ? (
                <span className="fx-muted fx-clip3" style={{ fontSize: 12, lineHeight: 1.45 }}>
                  {f.why}
                </span>
              ) : null}
              {isYouTube(f.url) ? (
                <Link
                  href={`/dashboard/social?like=${encodeURIComponent(f.url)}&title=${encodeURIComponent(f.title)}#make`}
                  className="fx-btn ghost small"
                  style={{ justifySelf: 'start' }}
                >
                  🎬 Make one like this
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
