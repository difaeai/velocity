'use client';

/**
 * Earn with Velocity — the Partner Program admin desk.
 *
 * Four jobs live here, and they are four tabs rather than four pages because an
 * admin working this program moves between them constantly: an application comes
 * in, you approve it; a fraud signal fires, you go zero the ride's commission;
 * a withdrawal lands, you check the partner is not the one you just flagged.
 *
 * The settings tab is the only place the commission rates exist. They are a
 * fraction of Velocity's PLATFORM COMMISSION, never of the fare — the input
 * labels say so, because an admin who types "5" thinking it means 5% of the fare
 * would be handing out five times what the business earns on the ride.
 */

import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card, StatCard, Badge } from '@/components/ui';
import { FranchisesPanel } from '@/components/FranchisesPanel';

type Tab = 'applications' | 'partners' | 'withdrawals' | 'fraud' | 'franchises' | 'settings';

type Tier = 'free' | 'pro';

interface Application {
  id: string;
  uid: string;
  tier?: Tier;
  fullName?: string;
  mobile?: string;
  city?: string;
  /** Which document the photos show; older applications predate it → CNIC. */
  idType?: string;
  cnicNumber?: string;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;
  photoURL?: string | null;
  /** Pro only — the registration-fee receipt. */
  paymentProofUrl?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  /** Pro only — plan length bought, in months (3, 6 or 12). */
  proMonths?: number | null;
  quotedFee?: number;
  quotedFeeCurrency?: string;
  status: string;
  submittedAt?: { seconds: number };
}

interface Partner {
  id: string;
  tier?: Tier;
  referralCode?: string;
  fullName?: string;
  city?: string;
  mobile?: string;
  status: string;
  level?: string;
  totalDrivers?: number;
  totalPassengers?: number;
  completedRides?: number;
  flaggedRides?: number;
  lifetimeEarnings?: number;
}

interface Withdrawal {
  id: string;
  partnerId: string;
  amount: number;
  method: string;
  accountName?: string;
  accountNumber?: string;
  bankName?: string | null;
  status: string;
  createdAt?: { seconds: number };
}

interface FraudLog {
  id: string;
  kind: string;
  partnerId: string;
  subjectUid: string;
  tripId?: string | null;
  detail: string;
  createdAt?: { seconds: number };
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'applications', label: 'Applications' },
  { key: 'partners', label: 'Partners' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'fraud', label: 'Fraud monitor' },
  { key: 'franchises', label: 'Franchises (legacy)' },
  { key: 'settings', label: 'Settings' },
];

function when(ts?: { seconds: number }): string {
  return ts ? new Date(ts.seconds * 1000).toLocaleString() : '—';
}

function pkr(n?: number): string {
  return `Rs ${Math.round(n ?? 0).toLocaleString('en-PK')}`;
}

/** The registration fee in whatever currency the admin configured. */
function fee(amount: number, currency?: string): string {
  if (!currency || currency === 'PKR') return pkr(amount);
  if (currency === 'USD') return `$${amount.toLocaleString('en-US')}`;
  return `${amount.toLocaleString('en-US')} ${currency}`;
}

const ID_TYPE_LABELS: Record<string, string> = {
  cnic: 'CNIC',
  university_card: 'University card',
  driving_license: 'Driving licence',
  passport: 'Passport',
  other: 'Other ID',
};

function idTypeLabel(idType?: string): string {
  return ID_TYPE_LABELS[idType ?? 'cnic'] ?? 'ID';
}

