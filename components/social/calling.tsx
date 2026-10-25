'use client';

/**
 * Sales agent → Calling agents.
 *
 * A calling agent is set up once — a name, a voice, a language, what the call
 * is for, what it knows and the hours it is polite to ring — and then works
 * one of two ways:
 *  - "A person dials": it writes the call for every business with a phone
 *    number (opener, pitch, questions, objections, the ask); whoever dials
 *    reads it and logs how it went.
 *  - "The AI dials": it rings the business itself from its own number and
 *    talks (Twilio → voice bridge → Gemini Live), records how the call ended,
 *    and sends the details on WhatsApp to anyone who said yes. It can ring new
 *    leads on its own, inside its hours and caps.
 */

import { useMemo, useState } from 'react';

import { colors } from '@/lib/config';
import {
  agentsApi,
  salesApi,
  type AgentState,
  type SalesCallAgent,
  type SalesCallOutcome,
  type SalesLeadDoc,
  type SalesSettingsDoc,
} from '@/lib/api';

const OUTCOMES: { key: SalesCallOutcome; label: string; tint: string }[] = [
  { key: 'interested', label: '🎉 Interested', tint: '#047857' },
  { key: 'callback', label: '⏰ Call back', tint: '#0058bb' },
  { key: 'no_answer', label: '📵 No answer', tint: '#6f7a72' },
  { key: 'not_interested', label: '🙅 Not interested', tint: '#ba1a1a' },
  { key: 'wrong_number', label: '❌ Wrong number', tint: '#b45309' },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<SalesCallOutcome, (typeof OUTCOMES)[number]>;

const LANGUAGES: { key: SalesCallAgent['language']; label: string }[] = [
  { key: 'mixed', label: 'Urdu + English (as people talk)' },
  { key: 'urdu', label: 'Urdu' },
  { key: 'english', label: 'English' },
];

const hour = (h: number) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const newId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent'}-${Math.random().toString(36).slice(2, 7)}`;

const BLANK: Omit<SalesCallAgent, 'id'> = {
  name: '',
  voice: 'female',
  language: 'mixed',
  goal: '',
  opener: '',
  points: '',
  hoursFrom: 10,
  hoursTo: 18,
  dailyCap: 30,
  active: true,
  mode: 'script',
  knowledge: '',
  autoCall: false,
};

export function CallingAgents({
  settings,
  leads,
  desk,
  onSaved,
  onError,
}: {
  settings: SalesSettingsDoc;
  leads: SalesLeadDoc[];
  /** The package, the phone line and the numbers; null while loading. */
  desk: AgentState | null;
  onSaved: (s: SalesSettingsDoc, message: string) => void;
  onError: (m: string) => void;
}) {
  const agents = settings.callAgents ?? [];
  const [editing, setEditing] = useState<SalesCallAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const caller = agents.find((a) => a.id === agentId) ?? agents.find((a) => a.active) ?? agents[0] ?? null;

  /** Businesses with a number, not yet closed: never called first, then the call-backs, then the rest. */
  const callList = useMemo(() => {
    const rank = (l: SalesLeadDoc) => (!l.lastCall ? 0 : l.lastCall.outcome === 'callback' ? 1 : l.lastCall.outcome === 'no_answer' ? 2 : 3);
    return leads
      .filter((l) => l.phone && !['lost', 'skipped', 'won'].includes(l.status))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 40);
  }, [leads]);

  async function saveAgents(next: SalesCallAgent[], message: string) {
    setBusy(true);
    try {
      const res = await salesApi.saveSettings({ callAgents: next });
      onSaved(res.settings, message);
      setEditing(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save the calling agent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="calling" className="fx-card" style={{ scrollMarginTop: 16 }} aria-labelledby="calling-h">
      <div className="fx-head" style={{ flexWrap: 'wrap' }}>
        <span className="fx-ico" style={{ background: 'linear-gradient(135deg,#fce7f3,#dbeafe)' }} aria-hidden>
          📞
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 id="calling-h" className="fx-h2">
            Calling agents
          </h2>
          <p className="fx-sub">
            Each one either rings businesses itself and talks (AI dials), or writes the call for you to read (a person dials).
          </p>
        </div>
        {agents.length < 5 && !editing ? (
          <button type="button" className="fx-btn small" onClick={() => setEditing({ ...BLANK, id: '' })}>
            + New calling agent
          </button>
        ) : null}
      </div>

      {agents.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginBottom: 14 }}>
          {agents.map((a) => (
            <div key={a.id} className="fx-card fx-lift" style={{ padding: 13, borderRadius: 16, display: 'grid', gap: 8, opacity: a.active ? 1 : 0.6 }}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="fx-avatar" style={{ marginLeft: 0, width: 40, height: 40, fontSize: 19, background: a.voice === 'female' ? '#fce7f3' : '#dbeafe' }}>
                  {a.voice === 'female' ? '👩🏻‍💼' : '👨🏻‍💼'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{a.name}</strong>
                  <span className="fx-muted" style={{ fontSize: 12 }}>
                    {LANGUAGES.find((l) => l.key === a.language)?.label} · {hour(a.hoursFrom)}–{hour(a.hoursTo)}
                  </span>
                </span>
                <span className="fx-pill" style={{ background: a.active ? '#04785714' : '#eef2ef', color: a.active ? colors.success : colors.muted }}>
                  <span className={a.active ? 'fx-live' : 'fx-live off'} />
                  {a.active ? 'On' : 'Off'}
                </span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: a.mode === 'ai' ? colors.primary : colors.muted }}>
                {a.mode === 'ai'
                  ? `🤖 AI dials${numberOf(desk, a.id) ? ` · from ${numberOf(desk, a.id)}` : ' · no number yet'}${a.autoCall ? ' · on its own' : ''}`
                  : '✍️ A person dials'}
              </span>
              {a.goal ? (
                <span className="fx-muted fx-clip2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  Goal: {a.goal}
                </span>
              ) : null}
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="fx-btn ghost small" onClick={() => setEditing(a)} disabled={busy}>
                  Edit
                </button>
                <button
                  type="button"
                  className="fx-btn ghost small"
                  disabled={busy}
                  onClick={() =>
                    void saveAgents(
                      agents.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)),
                      `${a.name} is ${a.active ? 'off' : 'on'}.`,
                    )
                  }
                >
                  {a.active ? 'Turn off' : 'Turn on'}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : !editing ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <div className="fx-radar light" aria-hidden>
            <span />
            <span />
            <span />
            <b>📞</b>
          </div>
          <p className="fx-muted" style={{ flex: 1, minWidth: 220, fontSize: 13, lineHeight: 1.55, margin: 0 }}>
            No calling agent yet. Give one a name, a language and what the call is for — it writes a fresh call for every
            business the sales agent finds with a phone number.
          </p>
        </div>
      ) : null}

      {editing ? (
        <AgentForm
          initial={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(a) => {
            const isNew = !a.id;
            const saved = isNew ? { ...a, id: newId(a.name) } : a;
            void saveAgents(
              isNew ? [...agents, saved] : agents.map((x) => (x.id === saved.id ? saved : x)),
              isNew ? `${saved.name} is set up. Pick a business below and press "Write the call".` : `${saved.name} is saved.`,
            );
          }}
          onDelete={
            editing.id
              ? () => void saveAgents(agents.filter((x) => x.id !== editing.id), `${editing.name} is removed.`)
              : undefined
          }
        />
      ) : null}

      {agents.length ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 10px' }}>
            <strong style={{ fontSize: 14 }}>Who to call</strong>
            <span className="fx-muted" style={{ fontSize: 12.5 }}>
              {callList.length} business{callList.length === 1 ? '' : 'es'} with a phone number
            </span>
            {agents.length > 1 ? (
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, fontWeight: 800 }}>
                Calling as
                <select value={caller?.id ?? ''} onChange={(e) => setAgentId(e.target.value)} className="fx-mini" style={{ width: 'auto' }}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {callList.length === 0 ? (
            <p className="fx-muted" style={{ fontSize: 13, margin: 0 }}>
              No business on the list has a phone number yet. The map search usually finds numbers — press &quot;Find &amp; write
              emails&quot; above for a kind of business, or add your own list with numbers.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {callList.map((l) => (
                <CallRow key={l.id} lead={l} caller={caller} aiBlocked={aiBlocked(desk, caller)} onError={onError} />
              ))}
            </div>
          )}
        </>
      ) : null}

      <p className="fx-muted" style={{ fontSize: 11.5, margin: '14px 0 0', lineHeight: 1.5 }}>
        An AI agent says it is an AI assistant calling for you, states only what you wrote in its knowledge box, and stops at
        once for anyone who says not to call again. Calls go out from its own number, inside its hours and your package.
      </p>
    </section>
  );
}

