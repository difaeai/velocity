'use client';

/**
 * The sales funnel: the whole journey from "somebody saw a post" to "they paid".
 *
 * The desk could already do every part of this, and showed none of it joined
 * up. The ads page knew what the ads cost. The comments page knew somebody had
 * asked the price under a reel. The WhatsApp page knew about a conversation.
 * Nowhere did it say the thing the owner is actually paying to find out: *a
 * stranger saw us, asked, got answered, and bought* — or where that stopped.
 *
 * So this reads one story out of three collections:
 *
 *   1. **They saw it and asked.** `socialComments` with intent `lead` — someone
 *      asking the price or "how much" under a post or an ad. Vexa answers in
 *      public and gives them the WhatsApp number, which is the handover.
 *   2. **They came to WhatsApp.** `salesChats` with source `whatsapp`. Or Vexa
 *      went to them: an uploaded list, source `sheet`, which starts `queued`.
 *   3. **Vexa sold.** The stages — talking, knows what they want, price given,
 *      won — are what the closer writes after every message it sends.
 *
 * Two honesty rules, because a funnel that flatters is worse than none:
 *
 *  • **Nothing is inferred between the halves.** We do not know that *this*
 *    WhatsApp conversation came from *that* comment — nobody can know that
 *    without asking, and Vexa does not ask. The two halves are counted and
 *    shown next to each other, and the step between them says "they have to
 *    message you", which is the truth.
 *  • **An empty stage says it is empty and why.** A funnel drawn with zeroes
 *    and no explanation reads as broken software. Each step knows what is
 *    missing — no number connected, no list uploaded, nobody has asked yet.
 *
 * The conversation record underneath is not decoration either. The owner's real
 * question is never "what is my conversion rate", it is "what did you say to
 * this person" — and seeing a few real answers is what makes somebody trust an
 * agent with their customers.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import type { SalesChatDoc, SalesChatStage, SocialCommentDoc } from '@/lib/api';
import { CountUp } from './fx';

const DAY_MS = 86_400_000;
const pktDay = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

/** Stages that mean the conversation got at least this far, cumulatively. */
const REACHED: Record<string, SalesChatStage[]> = {
  talking: ['talking', 'qualified', 'pitched', 'won', 'lost', 'needs_you'],
  qualified: ['qualified', 'pitched', 'won'],
  pitched: ['pitched', 'won'],
  won: ['won'],
};

interface FunnelRead {
  /** Public questions under posts and ads: the top of the funnel. */
  asked: number;
  askedWeek: number;
  /** Conversations, by how they started. */
  bySource: { key: string; label: string; icon: string; n: number }[];
  steps: { key: string; label: string; does: string; icon: string; n: number; empty: string }[];
  /** Won today, and what they booked. */
  todayWon: SalesChatDoc[];
  weekWon: number;
  packages: { label: string; n: number }[];
  /** Needs a person right now. */
  needsYou: number;
  total: number;
}

/**
 * Everything the section shows, decided once. Pure, so it can be tested without
 * a browser and so the drawing below only draws.
 */
