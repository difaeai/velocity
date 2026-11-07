'use client';

/**
 * Manage social → Email agent: the connected Gmail, managed.
 *
 * Two jobs on one mailbox (connected once, on the Sales page):
 * - The inbox. Turned on, it reads every email a person sends — never
 *   newsletters, no-reply or automated mail — says what each one wants, and
 *   drafts the answer from what you told it it may say. Nothing goes until you
 *   press Send: it speaks for the business to a real customer.
 * - Every customer. Say what to tell them; it writes each customer on the list
 *   their own email — their name, your note about them, what they last wrote —
 *   and sends within the daily limit, asking first or not as you chose once.
 *
 * The list fills itself from the inbox, and takes a pasted one too.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { useDraft } from '@/lib/draft';
import { colors } from '@/lib/config';
import { mailApi, salesApi, type MailCustomerDoc, type MailCustomerStatus, type MailInboxDoc, type SalesSettingsDoc } from '@/lib/api';
import { Button, Card, glass } from '@/components/ui';
import { FX_CSS } from '@/components/social/fx';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/states';

const INBOX_TABS: { key: MailInboxDoc['status']; label: string }[] = [
  { key: 'open', label: 'To answer' },
  { key: 'answered', label: 'Answered' },
  { key: 'done', label: 'Needs nothing' },
];

type Shelf = 'review' | 'ready' | 'sent' | 'all';
const SHELVES: { key: Shelf; label: string; states: MailCustomerStatus[] | null }[] = [
  { key: 'review', label: 'To review', states: ['drafted', 'failed'] },
  { key: 'ready', label: 'Ready to send', states: ['approved'] },
  { key: 'sent', label: 'Sent', states: ['sent'] },
  { key: 'all', label: 'All customers', states: null },
];

const KIND_LABEL: Record<MailInboxDoc['kind'], string> = {
  question: '❓ Question',
  order: '🛒 Order',
  complaint: '⚠️ Complaint',
  thanks: '🙏 Thanks',
  sales_pitch: '📢 Selling to you',
  unsubscribe: '🚫 Asked to stop',
  other: '✉️ Other',
};

export default function EmailAgentPage() {
  const { path } = useWorkspace();
  const [settings, setSettings] = useState<SalesSettingsDoc | null>(null);
  const [inbox, setInbox] = useState<MailInboxDoc[]>([]);
  const [customers, setCustomers] = useState<MailCustomerDoc[]>([]);
  const [tab, setTab] = useState<MailInboxDoc['status']>('open');
  const [shelf, setShelf] = useState<Shelf>('review');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [brief, setBrief, clearBrief] = useDraft('email.brief');

  useEffect(() => {
    salesApi
      .getSettings({})
      .then((r) => setSettings(r.settings))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the email agent.'));
  }, []);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('mailInbox')), orderBy('atMs', 'desc'), limit(200)),
        (snap) => setInbox(snap.docs.map((d) => ({ ...(d.data() as MailInboxDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('mailCustomers')), orderBy('createdAtMs', 'desc'), limit(1000)),
        (snap) => setCustomers(snap.docs.map((d) => ({ ...(d.data() as MailCustomerDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );

  // A sentence handed over by the brain as ?brief= becomes what to tell every customer.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const handed = params.get('brief');
      if (!handed) return;
      setBrief(handed.slice(0, 2000));
      params.delete('brief');
      history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }, 0);
    return () => clearTimeout(t);
  }, [setBrief]);

  // Pakistan's today, read after mount: the clock is not read during render.
  const [today, setToday] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setToday(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)), 0);
    return () => clearTimeout(t);
  }, []);

  const inboxCounts = useMemo(
    () => Object.fromEntries(INBOX_TABS.map((t) => [t.key, inbox.filter((m) => m.status === t.key).length])) as Record<MailInboxDoc['status'], number>,
    [inbox],
  );
  const shelfCounts = useMemo(
    () =>
      Object.fromEntries(
        SHELVES.map((s) => [s.key, s.states ? customers.filter((c) => s.states!.includes(c.status)).length : customers.length]),
      ) as Record<Shelf, number>,
    [customers],
  );

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

  async function save(patch: Parameters<typeof salesApi.saveSettings>[0]) {
    const res = await salesApi.saveSettings(patch);
    setSettings(res.settings);
    return res.settings;
  }

  if (!settings) {
    return error ? <ErrorState error={error} onRetry={() => window.location.reload()} /> : <SkeletonRows rows={5} />;
  }

  const mailbox = settings.mode === 'mailbox' && Boolean(settings.smtp);
  const setUp = Boolean(settings.product && settings.senderCompany && settings.senderName);
  const sentToday = settings.sentDay === today ? settings.sentCount : 0;
  const campaign = settings.campaign;
  const written = campaign ? customers.filter((c) => c.campaignAtMs === campaign.atMs).length : 0;
  const reachable = customers.filter((c) => c.status !== 'unsubscribed').length;
  const shelfNow = SHELVES.find((s) => s.key === shelf)!;
  const shown = shelfNow.states ? customers.filter((c) => shelfNow.states!.includes(c.status)) : customers;

  return (
    <div className="fx" style={{ display: 'grid', gap: 16 }}>
      <style>{FX_CSS}</style>
      <section className="fx-hero fx-rise" style={{ padding: '22px 26px', marginBottom: 0 }}>
        <span className="fx-orb a" />
        <span className="fx-orb b" />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="fx-eyebrow">Gmail · inbox · every customer</div>
            <h1 style={{ fontSize: 26 }}>Email agent</h1>
            <p style={{ maxWidth: 680 }}>
              {mailbox
                ? `Works in ${settings.smtp!.from}: answers what customers write, and writes each customer their own email — ${sentToday} of ${settings.dailyCap} sent today.`
                : 'Answers what customers write and writes each customer their own email. Connect your Gmail on the Sales page and it reads and sends too.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="fx-hero-chip">📥 {inboxCounts.open} to answer</span>
            <span className="fx-hero-chip">👥 {customers.length} customers</span>
          </div>
        </div>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {!setUp || !mailbox ? (
        <Card>
          <h2 style={h2}>{setUp ? 'Connect your Gmail' : 'Set up the sales agent first'}</h2>
          <p style={{ fontSize: 13.5, color: colors.muted, margin: '0 0 10px', lineHeight: 1.55 }}>
            {setUp
              ? 'The email agent uses the mailbox the sales agent sends from. On the Sales page open Settings, choose "Send from my mailbox" and add a Gmail app password. Until then it still writes your customer emails for you to copy.'
              : 'Say what you sell and who is writing on the Sales page — the email agent writes in that name.'}
          </p>
          <Link href="/dashboard/social/sales" style={{ ...pill, display: 'inline-block', textDecoration: 'none' }}>
            Open the Sales page
          </Link>
        </Card>
      ) : null}

      {mailbox ? (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ ...h2, margin: 0, flex: 1 }}>📥 Inbox</h2>
            {settings.inboxAgent ? (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() =>
                  run('check', async () => {
                    const r = await mailApi.inboxAction({ action: 'check' });
                    return r.mail ? `${r.mail} new email${r.mail === 1 ? '' : 's'} — answers drafted below.` : 'Nothing new from a person.';
                  })
                }
              >
                {busy === 'check' ? 'Reading…' : 'Check now'}
              </Button>
            ) : null}
            <button
              type="button"
              style={pill}
              disabled={busy !== null}
              onClick={() =>
                run('switch', async () =>
                  (await save({ inboxAgent: !settings.inboxAgent })).inboxAgent
                    ? 'The inbox agent is on. It reads new email every 15 minutes — press Check now to start.'
                    : 'The inbox agent is off. It no longer opens anything but replies to your sales emails.',
                )
              }
            >
              Inbox agent: {settings.inboxAgent ? 'on' : 'off'}
            </button>
          </div>
          <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 12px', lineHeight: 1.55 }}>
            {settings.inboxAgent
              ? 'It opens only email a person wrote — never newsletters, no-reply or automated mail — says what each wants and drafts an answer. Nothing is sent until you press Send. Whoever writes joins your customer list; whoever asks to stop never gets an email again.'
              : 'Turn it on and it reads every email a person sends you, and drafts the answer. Off, it opens only the replies to your sales emails.'}
          </p>

          {settings.inboxAgent ? (
            <>
              <label style={{ display: 'grid', gap: 5, marginBottom: 12 }}>
                <span style={labelText}>What it may tell customers — prices, timings, delivery, returns. It says nothing else as fact.</span>
                <textarea
                  value={knowledge ?? settings.mailKnowledge}
                  onChange={(e) => setKnowledge(e.target.value)}
                  style={{ ...input, minHeight: 90, lineHeight: 1.5 }}
                  maxLength={4000}
                  placeholder="e.g. Open 10am–10pm every day. Delivery in Lahore Rs 200, free over Rs 3,000. Returns within 7 days with the receipt."
                />
              </label>
              {knowledge !== null && knowledge !== settings.mailKnowledge ? (
                <div style={{ marginBottom: 12 }}>
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      run('knowledge', async () => {
                        await save({ mailKnowledge: knowledge });
                        setKnowledge(null);
                        return 'Saved. New answers use it.';
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          <Tabs items={INBOX_TABS.map((t) => ({ key: t.key, label: t.label, n: inboxCounts[t.key] }))} on={tab} onPick={setTab} />
          {inbox.filter((m) => m.status === tab).length === 0 ? (
            <p style={{ fontSize: 13, color: colors.muted, margin: '10px 0 0' }}>
              {tab === 'open' ? 'Nothing waiting for an answer.' : 'Nothing here yet.'}
            </p>
          ) : (
            <div style={cards}>
              {inbox
                .filter((m) => m.status === tab)
                .map((m) => (
                  <MailBox key={m.id} mail={m} onError={setError} />
                ))}
            </div>
          )}
        </Card>
      ) : null}

      {setUp ? (
        <Card>
          <h2 style={h2}>👥 Write to every customer</h2>
          <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 10px', lineHeight: 1.55 }}>
            Say what to tell them. Each customer gets their own email — their name, your note about them, what they last wrote —
            {mailbox
              ? settings.sendMode === 'direct'
                ? ' sent on its own within your daily limit.'
                : ' waiting for your Approve, then sent within your daily limit.'
              : ' ready to copy into your own email.'}
          </p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            style={{ ...input, minHeight: 80, lineHeight: 1.5 }}
            maxLength={2000}
            aria-label="What to tell every customer"
            placeholder="e.g. Eid sale: 20% off everything until Sunday, free delivery in Lahore. Order at bloom.pk/eid"
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <Button
              disabled={busy !== null || brief.trim().length < 5 || !reachable}
              onClick={() =>
                run('write', async () => {
                  const r = await mailApi.writeCustomers({ brief: brief.trim() });
                  clearBrief();
                  setSettings((await salesApi.getSettings({})).settings);
                  setShelf(r.direct ? 'ready' : 'review');
                  return `Wrote ${r.written} email${r.written === 1 ? '' : 's'}${r.more ? ' — it writes the rest every 15 minutes' : ''}.`;
                })
              }
            >
              {busy === 'write' ? 'Writing…' : `Write to ${reachable} customer${reachable === 1 ? '' : 's'}`}
            </Button>
            {mailbox && shelfCounts.review ? (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() =>
                  run('approveAll', async () => {
                    const r = await mailApi.customerAction({ action: 'approveAll' });
                    setShelf('ready');
                    return `Approved ${r.approved}. They go out within your daily limit of ${settings.dailyCap}.`;
                  })
                }
              >
                Approve all {customers.filter((c) => c.status === 'drafted').length}
              </Button>
            ) : null}
          </div>
          {campaign ? (
            <p style={{ fontSize: 12.5, color: colors.muted, margin: '10px 0 0' }}>
              Now: “{campaign.brief.slice(0, 140)}
              {campaign.brief.length > 140 ? '…' : ''}” — written for {written} of {customers.length}.
            </p>
          ) : null}

          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 13.5 }}>+ Add customers</summary>
            <p style={{ fontSize: 12.5, color: colors.muted, margin: '8px 0' }}>
              One per line: name, email, and a note about them (what they bought, when). A spreadsheet column pasted as-is works too.
            </p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              style={{ ...input, minHeight: 90, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
              aria-label="Customers, one per line"
              placeholder={'Sana Khan, sana@gmail.com, bought 2 cakes in March\nAli Raza, ali@company.pk'}
            />
            <div style={{ marginTop: 8 }}>
              <Button
                disabled={busy !== null || !paste.includes('@')}
                onClick={() =>
                  run('add', async () => {
                    const r = await mailApi.addCustomers({ lines: paste });
                    setPaste('');
                    return `Added ${r.added}${r.updated ? `, updated ${r.updated}` : ''}.`;
                  })
                }
              >
                Add
              </Button>
            </div>
          </details>
        </Card>
      ) : null}

      {setUp ? (
        <>
          <Tabs items={SHELVES.map((s) => ({ key: s.key, label: s.label, n: shelfCounts[s.key] }))} on={shelf} onPick={setShelf} />
          {shown.length === 0 ? (
            <EmptyState
              icon="✉️"
              title={customers.length ? 'No customer emails on this shelf' : 'No customers yet'}
              why={
                customers.length
                  ? 'Say what to tell your customers above and press Write.'
                  : 'Paste your customer list under "Add customers" — or turn the inbox agent on, and everyone who writes to you joins the list.'
              }
            />
          ) : (
            <div style={cards}>
              {shown.map((c) => (
                <CustomerBox key={c.id} customer={c} settings={settings} mailbox={mailbox} onError={setError} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Tabs<K extends string>({ items, on, onPick }: { items: { key: K; label: string; n: number }[]; on: K; onPick: (k: K) => void }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((t) => {
        const active = t.key === on;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onPick(t.key)}
            style={{
              border: `1px solid ${active ? colors.primary : colors.border}`,
              background: active ? `${colors.primary}14` : colors.surface,
              color: active ? colors.primary : colors.text,
              fontWeight: 800,
              fontSize: 12.5,
              padding: '6px 12px',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.n ? <span style={{ marginLeft: 6, color: colors.muted }}>{t.n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Subject and body boxes: a rewrite from the agent replaces them; a local edit survives other updates. */
