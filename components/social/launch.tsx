'use client';

/**
 * The launch sequence, as five boxes in a row: market analysis → content
 * setup → execute → sales funnel → lead close. Each box is lit from
 * `socialLaunch/state`, which the backend moves along on its own
 * (backend/functions/src/social/launch.ts); nothing here decides a status.
 *
 * The first box is the one the owner works in: tap it, type what you know,
 * add links, press Analyse — the team reads it all, searches the market and
 * runs the audience test. It starts by itself the first time a workspace
 * lands here, so the owner sees it working before they have touched anything.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  LAUNCH_STEPS,
  socialApi,
  type FunnelPlanDoc,
  type LaunchStateDoc,
  type LaunchStepId,
  type LaunchStepStatus,
  type MarketAnalysisDoc,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';

const STEP_META: Record<LaunchStepId, { n: number; icon: string; title: string; blurb: string }> = {
  market: { n: 1, icon: '🔎', title: 'Market analysis', blurb: 'Your notes and links, a live market search and an audience test.' },
  content: { n: 2, icon: '🗓️', title: 'Content setup', blurb: 'A month planned from the analysis, made 30 days ahead.' },
  execute: { n: 3, icon: '🚀', title: 'Execute', blurb: 'Posts go out every day at your time.' },
  funnel: { n: 4, icon: '🎯', title: 'Sales funnel', blurb: 'The offer, and the Meta Ad Expert’s first campaign.' },
  close: { n: 5, icon: '🤝', title: 'Lead close', blurb: 'Emails, two follow-ups, and an answer to every reply.' },
};

const STATUS_META: Record<LaunchStepStatus, { label: string; colour: string }> = {
  waiting: { label: 'Waiting', colour: colors.muted },
  working: { label: 'Working', colour: colors.secondary },
  done: { label: 'Done', colour: colors.success },
  needs_you: { label: 'Needs you', colour: colors.warn },
  failed: { label: 'Will retry', colour: colors.danger },
  skipped: { label: 'Not in your plan', colour: colors.muted },
};

const VERDICT: Record<NonNullable<MarketAnalysisDoc['test']>['verdict'], { label: string; colour: string }> = {
  go: { label: 'Worth launching — the panel would buy', colour: colors.success },
  adjust: { label: 'Interested — with changes', colour: colors.warn },
  not_yet: { label: 'Not convinced yet', colour: colors.danger },
};

/** A Pakistan hour as the owner's own clock reads it, so the posting time is shown and chosen in their time. */
export function localHourLabel(pktHour: number): string {
  const d = new Date(Date.UTC(2026, 0, 15, pktHour - 5, 0));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function LaunchSequence({ settings }: { settings: SocialSettings | null }) {
  const { path } = useWorkspace();
  const [state, setState] = useState<LaunchStateDoc | null | undefined>(undefined);
  const [market, setMarket] = useState<MarketAnalysisDoc | null>(null);
  const [funnel, setFunnel] = useState<FunnelPlanDoc | null>(null);
  const [open, setOpen] = useState<LaunchStepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('socialLaunch/state')),
        (snap) => setState(snap.exists() ? (snap.data() as LaunchStateDoc) : null),
        () => setState(null),
      ),
    [path],
  );
  useEffect(
    () =>
      onSnapshot(
        doc(db, path('socialLaunch/market')),
        (snap) => setMarket(snap.exists() ? (snap.data() as MarketAnalysisDoc) : null),
        () => setMarket(null),
      ),
    [path],
  );
  useEffect(
    () =>
      onSnapshot(
        doc(db, path('socialLaunch/funnel')),
        (snap) => setFunnel(snap.exists() ? (snap.data() as FunnelPlanDoc) : null),
        () => setFunnel(null),
      ),
    [path],
  );

  // The first visit starts the market read: "as soon as the account is in, the first box is working".
  useEffect(() => {
    if (started.current || state === undefined) return;
    if (state !== null && state.steps.market.status !== 'waiting') return;
    started.current = true;
    socialApi.launchMarket({}).catch((e) => {
      // Already running in another tab, or the sweep got there first: the box shows it either way.
      if (!/already/i.test(e instanceof Error ? e.message : '')) setError(e instanceof Error ? e.message : 'Could not start.');
    });
  }, [state]);

  // The market box opens on its own until the analysis exists, so the owner sees where to type.
  const shown = open ?? (state && state.steps.market.status !== 'done' ? 'market' : null);
  const steps = state?.steps;

  return (
    <Card style={{ marginBottom: 18, padding: 18 }}>
      <style>{LAUNCH_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>Your launch</h2>
        <span style={{ fontSize: 12.5, color: colors.muted }}>
          Five steps your AI team runs in order, on its own. Tap a box to see it — or to tell it what you know.
        </span>
      </div>
      {error ? <p style={{ color: colors.danger, fontSize: 13, margin: '8px 0 0' }}>{error}</p> : null}

      <ol className="ln-row">
        {LAUNCH_STEPS.map((id) => {
          const meta = STEP_META[id];
          const step = steps?.[id] ?? { status: 'waiting' as const, note: null, atMs: null };
          const status = STATUS_META[step.status];
          const active = shown === id;
          return (
            <li key={id} className={`ln-step ln-${step.status}`}>
              <button
                type="button"
                className={`ln-box${active ? ' ln-open' : ''}`}
                aria-expanded={active}
                aria-controls="launch-panel"
                onClick={() => setOpen(active ? null : id)}
                style={{ ['--tone' as string]: status.colour }}
              >
                <span className="ln-head">
                  <span className="ln-num" aria-hidden>
                    {step.status === 'done' ? '✓' : meta.n}
                  </span>
                  <span className="ln-icon" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="ln-pill">
                    {step.status === 'working' ? <span className="ln-dot" aria-hidden /> : null}
                    {status.label}
                  </span>
                </span>
                <strong className="ln-title">{meta.title}</strong>
                <span className="ln-note">{step.note ?? meta.blurb}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {shown ? (
        <div id="launch-panel" className="ln-panel">
          {shown === 'market' ? (
            <MarketPanel state={state ?? null} market={market} onError={setError} />
          ) : shown === 'content' ? (
            <ContentPanel settings={settings} />
          ) : shown === 'execute' ? (
            <ExecutePanel settings={settings} onError={setError} />
          ) : shown === 'funnel' ? (
            <FunnelPanel funnel={funnel} />
          ) : (
            <ClosePanel note={steps?.close.note ?? null} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ── 1. market analysis ──────────────────────────────────────────────────────

function MarketPanel({
  state,
  market,
  onError,
}: {
  state: LaunchStateDoc | null;
  market: MarketAnalysisDoc | null;
  onError: (m: string | null) => void;
}) {
  const [knowledge, setKnowledge] = useState<string | null>(null);
  const [links, setLinks] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const typed = knowledge ?? state?.knowledge ?? '';
  const list = links ?? (state?.links.length ? state.links : ['']);
  const working = state?.steps.market.status === 'working';

  async function analyse() {
    setBusy(true);
    onError(null);
    try {
      await socialApi.launchMarket({ knowledge: typed, links: list.map((l) => l.trim()).filter(Boolean) });
      setKnowledge(null);
      setLinks(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'The team could not read the market.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="ln-form">
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="ln-label">What you know — your customers, prices, what sells, what doesn&apos;t</span>
          <textarea
            value={typed}
            onChange={(e) => setKnowledge(e.target.value)}
            rows={5}
            maxLength={6000}
            placeholder="e.g. Most orders come from offices in Gulberg before 9am. Our best seller is the Rs 1,200 breakfast box. People complain about delivery time on weekends."
            className="ln-input"
          />
        </label>
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="ln-label">Links for the team to read — your site, your Instagram, a competitor, an article</span>
          {list.map((link, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                value={link}
                onChange={(e) => setLinks(list.map((l, j) => (j === i ? e.target.value : l)))}
                placeholder="https://"
                aria-label={`Link ${i + 1}`}
                className="ln-input"
                style={{ flex: 1 }}
              />
              {list.length > 1 ? (
                <button type="button" className="ln-x" aria-label="Remove this link" onClick={() => setLinks(list.filter((_, j) => j !== i))}>
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {list.length < 6 ? (
            <button type="button" className="ln-add" onClick={() => setLinks([...list, ''])}>
              + Add a link
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={analyse} disabled={busy || working}>
            {busy || working ? 'The team is reading…' : market ? 'Analyse again with this' : 'Analyse my market'}
          </Button>
          <span style={{ fontSize: 12, color: colors.muted }}>
            {busy || working ? 'A minute or two. You can leave this page — it carries on.' : 'Pages behind a login (like Instagram) may not open for the team.'}
          </span>
        </div>
      </div>

      {market ? <MarketResult market={market} /> : null}
    </div>
  );
}

function MarketResult({ market: m }: { market: MarketAnalysisDoc }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div className="ln-label">
          The read · {new Date(m.atMs).toLocaleString()} {m.grounded ? '· searched live' : '· not searched live today'}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 14.5, lineHeight: 1.6, fontWeight: 600 }}>{m.summary}</p>
        {m.positioning ? (
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: colors.primary, fontWeight: 800 }}>★ {m.positioning}</p>
        ) : null}
      </div>

      <div className="ln-grid">
        <Facts title="Who buys" items={m.segments.map((s) => `${s.who} — ${s.wants}`)} />
        <Facts
          title="Who they choose instead"
          items={m.competitors.map((c) => `${c.name}${c.knownFor ? ` — ${c.knownFor}` : ''}`)}
          links={m.competitors.map((c) => c.url)}
        />
        <Facts title="Opportunities" items={m.opportunities} />
        <Facts title="Offers that should pull" items={m.offers} />
        <Facts title="What could stop them" items={m.risks} />
        <Facts title="Where they spend time" items={m.channels} />
      </div>

      {m.fromLinks.length ? (
        <Facts title="From the links you gave" items={m.fromLinks.map((l) => `${l.url.replace(/^https?:\/\//, '')} — ${l.takeaway}`)} />
      ) : null}

      {m.test ? <AudienceTest test={m.test} /> : <p className="ln-muted">The audience test did not run this time. Analyse again to try it.</p>}

      {m.sources.length ? (
        <details>
          <summary className="ln-muted" style={{ cursor: 'pointer' }}>
            {m.sources.length} pages the search read
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {m.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: colors.secondary }}>
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The panel's verdict, its doubts and every simulated person — labelled as a simulation. */
function AudienceTest({ test }: { test: NonNullable<MarketAnalysisDoc['test']> }) {
  const v = VERDICT[test.verdict];
  return (
    <div className="ln-test">
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="ln-meter" style={{ ['--pct' as string]: `${Math.round(test.score * 100)}%`, ['--tone' as string]: v.colour }}>
          <span>{Math.round(test.score * 100)}%</span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="ln-label">Pre-launch audience test · a simulated panel, not real people</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: v.colour }}>{v.label}</div>
          <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>
            Shown: “{test.offer}”{test.bestHook ? ` · best hook: “${test.bestHook}”` : ''}
          </div>
        </div>
      </div>
      {test.objections.length || test.changes.length ? (
        <div className="ln-grid" style={{ marginTop: 12 }}>
          {test.objections.length ? <Facts title="What stood in the way" items={test.objections} /> : null}
          {test.changes.length ? <Facts title="Change before launch" items={test.changes} /> : null}
        </div>
      ) : null}
      <div className="ln-panel-grid">
        {test.panel.map((p, i) => (
          <div key={i} className="ln-person">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ln-avatar" aria-hidden>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
                <div className="ln-muted" style={{ fontSize: 11.5 }}>
                  {p.who}
                </div>
              </div>
              <span className={`ln-buy ln-buy-${p.wouldBuy}`}>{p.wouldBuy === 'yes' ? 'Would buy' : p.wouldBuy === 'maybe' ? 'Maybe' : 'No'}</span>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.5 }}>“{p.reaction}”</p>
            {p.objection ? <p className="ln-muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>In the way: {p.objection}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Facts({ title, items, links }: { title: string; items: string[]; links?: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="ln-label">{title}</div>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 3, fontSize: 13, lineHeight: 1.5 }}>
        {items.map((it, i) => (
          <li key={i}>
            {links?.[i] ? (
              <a href={links[i]} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                {it} ↗
              </a>
            ) : (
              it
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 2–5 ─────────────────────────────────────────────────────────────────────

function ContentPanel({ settings }: { settings: SocialSettings | null }) {
  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13.5, lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>
        The team planned the month from your market analysis — a goal, the kinds of story it will tell, a theme per week
        and a piece for every day — and{' '}
        {settings?.makeAheadDays
          ? `keeps the next ${settings.makeAheadDays} days made ahead, one piece an hour, once the desk is on.`
          : 'makes each day on the day.'}
      </p>
      <p style={{ margin: 0 }}>
        Open the calendar to read any day, change what a planned day is about, or send a finished piece back with your
        changes.
      </p>
      <Link href="/dashboard/social/calendar" className="ln-cta">
        Open the content calendar →
      </Link>
    </div>
  );
}

function ExecutePanel({ settings, onError }: { settings: SocialSettings | null; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  if (!settings) return null;

  async function save(patch: Partial<SocialSettings>) {
    setBusy(true);
    onError(null);
    try {
      await socialApi.updateSettings(patch);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14, fontSize: 13.5 }}>
      <PostingTime settings={settings} disabled={busy} onPick={(runHour) => save({ runHour })} />
      <div style={{ display: 'grid', gap: 6 }}>
        <span className="ln-label">Before anything goes out</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant={settings.publishModeChosen && !settings.autoPublish ? 'primary' : 'ghost'}
            onClick={() => save({ autoPublish: false, publishModeChosen: true })}
            disabled={busy}
          >
            Ask me before posting
          </Button>
          <Button
            variant={settings.publishModeChosen && settings.autoPublish ? 'primary' : 'ghost'}
            onClick={() => save({ autoPublish: true, publishModeChosen: true })}
            disabled={busy}
          >
            Post directly
          </Button>
        </div>
      </div>
      <Link href="/dashboard/social/accounts" className="ln-cta">
        Connect Instagram or Facebook →
      </Link>
    </div>
  );
}

/** The desk's hour, chosen in the owner's own time zone. */
export function PostingTime({
  settings,
  disabled,
  onPick,
}: {
  settings: SocialSettings;
  disabled?: boolean;
  onPick: (pktHour: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13.5 }}>
      <span className="ln-label" style={{ margin: 0 }}>
        Post every day at
      </span>
      <select
        value={settings.runHour}
        disabled={disabled}
        onChange={(e) => onPick(Number(e.target.value))}
        className="ln-input"
        style={{ width: 'auto' }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {localHourLabel(h)}
          </option>
        ))}
      </select>
      <span className="ln-muted">your time</span>
    </label>
  );
}

function FunnelPanel({ funnel }: { funnel: FunnelPlanDoc | null }) {
  if (!funnel) {
    return <p className="ln-muted" style={{ margin: 0 }}>The team designs the funnel right after the content is set up.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div className="ln-label">The offer</div>
        <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 900 }}>{funnel.offer}</p>
        <p className="ln-muted" style={{ margin: '2px 0 0' }}>
          {funnel.cta ? `Ask: ${funnel.cta}` : ''}
          {funnel.landing ? ` · They land on ${funnel.landing}` : ''}
        </p>
      </div>
      {funnel.stages.length ? (
        <ol className="ln-funnel">
          {funnel.stages.map((s, i) => (
            <li key={s.stage} style={{ ['--w' as string]: `${100 - i * 12}%` }}>
              <strong>{s.stage}</strong>
              <span>{s.how}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="ln-grid">
        <Facts title="The Meta Ad Expert's first campaign" items={[funnel.adBrief]} />
        {funnel.salesKinds.length ? (
          <Facts
            title="Who the sales agent writes to"
            items={[`${funnel.salesKinds.join(', ')}${funnel.salesCity ? ` in ${funnel.salesCity}` : ''}`]}
          />
        ) : null}
      </div>
      <Link href="/dashboard/social/ads" className="ln-cta">
        {funnel.campaignId ? 'See the campaign on the Ads page →' : 'Connect the ad account on the Ads page →'}
      </Link>
    </div>
  );
}

function ClosePanel({ note }: { note: string | null }) {
  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13.5, lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>
        The sales agent writes one short email to each business it finds, follows up twice in the same thread if nobody
        answers, and reads your inbox: anyone who replies gets an answer drafted for you to send in one tap. A “no” closes
        the lead for good.
      </p>
      {note ? <p className="ln-muted" style={{ margin: 0 }}>{note}</p> : null}
      <Link href="/dashboard/social/sales" className="ln-cta">
        Open the sales agent →
      </Link>
    </div>
  );
}

const LAUNCH_CSS = `
.ln-row { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; counter-reset: ln; }
@media (max-width: 1100px) { .ln-row { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); } }
.ln-step { position: relative; min-width: 0; }
.ln-step:not(:last-child)::after { content: ''; position: absolute; top: 26px; right: -10px; width: 10px; height: 2px; background: ${colors.border}; }
.ln-step.ln-done:not(:last-child)::after { background: ${colors.success}; }
.ln-box { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 6px; width: 100%; height: 100%; padding: 12px;
  border-radius: 14px; border: 1px solid ${colors.border}; background: ${colors.surface}; border-top: 3px solid var(--tone);
  transition: box-shadow .18s ease, transform .18s ease; }
.ln-box:hover { box-shadow: 0 10px 24px rgba(0, 57, 36, .10); transform: translateY(-2px); }
.ln-box:focus-visible { outline: 2px solid ${colors.secondary}; outline-offset: 2px; }
.ln-open { box-shadow: 0 0 0 2px ${colors.primary}33; }
.ln-head { display: flex; align-items: center; gap: 6px; }
.ln-num { width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center; font-size: 11.5px; font-weight: 900;
  color: #fff; background: var(--tone); flex: none; }
.ln-icon { font-size: 16px; }
.ln-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 900; text-transform: uppercase;
  letter-spacing: .3px; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
.ln-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--tone); animation: ln-pulse 1.1s ease-in-out infinite; }
@keyframes ln-pulse { 0%, 100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
.ln-working .ln-box { background-image: linear-gradient(110deg, transparent 30%, ${colors.secondary}0f 50%, transparent 70%);
  background-size: 220% 100%; animation: ln-sheen 1.8s linear infinite; }
@keyframes ln-sheen { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.ln-title { font-size: 14px; font-weight: 900; color: ${colors.text}; }
.ln-note { font-size: 12px; line-height: 1.45; color: ${colors.muted}; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.ln-panel { margin-top: 14px; padding: 16px; border-radius: 14px; background: ${colors.bg}; border: 1px solid ${colors.border}; }
.ln-form { display: grid; gap: 12px; }
.ln-label { display: block; font-size: 11px; font-weight: 900; color: ${colors.muted}; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px; }
.ln-input { width: 100%; box-sizing: border-box; padding: 9px 11px; font: inherit; font-size: 13.5px; border: 1px solid ${colors.border};
  border-radius: 10px; background: ${colors.surface}; color: ${colors.text}; }
.ln-x, .ln-add { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 800; color: ${colors.secondary}; padding: 6px 8px; border-radius: 8px; }
.ln-x:focus-visible, .ln-add:focus-visible { outline: 2px solid ${colors.secondary}; }
.ln-muted { font-size: 12.5px; color: ${colors.muted}; }
.ln-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.ln-cta { font-size: 13px; font-weight: 800; color: ${colors.secondary}; }
.ln-test { border-radius: 14px; background: ${colors.surface}; border: 1px solid ${colors.border}; padding: 14px; }
.ln-meter { --size: 64px; width: var(--size); height: var(--size); border-radius: 999px; flex: none; display: grid; place-items: center;
  background: conic-gradient(var(--tone) var(--pct), ${colors.border} 0); }
.ln-meter span { width: 48px; height: 48px; border-radius: 999px; background: ${colors.surface}; display: grid; place-items: center;
  font-size: 13px; font-weight: 900; }
.ln-panel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin-top: 12px; }
.ln-person { border: 1px solid ${colors.border}; border-radius: 12px; padding: 10px; background: ${colors.bg}; min-width: 0; }
.ln-avatar { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; font-weight: 900; font-size: 13px;
  background: ${colors.primary}1a; color: ${colors.primary}; flex: none; }
.ln-buy { font-size: 10.5px; font-weight: 900; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
.ln-buy-yes { color: ${colors.success}; background: ${colors.success}1a; }
.ln-buy-maybe { color: ${colors.warn}; background: ${colors.warn}1a; }
.ln-buy-no { color: ${colors.muted}; background: ${colors.border}; }
.ln-funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ln-funnel li { width: var(--w); min-width: min(260px, 100%); display: grid; gap: 2px; padding: 9px 12px; border-radius: 10px;
  background: linear-gradient(90deg, ${colors.primary}, ${colors.secondary}); color: #fff; font-size: 12.5px; line-height: 1.45; }
.ln-funnel li strong { font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
@media (prefers-reduced-motion: reduce) {
  .ln-dot, .ln-working .ln-box { animation: none; }
  .ln-box, .ln-box:hover { transition: none; transform: none; }
}
`;