export function readFunnel(chats: SalesChatDoc[], comments: SocialCommentDoc[], nowMs: number): FunnelRead {
  const live = chats.filter((c) => !c.blocked);
  const at = (stage: keyof typeof REACHED) => live.filter((c) => REACHED[stage].includes(c.stage)).length;
  const today = nowMs ? pktDay(nowMs) : '';
  const weekAgo = nowMs - 7 * DAY_MS;

  const leads = comments.filter((c) => c.intent === 'lead');
  const sources: { key: SalesChatDoc['source']; label: string; icon: string }[] = [
    { key: 'whatsapp', label: 'Messaged you', icon: '🟢' },
    { key: 'comment', label: 'From a comment', icon: '💬' },
    { key: 'instagram', label: 'Instagram DM', icon: '📸' },
    { key: 'facebook', label: 'Facebook DM', icon: '👍' },
    { key: 'sheet', label: 'Your own list', icon: '📋' },
  ];

  const won = live.filter((c) => c.stage === 'won');
  const todayWon = won.filter((c) => pktDay(c.updatedAtMs) === today);

  // What they booked. Vexa writes `wants` on every reply — a few words for what
  // this person is buying — so the same thing bought twice counts as two.
  const byWant = new Map<string, number>();
  for (const c of todayWon) {
    const label = (c.wants || c.summary || '').trim();
    if (!label) continue;
    const key = label.toLowerCase().slice(0, 40);
    byWant.set(key, (byWant.get(key) ?? 0) + 1);
  }
  const packages = [...byWant.entries()]
    .map(([label, n]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);

  const noNumber = !live.some((c) => c.source === 'whatsapp');
  return {
    asked: leads.length,
    askedWeek: leads.filter((c) => c.createdAtMs > weekAgo).length,
    bySource: sources
      .map((s) => ({ ...s, n: live.filter((c) => c.source === s.key).length }))
      .filter((s) => s.n > 0),
    steps: [
      {
        key: 'asked',
        label: 'Asked in public',
        does: 'Someone asks the price under a post or an ad. Vexa answers there and gives them your WhatsApp.',
        icon: '💬',
        n: leads.length,
        empty: 'Nobody has asked a buying question under a post yet.',
      },
      {
        key: 'started',
        label: 'Came to WhatsApp',
        does: 'They message you — or Vexa opens with the people on your list.',
        icon: '🟢',
        n: live.length,
        empty: noNumber
          ? 'No WhatsApp number connected yet, so there is nowhere for them to land.'
          : 'Nobody has written in yet.',
      },
      {
        key: 'talking',
        label: 'Vexa talking',
        does: 'It works out what they actually want, one question at a time, in their own language.',
        icon: '💭',
        n: at('talking'),
        empty: 'No conversation has started.',
      },
      {
        key: 'pitched',
        label: 'Price given',
        does: 'It knows what they want, so it gives the price or the offer and asks for the next step.',
        icon: '🏷️',
        n: at('pitched'),
        empty: 'Nothing has got as far as a price.',
      },
      {
        key: 'won',
        label: 'Sold',
        does: 'They said yes. Vexa confirms what happens next and the row turns green.',
        icon: '🎉',
        n: at('won'),
        empty: 'No sale closed yet.',
      },
    ],
    todayWon,
    weekWon: won.filter((c) => c.updatedAtMs > weekAgo).length,
    packages,
    needsYou: live.filter((c) => c.stage === 'needs_you' || c.handover).length,
    total: live.length,
  };
}

const SOURCE_BADGE: Record<string, { label: string; icon: string }> = {
  whatsapp: { label: 'Messaged you', icon: '🟢' },
  comment: { label: 'From a comment', icon: '💬' },
  instagram: { label: 'Instagram', icon: '📸' },
  facebook: { label: 'Facebook', icon: '👍' },
  sheet: { label: 'Your list', icon: '📋' },
};

const STAGE_WORD: Record<SalesChatStage, string> = {
  new: 'Just arrived',
  talking: 'Talking',
  qualified: 'Knows what they want',
  pitched: 'Price given',
  won: 'Sold',
  lost: 'Lost',
  needs_you: 'Needs you',
  queued: 'Waiting to be messaged',
  stopped: 'Stopped',
};

/**
 * The section itself. Everything it draws comes from `readFunnel`; it decides
 * nothing of its own except which conversation is open.
 */
export function SalesFunnel({
  chats,
  comments,
  nowMs,
  i = 0,
}: {
  chats: SalesChatDoc[];
  comments: SocialCommentDoc[];
  nowMs: number;
  i?: number;
}) {
  const f = useMemo(() => readFunnel(chats, comments, nowMs), [chats, comments, nowMs]);
  const [open, setOpen] = useState<string | null>(null);

  // The widest step sets the scale, so the bars narrow the way a funnel does.
  const top = Math.max(f.steps[0].n, f.steps[1].n, 1);
  // The conversations worth putting in front of somebody: the ones that need
  // them, then the ones furthest along, then the most recent.
  const recent = [...chats]
    .filter((c) => c.messages.length)
    .sort((a, b) => {
      const rank = (c: SalesChatDoc) => (c.stage === 'needs_you' || c.handover ? 2 : c.stage === 'won' ? 1 : 0);
      return rank(b) - rank(a) || b.updatedAtMs - a.updatedAtMs;
    })
    .slice(0, 5);

  return (
    <section
      className="fx-card fx-rise fn"
      style={{ ['--i' as string]: i } as React.CSSProperties}
      aria-labelledby="funnel-h"
      data-tour="funnel"
    >
      <style>{FUNNEL_CSS}</style>

      <div className="fx-head">
        <span className="fx-ico" style={{ background: '#e8f7ee' }} aria-hidden>
          🛒
        </span>
        <div>
          <h2 id="funnel-h" className="fx-h2">
            Sales funnel
          </h2>
          <p className="fx-sub">From somebody seeing you, to somebody paying you</p>
        </div>
        <Link href="/dashboard/social/whatsapp" className="fx-link">
          Open the conversations →
        </Link>
      </div>

      {f.needsYou ? (
        <Link href="/dashboard/social/whatsapp" className="fn-alert">
          <span aria-hidden>🔔</span>
          <span>
            <strong>
              {f.needsYou} {f.needsYou === 1 ? 'conversation needs' : 'conversations need'} you
            </strong>{' '}
            — a complaint, a refund, or they asked for a person. Vexa has stopped and is waiting.
          </span>
          <span className="fn-go" aria-hidden>
            →
          </span>
        </Link>
      ) : null}

      {/* where they came from */}
      {f.bySource.length ? (
        <div className="fn-sources">
          <span className="fn-cap">Where they came from</span>
          <div className="fn-chips">
            {f.bySource.map((s) => (
              <span key={s.key} className="fn-chip">
                <i aria-hidden>{s.icon}</i>
                {s.label}
                <b>{s.n}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* the journey */}
      <ol className="fn-steps">
        {f.steps.map((s, k) => {
          const prev = k > 0 ? f.steps[k - 1].n : 0;
          // The drop-off from the step before, but never between the two halves:
          // a comment and a WhatsApp message are not the same people, and a
          // percentage there would be a lie with a decimal point on it.
          const through = k > 1 && prev > 0 ? Math.round((s.n / prev) * 100) : null;
          return (
            <li key={s.key} className={s.n ? '' : 'empty'} style={{ ['--i' as string]: k } as React.CSSProperties}>
              <span className="fn-node" aria-hidden>
                {s.icon}
              </span>
              <div className="fn-body">
                <div className="fn-top">
                  <strong>{s.label}</strong>
                  {through !== null ? <span className="fn-pct">{through}% got through</span> : null}
                  <span className="fn-n">
                    <CountUp value={s.n} />
                  </span>
                </div>
                <span className="fx-bar">
                  <i
                    style={{
                      width: `${Math.max(s.n ? 5 : 0, Math.min(100, (s.n / top) * 100))}%`,
                      background: BAR[k],
                      ['--i' as string]: k,
                    }}
                  />
                </span>
                <p>{s.n ? s.does : s.empty}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* today's sales report */}
      <div className="fn-today">
        <div className="fn-today-n">
          <span className="k">Sold today</span>
          <span className="v">
            <CountUp value={f.todayWon.length} />
          </span>
          <span className="h">{f.weekWon} this week</span>
        </div>
        <div className="fn-today-what">
          <span className="fn-cap">What they booked</span>
          {f.packages.length ? (
            <div className="fn-chips">
              {f.packages.map((p) => (
                <span key={p.label} className="fn-chip lime">
                  {p.label}
                  {p.n > 1 ? <b>×{p.n}</b> : null}
                </span>
              ))}
            </div>
          ) : (
            <p className="fn-none">
              {f.todayWon.length
                ? 'Vexa has not written down what these were for yet.'
                : 'Nothing booked today. Each sale will be named here as it closes.'}
            </p>
          )}
        </div>
      </div>

      {/* what Vexa actually said */}
      {recent.length ? (
        <div className="fn-said">
          <span className="fn-cap">What Vexa said</span>
          <div className="fn-rows">
            {recent.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const badge = SOURCE_BADGE[c.source] ?? SOURCE_BADGE.whatsapp;
              const isOpen = open === c.waId;
              return (
                <div key={c.waId} className={`fn-row${isOpen ? ' open' : ''}`}>
                  <button
                    type="button"
                    className="fn-row-top"
                    onClick={() => setOpen(isOpen ? null : c.waId)}
                    aria-expanded={isOpen}
                  >
                    <span className="fn-who">
                      <strong>{c.name || c.waId}</strong>
                      <em>
                        <i aria-hidden>{badge.icon}</i> {badge.label}
                      </em>
                    </span>
                    <span className={`fn-stage s-${c.stage}`}>{STAGE_WORD[c.stage]}</span>
                    <span className="fn-last">{last ? `${last.from === 'us' ? 'Vexa: ' : ''}${last.text}` : ''}</span>
                    <span className="fn-caret" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="fn-chat">
                      {c.summary ? <p className="fn-sum">{c.summary}</p> : null}
                      {c.messages.slice(-6).map((m, k) => (
                        <span key={`${m.atMs}-${k}`} className={`fn-msg ${m.from}`}>
                          {m.text}
                          {m.draft ? <em> · waiting for you to approve</em> : null}
                        </span>
                      ))}
                      {c.nextStep ? (
                        <p className="fn-next">
                          <strong>Next:</strong> {c.nextStep}
                        </p>
                      ) : null}
                      <Link href="/dashboard/social/whatsapp" className="fn-open">
                        Open this conversation →
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="fn-none" style={{ marginTop: 14 }}>
          Nothing has come through yet. Every conversation Vexa has will be kept here, word for word, so you can see
          exactly how your customers are being spoken to — and so it learns from the ones that closed.
        </p>
      )}
    </section>
  );
}

/** Green through to lime: the further down the funnel, the closer to money. */
const BAR = [
  'linear-gradient(90deg,#60a5fa,#93c5fd)',
  'linear-gradient(90deg,#34d399,#86efac)',
  'linear-gradient(90deg,#19c37d,#4ade80)',
  'linear-gradient(90deg,#a3c93a,#d9f26b)',
  'linear-gradient(90deg,#84cc16,#ccff00)',
];

export const FUNNEL_CSS = `
.fn { margin-bottom: 18px; }
.fn-cap { display: block; font-size: 10.5px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; color: #6f7a72; margin-bottom: 7px; }
.fn-none { margin: 0; font-size: 12.5px; line-height: 1.6; color: #6f7a72; }

.fn-alert { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 14px; margin-bottom: 14px;
  background: #fff6dc; border: 1px solid #fde7a6; color: #7a5200; font-size: 13px; line-height: 1.5;
  transition: transform .2s ease, box-shadow .2s ease; }
.fn-alert:hover { transform: translateX(3px); box-shadow: 0 10px 22px -16px rgba(122,82,0,.6); }
.fn-alert strong { color: #5c3e00; }
.fn-go { margin-left: auto; font-weight: 900; }

.fn-sources { margin-bottom: 16px; }
.fn-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.fn-chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 11px; font-size: 12.5px; font-weight: 700;
  background: #f4f8f6; border: 1px solid #e2e8e4; color: #1c1b1b; }
.fn-chip i { font-style: normal; }
.fn-chip b { font-weight: 900; font-variant-numeric: tabular-nums; }
.fn-chip.lime { background: #f7ffe0; border-color: #e0f29a; }

/* the journey: one node per step, joined by a line so it reads as a path */
.fn-steps { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 2px; }
.fn-steps li { position: relative; display: flex; gap: 13px; padding: 9px 0;
  animation: fn-rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 70ms); }
@keyframes fn-rise { from { opacity: 0; transform: translateY(8px); } }
.fn-steps li::before { content: ''; position: absolute; left: 16px; top: 42px; bottom: -4px; width: 2px;
  background: repeating-linear-gradient(#cfdcd5 0 4px, transparent 4px 8px); }
.fn-steps li:last-child::before { display: none; }
.fn-node { flex: none; width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; font-size: 16px;
  background: #f1f5f3; border: 1px solid #e2e8e4; z-index: 1; transition: transform .3s cubic-bezier(.3,1.5,.5,1); }
.fn-steps li:hover .fn-node { transform: scale(1.08) rotate(-5deg); }
.fn-steps li.empty .fn-node { opacity: .45; }
.fn-body { flex: 1; min-width: 0; }
/* .fx-bar is a span, and it is only ever a grid item where it is used elsewhere.
   Here its parent is a plain block, so it stays inline and loses its height. */
.fn-body .fx-bar { display: block; height: 9px; }
.fn-top { display: flex; align-items: baseline; gap: 9px; margin-bottom: 6px; }
.fn-top strong { font-size: 13.5px; font-weight: 800; }
.fn-pct { font-size: 11px; font-weight: 800; color: #6f7a72; background: #f1f5f3; border-radius: 999px; padding: 2px 8px; }
.fn-n { margin-left: auto; font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1; }
.fn-steps li.empty .fn-n { color: #9aa5a0; }
.fn-body p { margin: 6px 0 0; font-size: 12px; line-height: 1.55; color: #6f7a72; }

/* today */
.fn-today { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 14px; border-radius: 16px; margin-bottom: 16px;
  background: linear-gradient(135deg, #f3fbe6, #eef6ff); border: 1px solid #e6f0d8; }
.fn-today-n { flex: none; }
.fn-today-n .k { display: block; font-size: 10.5px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; color: #6f7a72; }
.fn-today-n .v { display: block; font-size: 30px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.fn-today-n .h { display: block; font-size: 11.5px; color: #6f7a72; }
.fn-today-what { flex: 1; min-width: 190px; }

/* the conversations */
.fn-rows { display: grid; gap: 7px; }
.fn-row { border: 1px solid #e2e8e4; border-radius: 13px; overflow: hidden; background: #fff; transition: border-color .2s ease, box-shadow .2s ease; }
.fn-row:hover { border-color: #c6ddd0; }
.fn-row.open { border-color: #a8d5bd; box-shadow: 0 10px 26px -18px rgba(16,40,28,.5); }
.fn-row-top { display: grid; grid-template-columns: minmax(96px, auto) auto minmax(0, 1fr) 16px; gap: 10px; align-items: center; width: 100%;
  padding: 10px 12px; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
.fn-who { min-width: 0; }
.fn-who strong { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fn-who em { display: flex; align-items: center; gap: 4px; font-style: normal; font-size: 11px; color: #6f7a72; margin-top: 1px; }
.fn-who em i { font-style: normal; }
.fn-stage { flex: none; font-size: 11px; font-weight: 900; border-radius: 999px; padding: 3px 9px; background: #f1f5f3; color: #4a564f; white-space: nowrap; }
.fn-stage.s-won { background: #e6f9ee; color: #11794c; }
.fn-stage.s-needs_you { background: #ffe9e9; color: #b42318; }
.fn-stage.s-pitched, .fn-stage.s-qualified { background: #fff4d6; color: #7a5200; }
.fn-last { font-size: 12.5px; color: #6f7a72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.fn-caret { font-size: 10px; color: #9aa5a0; transition: transform .25s ease; }
.fn-row.open .fn-caret { transform: rotate(180deg); }
.fn-chat { padding: 0 12px 12px; display: grid; gap: 6px; animation: fn-open .3s ease both; }
@keyframes fn-open { from { opacity: 0; transform: translateY(-4px); } }
.fn-sum { margin: 0 0 4px; font-size: 12px; color: #6f7a72; font-style: italic; }
.fn-msg { max-width: 82%; padding: 8px 11px; border-radius: 13px; font-size: 12.5px; line-height: 1.5; word-break: break-word; }
.fn-msg.them { background: #f1f5f3; border-bottom-left-radius: 4px; justify-self: start; }
.fn-msg.us { background: #e3f4ea; border-bottom-right-radius: 4px; justify-self: end; }
.fn-msg em { font-style: normal; font-size: 11px; color: #6f7a72; }
.fn-next { margin: 4px 0 0; font-size: 12px; color: #4a564f; }
.fn-open { font-size: 12.5px; font-weight: 800; color: #0058bb; margin-top: 4px; }

@media (max-width: 640px) {
  .fn-row-top { grid-template-columns: minmax(0, 1fr) auto; }
  .fn-last { display: none; }
}
@media (prefers-reduced-motion: reduce) { .fn *, .fn { animation: none !important; transition: none !important; } }
`;
