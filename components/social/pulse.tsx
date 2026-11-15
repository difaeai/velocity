'use client';

/**
 * The Pulse — the whole of Vexa in one circle, at the top of the console.
 *
 * Owner, 2026-11-15: before anything else on the page, say what is working and
 * what is not. Content is being made, ads are not running, the sales agent is
 * talking to someone, the voice agents are idle — all of it, in one glance,
 * without reading a single card.
 *
 * So: the brain in the middle, its six departments on a ring around it, and
 * each one in one of three states that are never guessed at —
 *
 *   working — something is happening *right now*, and the node says what
 *   ready   — connected and switched on, but idle this minute
 *   off     — not set up, switched off, or not in the plan
 *
 * A node only says "working" on evidence with a timestamp on it (an employee
 * mid-job, a campaign Meta itself calls active, a message sent in the last half
 * hour). Anything softer than that is "ready", because a dial that says busy
 * when nothing is happening is worse than no dial — it is the one thing on this
 * page somebody will believe without checking.
 *
 * Drawn as one SVG with CSS on top: a comet runs the spoke of every working
 * department, the ring sweeps, idle nodes sit still. Everything stops under
 * `prefers-reduced-motion`, leaving a legible static dial.
 */

import { useMemo } from 'react';
import Link from 'next/link';

import type {
  AdCampaignDoc,
  AdsConfigDoc,
  SalesChatDoc,
  SalesLeadDoc,
  SalesSettingsDoc,
  SocialPageRead,
  SocialSettings,
} from '@/lib/api';
import type { DeskRead } from './dashboard';
import { BrainArt } from './brainArt';

/** How recent a thing has to be to count as happening now. */
const LIVE_MS = 30 * 60_000;
const HOUR_MS = 3600_000;

export type PulseState = 'working' | 'ready' | 'off';

export interface PulseNode {
  key: string;
  label: string;
  icon: string;
  state: PulseState;
  /** One short line: what it is doing, or why it is not. */
  says: string;
  href: string;
}

const pktDay = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

/**
 * What every department is doing. Pure, so the drawing below only draws — and
 * so the one piece of judgement on this page (what counts as "working") sits in
 * one readable place.
 */
