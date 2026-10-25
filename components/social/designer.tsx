'use client';

/**
 * "Design a campaign with your expert" — the Ads page's main box.
 *
 * You say what you want from a campaign in your own words. The expert answers
 * in plain words (what it would run, for whom, for how much, and why), asks
 * what it still needs, and keeps a live plan beside the conversation that you
 * can adjust. Nothing reaches Meta and nothing is spent until you press
 * Create — and that call still holds the budget to your daily limit.
 */

import { useEffect, useRef, useState } from 'react';

import { colors } from '@/lib/config';
import {
  adsApi,
  type AdChatTurn,
  type AdForecast,
  type AdPlan,
  type AdSource,
  type AdsConfigDoc,
  type SocialPostDoc,
} from '@/lib/api';
import { adMoney } from './ads';
import { Mascot } from './shared';

const GOAL: Record<AdPlan['objective'], { icon: string; label: string; means: string }> = {
  traffic: { icon: '👆', label: 'Traffic', means: 'people tap through to your link' },
  awareness: { icon: '📢', label: 'Awareness', means: 'as many of the right people as possible see it' },
  engagement: { icon: '❤️', label: 'Engagement', means: 'likes, comments, shares and views' },
};

const CTA: Record<string, string> = {
  LEARN_MORE: 'Learn more',
  DOWNLOAD: 'Download',
  SIGN_UP: 'Sign up',
  APPLY_NOW: 'Apply now',
  BOOK_TRAVEL: 'Book now',
  GET_OFFER: 'Get offer',
};

const STARTERS_HOUSE = [
  'Get more drivers in Lahore to sign up this week',
  'More rides in Karachi this weekend',
  'Tell students in Islamabad about shared rides',
  'Make people in Rawalpindi know Velocity Rides',
];
const STARTERS = [
  'More customers from Instagram this month',
  'Promote my offer to people nearby this week',
  'Get WhatsApp messages from people who want to buy',
];

