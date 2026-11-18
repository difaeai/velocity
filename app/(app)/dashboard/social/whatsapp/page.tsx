/**
 * WhatsApp sales — Vexa answering leads on the client's own number.
 *
 * The ads and the posts bring people to the door; this is the screen where they
 * are actually sold to. It shows one thing per row — who wrote in, what they
 * want, where it has got to — and the whole conversation underneath, because
 * the owner's question is never "what is my conversion rate", it is "what did
 * you say to this person".
 *
 * Three things on this page are deliberately blunt rather than friendly:
 *
 *  • **The number.** Connecting it is a phone-number id and a token from the
 *    client's own WhatsApp Business account, and the page says plainly that a
 *    Cloud API number is a business platform number.
 *  • **The ration.** WhatsApp caps how many conversations a business may start
 *    in a day, and starting too many on a list nobody asked to be on is how a
 *    number gets restricted. The count left today is shown next to the number,
 *    and the sheet upload cannot be submitted without the client saying those
 *    people asked to hear from them.
 *  • **The handover.** Anything that is a complaint, a refund or a request for
 *    a person is Vexa's to stop and the client's to answer, and those rows are
 *    at the top.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import { closerApi, type CloserState, type SalesChatDoc, type SalesChatStage } from '@/lib/api';
import { Button, Card } from '@/components/ui';

const STAGE_LABEL: Record<SalesChatStage, string> = {
  new: 'New',
  talking: 'Talking',
  qualified: 'Knows what they want',
  pitched: 'Price given',
  won: 'Won',
  lost: 'Lost',
  needs_you: 'Needs you',
  queued: 'Waiting to be messaged',
  stopped: 'Stopped',
};

const STAGE_TONE: Record<SalesChatStage, string> = {
  new: colors.muted,
  talking: '#7dd3fc',
  qualified: '#ffd166',
  pitched: '#ffd166',
  won: '#28c76f',
  lost: colors.muted,
  needs_you: '#ff6b6b',
  queued: colors.muted,
  stopped: colors.muted,
};

/** Needs you first, then the live funnel, then everything settled. */
const ORDER: SalesChatStage[] = ['needs_you', 'pitched', 'qualified', 'talking', 'new', 'queued', 'won', 'lost', 'stopped'];

