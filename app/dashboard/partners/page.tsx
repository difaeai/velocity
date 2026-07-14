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

type Tab = 'applications' | 'partners' | 'withdrawals' | 'fraud' | 'settings';

interface Application {
  id: string;
  uid: string;
  fullName?: string;
  mobile?: string;
  city?: string;
  cnicNumber?: string;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;
  photoURL?: string | null;
  status: string;
  submittedAt?: { seconds: number };
}

interface Partner {
  id: string;
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
  { key: 'settings', label: 'Settings' },
];

function when(ts?: { seconds: number }): string {
  return ts ? new Date(ts.seconds * 1000).toLocaleString() : '—';
}

function pkr(n?: number): string {
  return `Rs ${Math.round(n ?? 0).toLocaleString('en-PK')}`;
}

export default function PartnersPage() {
  const [tab, setTab] = useState<Tab>('applications');
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
        <h1 style={{ margin: 0, color: colors.text }}>💸 Earn with Velocity</h1>
        <p style={{ color: colors.muted, marginTop: 6, fontSize: 14 }}>
          Partners earn a share of Velocity&apos;s platform commission on genuine completed rides
          run by the drivers and passengers they recruited. Never a share of the fare.
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

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {apps.map((a) => (
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
              </div>

              <Row label="CNIC" value={a.cnicNumber ?? '—'} />
              <Row label="Submitted" value={when(a.submittedAt)} />
              <Row label="Status" value={a.status} />
            </div>

            <div style={{ display: 'flex', gap: 10, flex: '1 1 300px' }}>
              <DocImage url={a.cnicFrontUrl} label="CNIC front" />
              <DocImage url={a.cnicBackUrl} label="CNIC back" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button
              disabled={busy === a.uid}
              onClick={() =>
                run(a.uid, () => adminApi.adminReviewPartnerApplication({ uid: a.uid, decision: 'approve' }))
              }
            >
              Approve
            </Button>
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
      ))}
    </div>
  );
}

function Partners({ partners, busy, run }: { partners: Partner[]; busy: string | null; run: Runner }) {
  if (partners.length === 0) {
    return <Card><p style={{ color: colors.muted, margin: 0 }}>No partners yet.</p></Card>;
  }
  return (
    <Card>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
          <thead>
            <tr style={{ color: colors.muted, textAlign: 'left' }}>
              <th style={th}>Partner</th>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
 * The rates. Every one of them is a fraction of the PLATFORM COMMISSION, and the
 * labels say so — an admin who reads "1%" as "1% of the fare" would be giving
 * away roughly ten times what they meant to.
 */
function Settings() {
  const [driverRate, setDriverRate] = useState('1');
  const [passengerRate, setPassengerRate] = useState('1');
  const [minWithdrawal, setMinWithdrawal] = useState('500');
  const [holdHours, setHoldHours] = useState('72');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'partnerSettings'), (snap) => {
      const d = snap.data();
      if (!d) return;
      if (typeof d.driverFleetRate === 'number') setDriverRate(String(d.driverFleetRate * 100));
      if (typeof d.passengerFleetRate === 'number') setPassengerRate(String(d.passengerFleetRate * 100));
      if (typeof d.minWithdrawal === 'number') setMinWithdrawal(String(d.minWithdrawal));
      if (typeof d.holdHours === 'number') setHoldHours(String(d.holdHours));
    });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const driver = Number(driverRate) / 100;
      const passenger = Number(passengerRate) / 100;
      if (!(driver >= 0 && driver <= 50) || !(passenger >= 0 && passenger <= 50)) {
        throw new Error('Rates must be between 0% and 50% of the platform commission.');
      }
      await setDoc(
        doc(db, 'config', 'partnerSettings'),
        {
          driverFleetRate: driver,
          passengerFleetRate: passenger,
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

  return (
    <Card>
      <h3 style={{ margin: '0 0 4px', color: colors.text }}>Commission &amp; payouts</h3>
      <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
        On a Rs 1,000 ride with a 10% platform commission (Rs 100), a 1% driver-fleet rate pays the
        partner <strong>Rs 1</strong> — 1% of the commission, not of the fare. Velocity&apos;s net is
        never allowed to go negative: the franchise cut is taken first, then the fleets, and a fleet
        is simply paid less if the commission runs out.
      </p>

      <div style={{ display: 'grid', gap: 14, maxWidth: 460, marginTop: 16 }}>
        <FieldRow
          label="Driver fleet rate"
          suffix="% of platform commission"
          value={driverRate}
          onChange={setDriverRate}
        />
        <FieldRow
          label="Passenger fleet rate"
          suffix="% of platform commission"
          value={passengerRate}
          onChange={setPassengerRate}
        />
        <FieldRow
          label="Minimum withdrawal"
          suffix="PKR"
          value={minWithdrawal}
          onChange={setMinWithdrawal}
        />
        <FieldRow
          label="Fraud-hold window"
          suffix="hours before earnings can be withdrawn"
          value={holdHours}
          onChange={setHoldHours}
        />

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {saved ? <span style={{ color: colors.primary, fontSize: 13, fontWeight: 700 }}>Saved ✓</span> : null}
          {error ? <span style={{ color: colors.danger, fontSize: 13 }}>{error}</span> : null}
        </div>
      </div>
    </Card>
  );
}

function FieldRow({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          style={{
            width: 100,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: 14,
          }}
        />
        <span style={{ color: colors.muted, fontSize: 12 }}>{suffix}</span>
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
