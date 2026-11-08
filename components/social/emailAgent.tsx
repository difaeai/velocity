'use client';

/**
 * The email agent's pieces: the tab row, one email a person sent (with the
 * answer drafted for it), and one customer with this campaign's email to them.
 * Used by the Email agent page.
 */

import { useState } from 'react';

import { colors } from '@/lib/config';
import { mailApi, type MailCustomerDoc, type MailInboxDoc, type SalesSettingsDoc } from '@/lib/api';
import { Button, glass } from '@/components/ui';

const KIND_LABEL: Record<MailInboxDoc['kind'], string> = {
  question: '❓ Question',
  order: '🛒 Order',
  complaint: '⚠️ Complaint',
  thanks: '🙏 Thanks',
  sales_pitch: '📢 Selling to you',
  unsubscribe: '🚫 Asked to stop',
  other: '✉️ Other',
};

export function Tabs<K extends string>({ items, on, onPick }: { items: { key: K; label: string; n: number }[]; on: K; onPick: (k: K) => void }) {
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
export function MailBox({ mail, onError }: { mail: MailInboxDoc; onError: (m: string) => void }) {
  // No draft (the model failed): the reply still starts with their subject, so only the words are yours to write.
  const d = useDraftBoxes(mail.draft ?? { subject: (/^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`).slice(0, 120), body: '' });
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
export function CustomerBox({
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

export const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
export const labelText: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, color: colors.muted };
export const cards: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 12, marginTop: 12 };
const box: React.CSSProperties = { ...glass, display: 'grid', gap: 8, padding: 14, borderRadius: 14 };
export const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  background: colors.surface,
  color: colors.text,
};
export const pill: React.CSSProperties = {
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
