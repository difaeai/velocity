'use client';

/**
 * Velocity AI Studio → Sign-up email (admins only).
 *
 * The mailbox the six-digit sign-up codes come from. Until one is connected,
 * email sign-up says it is not open yet and Google sign-up still works. Saving
 * logs in to the mailbox and sends you a test message before anything is
 * stored; the password is sealed on the server and never shown again.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi } from '@/lib/api';
import { SUPPORT_EMAIL } from '@/lib/site';
import { Button, Card } from '@/components/ui';

interface MailerDoc {
  host: string;
  port: number;
  user: string;
  from: string;
  fromName: string;
  verifiedAtMs: number;
}

export default function StudioEmailPage() {
  const { isAdmin, user } = useAuth();
  const [saved, setSaved] = useState<MailerDoc | null | undefined>(undefined);
  const [f, setF] = useState({ host: 'smtp.gmail.com', port: '465', user: '', pass: '', from: '', fromName: 'Velocity Studio' });
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      doc(db, 'system', 'studioMailer'),
      (snap) => {
        const d = snap.exists() ? (snap.data() as MailerDoc) : null;
        setSaved(d);
        if (d) setF((cur) => ({ ...cur, host: d.host, port: String(d.port), user: d.user, from: d.from, fromName: d.fromName }));
      },
      (e) => setError(e.message),
    );
  }, [isAdmin]);

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const to = testTo || user?.email || '';

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await studioApi.setMailer({
        host: f.host.trim(),
        port: Number(f.port),
        user: f.user.trim(),
        ...(f.pass ? { pass: f.pass } : {}),
        from: (f.from || f.user).trim(),
        fromName: f.fromName.trim(),
        testTo: to,
      });
      setF({ ...f, pass: '' });
      setNotice(`Connected. A test message went to ${to} — sign-up codes now come from this mailbox.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>Velocity AI Studio — sign-up email</h1>
        <p style={{ color: colors.muted, margin: 0, lineHeight: 1.6 }}>
          The mailbox that sends each new customer their 6-digit code.{' '}
          {saved === undefined ? '' : saved ? (
            <strong style={{ color: colors.success }}>
              Connected: {saved.fromName} &lt;{saved.from}&gt;, proved {new Date(saved.verifiedAtMs).toLocaleString('en-GB')}.
            </strong>
          ) : (
            <strong style={{ color: colors.warn }}>Not connected — email sign-up is closed; Google sign-up still works.</strong>
          )}
        </p>
      </header>

      {error ? <p role="alert" style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="SMTP server">
              <input value={f.host} onChange={set('host')} style={input} />
            </Field>
            <Field label="Port">
              <input value={f.port} onChange={set('port')} style={input} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Mailbox login">
            <input value={f.user} onChange={set('user')} style={input} autoComplete="off" placeholder={SUPPORT_EMAIL} />
          </Field>
          <Field label={saved ? 'Password (leave empty to keep the saved one)' : 'Password'}>
            <input value={f.pass} onChange={set('pass')} style={input} type="password" autoComplete="new-password" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Send as (address)">
              <input value={f.from} onChange={set('from')} style={input} placeholder={f.user || SUPPORT_EMAIL} />
            </Field>
            <Field label="Send as (name)">
              <input value={f.fromName} onChange={set('fromName')} style={input} />
            </Field>
          </div>
          <Field label="Send the test message to">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} style={input} placeholder={user?.email ?? ''} />
          </Field>
          <div>
            <Button onClick={save} disabled={busy || !f.host || !f.user || (!saved && !f.pass) || !to}>
              {busy ? 'Logging in and sending a test…' : saved ? 'Save and test again' : 'Connect and send a test'}
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 8px' }}>With a Gmail or Google Workspace mailbox</h2>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: colors.text }}>
          <li>Turn on 2-Step Verification for that Google account.</li>
          <li>
            Open Google Account → Security → <strong>App passwords</strong>, make one called &quot;Velocity Studio&quot;, and
            paste the 16 letters as the password here.
          </li>
          <li>
            Server <code>smtp.gmail.com</code>, port <code>465</code>, login = the full address. Gmail sends up to about 500
            a day, plenty for sign-ups.
          </li>
        </ol>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 800, color: colors.muted }}>
      {label}
      {children}
    </label>
  );
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  color: colors.text,
  background: colors.surface,
};
