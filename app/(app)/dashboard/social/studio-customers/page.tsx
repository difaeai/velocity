'use client';

/**
 * Velocity AI Studio → Users (admins only).
 *
 * Everyone who started a Studio sign-up, live: the businesses with a workspace,
 * and the people who signed in but never finished (from `studioUsers`). Open
 * one to see their business, every payment with what our AI read off the
 * receipt, and to manage them — extend the trial, give days, change the plan,
 * pause or resume, keep a note. Every action is a callable and lands in the
 * audit log; nothing here writes Firestore directly.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi, type StudioPaymentDoc } from '@/lib/api';
import { STUDIO_PLAN_IDS, STUDIO_PLANS, type StudioPlanId, type StudioUserDoc, type StudioWorkspace } from '@/lib/studio';
import { Badge, Button, Card, StatCard } from '@/components/ui';
import { VerdictBadge } from '@/components/social/studioVerdict';

type Workspace = StudioWorkspace & { id: string };
type Status = 'trial' | 'paid' | 'lapsed' | 'paused' | 'unfinished';

interface Row {
  key: string;
  status: Status;
  email: string | null;
  user: StudioUserDoc | null;
  ws: Workspace | null;
}

const STATUS_LABEL: Record<Status, string> = {
  trial: 'On trial',
  paid: 'Paid',
  lapsed: 'Lapsed',
  paused: 'Paused',
  unfinished: 'Not finished',
};
const STATUS_COLOR: Record<Status, string> = {
  trial: colors.secondary,
  paid: colors.success,
  lapsed: colors.muted,
  paused: colors.danger,
  unfinished: colors.warn,
};

function statusOf(ws: StudioWorkspace, nowMs: number): Status {
  if (ws.suspended) return 'paused';
  if (ws.paidUntilMs > nowMs) return 'paid';
  if (ws.trialEndsAtMs > nowMs) return 'trial';
  return 'lapsed';
}

export default function StudioUsersPage() {
  const { isAdmin } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<StudioUserDoc[]>([]);
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const fail = (e: Error) => setError(e.message);
    const subs = [
      onSnapshot(
        query(collection(db, 'workspaces'), orderBy('createdAtMs', 'desc'), limit(500)),
        (snap) => setWorkspaces(snap.docs.map((d) => ({ ...(d.data() as StudioWorkspace), id: d.id }))),
        fail,
      ),
      onSnapshot(
        query(collection(db, 'studioUsers'), orderBy('createdAtMs', 'desc'), limit(500)),
        (snap) => setUsers(snap.docs.map((d) => d.data() as StudioUserDoc)),
        fail,
      ),
      onSnapshot(
        query(collection(db, 'studioPayments'), orderBy('createdAtMs', 'desc'), limit(300)),
        (snap) => setPayments(snap.docs.map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id }))),
        fail,
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [isAdmin]);

  // The wall clock is subscribed to, not read during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const read = () => setNowMs(Date.now());
    const first = setTimeout(read, 0);
    const every = setInterval(read, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const byUid = new Map(users.map((u) => [u.uid, u]));
    const owned = new Set(workspaces.map((w) => w.ownerUid));
    return [
      ...workspaces.map((w) => ({
        key: w.id,
        status: statusOf(w, nowMs),
        email: w.ownerEmail,
        user: byUid.get(w.ownerUid) ?? null,
        ws: w,
      })),
      ...users
        .filter((u) => !owned.has(u.uid))
        .map((u) => ({ key: u.uid, status: 'unfinished' as const, email: u.email, user: u, ws: null })),
    ];
  }, [workspaces, users, nowMs]);

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const mrr = workspaces.filter((w) => !w.suspended && w.paidUntilMs > nowMs).reduce((n, w) => n + STUDIO_PLANS[w.plan].usd, 0);
  const waiting = payments.filter((p) => p.status === 'pending').length;
  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (!needle || [r.email, r.ws?.name, r.user?.name, r.ws?.brand.market].some((v) => v?.toLowerCase().includes(needle))),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>Velocity AI Studio — users</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          Everyone who signed up, live. Open a row to manage that customer.{' '}
          {waiting ? (
            <Link href="/dashboard/social/studio-payments" style={{ color: colors.secondary, fontWeight: 800 }}>
              {waiting} payment{waiting === 1 ? '' : 's'} waiting →
            </Link>
          ) : null}
        </p>
      </header>
      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Signed up" value={String(rows.length)} />
        <StatCard label="On trial" value={String(count('trial'))} />
        <StatCard label="Paying" value={String(count('paid'))} />
        <StatCard label="Paid per month" value={`$${mrr}`} />
        <StatCard
          label="Trial → paid"
          value={workspaces.length ? `${Math.round((workspaces.filter((w) => w.paidUntilMs > 0).length / workspaces.length) * 100)}%` : '—'}
        />
      </div>

      <Card style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {(['all', 'trial', 'paid', 'lapsed', 'paused', 'unfinished'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
              style={{
                ...chip,
                border: `${filter === s ? 2 : 1}px solid ${filter === s ? colors.primary : colors.border}`,
                color: filter === s ? colors.primary : colors.text,
              }}
            >
              {s === 'all' ? `All ${rows.length}` : `${STATUS_LABEL[s]} ${count(s)}`}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business or email"
            aria-label="Search business or email"
            style={{ ...field, marginLeft: 'auto', minWidth: 220 }}
          />
        </div>

        {shown.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>
            {rows.length === 0 ? 'Nobody has signed up yet. The sign-up page is /studio/start.' : 'Nobody matches.'}
          </p>
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
                  <th style={th}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <UserRow
                    key={r.key}
                    row={r}
                    nowMs={nowMs}
                    open={open === r.key}
                    onToggle={() => setOpen(open === r.key ? null : r.key)}
                    payments={r.ws ? payments.filter((p) => p.wid === r.ws!.id) : []}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function UserRow({
  row,
  nowMs,
  open,
  onToggle,
  payments,
}: {
  row: Row;
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  payments: StudioPaymentDoc[];
}) {
  const { ws, user } = row;
  const statusLine =
    !ws || row.status === 'paused'
      ? STATUS_LABEL[row.status]
      : row.status === 'paid'
        ? `Paid to ${day(ws.paidUntilMs)}`
        : row.status === 'trial'
          ? `Trial to ${when(ws.trialEndsAtMs)}`
          : 'Lapsed';
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderTop: `1px solid ${colors.border}`, cursor: 'pointer', background: open ? colors.bg : undefined }}
      >
        <td style={td}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            style={rowButton}
          >
            {ws ? ws.name : <span style={{ color: colors.muted }}>— no business yet</span>}
          </button>
          {ws ? <div style={{ fontSize: 12, color: colors.muted }}>{ws.brand.market}</div> : null}
        </td>
        <td style={td}>
          {row.email ?? '—'}
          <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
            {user ? <Badge label={user.method === 'google' ? 'Google' : 'Email'} color={colors.secondary} /> : null}
            {user ? (
              <Badge label={user.emailVerified ? 'Verified' : 'Not verified'} color={user.emailVerified ? colors.success : colors.warn} />
            ) : null}
          </div>
        </td>
        <td style={td}>{ws ? STUDIO_PLANS[ws.plan].name : '—'}</td>
        <td style={{ ...td, fontWeight: 800, color: STATUS_COLOR[row.status] }}>{statusLine}</td>
        <td style={td}>{day(ws?.createdAtMs ?? user?.createdAtMs ?? 0)}</td>
        <td style={td}>{user?.lastSeenAtMs ? ago(user.lastSeenAtMs, nowMs) : '—'}</td>
      </tr>
      {open ? (
        <tr style={{ background: colors.bg }}>
          <td colSpan={6} style={{ padding: '4px 8px 16px' }}>
            {ws ? <Manage ws={ws} payments={payments} /> : <Unfinished user={user!} />}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Unfinished({ user }: { user: StudioUserDoc }) {
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: colors.muted, lineHeight: 1.6 }}>
      {user.name ? <strong style={{ color: colors.text }}>{user.name}</strong> : 'This person'} signed in with{' '}
      {user.method === 'google' ? 'Google' : 'email'}
      {user.emailVerified ? ' and verified the address' : ' but has not typed the emailed code yet'}, and has not described a
      business. Nothing to manage until they do — write to {user.email ?? 'them'} if they need a hand.
    </p>
  );
}

function Manage({ ws, payments }: { ws: Workspace; payments: StudioPaymentDoc[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(ws.adminNote ?? '');
  const [plan, setPlan] = useState<StudioPlanId>(ws.plan);

  async function act(label: string, change: Parameters<typeof studioApi.manageCustomer>[0]) {
    setBusy(label);
    setError(null);
    try {
      await studioApi.manageCustomer(change);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const b = ws.brand;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      <Card style={{ padding: 14 }}>
        <h3 style={h3}>The business</h3>
        <div style={facts}>
          {(
            [
              ['Sells', b.what],
              ['Customers', b.audience],
              ['Where', b.market],
              ['Posts in', b.language],
              ['Website', b.website || '—'],
              ['Trial ends', when(ws.trialEndsAtMs)],
              ['Paid until', ws.paidUntilMs ? when(ws.paidUntilMs) : 'never paid'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span style={{ color: colors.muted, fontWeight: 700 }}>{k}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 14 }}>
        <h3 style={h3}>Manage</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" disabled={busy !== null} onClick={() => act('t1', { wid: ws.id, action: 'extendTrial', days: 1 })}>
              {busy === 't1' ? '…' : 'Trial +1 day'}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => act('t7', { wid: ws.id, action: 'extendTrial', days: 7 })}>
              {busy === 't7' ? '…' : 'Trial +7 days'}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => act('g30', { wid: ws.id, action: 'giveDays', days: 30 })}>
              {busy === 'g30' ? '…' : 'Give 30 days free'}
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={plan} onChange={(e) => setPlan(e.target.value as StudioPlanId)} aria-label="Plan" style={field}>
              {STUDIO_PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {STUDIO_PLANS[id].name} — ${STUDIO_PLANS[id].usd}/mo
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              disabled={busy !== null || plan === ws.plan}
              onClick={() => act('plan', { wid: ws.id, action: 'setPlan', plan })}
            >
              {busy === 'plan' ? 'Changing…' : 'Change plan'}
            </Button>
          </div>
          <div>
            {ws.suspended ? (
              <Button disabled={busy !== null} onClick={() => act('resume', { wid: ws.id, action: 'resume' })}>
                {busy === 'resume' ? 'Resuming…' : 'Resume workspace'}
              </Button>
            ) : (
              <Button variant="danger" disabled={busy !== null} onClick={() => act('suspend', { wid: ws.id, action: 'suspend' })}>
                {busy === 'suspend' ? 'Pausing…' : 'Pause workspace'}
              </Button>
            )}
          </div>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 800, color: colors.muted }}>
            Note (only admins see it)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ ...field, minHeight: 60 }} />
          </label>
          <div>
            <Button
              variant="ghost"
              disabled={busy !== null || note === (ws.adminNote ?? '')}
              onClick={() => act('note', { wid: ws.id, action: 'note', note })}
            >
              {busy === 'note' ? 'Saving…' : 'Save note'}
            </Button>
          </div>
          {error ? <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p> : null}
        </div>
      </Card>

      <Card style={{ padding: 14 }}>
        <h3 style={h3}>Payments</h3>
        {payments.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0, fontSize: 13 }}>Nothing sent yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            {payments.map((p) => (
              <div key={p.id} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong>{day(p.createdAtMs)}</strong>
                  <span>
                    {STUDIO_PLANS[p.plan].name}
                    {p.billing === 'year' ? ' · a year' : ''} · ${p.amountUsd}
                  </span>
                  <Badge
                    label={p.status}
                    color={p.status === 'approved' ? colors.success : p.status === 'rejected' ? colors.danger : colors.warn}
                  />
                  <VerdictBadge analysis={p.analysis} />
                </div>
                {p.analysis?.summary ? <span style={{ color: colors.muted }}>{p.analysis.summary}</span> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const day = (ms: number) =>
  ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function ago(ms: number, nowMs: number): string {
  if (!nowMs) return '…';
  const min = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

const h3: React.CSSProperties = { fontSize: 14, fontWeight: 800, margin: '0 0 10px' };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 800 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const chip: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  background: colors.surface,
  fontFamily: 'inherit',
  fontWeight: 800,
  fontSize: 12.5,
  cursor: 'pointer',
};
const field: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  fontFamily: 'inherit',
  fontSize: 13.5,
  background: colors.surface,
  color: colors.text,
};
const rowButton: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontWeight: 800,
  color: colors.text,
  cursor: 'pointer',
  textAlign: 'left',
};
const facts: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '4px 12px',
  margin: 0,
  fontSize: 13,
};
