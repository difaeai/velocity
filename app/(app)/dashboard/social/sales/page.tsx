'use client';

/**
 * Manage social → Sales agent.
 *
 * Harvey's loop as one page: tell it what you sell and who to look for; it
 * finds businesses (map + verified web search), reads their sites, and writes
 * one short personal email each. Then either you copy / open each in your own
 * mail app ("find & write only"), or it sends from your own mailbox within a
 * daily cap — asking first for each one, or not, as you chose once.
 *
 * It sends one email per business and no follow-ups, and does not read your
 * inbox: replies arrive where you already read mail, and you mark the lead.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import { salesApi, type SalesLeadDoc, type SalesLeadStatus, type SalesSettingsDoc } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { CallingAgents } from '@/components/social/calling';
import { AgentPackageCard, AiCallLog, WhatsAppChats, WhatsAppLine, useAgentDesk } from '@/components/social/agentsDesk';
import { FX_CSS } from '@/components/social/fx';

type Shelf = 'review' | 'ready' | 'new' | 'sent' | 'done' | 'all';
const SHELVES: { key: Shelf; label: string; states: SalesLeadStatus[] | null }[] = [
  { key: 'review', label: 'To review', states: ['drafted', 'failed'] },
  { key: 'ready', label: 'Ready to send', states: ['approved'] },
  { key: 'new', label: 'Found, not written', states: ['new'] },
  { key: 'sent', label: 'Sent', states: ['sent'] },
  { key: 'done', label: 'Replied & won', states: ['replied', 'won'] },
  { key: 'all', label: 'All', states: null },
];

export default function SalesPage() {
  const { path } = useWorkspace();
  const [settings, setSettings] = useState<SalesSettingsDoc | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [leads, setLeads] = useState<SalesLeadDoc[]>([]);
  const [shelf, setShelf] = useState<Shelf>('review');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const desk = useAgentDesk(path, setError);

  useEffect(() => {
    salesApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setHasPassword(r.hasPassword);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the sales agent.'));
  }, []);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('salesLeads')), orderBy('createdAtMs', 'desc'), limit(300)),
        (snap) => setLeads(snap.docs.map((d) => ({ ...(d.data() as SalesLeadDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );

  // Pakistan's today, read after mount: the clock is not read during render.
  const [today, setToday] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setToday(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)), 0);
    return () => clearTimeout(t);
  }, []);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        SHELVES.map((s) => [s.key, s.states ? leads.filter((l) => s.states!.includes(l.status)).length : leads.length]),
      ) as Record<Shelf, number>,
    [leads],
  );
  const current = SHELVES.find((s) => s.key === shelf)!;
  const shown = current.states ? leads.filter((l) => current.states!.includes(l.status)) : leads;

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (!settings) {
    return error ? <p style={{ color: colors.danger }}>{error}</p> : <p style={{ color: colors.muted }}>Loading…</p>;
  }

  const setUp = Boolean(settings.product && settings.senderCompany && settings.senderName);
  const mailbox = settings.mode === 'mailbox' && Boolean(settings.smtp);
  const sentToday = settings.sentDay === today ? settings.sentCount : 0;

  return (
    <div className="fx" style={{ display: 'grid', gap: 16 }}>
      <style>{FX_CSS}</style>
      <section className="fx-hero fx-rise" style={{ padding: '22px 26px', marginBottom: 0 }}>
        <span className="fx-orb a" />
        <span className="fx-orb b" />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="fx-eyebrow">Find · write · follow up · call</div>
            <h1 style={{ fontSize: 26 }}>Sales agents</h1>
            <p style={{ maxWidth: 680 }}>
              {mailbox
                ? `Finds businesses, writes to each from ${settings.smtp!.from} — ${sentToday} of ${settings.dailyCap} today — follows up twice and drafts your answer to every reply.`
                : 'Finds businesses that could buy from you and writes each one a short, personal email. Connect your mailbox in Settings and it sends and follows up too.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="fx-hero-chip">🏪 {leads.length} businesses</span>
            <span className="fx-hero-chip">🎉 {counts.done} replied &amp; won</span>
            <span className="fx-hero-chip">📞 {settings.callAgents?.length ?? 0} calling agents</span>
          </div>
        </div>
      </section>
      <header style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          {settings.lastStatus ? <p style={{ fontSize: 12.5, color: colors.muted, margin: 0 }}>Last run: {settings.lastStatus}</p> : null}
          {mailbox ? (
            <p style={{ fontSize: 12.5, color: settings.inboxStatus ? colors.danger : colors.muted, margin: '4px 0 0', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {settings.inboxStatus ??
                (settings.inboxCheckedAtMs ? `Inbox read ${new Date(settings.inboxCheckedAtMs).toLocaleString()}.` : 'The inbox is read every 15 minutes.')}
              <button
                type="button"
                style={pill}
                disabled={busy !== null}
                onClick={() =>
                  run('followups', async () => {
                    const res = await salesApi.saveSettings({ followUps: !settings.followUps });
                    setSettings(res.settings);
                    return res.settings.followUps ? 'Follow-ups are on: two, three and seven days after the first email.' : 'Follow-ups are off.';
                  })
                }
              >
                Follow-ups: {settings.followUps ? 'on' : 'off'}
              </button>
            </p>
          ) : null}
        </div>
        {setUp ? (
          <Button variant="ghost" onClick={() => setShowSetup(!showSetup)}>
            {showSetup ? 'Close settings' : 'Settings'}
          </Button>
        ) : null}
      </header>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {!setUp || showSetup ? (
        <Setup
          initial={settings}
          hasPassword={hasPassword}
          busy={busy === 'save'}
          onSave={(patch) =>
            run('save', async () => {
              const res = await salesApi.saveSettings(patch);
              setSettings(res.settings);
              if (patch.smtp?.pass) setHasPassword(true);
              setShowSetup(false);
              return 'Saved.';
            })
          }
        />
      ) : null}

      {setUp ? (
        <FindCard
          settings={settings}
          busy={busy}
          onFind={(kind, city) =>
            run('find', async () => {
              const r = await salesApi.findLeads({ kind, city });
              return `Found ${r.found}, added ${r.added} new, wrote ${r.written} email${r.written === 1 ? '' : 's'}.${r.note ? ` (${r.note})` : ''}`;
            })
          }
          onAdd={(lines, city) =>
            run('add', async () => {
              const r = await salesApi.addLeads({ lines, city });
              return `Added ${r.added} business${r.added === 1 ? '' : 'es'}. Press "Write emails" to draft them.`;
            })
          }
          onWrite={() =>
            run('write', async () => {
              const r = await salesApi.writeEmails({});
              return r.written ? `Wrote ${r.written} email${r.written === 1 ? '' : 's'} — they are in To review.` : 'Nothing new to write for.';
            })
          }
        />
      ) : null}

      {setUp ? (
        <>
          <AgentPackageCard key={`pkg-${desk.state?.plan?.setAtMs ?? 0}`} state={desk.state} />
          <CallingAgents
            settings={settings}
            leads={leads}
            desk={desk.state}
            onSaved={(s, message) => {
              setSettings(s);
              setError(null);
              setNotice(message);
            }}
            onError={setError}
          />
          <AiCallLog calls={desk.calls} />
          <WhatsAppLine
            key={`wa-${desk.state?.whatsapp?.connectedAtMs ?? 0}`}
            state={desk.state}
            agents={settings.callAgents ?? []}
            onSaved={(message) => {
              setError(null);
              setNotice(message);
              void desk.reload();
            }}
            onError={setError}
          />
          <WhatsAppChats threads={desk.threads} onError={setError} />
        </>
      ) : null}

      {setUp ? (
        <>
          <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SHELVES.map((s) => {
              const on = s.key === shelf;
              return (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setShelf(s.key)}
                  style={{
                    border: `1px solid ${on ? colors.primary : colors.border}`,
                    background: on ? `${colors.primary}14` : colors.surface,
                    color: on ? colors.primary : colors.text,
                    fontWeight: 800,
                    fontSize: 12.5,
                    padding: '6px 12px',
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                >
                  {s.label}
                  {counts[s.key] ? <span style={{ marginLeft: 6, color: colors.muted }}>{counts[s.key]}</span> : null}
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <Card>
              <p style={{ margin: 0, color: colors.muted }}>Nothing here yet.</p>
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {shown.map((lead) => (
                <LeadBox key={lead.id} lead={lead} settings={settings} mailbox={mailbox} onError={setError} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Setup({
  initial,
  hasPassword,
  busy,
  onSave,
}: {
  initial: SalesSettingsDoc;
  hasPassword: boolean;
  busy: boolean;
  onSave: (patch: Parameters<typeof salesApi.saveSettings>[0]) => void;
}) {
  const [f, setF] = useState({
    product: initial.product,
    offer: initial.offer,
    kinds: initial.kinds.join(', '),
    city: initial.city,
    senderName: initial.senderName,
    senderCompany: initial.senderCompany,
    senderAddress: initial.senderAddress,
    mode: initial.mode,
    sendMode: initial.sendMode ?? 'approve',
    dailyCap: String(initial.dailyCap),
    host: initial.smtp?.host ?? 'smtp.gmail.com',
    port: String(initial.smtp?.port ?? 465),
    user: initial.smtp?.user ?? '',
    from: initial.smtp?.from ?? '',
    pass: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function save() {
    onSave({
      product: f.product,
      offer: f.offer,
      kinds: f.kinds.split(',').map((k) => k.trim()).filter((k) => k.length >= 2).slice(0, 8),
      city: f.city,
      senderName: f.senderName,
      senderCompany: f.senderCompany,
      senderAddress: f.senderAddress,
      mode: f.mode as 'copy' | 'mailbox',
      sendMode: f.sendMode as 'approve' | 'direct',
      dailyCap: Math.max(1, Math.min(50, Number(f.dailyCap) || 20)),
      ...(f.mode === 'mailbox'
        ? {
            smtp: {
              host: f.host.trim(),
              port: f.port === '587' ? 587 : 465,
              user: f.user.trim(),
              from: (f.from || f.user).trim(),
              ...(f.pass ? { pass: f.pass } : {}),
            },
          }
        : {}),
    });
  }

  return (
    <Card>
      <h2 style={h2}>Set up the sales agent</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="What do you sell?">
          <textarea value={f.product} onChange={set('product')} style={{ ...input, minHeight: 56 }} />
        </Field>
        <Field label="What can you offer a new customer? (optional)">
          <input value={f.offer} onChange={set('offer')} style={input} placeholder="e.g. a free sample reel, 10% off the first order" />
        </Field>
        <div style={grid2}>
          <Field label="Who should it look for? (comma separated)">
            <input value={f.kinds} onChange={set('kinds')} style={input} placeholder="e.g. bakery, restaurant, salon" />
          </Field>
          <Field label="Which city?">
            <input value={f.city} onChange={set('city')} style={input} placeholder="e.g. Lahore, Pakistan" />
          </Field>
        </div>
        <div style={grid2}>
          <Field label="Your name (signs the email)">
            <input value={f.senderName} onChange={set('senderName')} style={input} />
          </Field>
          <Field label="Company">
            <input value={f.senderCompany} onChange={set('senderCompany')} style={input} />
          </Field>
        </div>
        <Field label="Postal address (every cold email must carry one)">
          <input value={f.senderAddress} onChange={set('senderAddress')} style={input} />
        </Field>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={labelText}>How should emails go out?</div>
          <div style={grid2}>
            <Choice on={f.mode === 'copy'} onClick={() => setF({ ...f, mode: 'copy' })} title="Find & write only">
              The agent writes each email; you copy it or open it in your own mail app and press send. Nothing to connect.
            </Choice>
            <Choice on={f.mode === 'mailbox'} onClick={() => setF({ ...f, mode: 'mailbox' })} title="Send from my mailbox">
              It sends from your own Gmail / Workspace address, a few at a time, never more than your daily limit.
            </Choice>
          </div>
        </div>

        {f.mode === 'mailbox' ? (
          <div style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 12, background: colors.bg }}>
            <p style={{ margin: 0, fontSize: 12.5, color: colors.muted, lineHeight: 1.55 }}>
              Gmail or Google Workspace: turn on 2-step verification, then create an <strong>app password</strong> at
              myaccount.google.com/apppasswords and paste it below — not your normal password. A separate address (e.g.
              hello@ a second domain) keeps your main inbox safe.
            </p>
            <div style={grid2}>
              <Field label="Mail server">
                <input value={f.host} onChange={set('host')} style={input} />
              </Field>
              <Field label="Port">
                <select value={f.port} onChange={set('port')} style={input}>
                  <option value="465">465 (SSL)</option>
                  <option value="587">587 (STARTTLS)</option>
                </select>
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Mailbox sign-in (email)">
                <input value={f.user} onChange={set('user')} style={input} autoComplete="off" />
              </Field>
              <Field label={hasPassword ? 'App password (saved — leave empty to keep)' : 'App password'}>
                <input value={f.pass} onChange={set('pass')} style={input} type="password" autoComplete="new-password" />
              </Field>
            </div>
            <div style={grid2}>
              <Field label="Send from (if different)">
                <input value={f.from} onChange={set('from')} style={input} placeholder={f.user} />
              </Field>
              <Field label="Most emails a day (1–50)">
                <input value={f.dailyCap} onChange={set('dailyCap')} style={input} inputMode="numeric" />
              </Field>
            </div>
            <div style={labelText}>Asked once: should each email wait for you?</div>
            <div style={grid2}>
              <Choice on={f.sendMode === 'approve'} onClick={() => setF({ ...f, sendMode: 'approve' })} title="Ask me before each email">
                Every email waits in “To review” until you approve it.
              </Choice>
              <Choice on={f.sendMode === 'direct'} onClick={() => setF({ ...f, sendMode: 'direct' })} title="Send directly">
                Emails that pass every check go out on their own, within the daily limit.
              </Choice>
            </div>
          </div>
        ) : null}

        <div>
          <Button onClick={save} disabled={busy || !f.product.trim() || !f.senderName.trim() || !f.senderCompany.trim()}>
            {busy ? (f.mode === 'mailbox' ? 'Checking the mailbox…' : 'Saving…') : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FindCard({
  settings,
  busy,
  onFind,
  onAdd,
  onWrite,
}: {
  settings: SalesSettingsDoc;
  busy: string | null;
  onFind: (kind: string, city: string) => void;
  onAdd: (lines: string, city: string) => void;
  onWrite: () => void;
}) {
  const [kind, setKind] = useState(settings.kinds[0] ?? '');
  const [city, setCity] = useState(settings.city);
  const [lines, setLines] = useState('');
  return (
    <Card>
      <h2 style={h2}>Find businesses</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Kind of business">
          <input value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...input, width: 200 }} placeholder="e.g. bakery" />
        </Field>
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} style={{ ...input, width: 200 }} />
        </Field>
        <Button onClick={() => onFind(kind, city)} disabled={busy !== null || kind.trim().length < 2 || city.trim().length < 2}>
          {busy === 'find' ? 'Searching… (about a minute)' : 'Find & write emails'}
        </Button>
        <Button variant="ghost" onClick={onWrite} disabled={busy !== null}>
          {busy === 'write' ? 'Writing…' : 'Write emails for new finds'}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: colors.muted, margin: '8px 0 0', lineHeight: 1.5 }}>
        It searches the map and the web, keeps only businesses whose website actually answers, and reads each site for an
        email address and something specific to say. Every day it also does this on its own for the kinds in Settings.
      </p>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, color: colors.secondary }}>
          Add your own list
        </summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <textarea
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            style={{ ...input, minHeight: 90, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
            placeholder={'One per line: name, email, website\nBake House, orders@bakehouse.pk, bakehouse.pk'}
          />
          <div>
            <Button variant="secondary" onClick={() => onAdd(lines, city)} disabled={busy !== null || !lines.trim()}>
              {busy === 'add' ? 'Adding…' : 'Add them'}
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}

function LeadBox({
  lead,
  settings,
  mailbox,
  onError,
}: {
  lead: SalesLeadDoc;
  settings: SalesSettingsDoc;
  mailbox: boolean;
  onError: (m: string) => void;
}) {
  const [subject, setSubject] = useState(lead.draft?.subject ?? '');
  const [body, setBody] = useState(lead.draft?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // A rewrite from the agent replaces what is in the boxes; a local edit survives other updates.
  const [server, setServer] = useState(lead.draft);
  if (lead.draft !== server && (lead.draft?.subject !== server?.subject || lead.draft?.body !== server?.body)) {
    setServer(lead.draft);
    setSubject(lead.draft?.subject ?? '');
    setBody(lead.draft?.body ?? '');
  }

  const edited = lead.draft && (subject !== lead.draft.subject || body !== lead.draft.body);
  const full = `${body.trim()}\n\n${settings.senderName}, ${settings.senderCompany}\n${settings.senderAddress}\nNot interested? Reply "no" and I won’t write again.`;

  async function act(action: Parameters<typeof salesApi.leadAction>[0]['action']) {
    setBusy(true);
    try {
      if (edited) await salesApi.leadAction({ leadId: lead.id, action: 'edit', subject, body });
      await salesApi.leadAction({ leadId: lead.id, action });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.surface }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14.5 }}>{lead.name}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: colors.muted, textTransform: 'uppercase' }}>
          {lead.status}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: colors.muted, display: 'grid', gap: 2 }}>
        {lead.website ? (
          <a href={lead.website} target="_blank" rel="noreferrer" style={{ color: colors.secondary }}>
            {lead.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
          </a>
        ) : null}
        <span>
          {lead.email ?? 'no email found'}
          {lead.phone ? ` · ${lead.phone}` : ''}
        </span>
      </div>
      {lead.signals.length ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {lead.signals.map((s) => (
            <span key={s} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: colors.bg, color: colors.muted }}>
              {s}
            </span>
          ))}
        </div>
      ) : null}

      {lead.draft ? (
        <>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...input, fontWeight: 700 }} aria-label="Subject" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...input, minHeight: 130, lineHeight: 1.5 }} aria-label="Email" />
          {lead.problems.length ? (
            <span style={{ fontSize: 12, color: colors.warn }}>Check before sending: {lead.problems.join(', ')}</span>
          ) : null}
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: colors.muted }}>
          {lead.status === 'new' ? (mailbox && !lead.email ? 'No email address found — nothing to send to.' : 'No email written yet.') : ''}
        </span>
      )}
      {lead.error ? <span style={{ fontSize: 12, color: colors.danger }}>{lead.error}</span> : null}
      {lead.status === 'sent' && lead.followUps ? (
        <span style={{ fontSize: 12, color: colors.muted }}>Followed up {lead.followUps} of 2 times — no answer yet.</span>
      ) : null}
      {lead.reply ? <ReplyBox lead={lead} mailbox={mailbox} onError={onError} /> : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {lead.draft && ['drafted', 'failed', 'approved'].includes(lead.status) ? (
          mailbox ? (
            <>
              {lead.status !== 'approved' ? (
                <Button onClick={() => act('approve')} disabled={busy || !lead.email}>
                  Approve
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => act('send')} disabled={busy || !lead.email}>
                Send now
              </Button>
            </>
          ) : (
            <>
              {lead.email ? (
                <a
                  href={`mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(full)}`}
                  style={pill}
                >
                  Open in my email
                </a>
              ) : null}
              <button
                type="button"
                style={pill}
                onClick={() => {
                  void navigator.clipboard.writeText(`${subject}\n\n${full}`).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" style={pill} onClick={() => act('sent')} disabled={busy}>
                I sent it
              </button>
            </>
          )
        ) : null}
        {['sent'].includes(lead.status) ? (
          <>
            <button type="button" style={pill} onClick={() => act('replied')} disabled={busy}>
              They replied
            </button>
            <button type="button" style={pill} onClick={() => act('won')} disabled={busy}>
              Won
            </button>
            <button type="button" style={pill} onClick={() => act('optout')} disabled={busy}>
              They said no
            </button>
          </>
        ) : null}
        {lead.status === 'replied' ? (
          <>
            <button type="button" style={pill} onClick={() => act('won')} disabled={busy}>
              Won
            </button>
            <button type="button" style={pill} onClick={() => act('lost')} disabled={busy}>
              Lost
            </button>
          </>
        ) : null}
        {['new', 'drafted', 'failed', 'approved'].includes(lead.status) ? (
          <button type="button" style={{ ...pill, color: colors.muted }} onClick={() => act('skip')} disabled={busy}>
            Skip
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * They wrote back: what they said, and the answer the agent drafted — sent
 * only when you press Send, because it speaks to a real person about a real deal.
 */
