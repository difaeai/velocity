'use client';

/**
 * Velocity AI Studio → Payments (admins only).
 *
 * Every "I paid" from a Studio customer, live. Each arrives with the receipt
 * screenshot and the transaction ID, and our AI (`studio/paymentCheck.ts`, our
 * own OCR) has already read the receipt: whether the amount covers the plan,
 * whether the typed ID is the one on it, whether the money went to our account
 * and whether the same picture was sent before. It advises; approving is still
 * yours, and only once the money is in the account — approving sets the plan
 * they paid for and adds a month (or a year). Rejecting frees the ID and the
 * screenshot, so an honest mistake can be sent again.
 */

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi, studioPaymentLabel, type StudioPaymentDoc } from '@/lib/api';
import { PKR_PER_USD, STUDIO_PLANS } from '@/lib/studio';
import { Button, Card } from '@/components/ui';
import { VerdictBadge, VerdictChecks } from '@/components/social/studioVerdict';

export default function StudioPaymentsPage() {
  const { isAdmin } = useAuth();
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      query(collection(db, 'studioPayments'), orderBy('createdAtMs', 'desc'), limit(150)),
      (snap) => setPayments(snap.docs.map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id }))),
      (e) => setError(e.message),
    );
  }, [isAdmin]);

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  const pending = payments.filter((p) => p.status === 'pending');
  const decided = payments.filter((p) => p.status !== 'pending').slice(0, 50);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>Velocity AI Studio — payments</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          Our AI reads every receipt the moment it arrives. Approve only once the money is in the account.
        </p>
      </header>
      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <Card>
        <h2 style={h2}>Waiting for you ({pending.length})</h2>
        {pending.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No payments waiting.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {pending.map((p) => (
              <PendingRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </Card>

      {decided.length ? (
        <Card>
          <h2 style={h2}>Decided</h2>
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            {decided.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ minWidth: 110, color: colors.muted }}>{day(p.createdAtMs)}</span>
                <span style={{ flex: 1 }}>
                  {p.business} · {studioPaymentLabel(p, STUDIO_PLANS[p.plan].name)}
                  {p.billing === 'year' ? ' · a year' : ''} · ${p.amountUsd}
                  {p.txnId ? ` · ${p.txnId}` : ''}
                </span>
                <VerdictBadge analysis={p.analysis} />
                <strong style={{ color: p.status === 'approved' ? colors.success : colors.danger }}>{p.status}</strong>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function PendingRow({ payment: p }: { payment: StudioPaymentDoc }) {
  const [shot, setShot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!p.screenshotPath) return;
    getDownloadURL(ref(storage, p.screenshotPath))
      .then(setShot)
      .catch(() => setShot(null));
  }, [p.screenshotPath]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await studioApi.decidePayment({ paymentId: p.id, approve, ...(note.trim() ? { note: note.trim() } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
      setBusy(false);
    }
  }

  const a = p.analysis;
  const asked = p.amountPkr ?? p.amountUsd * PKR_PER_USD;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: shot ? 'minmax(120px, 160px) 1fr' : '1fr',
        gap: 14,
        padding: 12,
        borderRadius: 12,
        background: colors.bg,
      }}
    >
      {shot ? (
        <a href={shot} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt={`Payment receipt from ${p.business}`} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
        </a>
      ) : null}
      <div style={{ display: 'grid', gap: 8, fontSize: 13.5, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{p.business}</strong>
          <span style={{ color: colors.muted }}>{p.email ?? 'no email'}</span>
          <VerdictBadge analysis={a} />
        </div>
        <div>
          {p.kind === 'agents' && p.agents
            ? `AI agents package (${p.agents.callsPerDay} calls a day, ${p.agents.numbers} number${p.agents.numbers === 1 ? '' : 's'})`
            : p.kind === 'credits'
              ? `Credits — ${p.credits} days of the team's work`
              : `${STUDIO_PLANS[p.plan].name} plan`}{' '}
          · <strong>{p.kind === 'credits' ? '$1 a day' : p.billing === 'year' ? 'a year' : 'a month'}</strong> ·{' '}
          <strong>${p.amountUsd}</strong> (Rs {asked.toLocaleString('en-PK')}) · sent {day(p.createdAtMs)}
        </div>
        <div>
          Transaction ID typed: <code style={{ fontWeight: 800 }}>{p.txnId ?? '—'}</code>
        </div>

        <div style={{ padding: 10, borderRadius: 10, background: colors.surface, border: `1px solid ${colors.border}` }}>
          {a === undefined ? (
            <span style={{ color: colors.muted }}>Sent before the AI check existed — look at the screenshot.</span>
          ) : a === null ? (
            <span style={{ color: colors.muted }}>Our AI is reading the receipt…</span>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <strong style={{ fontSize: 13.5 }}>{a.summary}</strong>
              <VerdictChecks analysis={a} />
              {a.read.amount !== null || a.read.transactionRef ? (
                <span style={{ color: colors.muted, fontSize: 12.5 }}>
                  Read off the receipt:{' '}
                  {[
                    a.read.amount !== null ? `Rs ${a.read.amount.toLocaleString('en-PK')}` : null,
                    a.read.transactionRef ? `ID ${a.read.transactionRef}` : null,
                    a.read.sourceApp,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the customer (optional)"
          aria-label="Note to the customer"
          style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${colors.border}`, fontFamily: 'inherit', maxWidth: 420 }}
        />
        {error ? <span style={{ color: colors.danger }}>{error}</span> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => decide(true)} disabled={busy}>
            Money received — approve
          </Button>
          <Button variant="ghost" onClick={() => decide(false)} disabled={busy}>
            Not received — reject
          </Button>
        </div>
      </div>
    </div>
  );
}

const day = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