export default function PartnersPage() {
  // /dashboard/franchises redirects here with ?tab=franchises, so an old
  // bookmark still lands on the franchise list rather than the application queue.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'applications';
    const q = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((t) => t.key === q) ? (q as Tab) : 'applications';
  });
  const [apps, setApps] = useState<Application[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [fraud, setFraud] = useState<FraudLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, 'partner_applications'), where('status', '==', 'pending')),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Application);
          // Oldest first — nobody waits behind a newer applicant.
          list.sort((a, b) => (a.submittedAt?.seconds ?? 0) - (b.submittedAt?.seconds ?? 0));
          setApps(list);
        },
        (e) => setError(e.message),
      ),
      onSnapshot(collection(db, 'partners'), (snap) =>
        setPartners(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Partner)),
      ),
      onSnapshot(
        query(collection(db, 'withdraw_requests'), orderBy('createdAt', 'desc')),
        (snap) => setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Withdrawal)),
      ),
      onSnapshot(
        query(collection(db, 'partner_fraud_logs'), orderBy('createdAt', 'desc')),
        (snap) => setFraud(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FraudLog)),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const openFraud = fraud.filter((f) => !('resolved' in f) || !(f as never)['resolved']);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, color: colors.text }}>🏢 Partner Program</h1>
        <p style={{ color: colors.muted, marginTop: 6, fontSize: 14 }}>
          Partners earn a share of Velocity&apos;s <strong>platform commission</strong> on genuine
          completed rides run by the drivers and passengers they recruited — never a share of the
          fare. Free earns 0.5% on both fleets; Pro pays a one-off fee and earns 2% (driver) and
          1.3% (passenger).
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatCard label="Pending applications" value={String(apps.length)} />
        <StatCard label="Active partners" value={String(partners.filter((p) => p.status === 'active').length)} />
        <StatCard label="Pending withdrawals" value={String(pendingWithdrawals.length)} />
        <StatCard label="Fraud signals" value={String(openFraud.length)} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${tab === t.key ? colors.primary : colors.border}`,
              background: tab === t.key ? colors.primary : 'transparent',
              color: tab === t.key ? '#fff' : colors.text,
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t.label}
            {t.key === 'applications' && apps.length > 0 ? ` (${apps.length})` : ''}
            {t.key === 'withdrawals' && pendingWithdrawals.length > 0 ? ` (${pendingWithdrawals.length})` : ''}
          </button>
        ))}
      </div>

      {error ? (
        <div style={{ color: colors.danger, fontSize: 13, fontWeight: 700 }}>{error}</div>
      ) : null}

      {tab === 'applications' ? (
        <Applications apps={apps} busy={busy} run={run} />
      ) : tab === 'partners' ? (
        <Partners partners={partners} busy={busy} run={run} />
      ) : tab === 'withdrawals' ? (
        <Withdrawals rows={withdrawals} busy={busy} run={run} />
      ) : tab === 'fraud' ? (
        <FraudMonitor rows={fraud} busy={busy} run={run} />
      ) : tab === 'franchises' ? (
        <FranchisesPanel />
      ) : (
        <Settings />
      )}
    </div>
  );
}

type Runner = (key: string, fn: () => Promise<unknown>) => Promise<void>;

function Applications({ apps, busy, run }: { apps: Application[]; busy: string | null; run: Runner }) {
  if (apps.length === 0) {
    return <Card><p style={{ color: colors.muted, margin: 0 }}>No applications waiting. 🎉</p></Card>;
  }

  // Pro and Free are different jobs — a Pro review is a payment check against a
  // receipt, a Free review is only an identity check — so they queue separately.
  const pro = apps.filter((a) => a.tier === 'pro');
  const free = apps.filter((a) => a.tier !== 'pro');

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <ApplicationSection
        title={`⭐ Pro applications (${pro.length})`}
        hint="Paid a plan fee — verify the receipt against your account before approving."
        apps={pro}
        empty="No Pro applications waiting."
        busy={busy}
        run={run}
      />
      <ApplicationSection
        title={`Free applications (${free.length})`}
        hint="No payment involved — just check the identity document."
        apps={free}
        empty="No Free applications waiting."
        busy={busy}
        run={run}
      />
    </div>
  );
}

function ApplicationSection({
  title,
  hint,
  apps,
  empty,
  busy,
  run,
}: {
  title: string;
  hint: string;
  apps: Application[];
  empty: string;
  busy: string | null;
  run: Runner;
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, color: colors.text, fontSize: 16 }}>{title}</h3>
        <p style={{ margin: '4px 0 0', color: colors.muted, fontSize: 12 }}>{hint}</p>
      </div>
      {apps.length === 0 ? (
        <Card><p style={{ color: colors.muted, margin: 0, fontSize: 13 }}>{empty}</p></Card>
      ) : (
        apps.map((a) => {
        const isPro = a.tier === 'pro';
        return (
        <Card key={a.id}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {a.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.photoURL} alt="" style={{ width: 40, height: 40, borderRadius: 20, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: colors.border }} />
                )}
                <div>
                  <div style={{ color: colors.text, fontWeight: 800 }}>{a.fullName ?? a.uid}</div>
                  <div style={{ color: colors.muted, fontSize: 12 }}>{a.mobile} · {a.city}</div>
                </div>
                <Badge
                  label={isPro ? 'PRO' : 'FREE'}
                  color={isPro ? colors.primary : colors.muted}
                />
              </div>

              <Row label={idTypeLabel(a.idType)} value={a.cnicNumber ?? '—'} />
              <Row label="Submitted" value={when(a.submittedAt)} />
              {isPro ? (
                <>
                  <Row
                    label="Plan"
                    value={a.proMonths ? (a.proMonths === 12 ? '1 year' : `${a.proMonths} months`) : '—'}
                  />
                  <Row label="Bill quoted" value={fee(a.quotedFee ?? 0, a.quotedFeeCurrency)} />
                  <Row label="Paid via" value={a.paymentMethod ?? '—'} />
                  <Row label="Txn ref" value={a.paymentReference || '—'} />
                </>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 10, flex: '1 1 300px' }}>
              <DocImage url={a.cnicFrontUrl} label={`${idTypeLabel(a.idType)} front`} />
              {a.cnicBackUrl ? (
                <DocImage url={a.cnicBackUrl} label={`${idTypeLabel(a.idType)} back`} />
              ) : null}
              {/* The receipt is the WHOLE point of the Pro gate — nothing in the
                  backend can tell a real transfer from a doctored screenshot, so
                  this image is the check. Open it before approving Pro. */}
              {isPro ? <DocImage url={a.paymentProofUrl ?? undefined} label="Payment receipt" /> : null}
            </div>
          </div>

          {isPro ? (
            <p style={{ color: colors.warn, fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              ⚠️ Check the receipt against your account before approving as Pro. Approving as Free
              instead lets them in at 0.5% without the fee.
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button
              disabled={busy === a.uid}
              onClick={() =>
                run(a.uid, () =>
                  adminApi.adminReviewPartnerApplication({
                    uid: a.uid,
                    decision: 'approve',
                    tier: a.tier ?? 'free',
                  }),
                )
              }
            >
              Approve as {isPro ? 'Pro' : 'Free'}
            </Button>
            {isPro ? (
              <Button
                variant="ghost"
                disabled={busy === a.uid}
                onClick={() =>
                  run(a.uid, () =>
                    adminApi.adminReviewPartnerApplication({
                      uid: a.uid,
                      decision: 'approve',
                      tier: 'free',
                    }),
                  )
                }
              >
                Approve as Free (no fee received)
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={busy === a.uid}
              onClick={() => {
                const reason = window.prompt('What should they fix? (shown to the applicant)');
                if (!reason) return;
                return run(a.uid, () =>
                  adminApi.adminReviewPartnerApplication({ uid: a.uid, decision: 'resubmit', reason }),
                );
              }}
            >
              Request resubmission
            </Button>
            <Button
              variant="danger"
              disabled={busy === a.uid}
              onClick={() => {
                const reason = window.prompt('Reason for rejection (shown to the applicant)');
                if (!reason) return;
                return run(a.uid, () =>
                  adminApi.adminReviewPartnerApplication({ uid: a.uid, decision: 'reject', reason }),
                );
              }}
            >
              Reject
            </Button>
          </div>
        </Card>
        );
        })
      )}
    </div>
  );
}

interface PartnerEditForm {
  id: string;
  fullName: string;
  city: string;
  mobile: string;
  tier: Tier;
}

function Partners({ partners, busy, run }: { partners: Partner[]; busy: string | null; run: Runner }) {
  const [editing, setEditing] = useState<PartnerEditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function saveEdit() {
    if (!editing) return;
    if (editing.fullName.trim().length < 2) {
      setEditError('Full name is required.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await adminApi.adminUpdatePartner({
        partnerId: editing.id,
        fullName: editing.fullName.trim(),
        city: editing.city.trim() || undefined,
        mobile: editing.mobile.trim() || undefined,
        tier: editing.tier,
      });
      setEditing(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  if (partners.length === 0) {
    return <Card><p style={{ color: colors.muted, margin: 0 }}>No partners yet.</p></Card>;
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
    {editing ? (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: colors.text, fontSize: 15 }}>Edit partner</h3>
          <button
            onClick={() => setEditing(null)}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: colors.muted }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'grid', gap: 12, maxWidth: 420, marginTop: 12 }}>
          <FieldRow label="Full name" suffix="also renames both fleets" value={editing.fullName} onChange={(v) => setEditing((f) => f && { ...f, fullName: v })} wide />
          <FieldRow label="City" suffix="" value={editing.city} onChange={(v) => setEditing((f) => f && { ...f, city: v })} wide />
          <FieldRow label="Mobile" suffix="" value={editing.mobile} onChange={(v) => setEditing((f) => f && { ...f, mobile: v })} wide />
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>Tier</span>
            <select
              value={editing.tier}
              onChange={(e) => setEditing((f) => f && { ...f, tier: e.target.value as Tier })}
              style={{
                width: 200,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                fontSize: 14,
              }}
            >
              <option value="free">Free — 0.5% both fleets</option>
              <option value="pro">Pro — 2% / 1.3%</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          {editError ? <span style={{ color: colors.danger, fontSize: 13 }}>{editError}</span> : null}
        </div>
      </Card>
    ) : null}
    <Card>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
          <thead>
            <tr style={{ color: colors.muted, textAlign: 'left' }}>
              <th style={th}>Partner</th>
              <th style={th}>Tier</th>
              <th style={th}>Code</th>
              <th style={th}>Level</th>
              <th style={th}>Drivers</th>
              <th style={th}>Passengers</th>
              <th style={th}>Rides</th>
              <th style={th}>Flagged</th>
              <th style={th}>Earned</th>
              <th style={th}>Status</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={td}>
                  <div style={{ color: colors.text, fontWeight: 700 }}>{p.fullName ?? p.id}</div>
                  <div style={{ color: colors.muted, fontSize: 11 }}>{p.city} · {p.mobile}</div>
                </td>
                <td style={td}>
                  <Badge
                    label={p.tier === 'pro' ? 'PRO' : 'FREE'}
                    color={p.tier === 'pro' ? colors.primary : colors.muted}
                  />
                </td>
                <td style={{ ...td, fontWeight: 800, letterSpacing: 1 }}>
                  {p.referralCode ?? '—'}
                </td>
                <td style={td}>{p.level ?? 'bronze'}</td>
                <td style={td}>{p.totalDrivers ?? 0}</td>
                <td style={td}>{p.totalPassengers ?? 0}</td>
                <td style={td}>{p.completedRides ?? 0}</td>
                <td style={{ ...td, color: (p.flaggedRides ?? 0) > 0 ? colors.danger : colors.muted }}>
                  {p.flaggedRides ?? 0}
                </td>
                <td style={td}>{pkr(p.lifetimeEarnings)}</td>
                <td style={td}>
                  <Badge
                    label={p.status}
                    color={p.status === 'active' ? colors.primary : colors.danger}
                  />
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      variant="ghost"
                      disabled={busy === p.id}
                      onClick={() =>
                        setEditing({
                          id: p.id,
                          fullName: p.fullName ?? '',
                          city: p.city ?? '',
                          mobile: p.mobile ?? '',
                          tier: p.tier === 'pro' ? 'pro' : 'free',
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant={p.status === 'active' ? 'danger' : 'secondary'}
                      disabled={busy === p.id}
                      onClick={() => {
                        const suspending = p.status === 'active';
                        const reason = suspending
                          ? window.prompt('Reason for suspension (shown to the partner)') ?? undefined
                          : undefined;
                        if (suspending && !reason) return;
                        return run(p.id, () =>
                          adminApi.adminSuspendPartner({
                            partnerId: p.id,
                            suspended: suspending,
                            reason,
                          }),
                        );
                      }}
                    >
                      {p.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy === p.id}
                      onClick={() => {
                        const sure = window.confirm(
                          `Permanently delete ${p.fullName ?? p.id}?\n\nTheir fleets, wallet and recruit links are removed, their code ${p.referralCode ?? ''} stops working, and they can apply to the program afresh. This cannot be undone.`,
                        );
                        if (!sure) return;
                        const reason = window.prompt('Reason (optional — shown to the user)');
                        if (reason === null) return;
                        return run(p.id, () =>
                          adminApi.adminDeletePartner({
                            partnerId: p.id,
                            reason: reason.trim() || undefined,
                          }),
                        );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    </div>
  );
}

function Withdrawals({ rows, busy, run }: { rows: Withdrawal[]; busy: string | null; run: Runner }) {
  if (rows.length === 0) {
    return <Card><p style={{ color: colors.muted, margin: 0 }}>No withdrawal requests.</p></Card>;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((w) => (
        <Card key={w.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: colors.text, fontWeight: 800, fontSize: 18 }}>{pkr(w.amount)}</div>
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                {w.method} · {w.accountName} · {w.accountNumber}
                {w.bankName ? ` · ${w.bankName}` : ''}
              </div>
              <div style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                Partner {w.partnerId} · {when(w.createdAt)}
              </div>
            </div>
            <Badge
              label={w.status}
              color={
                w.status === 'paid'
                  ? colors.primary
                  : w.status === 'rejected'
                    ? colors.danger
                    : colors.secondary
              }
            />
          </div>

          {w.status === 'pending' || w.status === 'approved' ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {w.status === 'pending' ? (
                <Button
                  disabled={busy === w.id}
                  onClick={() => run(w.id, () => adminApi.adminReviewWithdrawal({ requestId: w.id, decision: 'approve' }))}
                >
                  Approve
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={busy === w.id}
                onClick={() => run(w.id, () => adminApi.adminReviewWithdrawal({ requestId: w.id, decision: 'paid' }))}
              >
                Mark paid
              </Button>
              <Button
                variant="danger"
                disabled={busy === w.id}
                onClick={() => {
                  const reason = window.prompt('Reason for rejection (the amount returns to their balance)');
                  if (!reason) return;
                  return run(w.id, () =>
                    adminApi.adminReviewWithdrawal({ requestId: w.id, decision: 'reject', reason }),
                  );
                }}
              >
                Reject
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function FraudMonitor({ rows, busy, run }: { rows: FraudLog[]; busy: string | null; run: Runner }) {
  if (rows.length === 0) {
    return <Card><p style={{ color: colors.muted, margin: 0 }}>No fraud signals. 🎉</p></Card>;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
        Rides flagged automatically already paid zero commission. Marking a ride as scam or fraud
        here <strong>reverses</strong> any commission it did pay — out of the partner&apos;s pending
        balance first, then their available balance.
      </p>
      {rows.map((f) => (
        <Card key={f.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <Badge label={f.kind.replace(/_/g, ' ')} color={colors.danger} />
              <div style={{ color: colors.text, marginTop: 8, fontSize: 14 }}>{f.detail}</div>
              <div style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
                Partner {f.partnerId} · subject {f.subjectUid}
                {f.tripId ? ` · trip ${f.tripId}` : ''} · {when(f.createdAt)}
              </div>
            </div>
            {f.tripId ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <Button
                  variant="danger"
                  disabled={busy === f.id}
                  onClick={() => {
                    const reason = window.prompt('Why is this a scam ride?') ?? undefined;
                    if (!reason) return;
                    return run(f.id, () =>
                      adminApi.adminMarkRideStatus({ tripId: f.tripId!, status: 'scam', reason }),
                    );
                  }}
                >
                  Mark scam
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy === f.id}
                  onClick={() =>
                    run(f.id, () =>
                      adminApi.adminMarkRideStatus({ tripId: f.tripId!, status: 'completed' }),
                    )
                  }
                >
                  It&apos;s genuine
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * The rates, the fee and the accounts.
 *
 * Every rate is a fraction of the PLATFORM COMMISSION, and the labels say so —
 * an admin who reads "2%" as "2% of the fare" would be handing out roughly ten
 * times what they meant to.
 *
 * The three account numbers are the ONLY place a Pro applicant learns where to
 * send their fee. Left blank, the apply screen tells the applicant the program
 * is not set up yet — which is the honest failure, and far better than showing
 * them a stale account that swallows their money.
 */
function Settings() {
  const [freeDriver, setFreeDriver] = useState('0.5');
  const [freePassenger, setFreePassenger] = useState('0.5');
  const [proDriver, setProDriver] = useState('2');
  const [proPassenger, setProPassenger] = useState('1.3');
  const [proMonthlyFee, setProMonthlyFee] = useState('4500');
  const [proFeeCurrency, setProFeeCurrency] = useState('PKR');
  const [bankName, setBankName] = useState('');
  const [bankAccountTitle, setBankAccountTitle] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [easypaisaTitle, setEasypaisaTitle] = useState('');
  const [easypaisa, setEasypaisa] = useState('');
  const [jazzcashTitle, setJazzcashTitle] = useState('');
  const [jazzcash, setJazzcash] = useState('');
  const [minWithdrawal, setMinWithdrawal] = useState('500');
  const [holdHours, setHoldHours] = useState('72');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'partnerSettings'), (snap) => {
      const d = snap.data();
      if (!d) return;
      const asPct = (v: unknown, fallback: string) =>
        typeof v === 'number' ? String(v * 100) : fallback;
      setFreeDriver(asPct(d.free?.driverFleetRate, '0.5'));
      setFreePassenger(asPct(d.free?.passengerFleetRate, '0.5'));
      setProDriver(asPct(d.pro?.driverFleetRate, '2'));
      setProPassenger(asPct(d.pro?.passengerFleetRate, '1.3'));
      if (typeof d.proMonthlyFee === 'number') setProMonthlyFee(String(d.proMonthlyFee));
      if (typeof d.proFeeCurrency === 'string') setProFeeCurrency(d.proFeeCurrency);
      setBankName(d.payment?.bankName ?? '');
      setBankAccountTitle(d.payment?.bankAccountTitle ?? '');
      setBankAccount(d.payment?.bankAccount ?? '');
      setEasypaisaTitle(d.payment?.easypaisaTitle ?? '');
      setEasypaisa(d.payment?.easypaisaAccount ?? '');
      setJazzcashTitle(d.payment?.jazzcashTitle ?? '');
      setJazzcash(d.payment?.jazzcashAccount ?? '');
      if (typeof d.minWithdrawal === 'number') setMinWithdrawal(String(d.minWithdrawal));
      if (typeof d.holdHours === 'number') setHoldHours(String(d.holdHours));
    });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const [fd, fp, pd, pp] = [freeDriver, freePassenger, proDriver, proPassenger].map(
        (r) => Number(r) / 100,
      );
      if ([fd, fp, pd, pp].some((r) => !(r >= 0 && r <= 0.5))) {
        throw new Error('Every rate must be between 0% and 50% of the platform commission.');
      }
      await setDoc(
        doc(db, 'config', 'partnerSettings'),
        {
          free: { driverFleetRate: fd, passengerFleetRate: fp },
          pro: { driverFleetRate: pd, passengerFleetRate: pp },
          proMonthlyFee: Number(proMonthlyFee),
          proFeeCurrency: proFeeCurrency.trim().toUpperCase() || 'PKR',
          payment: {
            bankName: bankName.trim() || null,
            bankAccountTitle: bankAccountTitle.trim() || null,
            bankAccount: bankAccount.trim() || null,
            easypaisaTitle: easypaisaTitle.trim() || null,
            easypaisaAccount: easypaisa.trim() || null,
            jazzcashTitle: jazzcashTitle.trim() || null,
            jazzcashAccount: jazzcash.trim() || null,
          },
          minWithdrawal: Number(minWithdrawal),
          holdHours: Number(holdHours),
          updatedAt: new Date(),
        },
        { merge: true },
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const noAccounts = !bankAccount.trim() && !easypaisa.trim() && !jazzcash.trim();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <h3 style={{ margin: '0 0 4px', color: colors.text }}>Tier rates</h3>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
          On a Rs 1,000 ride with a 10% platform commission (Rs 100), a 2% driver-fleet rate pays the
          partner <strong>Rs 2</strong> — 2% of the commission, not of the fare. Velocity&apos;s net
          can never go negative: the franchise cut is taken first, then the fleets, and a fleet is
          simply paid less if the commission runs out.
        </p>

        <div style={{ display: 'grid', gap: 14, maxWidth: 520, marginTop: 16 }}>
          <strong style={{ color: colors.text, fontSize: 13 }}>Free Partner</strong>
          <FieldRow label="Driver fleet" suffix="% of platform commission" value={freeDriver} onChange={setFreeDriver} />
          <FieldRow label="Passenger fleet" suffix="% of platform commission" value={freePassenger} onChange={setFreePassenger} />

          <strong style={{ color: colors.text, fontSize: 13, marginTop: 10 }}>Pro Partner</strong>
          <FieldRow label="Driver fleet" suffix="% of platform commission" value={proDriver} onChange={setProDriver} />
          <FieldRow label="Passenger fleet" suffix="% of platform commission" value={proPassenger} onChange={setProPassenger} />
          <FieldRow label="Monthly fee" suffix={`${proFeeCurrency} / month — billed for 3, 6 or 12 months`} value={proMonthlyFee} onChange={setProMonthlyFee} />
          <FieldRow label="Fee currency" suffix="e.g. PKR or USD" value={proFeeCurrency} onChange={setProFeeCurrency} />
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: '0 0 4px', color: colors.text }}>Where Pro applicants pay</h3>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
          Shown on the Pro application screen. Applicants copy one of these, pay, and upload a
          receipt for you to check.
        </p>
        {noAccounts ? (
          <p style={{ color: colors.warn, fontSize: 13, fontWeight: 700, margin: '8px 0 0' }}>
            ⚠️ No accounts set — Pro applicants currently have nowhere to send the fee.
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 14, maxWidth: 520, marginTop: 14 }}>
          <FieldRow label="Bank name" suffix="" value={bankName} onChange={setBankName} wide />
          <FieldRow label="Bank account title" suffix="account holder's name" value={bankAccountTitle} onChange={setBankAccountTitle} wide />
          <FieldRow label="Bank account / IBAN" suffix="" value={bankAccount} onChange={setBankAccount} wide />
          <FieldRow label="Easypaisa account title" suffix="account holder's name" value={easypaisaTitle} onChange={setEasypaisaTitle} wide />
          <FieldRow label="Easypaisa account" suffix="" value={easypaisa} onChange={setEasypaisa} wide />
          <FieldRow label="JazzCash account title" suffix="account holder's name" value={jazzcashTitle} onChange={setJazzcashTitle} wide />
          <FieldRow label="JazzCash account" suffix="" value={jazzcash} onChange={setJazzcash} wide />
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: '0 0 4px', color: colors.text }}>Payouts</h3>
        <div style={{ display: 'grid', gap: 14, maxWidth: 520, marginTop: 12 }}>
          <FieldRow label="Minimum withdrawal" suffix="PKR" value={minWithdrawal} onChange={setMinWithdrawal} />
          <FieldRow
            label="Fraud-hold window"
            suffix="hours before earnings can be withdrawn"
            value={holdHours}
            onChange={setHoldHours}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 18 }}>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save all settings'}
          </Button>
          {saved ? <span style={{ color: colors.primary, fontSize: 13, fontWeight: 700 }}>Saved ✓</span> : null}
          {error ? <span style={{ color: colors.danger, fontSize: 13 }}>{error}</span> : null}
        </div>
      </Card>
    </div>
  );
}

function FieldRow({
  label,
  suffix,
  value,
  onChange,
  wide,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  /** Account numbers need room; a rate needs four characters. */
  wide?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={wide ? 'text' : 'decimal'}
          style={{
            width: wide ? 320 : 100,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: 14,
          }}
        />
        {suffix ? <span style={{ color: colors.muted, fontSize: 12 }}>{suffix}</span> : null}
      </span>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginTop: 4 }}>
      <span style={{ color: colors.muted, minWidth: 90 }}>{label}</span>
      <span style={{ color: colors.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function DocImage({ url, label }: { url?: string; label: string }) {
  if (!url) {
    return (
      <div style={{ ...docBox, color: colors.muted, fontSize: 12 }}>{label} missing</div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} style={{ ...docBox, objectFit: 'cover' }} />
    </a>
  );
}

const docBox: React.CSSProperties = {
  width: '100%',
  height: 130,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: colors.surface,
};

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px', color: colors.text, whiteSpace: 'nowrap' };
