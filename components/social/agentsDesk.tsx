'use client';

/**
 * Sales agent → the AI agents' own desk: the package (what is paid for and
 * what is used), the calls the AI made with what was said, the WhatsApp line,
 * and the chats it is having — with a way in for a person at any point.
 *
 * Everything here reads the workspace's own documents (`agentCalls`,
 * `agentThreads`) live; every change is a callable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  agentPrice,
  agentsApi,
  type AgentCallDoc,
  type AgentPackage,
  type AgentState,
  type AgentThreadDoc,
  type SalesCallAgent,
} from '@/lib/api';

/** The package, the calls and the chats for the workspace in `path`. */
export function useAgentDesk(path: (p: string) => string, onError: (m: string) => void) {
  const [state, setState] = useState<AgentState | null>(null);
  const [calls, setCalls] = useState<AgentCallDoc[]>([]);
  const [threads, setThreads] = useState<AgentThreadDoc[]>([]);

  const reload = useCallback(async () => {
    try {
      setState(await agentsApi.state({}));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read the AI agents.');
    }
  }, [onError]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('agentCalls')), orderBy('createdAtMs', 'desc'), limit(30)),
        (snap) => setCalls(snap.docs.map((d) => ({ ...(d.data() as AgentCallDoc), id: d.id }))),
        () => setCalls([]),
      ),
    [path],
  );
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('agentThreads')), orderBy('updatedAtMs', 'desc'), limit(50)),
        (snap) => setThreads(snap.docs.map((d) => d.data() as AgentThreadDoc)),
        () => setThreads([]),
      ),
    [path],
  );

  return { state, calls, threads, reload };
}

function Meter({ label, used, of }: { label: string; used: number; of: number }) {
  const pct = of > 0 ? Math.min(1, used / of) : 0;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
        <span style={{ fontWeight: 800 }}>{label}</span>
        <span className="fx-muted">
          {used.toLocaleString('en-PK')} of {of.toLocaleString('en-PK')}
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: '#eef2ef', overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 99, background: pct >= 1 ? colors.danger : pct > 0.8 ? colors.warn : colors.success }} />
      </div>
    </div>
  );
}

const DEFAULT_PKG: AgentPackage = { agents: 1, numbers: 1, callsPerDay: 20, avgCallMin: 2, waMessagesPerMonth: 300 };