export function CampaignDesigner({
  cfg,
  ready,
  blocked,
  posts,
  manager,
  house,
  onDone,
  onError,
}: {
  cfg: AdsConfigDoc | null;
  /** Connected, with a daily limit and an answer to "ask or launch". */
  ready: boolean;
  /** Why Create is off, when it is. */
  blocked: string | null;
  posts: SocialPostDoc[];
  manager: string | null;
  house: boolean;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [chat, setChat] = useState<AdChatTurn[]>([]);
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [forecast, setForecast] = useState<AdForecast | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [currency, setCurrency] = useState(cfg?.currency ?? 'PKR');
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<AdSource['kind']>('make');
  const [pick, setPick] = useState('');
  const [launch, setLaunch] = useState<boolean | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  const who = manager ?? 'Your expert';
  const goLive = launch ?? cfg?.mode === 'direct';
  const reusable = posts.filter((p) => (p.media ?? []).some((m) => m.url));
  const live = posts.filter((p) => p.results?.instagram?.ok && p.results.instagram.id);
  const brief = chat
    .filter((m) => m.from === 'you')
    .map((m) => m.text)
    .join('\n')
    .slice(0, 2000);

  // Keep the newest message in view.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, thinking]);

  // The overview's brain hands its words over as ?brief= — the first message, sent once.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const handed = params.get('brief');
      if (!handed) return;
      params.delete('brief');
      history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
      document.getElementById('design')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      void send(handed);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const said = text.trim();
    if (!said || thinking) return;
    const next: AdChatTurn[] = [...chat, { from: 'you', text: said.slice(0, 2000) }];
    setChat(next);
    setInput('');
    setThinking(true);
    try {
      const res = await adsApi.design({ chat: next.slice(-24), ...(plan ? { draft: plan } : {}) });
      setChat([...next, { from: 'expert', text: res.reply }]);
      setPlan(res.plan);
      setForecast(res.forecast);
      setQuestions(res.questions);
      setNote(res.note);
      setCurrency(res.currency);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'The expert could not answer just now.');
    } finally {
      setThinking(false);
    }
  }

  async function create() {
    if (!plan) return;
    setCreating(true);
    try {
      if (kind !== 'make' && !pick) throw new Error('Pick the post to use.');
      const source: AdSource =
        kind === 'post' ? { kind: 'post', postId: pick } : kind === 'boost' ? { kind: 'boost', mediaId: pick } : { kind: 'make' };
      const res = await adsApi.create({ brief, plan, source, launch: goLive });
      const said = res.launched
        ? `Done — "${res.plan.name}" is live at ${adMoney(res.budget, currency)} a day.`
        : `Made — "${res.plan.name}" is waiting for your Approve under Campaigns.`;
      setChat((c) => [...c, { from: 'expert', text: `${said}${res.note ? ` ${res.note}` : ''}` }]);
      onDone(said);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'The campaign could not be made.');
    } finally {
      setCreating(false);
    }
  }

  /** Budget and days are the owner's to change; the forecast scales with the money. */
  const edit = (patch: Partial<AdPlan>) => setPlan((p) => (p ? { ...p, ...patch } : p));
  const total = plan ? plan.dailyBudget * plan.days : 0;
  const scale = forecast && forecast.spend ? total / forecast.spend : 1;

  return (
    <section id="design" className="fx-card fx-rise" style={{ marginBottom: 16, scrollMarginTop: 16 }} aria-labelledby="design-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#ecfccb,#d1fae5)' }} aria-hidden>
          ✨
        </span>
        <div>
          <h2 id="design-h" className="fx-h2">
            Design a campaign with {manager ?? 'your expert'}
          </h2>
          <p className="fx-sub">
            Say what you want. It explains the campaign, asks what it needs, and builds it when you press Create — nothing
            is spent before that.
          </p>
        </div>
      </div>

      <div className="fx-design">
        <div className="fx-convo">
          <div ref={thread} className="fx-thread" aria-live="polite">
            {chat.length === 0 ? (
              <div className="fx-bubble expert fx-rise">
                <span className="fx-face" aria-hidden>
                  <Mascot role="social-manager" size={28} />
                </span>
                <span>
                  Hi! I&apos;m {who === 'Your expert' ? 'your Meta Ad Expert' : who}. Tell me what you want from this campaign —
                  more customers, more app installs, more people knowing your name — and where. I&apos;ll explain what I&apos;d
                  run and why, in plain words.
                </span>
              </div>
            ) : null}
            {chat.map((m, k) =>
              m.from === 'expert' ? (
                <div key={k} className="fx-bubble expert fx-rise">
                  <span className="fx-face" aria-hidden>
                    <Mascot role="social-manager" size={28} />
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                </div>
              ) : (
                <div key={k} className="fx-bubble you fx-rise">
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                </div>
              ),
            )}
            {thinking ? (
              <div className="fx-bubble expert">
                <span className="fx-face" aria-hidden>
                  <Mascot role="social-manager" size={28} />
                </span>
                <span className="fx-typing" aria-label={`${who} is thinking`} style={{ color: colors.primary }}>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
          </div>

          {(chat.length === 0 ? (house ? STARTERS_HOUSE : STARTERS) : questions).length && !thinking ? (
            <div className="fx-chips" aria-label={chat.length ? 'Answer a question' : 'Start with an idea'}>
              {(chat.length === 0 ? (house ? STARTERS_HOUSE : STARTERS) : questions).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => (chat.length ? setInput((v) => (v ? `${v}\n` : '') + `${q} `) : void send(q))}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="fx-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder={chat.length ? 'Answer, or ask it to change something…' : 'e.g. I want more drivers in Lahore, about Rs 1,500 a day for a week'}
              aria-label="Your message to the expert"
              className="fx-input"
            />
            <button type="submit" className="fx-btn" disabled={thinking || !input.trim()} aria-label="Send">
              ➤
            </button>
          </form>
        </div>

        <div className="fx-plan">
          {!plan ? (
            <div style={{ display: 'grid', placeItems: 'center', textAlign: 'center', gap: 10, height: '100%', minHeight: 260, padding: 10 }}>
              <div className="fx-radar light" aria-hidden>
                <span />
                <span />
                <span />
                <b>🎯</b>
              </div>
              <strong>The plan appears here</strong>
              <span className="fx-muted" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 260 }}>
                Goal, who sees it, the money and what it should buy — updated after every answer.
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }} className="fx-rise">
              <div>
                <div className="fx-eyebrow" style={{ color: colors.primary }}>
                  The plan
                </div>
                <strong style={{ fontSize: 16.5, display: 'block', marginTop: 2 }}>{plan.name}</strong>
              </div>
              <Row icon={GOAL[plan.objective].icon} title={`Goal · ${GOAL[plan.objective].label}`}>
                {GOAL[plan.objective].means}
              </Row>
              <Row icon="👥" title="Who sees it">
                {plan.audience.genders === 'all' ? 'Everyone' : plan.audience.genders === 'men' ? 'Men' : 'Women'} aged{' '}
                {plan.audience.ageMin}–{plan.audience.ageMax}, in{' '}
                {plan.audience.cities.length ? plan.audience.cities.join(', ') : 'the whole country'}
                {plan.audience.interests.length ? ` · interested in ${plan.audience.interests.join(', ')}` : ''}
              </Row>
              <Row icon="💰" title="The money">
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <input
                    inputMode="numeric"
                    aria-label={`Per day (${currency})`}
                    value={plan.dailyBudget || ''}
                    onChange={(e) => edit({ dailyBudget: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0) })}
                    className="fx-mini"
                  />
                  <span className="fx-muted">{currency} a day ×</span>
                  <input
                    inputMode="numeric"
                    aria-label="Days"
                    value={plan.days || ''}
                    onChange={(e) =>
                      edit({ days: Math.min(cfg?.maxDays ?? 30, Math.max(1, Math.round(Number(e.target.value.replace(/\D/g, '')) || 1))) })
                    }
                    className="fx-mini"
                    style={{ width: 54 }}
                  />
                  <span className="fx-muted">days =</span>
                  <strong>{adMoney(total, currency)} at most</strong>
                </span>
                {note ? <span style={{ display: 'block', color: colors.warn, marginTop: 4 }}>{note}</span> : null}
              </Row>
              {forecast ? (
                <Row icon="📈" title="What it should buy">
                  {Math.round(forecast.results[0] * scale).toLocaleString('en-PK')}–
                  {Math.round(forecast.results[1] * scale).toLocaleString('en-PK')} {forecast.label} · normal cost{' '}
                  {adMoney(forecast.costPerResult.low, currency)}–{adMoney(forecast.costPerResult.high, currency)}
                  {plan.objective === 'awareness' ? ' per 1,000 people' : ' each'}
                </Row>
              ) : null}
              <div className="fx-adprev">
                <span className="fx-muted" style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.08em' }}>
                  THE AD
                </span>
                {plan.lines[0] ? <span className="fx-hook">{plan.lines[0]}</span> : null}
                <span style={{ fontSize: 13, lineHeight: 1.5 }}>{plan.primaryText}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{plan.headline}</strong>
                  <span className="fx-pill" style={{ background: '#e6eefc', color: colors.secondary }}>
                    {CTA[plan.cta] ?? plan.cta}
                  </span>
                </span>
              </div>
              {plan.why ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: colors.secondary }}>Why this plan</summary>
                  <p className="fx-muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: '6px 0 0' }}>
                    {plan.why}
                  </p>
                </details>
              ) : null}

              <div style={{ display: 'grid', gap: 8, paddingTop: 10, borderTop: `1px solid ${colors.border}` }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 11.5, fontWeight: 800, color: colors.muted }}>
                  The picture
                  <select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as AdSource['kind']);
                      setPick('');
                    }}
                    className="fx-mini"
                    style={{ width: '100%' }}
                  >
                    <option value="make">The desk makes it from the plan</option>
                    <option value="post" disabled={!reusable.length}>
                      Use a piece the desk made
                    </option>
                    <option value="boost" disabled={!live.length}>
                      Boost a live Instagram post
                    </option>
                  </select>
                </label>
                {kind !== 'make' ? (
                  <select value={pick} onChange={(e) => setPick(e.target.value)} className="fx-mini" style={{ width: '100%' }} aria-label="Which one">
                    <option value="">Choose…</option>
                    {(kind === 'post' ? reusable : live).map((p) => (
                      <option key={p.id} value={kind === 'post' ? p.id : (p.results.instagram?.id ?? '')}>
                        {p.date} · {p.format} · {(p.script?.hook ?? p.caption).slice(0, 50)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                  <input type="checkbox" checked={goLive} onChange={(e) => setLaunch(e.target.checked)} disabled={!ready} />
                  Launch it straight away{cfg?.dailyCap ? ` (within your ${adMoney(cfg.dailyCap, currency)} daily limit)` : ''}
                </label>
                <button type="button" className="fx-btn" onClick={create} disabled={!ready || creating || thinking || brief.length < 5 || !plan.dailyBudget}>
                  {creating ? (
                    <span className="fx-typing" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <span aria-hidden>🚀</span>
                  )}
                  {creating ? 'Building it at Meta…' : 'Create this campaign'}
                </button>
                {blocked ? <span style={{ fontSize: 12, color: colors.warn }}>{blocked}</span> : null}
                {creating ? (
                  <span className="fx-muted" style={{ fontSize: 12 }}>
                    Drawing the picture and setting it up at Meta — a minute or three. You can leave this page.
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: 8, fontSize: 13, lineHeight: 1.45 }}>
      <span className="fx-ico" style={{ width: 30, height: 30, borderRadius: 10, fontSize: 15, background: '#f1f5f3' }} aria-hidden>
        {icon}
      </span>
      <span>
        <strong style={{ display: 'block', fontSize: 12, color: colors.muted }}>{title}</strong>
        {children}
      </span>
    </div>
  );
}

/** The conversation's own CSS, on top of the desk's (FX_CSS). */
export const DESIGNER_CSS = `
.fx-design { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, 1fr); gap: 16px; }
@media (max-width: 1080px) { .fx-design { grid-template-columns: minmax(0, 1fr); } }
.fx-convo { display: grid; grid-template-rows: 1fr auto auto; gap: 10px; min-width: 0; border-radius: 18px; padding: 12px;
  background: linear-gradient(180deg, #f6faf7, #fbfdfc); border: 1px solid var(--line); }
.fx-thread { display: grid; gap: 10px; align-content: start; max-height: 420px; min-height: 260px; overflow-y: auto; padding: 4px; }
.fx-bubble { display: flex; gap: 9px; align-items: flex-end; max-width: 92%; font-size: 13.5px; line-height: 1.55; }
.fx-bubble > span:last-child { padding: 10px 13px; border-radius: 16px; }
.fx-bubble.expert > span:last-child { background: #fff; border: 1px solid var(--line); border-bottom-left-radius: 5px; box-shadow: 0 6px 16px -14px rgba(0,57,36,.5); }
.fx-bubble.you { justify-self: end; }
.fx-bubble.you > span:last-child { background: var(--forest); color: #fff; border-bottom-right-radius: 5px; }
.fx-face { width: 34px; height: 34px; flex: none; border-radius: 12px; display: grid; place-items: center; background: #e3f4ea; }
.fx-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.fx-chips button { border: 1px dashed #9fcfb6; background: #fff; color: var(--forest); border-radius: 999px; padding: 6px 12px; font: inherit;
  font-size: 12.5px; font-weight: 700; cursor: pointer; text-align: left; transition: background .2s ease, transform .2s ease; }
.fx-chips button:hover { background: #ecf8f1; transform: translateY(-1px); }
.fx-compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
.fx-compose .fx-btn { height: 48px; width: 52px; padding: 0; font-size: 18px; }
.fx-plan { border-radius: 18px; padding: 16px; border: 1px solid var(--line); background: #fff; min-width: 0; }
.fx-adprev { display: grid; gap: 6px; padding: 12px; border-radius: 14px; background: #fafbfa; border: 1px solid var(--line); }
.fx-hook { display: block; padding: 18px 14px; border-radius: 10px; background: radial-gradient(120% 140% at 0% 0%, #0f5a3c, #04150e);
  color: var(--lime); font-size: 17px; font-weight: 900; letter-spacing: -.01em; line-height: 1.25; }
`;