function AgentForm({
  initial,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  initial: SalesCallAgent;
  busy: boolean;
  onCancel: () => void;
  onSave: (a: SalesCallAgent) => void;
  onDelete?: () => void;
}) {
  const [a, setA] = useState<SalesCallAgent>({ mode: 'script', knowledge: '', autoCall: false, ...initial });
  const set = <K extends keyof SalesCallAgent>(k: K, v: SalesCallAgent[K]) => setA((x) => ({ ...x, [k]: v }));
  const valid = a.name.trim().length > 0 && a.hoursTo > a.hoursFrom;

  return (
    <div className="fx-rise" style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 16, background: '#f6faf7', border: '1px solid var(--line)', marginBottom: 14 }}>
      <strong>{initial.id ? `Edit ${initial.name}` : 'A new calling agent'}</strong>
      <div style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 800, color: colors.muted }}>
        Who dials
        <span className="fx-seg" role="radiogroup" aria-label="Who dials">
          {(
            [
              ['ai', '🤖 The AI dials and talks'],
              ['script', '✍️ A person dials, the AI writes the call'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={a.mode === m} onClick={() => set('mode', m)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <Field label="Name (what they say on the phone)">
          <input value={a.name} onChange={(e) => set('name', e.target.value.slice(0, 40))} className="fx-mini" style={{ width: '100%' }} placeholder="e.g. Sana" />
        </Field>
        <div style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 800, color: colors.muted }}>
          Voice
          <span className="fx-seg" role="radiogroup" aria-label="Voice">
            {(['female', 'male'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={a.voice === v} onClick={() => set('voice', v)}>
                {v === 'female' ? '👩🏻‍💼 Female' : '👨🏻‍💼 Male'}
              </button>
            ))}
          </span>
        </div>
        <Field label="Language">
          <select value={a.language} onChange={(e) => set('language', e.target.value as SalesCallAgent['language'])} className="fx-mini" style={{ width: '100%' }}>
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="What is the call for?">
        <input
          value={a.goal}
          onChange={(e) => set('goal', e.target.value.slice(0, 300))}
          className="fx-mini"
          style={{ width: '100%' }}
          placeholder="e.g. book a 10-minute meeting, or get a WhatsApp number to send prices"
        />
      </Field>
      <Field label="First line (optional — it writes one per business if empty)">
        <input value={a.opener} onChange={(e) => set('opener', e.target.value.slice(0, 400))} className="fx-mini" style={{ width: '100%' }} />
      </Field>
      <Field label="What it knows — prices, packages, delivery, questions people ask (the only facts it may say)">
        <textarea
          value={a.knowledge ?? ''}
          onChange={(e) => set('knowledge', e.target.value.slice(0, 3000))}
          rows={4}
          className="fx-input"
          placeholder={'e.g. Basic plan Rs 5,000 a month, Pro Rs 9,000\nDelivery in Lahore and Islamabad, 2 days\nFree trial: 7 days'}
        />
      </Field>
      <Field label="Points to make (one per line)">
        <textarea
          value={a.points}
          onChange={(e) => set('points', e.target.value.slice(0, 1200))}
          rows={3}
          className="fx-input"
          placeholder={'e.g. We post a reel every day for you\nNo contract — stop any month'}
        />
      </Field>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Calls from">
          <select value={a.hoursFrom} onChange={(e) => set('hoursFrom', Number(e.target.value))} className="fx-mini">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Until">
          <select value={a.hoursTo} onChange={(e) => set('hoursTo', Number(e.target.value))} className="fx-mini">
            {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Most calls a day">
          <input
            inputMode="numeric"
            value={a.dailyCap}
            onChange={(e) => set('dailyCap', Math.max(1, Math.min(200, Number(e.target.value.replace(/\D/g, '')) || 1)))}
            className="fx-mini"
            style={{ width: 80 }}
          />
        </Field>
      </div>
      {a.mode === 'ai' ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" checked={Boolean(a.autoCall)} onChange={(e) => set('autoCall', e.target.checked)} />
          Ring new businesses with a phone number on its own, inside these hours (a missed call is tried once more)
        </label>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="fx-btn small" disabled={busy || !valid} onClick={() => onSave({ ...a, name: a.name.trim() })}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="fx-btn ghost small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {onDelete ? (
          <button type="button" className="fx-btn ghost small" style={{ color: colors.danger, marginLeft: 'auto' }} onClick={onDelete} disabled={busy}>
            Remove
          </button>
        ) : null}
        {a.hoursTo <= a.hoursFrom ? <span style={{ fontSize: 12, color: colors.warn }}>The end hour has to be after the start.</span> : null}
      </div>
    </div>
  );
}

function CallRow({
  lead,
  caller,
  aiBlocked,
  onError,
}: {
  lead: SalesLeadDoc;
  caller: SalesCallAgent | null;
  /** Why the AI cannot ring right now, or null when it can. */
  aiBlocked: string | null;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const script = lead.callScript;
  const last = lead.lastCall ? OUTCOME_LABEL[lead.lastCall.outcome] : null;

  async function write() {
    if (!caller) return;
    setBusy('write');
    try {
      await salesApi.callScript({ leadId: lead.id, agentId: caller.id });
      setOpen(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'The call could not be written.');
    } finally {
      setBusy(null);
    }
  }

  async function ringWithAi() {
    if (!caller) return;
    setBusy('ai');
    try {
      await agentsApi.startCall({ leadId: lead.id, agentId: caller.id });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'The AI could not ring them.');
    } finally {
      setBusy(null);
    }
  }

  async function log(outcome: SalesCallOutcome) {
    setBusy(outcome);
    try {
      await salesApi.leadAction({ leadId: lead.id, action: 'call', outcome });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 180 }}>
          <strong style={{ display: 'block', fontSize: 14 }}>{lead.name}</strong>
          <span className="fx-muted" style={{ fontSize: 12.5 }}>
            {lead.phone}
            {lead.city ? ` · ${lead.city}` : ''}
          </span>
        </span>
        {last ? (
          <span className="fx-pill" style={{ background: `${last.tint}14`, color: last.tint }}>
            {last.label} · {new Date(lead.lastCall!.atMs).toLocaleDateString('en-PK')}
          </span>
        ) : null}
        {script ? (
          <button type="button" className="fx-btn ghost small" onClick={() => setOpen(!open)}>
            {open ? 'Hide the call' : 'Show the call'}
          </button>
        ) : (
          <button type="button" className="fx-btn ghost small" onClick={write} disabled={!caller || busy !== null}>
            {busy === 'write' ? 'Writing…' : '✍️ Write the call'}
          </button>
        )}
        {caller?.mode === 'ai' ? (
          <button
            type="button"
            className="fx-btn small"
            onClick={() => void ringWithAi()}
            disabled={busy !== null || aiBlocked !== null}
            title={aiBlocked ?? `${caller.name} rings ${lead.name} now`}
          >
            {busy === 'ai' ? 'Ringing…' : `🤖 ${caller.name} calls`}
          </button>
        ) : null}
        <a
          href={`tel:${lead.phone!.replace(/[^\d+]/g, '')}`}
          className={caller?.mode === 'ai' ? 'fx-btn ghost small' : 'fx-btn small'}
          aria-label={`Call ${lead.name} yourself`}
        >
          📞 {caller?.mode === 'ai' ? 'Call yourself' : 'Call'}
        </a>
      </div>

      {open && script ? (
        <div className="fx-rise" style={{ display: 'grid', gap: 10, marginTop: 12, padding: 12, borderRadius: 12, background: '#f6faf7', fontSize: 13, lineHeight: 1.55 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800 }}>“{script.opener}”</span>
          <Block title="Say">
            {script.pitch.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </Block>
          <Block title="Ask">
            {script.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </Block>
          <Block title="If they say…">
            {script.objections.map((o) => (
              <li key={o.they}>
                <em>{o.they}</em> → {o.you}
              </li>
            ))}
          </Block>
          <span>
            <strong>Close: </strong>
            {script.close}
          </span>
          <button
            type="button"
            onClick={write}
            disabled={!caller || busy !== null}
            style={{ justifySelf: 'start', border: 'none', background: 'none', color: colors.secondary, fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', padding: 0 }}
          >
            {busy === 'write' ? 'Writing…' : `↻ Write it again${caller ? ` as ${caller.name}` : ''}`}
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }} aria-label="How did the call go?">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => void log(o.key)}
            disabled={busy !== null}
            style={{
              border: `1px solid ${o.tint}33`,
              background: lead.lastCall?.outcome === o.key ? `${o.tint}14` : '#fff',
              color: o.tint,
              borderRadius: 999,
              padding: '5px 11px',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {busy === o.key ? 'Saving…' : o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The number an agent calls from, if one is given to it. */
function numberOf(desk: AgentState | null, agentId: string): string | null {
  return desk?.numbers.find((n) => n.agentId === agentId)?.phone ?? null;
}

/** Why the AI cannot ring for this agent right now, in words; null when it can. */
function aiBlocked(desk: AgentState | null, caller: SalesCallAgent | null): string | null {
  if (!caller || caller.mode !== 'ai') return null;
  if (!desk) return 'Loading…';
  if (!desk.bridge) return 'AI calling is not switched on yet.';
  if (!desk.phoneLine) return 'No phone line is connected yet.';
  if (!numberOf(desk, caller.id)) return `${caller.name} has no phone number yet — Velocity gives it one.`;
  if (!desk.house && !desk.planLive) return 'Choose and pay for an AI calling package first.';
  return null;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <strong style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase', color: colors.muted }}>{title}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{children}</ul>
    </div>
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