function ReplyBox({ lead, mailbox, onError }: { lead: SalesLeadDoc; mailbox: boolean; onError: (m: string) => void }) {
  const [subject, setSubject] = useState(lead.replyDraft?.subject ?? '');
  const [body, setBody] = useState(lead.replyDraft?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const reply = lead.reply!;
  const edited = lead.replyDraft && (subject !== lead.replyDraft.subject || body !== lead.replyDraft.body);

  async function send() {
    setBusy(true);
    try {
      if (edited) await salesApi.leadAction({ leadId: lead.id, action: 'editReply', subject, body });
      await salesApi.leadAction({ leadId: lead.id, action: 'sendReply' });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, background: `${colors.success}0d`, border: `1px solid ${colors.success}33` }}>
      <span style={{ fontSize: 11.5, fontWeight: 900, color: colors.success, textTransform: 'uppercase' }}>
        They wrote back · {new Date(reply.atMs).toLocaleString()} · {reply.intent.replace('_', ' ')}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{reply.text}</span>
      {lead.replyDraft ? (
        <>
          <span style={{ fontSize: 11.5, fontWeight: 900, color: colors.muted, textTransform: 'uppercase' }}>
            {lead.answeredAtMs ? `Answered ${new Date(lead.answeredAtMs).toLocaleString()}` : 'Your answer — check it, then send'}
          </span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...input, fontWeight: 700 }} aria-label="Answer subject" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...input, minHeight: 110, lineHeight: 1.5 }} aria-label="Answer" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {mailbox ? (
              <Button onClick={send} disabled={busy || body.trim().length < 10}>
                {busy ? 'Sending…' : lead.answeredAtMs ? 'Send again' : 'Send the answer'}
              </Button>
            ) : null}
            <button
              type="button"
              style={pill}
              onClick={() => void navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => setCopied(true))}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Choice({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        textAlign: 'left',
        padding: 12,
        borderRadius: 12,
        border: `${on ? 2 : 1}px solid ${on ? colors.primary : colors.border}`,
        background: colors.surface,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: colors.text,
      }}
    >
      <strong style={{ display: 'block', fontSize: 13.5, marginBottom: 3 }}>{title}</strong>
      <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.45 }}>{children}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={labelText}>{label}</span>
      {children}
    </label>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const labelText: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, color: colors.muted };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 };
const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  background: colors.surface,
  color: colors.text,
};
const pill: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.primary,
  borderRadius: 9,
  padding: '7px 11px',
  fontSize: 12.5,
  fontWeight: 800,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