function useDraftBoxes(draft: { subject: string; body: string } | null) {
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [server, setServer] = useState(draft);
  if (draft !== server && (draft?.subject !== server?.subject || draft?.body !== server?.body)) {
    setServer(draft);
    setSubject(draft?.subject ?? '');
    setBody(draft?.body ?? '');
  }
  const edited = Boolean(draft) && (subject !== draft!.subject || body !== draft!.body);
  return { subject, setSubject, body, setBody, edited };
}

/** One email a person sent: what they wrote, what they want, and your answer — sent only when you press Send. */
function MailBox({ mail, onError }: { mail: MailInboxDoc; onError: (m: string) => void }) {
  const d = useDraftBoxes(mail.draft);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function act(action: 'send' | 'done') {
    setBusy(true);
    try {
      await mailApi.inboxAction({ action, id: mail.id, ...(action === 'send' ? { subject: d.subject, body: d.body } : {}) });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14.5 }}>{mail.name || mail.from}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: colors.muted }}>{KIND_LABEL[mail.kind]}</span>
      </div>
      <span style={{ fontSize: 12, color: colors.muted }}>
        {mail.name ? `${mail.from} · ` : ''}
        {new Date(mail.atMs).toLocaleString()}
      </span>
      <strong style={{ fontSize: 13 }}>{mail.subject || '(no subject)'}</strong>
      {mail.summary ? <span style={{ fontSize: 13, color: colors.text }}>→ {mail.summary}</span> : null}
      <button type="button" onClick={() => setOpen(!open)} style={{ ...pill, color: colors.muted, justifySelf: 'start', padding: '4px 9px' }}>
        {open ? 'Hide their email' : 'Read their email'}
      </button>
      {open ? <span style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{mail.text}</span> : null}
      {mail.error ? <span style={{ fontSize: 12, color: colors.danger }}>{mail.error}</span> : null}

      {mail.status !== 'done' ? (
        <>
          <span style={labelText}>{mail.answeredAtMs ? `Answered ${new Date(mail.answeredAtMs).toLocaleString()}` : 'Your answer — check it, then send'}</span>
          <input value={d.subject} onChange={(e) => d.setSubject(e.target.value)} style={{ ...input, fontWeight: 700 }} aria-label="Answer subject" />
          <textarea
            value={d.body}
            onChange={(e) => d.setBody(e.target.value)}
            style={{ ...input, minHeight: 120, lineHeight: 1.5 }}
            aria-label="Answer"
            placeholder={mail.draft ? undefined : 'Write your answer here.'}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button onClick={() => act('send')} disabled={busy || !d.subject.trim() || d.body.trim().length < 2}>
              {busy ? 'Sending…' : mail.answeredAtMs ? 'Send again' : 'Send'}
            </Button>
            {mail.status === 'open' ? (
              <button type="button" style={{ ...pill, color: colors.muted }} onClick={() => act('done')} disabled={busy}>
                No answer needed
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One customer and this campaign's email to them. */
function CustomerBox({
  customer: c,
  settings,
  mailbox,
  onError,
}: {
  customer: MailCustomerDoc;
  settings: SalesSettingsDoc;
  mailbox: boolean;
  onError: (m: string) => void;
}) {
  const d = useDraftBoxes(c.draft);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const full = `${d.body.trim()}\n\n${settings.senderName}, ${settings.senderCompany}\n${settings.senderAddress}\nNot interested? Reply "no" and I won’t write again.`;

  async function act(action: 'approve' | 'send' | 'skip' | 'rewrite' | 'optout') {
    setBusy(true);
    try {
      if (d.edited) await mailApi.customerAction({ action: 'edit', id: c.id, subject: d.subject, body: d.body });
      await mailApi.customerAction({ action, id: c.id });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const live = c.draft && ['drafted', 'failed', 'approved'].includes(c.status);
  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14.5 }}>{c.name || c.email}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: colors.muted, textTransform: 'uppercase' }}>{c.status}</span>
      </div>
      <span style={{ fontSize: 12, color: colors.muted }}>
        {c.name ? `${c.email} · ` : ''}
        {c.source === 'inbox' ? 'wrote to you' : 'from your list'}
        {c.sentAtMs ? ` · sent ${new Date(c.sentAtMs).toLocaleString()}` : ''}
      </span>
      {c.note ? <span style={{ fontSize: 12.5, color: colors.muted }}>📝 {c.note}</span> : null}
      {c.draft && c.status !== 'unsubscribed' ? (
        <>
          <input value={d.subject} onChange={(e) => d.setSubject(e.target.value)} style={{ ...input, fontWeight: 700 }} aria-label="Subject" readOnly={c.status === 'sent'} />
          <textarea
            value={d.body}
            onChange={(e) => d.setBody(e.target.value)}
            style={{ ...input, minHeight: 130, lineHeight: 1.5 }}
            aria-label="Email"
            readOnly={c.status === 'sent'}
          />
          {c.problems.length && c.status !== 'sent' ? (
            <span style={{ fontSize: 12, color: colors.warn }}>Check before sending: {c.problems.join(', ')}</span>
          ) : null}
        </>
      ) : null}
      {c.error ? <span style={{ fontSize: 12, color: colors.danger }}>{c.error}</span> : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {live ? (
          mailbox ? (
            <>
              {c.status !== 'approved' ? (
                <Button onClick={() => act('approve')} disabled={busy}>
                  Approve
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => act('send')} disabled={busy}>
                Send now
              </Button>
            </>
          ) : (
            <>
              <a href={`mailto:${c.email}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(full)}`} style={pill}>
                Open in my email
              </a>
              <button type="button" style={pill} onClick={() => void navigator.clipboard.writeText(`${d.subject}\n\n${full}`).then(() => setCopied(true))}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )
        ) : null}
        {live || c.status === 'failed' ? (
          <button type="button" style={pill} onClick={() => act('rewrite')} disabled={busy}>
            Write again
          </button>
        ) : null}
        {live ? (
          <button type="button" style={{ ...pill, color: colors.muted }} onClick={() => act('skip')} disabled={busy}>
            Skip
          </button>
        ) : null}
        {c.status !== 'unsubscribed' ? (
          <button type="button" style={{ ...pill, color: colors.muted }} onClick={() => act('optout')} disabled={busy}>
            Never email them
          </button>
        ) : null}
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const labelText: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, color: colors.muted };
const cards: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 12, marginTop: 12 };
const box: React.CSSProperties = { ...glass, display: 'grid', gap: 8, padding: 14, borderRadius: 14 };
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
