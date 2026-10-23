'use client';

/**
 * Velocity Studio → Customers & payments (admins only).
 *
 * Every business on Studio, and every "I paid" waiting for a decision. Approve
 * only once the money is in the account: approving sets the plan they paid for
 * and adds a month. Rejecting frees the transaction ID, so an honest typo can
 * be sent again.
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi, type StudioPaymentDoc } from '@/lib/api';
import { STUDIO_PLANS, type StudioWorkspace } from '@/lib/studio';
import { Button, Card } from '@/components/ui';

// shortcut: shown next to the USD price for checking a PKR transfer; matches the Billing page.
const PKR_PER_USD = 280;

export default function StudioCustomersPage() {
  const { isAdmin } = useAuth();
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  const [workspaces, setWorkspaces] = useState<(StudioWorkspace & { id: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      query(collection(db, 'studioPayments'), orderBy('createdAtMs', 'desc'), limit(100)),
      (snap) => setPayments(snap.docs.map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id }))),
      (e) => setError(e.message),
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      query(collection(db, 'workspaces'), orderBy('createdAtMs', 'desc'), limit(200)),
      (snap) => setWorkspaces(snap.docs.map((d) => ({ ...(d.data() as StudioWorkspace), id: d.id }))),
      (e) => setError(e.message),
    );
  }, [isAdmin]);

  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  const pending = payments.filter((p) => p.status === 'pending');
  const decided = payments.filter((p) => p.status !== 'pending').slice(0, 30);
  const live = workspaces.filter((w) => w.accessUntilMs > nowMs);
  const mrr = workspaces
    .filter((w) => w.paidUntilMs > nowMs)
    .reduce((n, w) => n + STUDIO_PLANS[w.plan].usd, 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>Velocity Studio — customers &amp; payments</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          {workspaces.length} signed up · {live.length} active now · ${mrr}/month paid
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

      <Card>
        <h2 style={h2}>Customers</h2>
        {workspaces.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>Nobody has signed up yet. The sales page is /studio.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, fontSize: 12 }}>
                  <th style={th}>Business</th>
                  <th style={th}>Owner</th>
                  <th style={th}>Plan</th>
                  <th style={th}>Status</th>
                  <th style={th}>Signed up</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => {
                  const paid = w.paidUntilMs > nowMs;
                  const trial = !paid && w.trialEndsAtMs > nowMs;
                  return (
                    <tr key={w.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={td}>
                        <strong>{w.name}</strong>
                        <div style={{ fontSize: 12, color: colors.muted }}>{w.brand.market}</div>
                      </td>
                      <td style={td}>{w.ownerEmail ?? '—'}</td>
                      <td style={td}>{STUDIO_PLANS[w.plan].name}</td>
                      <td style={{ ...td, fontWeight: 800, color: paid ? colors.success : trial ? colors.primary : colors.muted }}>
                        {paid ? `Paid to ${day(w.paidUntilMs)}` : trial ? `Trial to ${day(w.trialEndsAtMs)}` : 'Lapsed'}
                      </td>
                      <td style={td}>{day(w.createdAtMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {decided.length ? (
        <Card>
          <h2 style={h2}>Decided</h2>
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            {decided.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 110, color: colors.muted }}>{day(p.createdAtMs)}</span>
                <span style={{ flex: 1 }}>
                  {p.business} · {STUDIO_PLANS[p.plan].name}
                  {p.billing === 'year' ? ' · a year' : ''} · ${p.amountUsd}
                  {p.txnId ? ` · ${p.txnId}` : ''}
                </span>
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: shot ? '120px 1fr' : '1fr', gap: 12, padding: 12, borderRadius: 12, background: colors.bg }}>
      {shot ? (
        <a href={shot} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt="Payment receipt" style={{ width: 120, borderRadius: 8, display: 'block' }} />
        </a>
      ) : null}
      <div style={{ display: 'grid', gap: 6, fontSize: 13.5 }}>
        <div>
          <strong>{p.business}</strong> · {p.email ?? 'no email'}
        </div>
        <div>
          {STUDIO_PLANS[p.plan].name} plan · <strong>{p.billing === 'year' ? 'a year' : 'a month'}</strong> ·{' '}
          <strong>${p.amountUsd}</strong> (about Rs{' '}
          {(p.amountUsd * PKR_PER_USD).toLocaleString('en-PK')}) · sent {day(p.createdAtMs)}
        </div>
        <div>
          Transaction ID: <code style={{ fontWeight: 800 }}>{p.txnId ?? '— (screenshot only)'}</code>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the customer (optional)"
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

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 800 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