export default function WhatsAppSalesPage() {
  const { path } = useWorkspace();
  const [state, setState] = useState<CloserState | null>(null);
  const [chats, setChats] = useState<SalesChatDoc[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    () =>
      closerApi
        .state({})
        .then(setState)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read the WhatsApp settings.')),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  // The 24-hour service window is read against a clock, and a clock read during
  // render is not a pure render. Taken once after mount, like the other desk
  // pages do it, and again whenever a conversation moves.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [chats]);

  // Watched rather than fetched: a lead replies while the page is open, and the
  // thread has to fill in without anybody reloading.
  useEffect(() => {
    const q = query(collection(db, path('salesChats')), orderBy('updatedAtMs', 'desc'), limit(100));
    return onSnapshot(
      q,
      (snap) => setChats(snap.docs.map((d) => d.data() as SalesChatDoc)),
      (e) => setError(e.message),
    );
  }, [path]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);
      setNote(null);
      try {
        await fn();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const sorted = useMemo(
    () => [...chats].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage) || b.updatedAtMs - a.updatedAtMs),
    [chats],
  );

  const connected = state?.config.connected ?? false;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 980 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>WhatsApp &amp; Instagram sales</h1>
        <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 0', lineHeight: 1.55, maxWidth: 680 }}>
          Vexa answers the people who write to your WhatsApp or send a DM on Instagram, in their own language,
          from your own number and your own account — and takes them from &ldquo;kitna hai?&rdquo; to a sale. Short
          messages, because nobody reads long ones. Anything that needs a person stops and waits for you.
        </p>
      </header>

      {error ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: '#ff6b6b' }}>{error}</p>
        </Card>
      ) : null}
      {note ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: '#28c76f' }}>{note}</p>
        </Card>
      ) : null}

      <Connect state={state} busy={busy} run={run} onNote={setNote} />

      {connected ? (
        <>
          <Funnel state={state} />
          <Sheet busy={busy} run={run} onNote={setNote} perDay={state?.config.dailyCap ?? 0} templateReady={Boolean(state?.config.templateName)} />
        </>
      ) : null}

      {/* Instagram needs no number, so the inbox is shown as soon as there is
          anything in it — a desk that only sells on Instagram is still a desk. */}
      {connected || sorted.length ? (
        <>
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ ...h2, flex: 1 }}>Conversations</h2>
              <Button
                variant="secondary"
                onClick={() =>
                  run('ig', async () => {
                    const out = await closerApi.syncInstagram({});
                    setNote(
                      out.threads
                        ? `${out.threads} Instagram chat${out.threads === 1 ? '' : 's'} read, ${out.answered} answered.`
                        : 'Nothing new on Instagram, or no Instagram account is connected.',
                    );
                  })
                }
                disabled={busy === 'ig'}
              >
                {busy === 'ig' ? 'Reading Instagram…' : 'Check Instagram now'}
              </Button>
            </div>
            {!sorted.length ? (
              <Empty>
                Nobody has written yet. When somebody messages your number or sends a DM on Instagram, the
                conversation appears here as it happens.
              </Empty>
            ) : (
              sorted.map((chat) => (
                <ChatRow
                  key={chat.waId}
                  chat={chat}
                  open={open === chat.waId}
                  onToggle={() => setOpen(open === chat.waId ? null : chat.waId)}
                  busy={busy}
                  run={run}
                  nowMs={nowMs}
                />
              ))
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** The number itself, and the two sentences a client has to read before connecting one. */
function Connect({
  state,
  busy,
  run,
  onNote,
}: {
  state: CloserState | null;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onNote: (s: string) => void;
}) {
  const cfg = state?.config;
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [token, setToken] = useState('');
  const [templateName, setTemplateName] = useState('');

  if (cfg?.connected) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Label>Your WhatsApp</Label>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>{cfg.displayNumber ?? cfg.phoneNumberId}</div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
              {state?.leftToday ?? 0} of {cfg.dailyCap} new conversations left today · replies are never capped ·
              {cfg.templateName ? ` template "${cfg.templateName}"` : ' no template yet, so Vexa cannot start a conversation'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              onClick={() =>
                run('mode', async () => {
                  const next = cfg.sendMode === 'auto' ? 'approve' : 'auto';
                  await closerApi.settings({ sendMode: next });
                  onNote(next === 'auto' ? 'Vexa now replies by itself.' : 'Vexa will write the reply and wait for you to send it.');
                })
              }
              disabled={busy === 'mode'}
            >
              {cfg.sendMode === 'auto' ? 'Vexa replies by itself' : 'Vexa waits for you'}
            </Button>
            <Button variant="danger" onClick={() => run('off', () => closerApi.disconnect({}))} disabled={busy === 'off'}>
              Disconnect
            </Button>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="New conversations a day">
            <input
              type="number"
              min={0}
              max={1000}
              defaultValue={cfg.dailyCap}
              onBlur={(e) => run('cap', () => closerApi.settings({ dailyCap: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) }))}
              style={input}
            />
          </Field>
          <Field label="Template Vexa opens with">
            <input
              defaultValue={cfg.templateName ?? ''}
              placeholder="the approved template's name"
              onBlur={(e) => run('tpl', () => closerApi.settings({ templateName: e.target.value.trim() || null }))}
              style={input}
            />
          </Field>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 style={h2}>Connect your WhatsApp number</h2>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 12px', lineHeight: 1.55 }}>
        From your WhatsApp Business account: the <strong>phone number ID</strong> and an <strong>access token</strong>.
        Worth knowing before you do it: a number on the WhatsApp Cloud API is a business platform number, so whether
        you can keep using it in the WhatsApp app at the same time depends on Meta&rsquo;s coexistence being available
        for your account. Either way you can read and take over every conversation from this page.
      </p>
      {state && !state.vaultReady ? (
        <Empty>This Vexa cannot store tokens safely yet (SOCIAL_TOKEN_KEY is missing), so nothing can be connected.</Empty>
      ) : null}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Field label="Phone number ID">
          <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="1234567890" style={input} />
        </Field>
        <Field label="Access token">
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" type="password" style={input} />
        </Field>
        <Field label="Template name (optional)">
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="first_hello" style={input} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          onClick={() =>
            run('connect', async () => {
              const out = await closerApi.connect({
                phoneNumberId: phoneNumberId.trim(),
                token: token.trim(),
                ...(templateName.trim() ? { templateName: templateName.trim() } : {}),
              });
              setToken('');
              onNote(`Connected ${out.displayNumber ?? 'your number'}. Vexa answers the next person who writes to it.`);
            })
          }
          disabled={busy === 'connect' || !phoneNumberId.trim() || token.trim().length < 40}
        >
          {busy === 'connect' ? 'Checking it with Meta…' : 'Connect'}
        </Button>
      </div>
    </Card>
  );
}

/** Where the money is, by stage. */
function Funnel({ state }: { state: CloserState | null }) {
  if (!state) return null;
  const rows = ORDER.filter((s) => (state.byStage[s] ?? 0) > 0);
  if (!rows.length) return null;
  return (
    <Card>
      <h2 style={h2}>The funnel</h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 10 }}>
        {rows.map((s) => (
          <div key={s} style={{ border: `1px solid ${colors.border}`, borderRadius: 9, padding: '9px 11px' }}>
            <Label>{STAGE_LABEL[s]}</Label>
            <div style={{ fontSize: 20, fontWeight: 900, color: STAGE_TONE[s], marginTop: 2 }}>{state.byStage[s]}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A list of numbers to pitch, and the one tick that has to be honest. */
function Sheet({
  busy,
  run,
  onNote,
  perDay,
  templateReady,
}: {
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onNote: (s: string) => void;
  perDay: number;
  templateReady: boolean;
}) {
  const [rows, setRows] = useState('');
  const [consent, setConsent] = useState(false);

  return (
    <Card>
      <h2 style={h2}>Pitch a list</h2>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 10px', lineHeight: 1.55 }}>
        Paste your WhatsApp numbers — one per line, or a CSV with a name and a note. Vexa opens each one with your
        approved template, {perDay} a day at most, never at night, and then talks to whoever replies.{' '}
        {templateReady ? '' : 'You have no template name saved yet, so nothing will go out until you add one above. '}
        WhatsApp restricts numbers that message people who did not ask, and the number at risk is yours.
      </p>
      <textarea
        value={rows}
        onChange={(e) => setRows(e.target.value)}
        placeholder={'Ali, 0317 581 2623, asked about 5 marla\n0300 1234567'}
        rows={5}
        style={{ ...input, width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, margin: '10px 0', lineHeight: 1.5 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>These people gave me their number and asked to hear from my business.</span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          onClick={() =>
            run('sheet', async () => {
              const out = await closerApi.uploadSheet({ rows, consent: true });
              setRows('');
              setConsent(false);
              onNote(`${out.added} numbers queued${out.skipped ? `, ${out.skipped} already known` : ''}. Vexa opens ${out.perDay} a day.`);
            })
          }
          disabled={busy === 'sheet' || !consent || rows.trim().length < 6}
        >
          {busy === 'sheet' ? 'Reading the list…' : 'Queue them'}
        </Button>
        <Button variant="secondary" onClick={() => run('now', async () => onNote((await closerApi.runNow({})).status))} disabled={busy === 'now'}>
          {busy === 'now' ? 'Working…' : 'Send what is due now'}
        </Button>
      </div>
    </Card>
  );
}

/** One lead: the summary always, the whole conversation when it is opened. */
function ChatRow({
  chat,
  open,
  onToggle,
  busy,
  run,
  nowMs,
}: {
  chat: SalesChatDoc;
  open: boolean;
  onToggle: () => void;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  /** Read after mount, never during render. 0 until then. */
  nowMs: number;
}) {
  const [text, setText] = useState('');
  const canWrite = chat.lastInboundAtMs !== null && nowMs > 0 && nowMs - chat.lastInboundAtMs < 24 * 3600_000 && !chat.blocked;

  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, padding: '10px 0' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 900, color: STAGE_TONE[chat.stage], minWidth: 120, textTransform: 'uppercase' }}>
          {STAGE_LABEL[chat.stage]}
        </span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {/* An Instagram lead has no phone number — only a handle and an app-scoped id. */}
          {chat.name || (chat.source === 'instagram' ? 'Instagram lead' : `+${chat.waId}`)}
        </span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: colors.muted }}>
          {chat.summary || chat.messages.at(-1)?.text || chat.note || '—'}
        </span>
        <span style={{ fontSize: 11.5, color: colors.muted }}>{new Date(chat.updatedAtMs).toLocaleString()}</span>
      </div>

      {open ? (
        <div style={{ marginTop: 10, paddingLeft: 4 }}>
          {chat.blocked ? (
            <p style={{ fontSize: 12.5, color: '#ff6b6b', margin: '0 0 8px' }}>
              {chat.blockedReason ?? 'This lead is not messaged any more.'}
            </p>
          ) : null}
          {chat.nextStep ? (
            <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 8px' }}>Next: {chat.nextStep}</p>
          ) : null}

          <div style={{ display: 'grid', gap: 6, margin: '8px 0' }}>
            {chat.messages.map((m, i) => (
              <div
                key={`${m.atMs}-${i}`}
                style={{
                  justifySelf: m.from === 'us' ? 'end' : 'start',
                  maxWidth: '78%',
                  padding: '7px 10px',
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.45,
                  border: `1px solid ${colors.border}`,
                  background: m.from === 'us' ? 'rgba(204,255,0,0.08)' : 'transparent',
                  opacity: m.draft ? 0.7 : 1,
                }}
              >
                {m.text}
                {m.draft ? <span style={{ fontSize: 10.5, color: colors.muted }}> · waiting for you to send</span> : null}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={canWrite ? 'Write to them yourself…' : 'WhatsApp only allows a free message within 24 hours of theirs'}
              disabled={!canWrite}
              style={{ ...input, flex: 1, minWidth: 220 }}
            />
            <Button
              onClick={() =>
                run(`send-${chat.waId}`, async () => {
                  await closerApi.send({ waId: chat.waId, text });
                  setText('');
                })
              }
              disabled={!canWrite || !text.trim() || busy === `send-${chat.waId}`}
            >
              Send
            </Button>
            <Button
              variant="secondary"
              onClick={() => run(`act-${chat.waId}`, () => closerApi.chatAction({ waId: chat.waId, action: chat.handover ? 'give-back' : 'take-over' }))}
              disabled={busy === `act-${chat.waId}`}
            >
              {chat.handover ? 'Give it back to Vexa' : 'I will handle this one'}
            </Button>
            <Button variant="secondary" onClick={() => run(`won-${chat.waId}`, () => closerApi.chatAction({ waId: chat.waId, action: 'won' }))} disabled={busy === `won-${chat.waId}`}>
              Won
            </Button>
            <Button variant="ghost" onClick={() => run(`lost-${chat.waId}`, () => closerApi.chatAction({ waId: chat.waId, action: 'lost' }))} disabled={busy === `lost-${chat.waId}`}>
              Lost
            </Button>
            <Button variant="danger" onClick={() => run(`block-${chat.waId}`, () => closerApi.chatAction({ waId: chat.waId, action: 'block' }))} disabled={busy === `block-${chat.waId}`}>
              Never message
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>{String(children).toUpperCase()}</div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 13, color: colors.muted, margin: '8px 0 0', lineHeight: 1.55 }}>{children}</p>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <Label>{label}</Label>
    <div style={{ marginTop: 4 }}>{children}</div>
  </div>
);

const input: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  color: colors.text,
  fontSize: 13,
  padding: '8px 10px',
  width: '100%',
};

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0 };