export function readPulse(p: {
  desk: DeskRead;
  settings: SocialSettings | null;
  ads: AdsConfigDoc | null;
  campaigns: AdCampaignDoc[];
  sales: SalesSettingsDoc | null;
  chats: SalesChatDoc[];
  /** The email/calling agent's businesses: where a call is recorded. */
  leads: SalesLeadDoc[];
  pageRead: SocialPageRead | null;
  nowMs: number;
  /** Whether the plan includes this part at all. */
  has: (need: 'content' | 'ads' | 'sales' | 'research') => boolean;
}): PulseNode[] {
  const { desk, settings, ads, campaigns, sales, chats, leads, pageRead, nowMs, has } = p;
  const since = nowMs - LIVE_MS;

  // Content: somebody on the team is mid-job right now.
  const busy = [...desk.doing.values()].filter((d) => d.now).length;
  const content: PulseNode = !has('content')
    ? { key: 'content', label: 'Content', icon: '🎬', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : busy
      ? {
          key: 'content',
          label: 'Content',
          icon: '🎬',
          state: 'working',
          says: `${busy} ${busy === 1 ? 'person is' : 'people are'} making something`,
          href: '/dashboard/social/queue',
        }
      : settings?.enabled
        ? {
            key: 'content',
            label: 'Content',
            icon: '🎬',
            state: 'ready',
            says: desk.waiting.length ? `${desk.waiting.length} waiting for your Approve` : 'On — next run at 10:00',
            href: '/dashboard/social/queue',
          }
        : { key: 'content', label: 'Content', icon: '🎬', state: 'off', says: 'The daily run is paused', href: '/dashboard/social/queue' };

  // Ads: Meta's own word for it, not ours.
  const live = campaigns.filter((c) => /ACTIVE/i.test(c.effectiveStatus ?? c.status ?? ''));
  const adsNode: PulseNode = !has('ads')
    ? { key: 'ads', label: 'Ads', icon: '📣', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : live.length
      ? {
          key: 'ads',
          label: 'Ads',
          icon: '📣',
          state: 'working',
          says: `${live.length} campaign${live.length === 1 ? '' : 's'} running`,
          href: '/dashboard/social/ads',
        }
      : ads?.adAccountId
        ? { key: 'ads', label: 'Ads', icon: '📣', state: 'ready', says: 'Connected, nothing running', href: '/dashboard/social/ads' }
        : { key: 'ads', label: 'Ads', icon: '📣', state: 'off', says: 'No ad account connected', href: '/dashboard/social/accounts' };

  // The WhatsApp closer: a conversation that moved in the last half hour.
  const talking = chats.filter((c) => !c.blocked && c.updatedAtMs > since).length;
  const open = chats.filter((c) => !c.blocked && !['won', 'lost', 'stopped'].includes(c.stage)).length;
  const salesNode: PulseNode = !has('sales')
    ? { key: 'sales', label: 'Sales agent', icon: '🟢', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : talking
      ? {
          key: 'sales',
          label: 'Sales agent',
          icon: '🟢',
          state: 'working',
          says: `Talking to ${talking} ${talking === 1 ? 'person' : 'people'} now`,
          href: '/dashboard/social/whatsapp',
        }
      : chats.length
        ? { key: 'sales', label: 'Sales agent', icon: '🟢', state: 'ready', says: open ? `${open} conversations open` : 'Waiting for someone to write in', href: '/dashboard/social/whatsapp' }
        : { key: 'sales', label: 'Sales agent', icon: '🟢', state: 'off', says: 'No WhatsApp number connected', href: '/dashboard/social/whatsapp' };

  // Voice: a call actually placed in the last half hour. A calling agent that
  // exists is ready, not working — it is the call that is the work.
  const agents = sales?.callAgents ?? [];
  const onCall = leads.reduce((n, l) => n + (l.calls ?? []).filter((c) => c.atMs > since).length, 0);
  const voice: PulseNode = !has('sales')
    ? { key: 'voice', label: 'Voice agents', icon: '📞', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : onCall
      ? {
          key: 'voice',
          label: 'Voice agents',
          icon: '📞',
          state: 'working',
          says: `${onCall} call${onCall === 1 ? '' : 's'} in the last half hour`,
          href: '/dashboard/social/sales#calling',
        }
      : agents.length
        ? { key: 'voice', label: 'Voice agents', icon: '📞', state: 'ready', says: `${agents.length} ready to call`, href: '/dashboard/social/sales#calling' }
        : { key: 'voice', label: 'Voice agents', icon: '📞', state: 'off', says: 'None set up yet', href: '/dashboard/social/sales#calling' };

  // Email: sent today, from this desk's own mailbox.
  const sentToday = sales && sales.sentDay === pktDay(nowMs) ? sales.sentCount : 0;
  const email: PulseNode = !has('sales')
    ? { key: 'email', label: 'Email agent', icon: '✉️', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : sentToday
      ? { key: 'email', label: 'Email agent', icon: '✉️', state: 'working', says: `${sentToday} written today`, href: '/dashboard/social/email' }
      : sales?.smtp
        ? { key: 'email', label: 'Email agent', icon: '✉️', state: 'ready', says: `Connected · ${sales.smtp.from}`, href: '/dashboard/social/email' }
        : { key: 'email', label: 'Email agent', icon: '✉️', state: 'off', says: 'No mailbox connected', href: '/dashboard/social/email' };

  // Research: it reads the page on a schedule, so its own timestamp is the test.
  const readAt = pageRead?.atMs ?? 0;
  const research: PulseNode = !has('research')
    ? { key: 'research', label: 'Research', icon: '🔬', state: 'off', says: 'Not in your plan', href: '/dashboard/social/upgrade' }
    : readAt > nowMs - HOUR_MS
      ? { key: 'research', label: 'Research', icon: '🔬', state: 'working', says: 'Reading your page now', href: '/dashboard/social/research' }
      : readAt
        ? {
            key: 'research',
            label: 'Research',
            icon: '🔬',
            state: 'ready',
            says: `Last read ${Math.max(1, Math.round((nowMs - readAt) / HOUR_MS))}h ago`,
            href: '/dashboard/social/research',
          }
        : { key: 'research', label: 'Research', icon: '🔬', state: 'off', says: 'Has not read your page yet', href: '/dashboard/social/research' };

  return [content, adsNode, salesNode, voice, email, research];
}

/** Where each node sits on the ring: twelve o'clock first, then clockwise. */
const spot = (i: number, n: number, r: number) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: 160 + Math.cos(a) * r, y: 160 + Math.sin(a) * r };
};

export function VexaPulse(props: Parameters<typeof readPulse>[0] & { name?: string | null }) {
  const nodes = useMemo(() => readPulse(props), [props]);
  const working = nodes.filter((n) => n.state === 'working');
  const off = nodes.filter((n) => n.state === 'off');

  // The headline is the thing somebody would say out loud about their business.
  const headline = working.length
    ? `${working.map((n) => n.label.toLowerCase()).join(', ')} — working now`
    : off.length === nodes.length
      ? 'Nothing is switched on yet'
      : 'Everything is on, and quiet';

  return (
    <section className="pl fx-rise" style={{ ['--i' as string]: 0 } as React.CSSProperties} aria-labelledby="pulse-h" data-tour="pulse">
      <style>{PULSE_CSS}</style>

      <div className="pl-dial">
        <svg viewBox="0 0 320 320" className="pl-svg" aria-hidden>
          {/* the ring the departments sit on, and the sweep that says it is alive */}
          <circle cx="160" cy="160" r="118" className="pl-track" />
          {working.length ? <circle cx="160" cy="160" r="118" className="pl-sweep" pathLength={100} /> : null}

          {nodes.map((n, i) => {
            const { x, y } = spot(i, nodes.length, 118);
            const from = spot(i, nodes.length, 72);
            const d = `M${from.x} ${from.y} L${x} ${y}`;
            return (
              <g key={n.key} className={`pl-g ${n.state}`}>
                <path d={d} className="pl-spoke" />
                {n.state === 'working' ? <path d={d} pathLength={100} className="pl-comet" style={{ ['--d' as string]: `${i * 0.45}s` }} /> : null}
                <circle cx={x} cy={y} r="19" className="pl-halo" style={{ ['--d' as string]: `${i * 0.3}s` }} />
                <circle cx={x} cy={y} r="15" className="pl-node" />
              </g>
            );
          })}
        </svg>

        {/* the brain itself, in the middle of its own departments */}
        <div className="pl-core">
          <BrainArt />
        </div>

        {/* Icons only on the ring. The names live in the list beside it: six
            labels orbiting a circle collide with each other at any size that
            still fits the page, and a clipped label is worse than none. */}
        {nodes.map((n, i) => {
          const { x, y } = spot(i, nodes.length, 118);
          return (
            <Link
              key={n.key}
              href={n.href}
              className={`pl-chip ${n.state}`}
              style={{ left: `${(x / 320) * 100}%`, top: `${(y / 320) * 100}%` }}
              aria-label={`${n.label}: ${n.says}`}
              data-tip={`${n.label} · ${n.says}`}
            >
              <span aria-hidden>{n.icon}</span>
            </Link>
          );
        })}
      </div>

      <div className="pl-read">
        <div className="fx-eyebrow">Vexa right now</div>
        <h2 id="pulse-h">
          {working.length ? (
            <>
              <span className="pl-n">{working.length}</span> of {nodes.length} working
            </>
          ) : (
            'Nothing running this minute'
          )}
        </h2>
        <p>{headline}.</p>

        <ul className="pl-list">
          {nodes.map((n) => (
            <li key={n.key} className={n.state}>
              <span className="pl-dot" aria-hidden />
              <strong>{n.label}</strong>
              <em>{n.says}</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export const PULSE_CSS = `
.pl { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: center; margin-bottom: 18px;
  position: relative; overflow: hidden; border-radius: 26px; padding: 22px 26px; color: #eaf5ee;
  background: radial-gradient(120% 140% at 0% 0%, #0f5a3c 0%, #06301f 48%, #04150e 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2); }

.pl-dial { position: relative; width: 300px; height: 300px; flex: none; }
.pl-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pl-track { fill: none; stroke: rgba(255,255,255,.1); stroke-width: 1.5; }
.pl-sweep { fill: none; stroke: #ccff00; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 18 82;
  transform-origin: 160px 160px; animation: pl-spin 9s linear infinite; opacity: .7; }
@keyframes pl-spin { to { transform: rotate(360deg); } }

.pl-spoke { fill: none; stroke: rgba(255,255,255,.12); stroke-width: 1.5; }
.pl-g.off .pl-spoke { stroke-dasharray: 3 5; stroke: rgba(255,255,255,.1); }
.pl-comet { fill: none; stroke: #ccff00; stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 16 84;
  animation: pl-run 2.2s cubic-bezier(.4,0,.5,1) infinite; animation-delay: var(--d, 0s); }
@keyframes pl-run { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }

.pl-node { stroke-width: 1.5; }
.pl-g.working .pl-node { fill: #ccff00; stroke: #ccff00; }
.pl-g.ready .pl-node { fill: #0b3524; stroke: #19c37d; }
.pl-g.off .pl-node { fill: #11261d; stroke: rgba(255,255,255,.18); }
.pl-halo { fill: none; stroke: #ccff00; stroke-width: 1.5; opacity: 0; }
.pl-g.working .pl-halo { animation: pl-ping 2.4s ease-out infinite; animation-delay: var(--d, 0s); }
@keyframes pl-ping { 0% { opacity: .55; transform: scale(.78); } 70%, 100% { opacity: 0; transform: scale(1.5); } }
.pl-halo { transform-origin: center; transform-box: fill-box; }

.pl-core { position: absolute; left: 50%; top: 50%; width: 132px; height: 116px; transform: translate(-50%, -50%); pointer-events: none; }
.pl-core .bn-art { width: 100%; height: 100%; }

/* each department sits on its own node; the name is in the list beside */
.pl-chip { position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 50%; font-size: 14px; line-height: 1; text-decoration: none;
  transition: transform .2s cubic-bezier(.3,1.5,.5,1); }
.pl-chip:hover { transform: translate(-50%, -50%) scale(1.18); }
.pl-chip.off { opacity: .45; filter: grayscale(1); }
.pl-chip::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 9px); left: 50%; transform: translate(-50%, 4px);
  padding: 6px 10px; border-radius: 9px; background: #04150e; border: 1px solid rgba(255,255,255,.14); color: #eaf5ee;
  font-size: 11.5px; font-weight: 700; white-space: nowrap; opacity: 0; pointer-events: none; z-index: 5;
  transition: opacity .18s ease, transform .2s cubic-bezier(.3,1.5,.5,1); }
.pl-chip:hover::after, .pl-chip:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }

.pl-read { min-width: 0; }
.pl-read h2 { margin: 6px 0 4px; font-size: 27px; font-weight: 900; letter-spacing: -.02em; line-height: 1.15; }
.pl-n { color: #ccff00; }
.pl-read > p { margin: 0 0 14px; font-size: 13.5px; color: #b9d6c6; line-height: 1.5; }
.pl-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; }
.pl-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; min-width: 0; }
.pl-list strong { font-weight: 800; flex: none; }
.pl-list em { font-style: normal; color: #8fb3a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pl-list li.off { opacity: .55; }
.pl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: rgba(255,255,255,.25); }
.pl-list li.working .pl-dot { background: #ccff00; box-shadow: 0 0 0 0 rgba(204,255,0,.5); animation: pl-dot 1.8s ease-out infinite; }
.pl-list li.ready .pl-dot { background: #19c37d; }
@keyframes pl-dot { 0% { box-shadow: 0 0 0 0 rgba(204,255,0,.55); } 80%, 100% { box-shadow: 0 0 0 7px rgba(204,255,0,0); } }

@media (max-width: 1020px) {
  .pl { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; }
  .pl-read { text-align: left; width: 100%; }
}
@media (max-width: 420px) {
  .pl-dial { width: 300px; height: 300px; }
  .pl-txt em { display: none; }
  .pl-list { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .pl *, .pl { animation: none !important; transition: none !important; } }
`;