/** What is paid for, what is used, and a package to buy. */
export function AgentPackageCard({ state }: { state: AgentState | null }) {
  const [pkg, setPkg] = useState<AgentPackage>(state?.plan ?? DEFAULT_PKG);
  const q = state ? agentPrice(pkg, state.price, state.usdToPkr) : null;
  const plan = state?.plan ?? null;
  const live = Boolean(state?.planLive);
  const minutes = Math.round((state?.usage.seconds ?? 0) / 60);
  const href = `/dashboard/social/billing?agents=${pkg.agents}&numbers=${pkg.numbers}&calls=${pkg.callsPerDay}&min=${pkg.avgCallMin}&wa=${pkg.waMessagesPerMonth}`;

  const field = (k: keyof AgentPackage, label: string, max: number, step = 1) => (
    <label key={k} style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: colors.muted }}>
      {label}
      <input
        type="number"
        min={k === 'waMessagesPerMonth' ? 0 : 1}
        max={max}
        step={step}
        value={pkg[k]}
        onChange={(e) => setPkg({ ...pkg, [k]: Math.min(max, Math.max(0, Number(e.target.value) || 0)) })}
        className="fx-mini"
        style={{ width: 96 }}
      />
    </label>
  );

  return (
    <section className="fx-card" aria-labelledby="pkg-h">
      <div className="fx-head" style={{ flexWrap: 'wrap' }}>
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#dcfce7,#dbeafe)' }} aria-hidden>
          🤖
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 id="pkg-h" className="fx-h2">
            AI calling &amp; WhatsApp
          </h2>
          <p className="fx-sub">
            {!state
              ? 'Loading…'
              : state.house
                ? 'Velocity’s own agents: no package, no caps. Every call and message is costed on AI agents & billing.'
                : live && plan
                  ? `Your package runs until ${new Date(plan.paidUntilMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`
                  : 'Your AI agents can phone businesses and answer WhatsApp once a package is paid for.'}
          </p>
        </div>
      </div>

      {state && !state.house && plan && live ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
          <Meter label="Calls today" used={state.callsToday} of={plan.callsPerDay} />
          <Meter label="Call minutes this month" used={state.usage.lineMin} of={plan.minutesPerMonth} />
          <Meter label="WhatsApp messages this month" used={state.usage.waOut + state.usage.waTemplates} of={plan.waMessagesPerMonth} />
        </div>
      ) : state?.house ? (
        <p className="fx-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          This month: {state.usage.calls} calls · {minutes} minutes · {state.usage.waOut + state.usage.waTemplates} WhatsApp sent ·{' '}
          {state.usage.waIn} received.
        </p>
      ) : null}

      {state && !state.house ? (
        <div style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 14, background: '#f6faf7' }}>
          <strong style={{ fontSize: 13.5 }}>{plan && live ? 'Change or renew your package' : 'Choose a package'}</strong>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {field('agents', 'AI agents', 5)}
            {field('numbers', 'Phone numbers', 10)}
            {field('callsPerDay', 'Calls a day', 500)}
            {field('avgCallMin', 'Minutes a call', 8, 0.5)}
            {field('waMessagesPerMonth', 'WhatsApp a month', 50_000, 50)}
          </div>
          {q ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>
                About {q.minutes.toLocaleString('en-PK')} call minutes for 30 days ·{' '}
                <strong style={{ fontSize: 17 }}>${q.usd.toLocaleString('en-US')}</strong>{' '}
                <span className="fx-muted">(Rs {q.pkr.toLocaleString('en-PK')})</span>
              </span>
              <Link href={href} className="fx-btn small" style={{ marginLeft: 'auto' }}>
                Pay for this package →
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const STATE_LABEL: Record<AgentCallDoc['state'], { label: string; tint: string }> = {
  dialing: { label: 'Ringing', tint: colors.secondary },
  live: { label: 'On the call', tint: colors.success },
  ended: { label: 'Finished', tint: colors.muted },
  'no-answer': { label: 'No answer', tint: colors.muted },
  busy: { label: 'Busy', tint: colors.warn },
  failed: { label: 'Failed', tint: colors.danger },
};

const RESULT_LABEL: Record<string, string> = {
  interested: '🎉 Interested',
  meeting: '📅 Meeting booked',
  deal: '🤝 Deal',
  callback: '⏰ Call back',
  not_interested: '🙅 Not interested',
  do_not_call: '⛔ Do not call again',
  wrong_number: '❌ Wrong number',
  voicemail: '📼 Voicemail',
};

/** The AI's calls, newest first, with what was said. */
export function AiCallLog({ calls }: { calls: AgentCallDoc[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!calls.length) return null;
  return (
    <section className="fx-card" aria-labelledby="calls-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#e0e7ff,#fce7f3)' }} aria-hidden>
          🎧
        </span>
        <div style={{ flex: 1 }}>
          <h2 id="calls-h" className="fx-h2">
            Calls the AI made
          </h2>
          <p className="fx-sub">What it said, what they said, and how each call ended.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {calls.map((c) => {
          const st = STATE_LABEL[c.state] ?? STATE_LABEL.failed;
          const isOpen = open === c.id;
          const lines = c.transcript ?? [];
          return (
            <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 12, background: '#fff' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <strong style={{ display: 'block', fontSize: 14 }}>{c.leadName}</strong>
                  <span className="fx-muted" style={{ fontSize: 12.5 }}>
                    {c.agentName} · {new Date(c.createdAtMs).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {c.seconds ? ` · ${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, '0')}` : ''}
                    {c.by === 'auto' ? ' · on its own' : ''}
                  </span>
                </span>
                {c.outcome ? (
                  <span className="fx-pill" style={{ background: '#04785714', color: colors.success }}>
                    {RESULT_LABEL[c.outcome.result] ?? c.outcome.result}
                  </span>
                ) : null}
                <span className="fx-pill" style={{ background: `${st.tint}14`, color: st.tint }}>
                  {c.state === 'live' || c.state === 'dialing' ? <span className="fx-live" /> : null}
                  {st.label}
                </span>
                {lines.length || c.outcome ? (
                  <button type="button" className="fx-btn ghost small" onClick={() => setOpen(isOpen ? null : c.id)}>
                    {isOpen ? 'Hide' : 'What was said'}
                  </button>
                ) : null}
              </div>
              {c.outcome?.summary ? <p style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>{c.outcome.summary}</p> : null}
              {c.outcome?.deal ? (
                <p style={{ fontSize: 13, margin: '6px 0 0', fontWeight: 800, color: colors.success }}>Agreed: {c.outcome.deal}</p>
              ) : null}
              {c.outcome?.whatsappOk ? (
                <p className="fx-muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                  WhatsApp details:{' '}
                  {c.followUp === 'sent' ? 'sent ✓' : c.followUp === 'pending' ? 'going out in a few minutes' : c.followUp === 'failed' ? 'could not be sent' : '—'}
                </p>
              ) : null}
              {c.error && c.state !== 'ended' ? (
                <p style={{ fontSize: 12.5, margin: '6px 0 0', color: colors.danger }}>{c.error}</p>
              ) : null}
              {isOpen && lines.length ? (
                <div className="fx-rise" style={{ display: 'grid', gap: 6, marginTop: 10, padding: 10, borderRadius: 12, background: '#f6faf7', fontSize: 13 }}>
                  {lines.map((line, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8 }}>
                      <strong style={{ minWidth: 64, color: line.who === 'agent' ? colors.primary : colors.secondary }}>
                        {line.who === 'agent' ? c.agentName : 'They'}
                      </strong>
                      <span style={{ lineHeight: 1.5 }}>{line.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Connect the business's own WhatsApp number, and choose who answers on it. */
export function WhatsAppLine({
  state,
  agents,
  onSaved,
  onError,
}: {
  state: AgentState | null;
  agents: SalesCallAgent[];
  onSaved: (message: string) => void;
  onError: (m: string) => void;
}) {
  const line = state?.whatsapp ?? null;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    phoneNumberId: line?.phoneNumberId ?? '',
    token: '',
    appSecret: '',
    templateName: line?.templateName ?? '',
    templateLang: line?.templateLang ?? 'en',
    templateHasName: line?.templateHasName ?? true,
    autoReply: line?.autoReply ?? true,
    agentId: (line?.agentId ?? agents[0]?.id ?? null) as string | null,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await agentsApi.saveWhatsApp({
        phoneNumberId: f.phoneNumberId.trim(),
        ...(f.token.trim() ? { token: f.token.trim() } : {}),
        ...(f.appSecret.trim() ? { appSecret: f.appSecret.trim() } : {}),
        templateName: f.templateName.trim(),
        templateLang: f.templateLang.trim(),
        templateHasName: f.templateHasName,
        autoReply: f.autoReply,
        agentId: f.agentId,
      });
      setF((x) => ({ ...x, token: '', appSecret: '' }));
      setOpen(false);
      onSaved('WhatsApp line connected. Point your Meta app’s webhook at the address shown, with the verify token.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not connect the WhatsApp line.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fx-card" aria-labelledby="wa-h">
      <div className="fx-head" style={{ flexWrap: 'wrap' }}>
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)' }} aria-hidden>
          💬
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 id="wa-h" className="fx-h2">
            WhatsApp line
          </h2>
          <p className="fx-sub">
            {line
              ? `${line.verifiedName || 'Connected'} · ${line.displayNumber} · ${line.autoReply ? 'the AI answers' : 'you answer'}`
              : 'Connect your WhatsApp Business number so the AI can answer, follow up after calls and close.'}
          </p>
        </div>
        <button type="button" className="fx-btn ghost small" onClick={() => setOpen(!open)}>
          {open ? 'Close' : line ? 'Change' : 'Connect'}
        </button>
      </div>

      {line ? (
        <div style={{ display: 'grid', gap: 4, fontSize: 12.5, padding: 10, borderRadius: 12, background: '#f6faf7', marginBottom: open ? 12 : 0 }}>
          <span>
            Webhook address: <code style={{ fontWeight: 800 }}>{state?.webhookUrl}</code>
          </span>
          <span>
            Verify token: <code style={{ fontWeight: 800 }}>{line.verifyToken}</code>
          </span>
          <span className="fx-muted">In your Meta app → WhatsApp → Configuration: paste both, then subscribe to “messages”.</span>
        </div>
      ) : null}

      {open ? (
        <div className="fx-rise" style={{ display: 'grid', gap: 10 }}>
          <p className="fx-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
            Use a number of your own on the WhatsApp Business Platform (Meta Business Suite → WhatsApp Manager). The AI only
            replies to people who wrote in the last 24 hours, and after a call it sends one approved template — only to someone who
            said yes on the call. It never messages anyone cold, and “stop” ends it at once.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <Field label="Phone number ID">
              <input value={f.phoneNumberId} onChange={(e) => set('phoneNumberId', e.target.value.replace(/\D/g, ''))} className="fx-mini" style={{ width: '100%' }} />
            </Field>
            <Field label={line ? 'Permanent access token (only to change it)' : 'Permanent access token'}>
              <input type="password" autoComplete="off" value={f.token} onChange={(e) => set('token', e.target.value)} className="fx-mini" style={{ width: '100%' }} />
            </Field>
            <Field label={line ? 'App secret (only to change it)' : 'Meta app secret'}>
              <input type="password" autoComplete="off" value={f.appSecret} onChange={(e) => set('appSecret', e.target.value)} className="fx-mini" style={{ width: '100%' }} />
            </Field>
            <Field label="Approved template for after a call">
              <input
                value={f.templateName}
                onChange={(e) => set('templateName', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="e.g. details_after_call"
                className="fx-mini"
                style={{ width: '100%' }}
              />
            </Field>
            <Field label="Template language">
              <input value={f.templateLang} onChange={(e) => set('templateLang', e.target.value)} placeholder="en or ur" className="fx-mini" style={{ width: '100%' }} />
            </Field>
            <Field label="Who answers">
              <select value={f.agentId ?? ''} onChange={(e) => set('agentId', e.target.value || null)} className="fx-mini" style={{ width: '100%' }}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                {!agents.length ? <option value="">An assistant (set up a calling agent to name it)</option> : null}
              </select>
            </Field>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={f.templateHasName} onChange={(e) => set('templateHasName', e.target.checked)} />
            The template’s text has one {'{{1}}'}, for their name
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={f.autoReply} onChange={(e) => set('autoReply', e.target.checked)} />
            The AI answers on its own (you can take over any chat)
          </label>
          <div>
            <button type="button" className="fx-btn small" disabled={busy || !f.phoneNumberId} onClick={() => void save()}>
              {busy ? 'Checking with Meta…' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const INTENT_LABEL: Record<string, string> = {
  deal: '🤝 Deal',
  meeting: '📅 Meeting',
  interested: '🙂 Interested',
  not_interested: '🙅 Not interested',
  stop: '⛔ Stopped',
  human: '🙋 Wants a person',
  question: '❓ Asking',
};

/** Every WhatsApp chat: who needs you first, then the newest. */
export function WhatsAppChats({ threads, onError }: { threads: AgentThreadDoc[]; onError: (m: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...threads].sort((a, b) => Number(Boolean(b.needsOwner)) - Number(Boolean(a.needsOwner))), [threads]);
  const open = threads.find((t) => t.waId === openId) ?? null;
  if (!threads.length) return null;

  async function act(waId: string, action: 'send' | 'takeover' | 'handback' | 'read', body?: string) {
    setBusy(true);
    try {
      await agentsApi.threadAction({ waId, action, ...(body ? { text: body } : {}) });
      if (action === 'send') setText('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fx-card" aria-labelledby="chats-h">
      <div className="fx-head">
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#dcfce7,#fef9c3)' }} aria-hidden>
          🗨️
        </span>
        <div style={{ flex: 1 }}>
          <h2 id="chats-h" className="fx-h2">
            WhatsApp chats
          </h2>
          <p className="fx-sub">
            {threads.filter((t) => t.needsOwner).length
              ? `${threads.filter((t) => t.needsOwner).length} need you — a deal to confirm, or a question the AI handed over.`
              : 'The AI is answering. Open any chat to read it or take over.'}
          </p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 12 }} className="fx-chat-grid">
        <div style={{ display: 'grid', gap: 6, alignContent: 'start', maxHeight: 460, overflowY: 'auto' }}>
          {sorted.map((t) => (
            <button
              key={t.waId}
              type="button"
              onClick={() => {
                setOpenId(t.waId);
                if (t.unread || t.needsOwner) void act(t.waId, 'read');
              }}
              style={{
                textAlign: 'left',
                border: `1px solid ${t.waId === openId ? colors.primary : 'var(--line)'}`,
                background: t.needsOwner ? '#fff7ed' : '#fff',
                borderRadius: 12,
                padding: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <strong style={{ fontSize: 13.5, flex: 1 }}>{t.name || `+${t.waId}`}</strong>
                {t.unread ? <span className="fx-pill" style={{ background: colors.success, color: '#fff' }}>{t.unread}</span> : null}
              </span>
              <span className="fx-muted fx-clip2" style={{ fontSize: 12, display: 'block' }}>
                {t.messages[t.messages.length - 1]?.text ?? ''}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: colors.muted }}>
                {t.mode === 'human' ? '👤 You' : '🤖 AI'}
                {t.intent ? ` · ${INTENT_LABEL[t.intent] ?? t.intent}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 12, minHeight: 240, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 10 }}>
          {open ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ flex: 1 }}>{open.name || `+${open.waId}`}</strong>
                {open.deal ? <span className="fx-pill" style={{ background: '#04785714', color: colors.success }}>{open.deal.slice(0, 80)}</span> : null}
                {open.mode === 'human' ? (
                  <button type="button" className="fx-btn ghost small" disabled={busy} onClick={() => void act(open.waId, 'handback')}>
                    Let the AI answer
                  </button>
                ) : (
                  <button type="button" className="fx-btn ghost small" disabled={busy} onClick={() => void act(open.waId, 'takeover')}>
                    Take over
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gap: 6, alignContent: 'start', maxHeight: 340, overflowY: 'auto' }}>
                {open.messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      justifySelf: m.from === 'us' ? 'end' : 'start',
                      maxWidth: '80%',
                      background: m.from === 'us' ? '#dcfce7' : '#f1f5f9',
                      borderRadius: 12,
                      padding: '7px 10px',
                      fontSize: 13,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                    <div style={{ fontSize: 10.5, color: colors.muted, marginTop: 3 }}>
                      {m.by === 'ai' ? 'AI · ' : m.by === 'owner' ? 'You · ' : m.by === 'template' ? 'Template · ' : ''}
                      {new Date(m.atMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
              {open.optedOut ? (
                <p className="fx-muted" style={{ fontSize: 12.5, margin: 0 }}>
                  They asked not to be messaged again.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 1000))}
                    placeholder="Write a reply…"
                    className="fx-mini"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && text.trim()) void act(open.waId, 'send', text.trim());
                    }}
                  />
                  <button type="button" className="fx-btn small" disabled={busy || !text.trim()} onClick={() => void act(open.waId, 'send', text.trim())}>
                    Send
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="fx-muted" style={{ fontSize: 13, margin: 0, alignSelf: 'center', justifySelf: 'center' }}>
              Choose a chat.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 800, color: colors.muted }}>
      {label}
      {children}
    </label>
  );
}
