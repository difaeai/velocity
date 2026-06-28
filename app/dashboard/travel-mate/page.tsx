'use client';

/**
 * Admin — Travel Mate management.
 * Three tabs: Plans | Subscriptions | Settings.
 *
 * Plans:         Create / toggle-active / soft-delete subscription plans.
 * Subscriptions: Queue of pending + active + rejected + expired requests.
 *                Approve (debits wallet, grants daily likes) or Reject.
 * Settings:      Edit config/travelMateSettings in place.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  name: string;
  billingPeriod: 'weekly' | 'yearly';
  pricePKR: number;
  dailyLikeAllowance: number;
  active: boolean;
  createdAt?: { seconds: number };
}

interface Sub {
  id: string;
  uid: string;
  planId: string;
  planSnapshot?: {
    name?: string;
    billingPeriod?: string;
    pricePKR?: number;
    dailyLikeAllowance?: number;
  };
  status: 'pending' | 'active' | 'rejected' | 'expired';
  paymentMethod: string;
  paymentProofURL?: string | null;
  requestedAt?: { seconds: number };
  reviewedAt?: { seconds: number };
  endAt?: Timestamp;
}

interface ModerationReport {
  id: string;
  reporterId: string;
  reportedUid: string;
  matchId: string | null;
  reason: string;
  status: 'open' | 'resolved';
  createdAt?: { seconds: number };
}

interface TmSettings {
  freeMonthlySwipes: number;
  maxGroupSize: number;
  discoveryRadiusKm: number;
  enforceMutualGender: boolean;
}

type Tab = 'plans' | 'subscriptions' | 'settings' | 'moderation';
type SubFilter = 'pending' | 'active' | 'rejected' | 'expired';

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TravelMatePage() {
  const [tab, setTab] = useState<Tab>('subscriptions');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [settings, setSettings] = useState<TmSettings>({
    freeMonthlySwipes: 4,
    maxGroupSize: 4,
    discoveryRadiusKm: 3,
    enforceMutualGender: true,
  });
  const [subFilter, setSubFilter] = useState<SubFilter>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);

  // ── Plans real-time ────────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMatePlans'), orderBy('createdAt', 'desc')),
      snap => setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Plan)),
    );
  }, []);

  // ── Subscriptions real-time ────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMateSubscriptions'), orderBy('requestedAt', 'desc')),
      snap => setSubs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Sub)),
    );
  }, []);

  // ── Settings real-time ────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'travelMateSettings'), snap => {
      if (snap.exists()) setSettings(snap.data() as TmSettings);
    });
  }, []);

  // ── Reports real-time ─────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'travelMateReports'), where('status', '==', 'open'), orderBy('createdAt', 'desc')),
      snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ModerationReport)),
    );
  }, []);

  async function call<T>(fn: () => Promise<T>, id: string): Promise<T | null> {
    setError(null);
    setBusy(id);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const filteredSubs = subs.filter(s => s.status === subFilter);

  return (
    <div style={{ maxWidth: 1060, padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, marginBottom: 20 }}>
        Travel Mate
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['subscriptions', 'plans', 'moderation', 'settings'] as Tab[]).map(t => (
          <Button key={t} variant={tab === t ? 'primary' : 'ghost'} onClick={() => setTab(t)}>
            {t === 'subscriptions' ? '🧾 Subscriptions'
              : t === 'plans' ? '📋 Plans'
              : t === 'moderation' ? `🚩 Moderation${reports.length ? ` (${reports.length})` : ''}`
              : '⚙️ Settings'}
          </Button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: `${colors.danger}22`, color: colors.danger, marginBottom: 14, fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {tab === 'plans'         && <PlansTab plans={plans} busy={busy} call={call} />}
      {tab === 'subscriptions' && (
        <SubsTab
          subs={filteredSubs}
          filter={subFilter}
          setFilter={setSubFilter}
          busy={busy}
          call={call}
        />
      )}
      {tab === 'settings' && <SettingsTab settings={settings} />}
      {tab === 'moderation' && <ModerationTab reports={reports} busy={busy} call={call} />}
    </div>
  );
}

// ── Plans tab ─────────────────────────────────────────────────────────────────

function PlansTab({
  plans,
  busy,
  call,
}: {
  plans: Plan[];
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);

  async function toggleActive(p: Plan) {
    await call(() => adminApi.adminUpdateTravelMatePlan({ planId: p.id, active: !p.active }), p.id);
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`Soft-delete "${p.name}"? Existing subscribers keep their access until expiry.`)) return;
    await call(() => adminApi.adminDeleteTravelMatePlan({ planId: p.id }), p.id);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New plan</Button>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>Name</th>
                <th style={th}>Period</th>
                <th style={th}>Price (PKR)</th>
                <th style={th}>Daily likes</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No plans yet. Create the first one.</td></tr>
              )}
              {plans.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}><strong>{p.name}</strong></td>
                  <td style={td}>{p.billingPeriod}</td>
                  <td style={td}>PKR {p.pricePKR?.toLocaleString()}</td>
                  <td style={td}>{p.dailyLikeAllowance}/day</td>
                  <td style={td}>
                    <StatusBadge status={p.active ? 'active' : 'inactive'} />
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" disabled={busy === p.id} onClick={() => setEditPlan(p)}>Edit</Button>
                      <Button variant={p.active ? 'secondary' : 'primary'} disabled={busy === p.id} onClick={() => toggleActive(p)}>
                        {busy === p.id ? '…' : p.active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="danger" disabled={busy === p.id} onClick={() => deletePlan(p)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(showCreate || editPlan) && (
        <PlanModal
          plan={editPlan}
          onClose={() => { setShowCreate(false); setEditPlan(null); }}
          call={call}
        />
      )}
    </div>
  );
}

function PlanModal({
  plan,
  onClose,
  call,
}: {
  plan: Plan | null;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  const [period, setPeriod] = useState<'weekly' | 'yearly'>(plan?.billingPeriod ?? 'weekly');
  const [price, setPrice] = useState(String(plan?.pricePKR ?? ''));
  const [likes, setLikes] = useState(String(plan?.dailyLikeAllowance ?? ''));
  const [loading, setLoading] = useState(false);

  async function submit() {
    const pricePKR = parseInt(price, 10);
    const dailyLikeAllowance = parseInt(likes, 10);
    if (!name.trim() || isNaN(pricePKR) || isNaN(dailyLikeAllowance)) {
      alert('Fill all fields with valid values.');
      return;
    }
    setLoading(true);
    try {
      if (plan) {
        await call(() => adminApi.adminUpdateTravelMatePlan({ planId: plan.id, name: name.trim(), billingPeriod: period, pricePKR, dailyLikeAllowance }), plan.id);
      } else {
        await call(() => adminApi.adminCreateTravelMatePlan({ name: name.trim(), billingPeriod: period, pricePKR, dailyLikeAllowance }), 'create');
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 400, maxWidth: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>{plan ? 'Edit plan' : 'New plan'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Plan name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekly Pro" style={inputStyle} />
          </Field>
          <Field label="Billing period">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['weekly', 'yearly'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)} style={{ ...pillStyle, ...(period === p ? pillActiveStyle : {}) }}>{p}</button>
              ))}
            </div>
          </Field>
          <Field label="Price (PKR)">
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="299" style={inputStyle} />
          </Field>
          <Field label="Daily like allowance">
            <input type="number" value={likes} onChange={e => setLikes(e.target.value)} placeholder="20" style={inputStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" disabled={loading} onClick={submit}>{loading ? '…' : plan ? 'Save' : 'Create'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Subscriptions tab ─────────────────────────────────────────────────────────

function SubsTab({
  subs,
  filter,
  setFilter,
  busy,
  call,
}: {
  subs: Sub[];
  filter: SubFilter;
  setFilter: (f: SubFilter) => void;
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [rejectModal, setRejectModal] = useState<Sub | null>(null);

  async function approve(s: Sub) {
    if (!confirm(`Approve subscription for ${s.uid.slice(0, 8)}…? This will debit their wallet and grant daily likes.`)) return;
    await call(() => adminApi.approveTravelMateSubscription({ subscriptionId: s.id }), s.id);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['pending', 'active', 'rejected', 'expired'] as SubFilter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...pillStyle, ...(filter === f ? pillActiveStyle : {}) }}>
            {f}
          </button>
        ))}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>User UID</th>
                <th style={th}>Plan</th>
                <th style={th}>Payment</th>
                <th style={th}>Requested</th>
                <th style={th}>Expires</th>
                <th style={th}>Status</th>
                {filter === 'pending' && <th style={th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr><td colSpan={filter === 'pending' ? 7 : 6} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>No {filter} subscriptions.</td></tr>
              )}
              {subs.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}><code style={{ fontSize: 11 }}>{s.uid.slice(0, 14)}…</code></td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{s.planSnapshot?.name ?? '—'}</div>
                    <div style={{ color: colors.muted, fontSize: 11 }}>PKR {s.planSnapshot?.pricePKR} · {s.planSnapshot?.dailyLikeAllowance}/day</div>
                  </td>
                  <td style={td}>
                    <div>{s.paymentMethod}</div>
                    {s.paymentProofURL && (
                      <a href={s.paymentProofURL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: colors.primary }}>View proof</a>
                    )}
                  </td>
                  <td style={td}>{s.requestedAt ? fmtDate(s.requestedAt.seconds) : '—'}</td>
                  <td style={td}>{s.endAt ? fmtDate(s.endAt.seconds) : '—'}</td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  {filter === 'pending' && (
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button variant="primary" disabled={busy === s.id} onClick={() => approve(s)}>
                          {busy === s.id ? '…' : 'Approve'}
                        </Button>
                        <Button variant="danger" disabled={busy === s.id} onClick={() => setRejectModal(s)}>
                          Reject
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rejectModal && (
        <RejectModal
          sub={rejectModal}
          onClose={() => setRejectModal(null)}
          call={call}
        />
      )}
    </div>
  );
}

function RejectModal({
  sub,
  onClose,
  call,
}: {
  sub: Sub;
  onClose: () => void;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    await call(
      () => adminApi.rejectTravelMateSubscription({ subscriptionId: sub.id, reason: reason.trim() || undefined }),
      sub.id,
    );
    setLoading(false);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ width: 400, maxWidth: '90%' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text, marginBottom: 12 }}>Reject subscription</h2>
        <p style={{ fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          User: <code>{sub.uid.slice(0, 14)}…</code> · Plan: {sub.planSnapshot?.name}
        </p>
        <Field label="Rejection reason (optional — shown to user)">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Payment proof unclear. Please re-upload."
            style={{ ...inputStyle, height: 72, resize: 'vertical' }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="danger" disabled={loading} onClick={submit}>{loading ? '…' : 'Reject'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings }: { settings: TmSettings }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(settings); }, [settings]);

  async function save() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'travelMateSettings'), {
        ...form,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function num(field: keyof TmSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: parseFloat(e.target.value) || 0 }));
  }

  return (
    <Card style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 16 }}>Global Travel Mate settings</h2>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Free monthly likes (per user)">
          <input type="number" value={form.freeMonthlySwipes} onChange={num('freeMonthlySwipes')} style={inputStyle} />
        </Field>
        <Field label="Discovery radius (km)">
          <input type="number" step="0.5" value={form.discoveryRadiusKm} onChange={num('discoveryRadiusKm')} style={inputStyle} />
        </Field>
        <Field label="Max group size">
          <input type="number" value={form.maxGroupSize} onChange={num('maxGroupSize')} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>Enforce mutual gender preference</div>
            <div style={{ fontSize: 11, color: colors.muted }}>Both users must accept each other's gender to appear in each other's feed</div>
          </div>
          <input
            type="checkbox"
            checked={form.enforceMutualGender}
            onChange={e => setForm(prev => ({ ...prev, enforceMutualGender: e.target.checked }))}
            style={{ width: 18, height: 18, accentColor: colors.primary }}
          />
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
        </Button>
      </div>
    </Card>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: colors.muted }}>{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'active'   ? colors.primary :
    status === 'pending'  ? '#f59e0b' :
    status === 'rejected' ? colors.danger :
    status === 'inactive' ? colors.danger :
    colors.muted;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, backgroundColor: `${color}22`, color }}>
      {status}
    </span>
  );
}

function fmtDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12 };
const td: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surface,
  color: colors.text,
  fontSize: 14,
  boxSizing: 'border-box',
};

const pillStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 99,
  border: `1.5px solid ${colors.border}`,
  backgroundColor: 'transparent',
  color: colors.muted,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'capitalize',
};

const pillActiveStyle: React.CSSProperties = {
  borderColor: colors.primary,
  backgroundColor: `${colors.primary}18`,
  color: colors.primary,
};

// ── Moderation tab ────────────────────────────────────────────────────────────

function ModerationTab({
  reports,
  busy,
  call,
}: {
  reports: ModerationReport[];
  busy: string | null;
  call: <T>(fn: () => Promise<T>, id: string) => Promise<T | null>;
}) {
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);

  async function suspend(uid: string, reason: string) {
    await call(() => adminApi.adminSuspendTravelMateProfile({ targetUid: uid, reason }), `suspend-${uid}`);
    setSuspendTarget(null);
    setSuspendReason('');
  }

  if (reports.length === 0) {
    return (
      <Card>
        <p style={{ color: colors.muted, fontSize: 14, margin: 0, textAlign: 'center' }}>
          No open reports — queue is clear ✅
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {reports.map(r => (
        <Card key={r.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.danger, background: `${colors.danger}18`, padding: '3px 8px', borderRadius: 6 }}>🚩 Open</span>
                {r.createdAt && (
                  <span style={{ fontSize: 11, color: colors.muted }}>
                    {new Date(r.createdAt.seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  Reporter: <code style={{ color: colors.text, fontSize: 11 }}>{r.reporterId}</code>
                </div>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  Reported: <code style={{ color: colors.text, fontSize: 11 }}>{r.reportedUid}</code>
                </div>
                {r.matchId && (
                  <div style={{ fontSize: 13, color: colors.muted }}>
                    Match: <code style={{ color: colors.text, fontSize: 11 }}>{r.matchId}</code>
                  </div>
                )}
                <div style={{ fontSize: 13, color: colors.text, marginTop: 4, padding: '8px 10px', borderRadius: 8, background: colors.bg }}>
                  "{r.reason}"
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suspendTarget === r.reportedUid ? (
                <div style={{ display: 'grid', gap: 8, minWidth: 220 }}>
                  <input
                    value={suspendReason}
                    onChange={e => setSuspendReason(e.target.value)}
                    placeholder="Suspension reason (optional)"
                    style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="ghost" onClick={() => setSuspendTarget(null)}>Cancel</Button>
                    <Button
                      variant="danger"
                      disabled={busy === `suspend-${r.reportedUid}`}
                      onClick={() => suspend(r.reportedUid, suspendReason)}
                    >
                      {busy === `suspend-${r.reportedUid}` ? 'Suspending…' : 'Confirm suspend'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setSuspendTarget(r.reportedUid)}>
                  Suspend profile
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
