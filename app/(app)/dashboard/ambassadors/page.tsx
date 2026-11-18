'use client';

/**
 * Velocity Ambassador Program — the admin desk.
 *
 * Two jobs, two tabs: read the applications and decide them, then watch the
 * approved ambassadors work their targets.
 *
 * The number that matters on this page is "remaining". The owner described the
 * desk in exactly those terms — a count that goes 99, 98, 97 as users come in
 * and 14, 13 as Earn with Velocity sales land — because it is the only figure
 * that answers the question an admin actually has, which is whether this person
 * is going to earn their salary.
 *
 * The commission rate lives in the settings tab and ships at zero, deliberately
 * (backend ambassadors/config.ts): until somebody decides what one Earn with
 * Velocity sale pays, an ambassador who misses the targets is shown "to be
 * confirmed" rather than a figure the code invented.
 */

import { useCallback, useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, setDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { Badge, Button, Card, StatCard } from '@/components/ui';

type Tab = 'applications' | 'ambassadors' | 'settings';

interface Application {
  id: string;
  uid: string;
  fullName?: string;
  mobile?: string | null;
  cvUrl?: string | null;
  cnicUrl?: string | null;
  about?: string | null;
  status: string;
  rejectionReason?: string | null;
  submittedAt?: { seconds: number };
}

interface Progress {
  usersOnboarded: number;
  partnersSold: number;
  usersRemaining: number;
  partnersRemaining: number;
  userTargetMet: boolean;
  partnerTargetMet: boolean;
  salaryUnlocked: boolean;
  payPkr: number;
  payKind: 'salary' | 'commission';
  rateUnset: boolean;
}

interface Ambassador {
  uid: string;
  fullName: string;
  mobile: string | null;
  referralCode: string;
  status: string;
  payoutAccount: { accountTitle?: string; accountNumber?: string; bankName?: string } | null;
  progress: Progress;
}

interface Settings {
  userTarget: number;
  partnerTarget: number;
  salaryPkr: number;
  commissionPerPartnerPkr: number;
  currency: string;
}

const pkr = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;

export default function AmbassadorsPage() {
  const [tab, setTab] = useState<Tab>('applications');
  const [apps, setApps] = useState<Application[]>([]);
  const [list, setList] = useState<Ambassador[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The queue is live: an application decided in another tab must not sit here
  // looking actionable.
  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'ambassadorApplications'),
        where('status', 'in', ['pending', 'resubmit']),
        orderBy('submittedAt', 'desc'),
      ),
      (snap) => {
        setApps(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Application));
        setError(null);
      },
      // Never swallowed into an empty list. This query needs a composite index
      // on (status, submittedAt), and while one was missing the queue read
      // "Nothing waiting." — which is not an error anybody investigates, so
      // applications sat unapproved and nobody could see why.
      (e) => setError(`The application queue could not be read: ${e.message}`),
    );
  }, []);

  const loadList = useCallback(async () => {
    try {
      const res = await adminApi.adminListAmbassadors({});
      setList(res.ambassadors);
      setSettings(res.settings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load ambassadors.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function decide(uid: string, decision: 'approve' | 'reject' | 'resubmit') {
    let reason: string | undefined;
    if (decision !== 'approve') {
      // The applicant is shown this verbatim, so it is never optional.
      reason = window.prompt('Why? The applicant is shown this.') ?? undefined;
      if (!reason) return;
    }
    setBusy(uid);
    try {
      const res = await adminApi.adminReviewAmbassador({ uid, decision, reason });
      await loadList();
      if (decision === 'approve') {
        window.alert(`Approved. Their code is ${res.code}.`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not save that decision.');
    } finally {
      setBusy(null);
    }
  }

  const salaried = list.filter((a) => a.progress.salaryUnlocked).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ambassadors</h1>
        <p className="text-sm text-muted">
          The Velocity Ambassador Program — apply, approve, and watch the targets.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Waiting for approval" value={String(apps.length)} />
        <StatCard label="Ambassadors" value={String(list.length)} />
        <StatCard label="On salary" value={String(salaried)} />
        <StatCard
          label="Users onboarded"
          value={String(list.reduce((n, a) => n + a.progress.usersOnboarded, 0))}
        />
      </div>

      <div className="flex gap-2">
        {(['applications', 'ambassadors', 'settings'] as Tab[]).map((t) => (
          <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
            {t === 'applications'
              ? `Applications (${apps.length})`
              : t === 'ambassadors'
                ? `Ambassadors (${list.length})`
                : 'Settings'}
          </Button>
        ))}
      </div>

      {error ? <Card><p className="text-sm text-red-400">{error}</p></Card> : null}

      {tab === 'applications' ? (
        apps.length === 0 ? (
          <Card><p className="text-sm text-muted">Nothing waiting.</p></Card>
        ) : (
          <div className="space-y-4">
            {apps.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{a.fullName ?? a.uid}</p>
                    <p className="text-sm text-muted">{a.mobile ?? 'No number on the account'}</p>
                    {a.about ? <p className="mt-2 max-w-xl text-sm">{a.about}</p> : null}
                    <div className="mt-3 flex gap-3 text-sm">
                      {a.cvUrl ? (
                        <a className="underline" href={a.cvUrl} target="_blank" rel="noreferrer">
                          Open CV
                        </a>
                      ) : null}
                      {a.cnicUrl ? (
                        <a className="underline" href={a.cnicUrl} target="_blank" rel="noreferrer">
                          Open CNIC
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={busy === a.uid} onClick={() => decide(a.uid, 'approve')}>
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === a.uid}
                      onClick={() => decide(a.uid, 'resubmit')}
                    >
                      Ask again
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy === a.uid}
                      onClick={() => decide(a.uid, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'ambassadors' ? (
        list.length === 0 ? (
          <Card><p className="text-sm text-muted">No ambassadors yet.</p></Card>
        ) : (
          <div className="space-y-4">
            {list.map((a) => (
              <Card key={a.uid}>
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{a.fullName}</p>
                      <Badge label={a.progress.salaryUnlocked ? 'salary' : 'working'} />
                    </div>
                    <p className="text-sm text-muted">{a.mobile ?? '—'}</p>
                    <p className="mt-1 font-mono text-lg">{a.referralCode}</p>
                  </div>

                  {/* The two counts, as the owner asked for them: what is left. */}
                  <div className="flex gap-8">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">Users</p>
                      <p className="text-xl font-bold">{a.progress.usersOnboarded}</p>
                      <p className="text-sm text-muted">
                        {a.progress.userTargetMet
                          ? 'target met'
                          : `remaining ${a.progress.usersRemaining}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">
                        Earn with Velocity
                      </p>
                      <p className="text-xl font-bold">{a.progress.partnersSold}</p>
                      <p className="text-sm text-muted">
                        {a.progress.partnerTargetMet
                          ? 'target met'
                          : `remaining ${a.progress.partnersRemaining}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">Owed</p>
                      <p className="text-xl font-bold">
                        {a.progress.rateUnset ? 'TBC' : pkr(a.progress.payPkr)}
                      </p>
                      <p className="text-sm text-muted">{a.progress.payKind}</p>
                    </div>
                  </div>

                  <div className="min-w-[180px] text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted">Pay into</p>
                    {a.payoutAccount?.accountNumber ? (
                      <>
                        <p className="font-mono">{a.payoutAccount.accountNumber}</p>
                        <p className="text-muted">
                          {a.payoutAccount.accountTitle} · {a.payoutAccount.bankName}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted">Not added yet</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'settings' && settings ? (
        <SettingsPanel settings={settings} onSaved={loadList} />
      ) : null}
    </div>
  );
}

/**
 * The targets and the money. Written straight to `config/ambassadorSettings`,
 * which the backend reads field by field — so a half-saved document still
 * produces usable targets rather than zero ones.
 */
function SettingsPanel({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'config', 'ambassadorSettings'), form, { merge: true });
      onSaved();
      window.alert('Saved.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: keyof Settings,
    label: string,
    hint: string,
  ) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2"
        value={String(form[key] ?? 0)}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
      <span className="block text-xs text-muted">{hint}</span>
    </label>
  );

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-2">
        {field('userTarget', 'Users target', 'App installs that put the code in their profile. Compulsory — the salary does not unlock without it.')}
        {field('partnerTarget', 'Earn with Velocity target', 'Of those users, how many must buy a Starter or Pro plan.')}
        {field('salaryPkr', 'Salary (PKR)', 'Paid in full only when BOTH targets are met.')}
        {field(
          'commissionPerPartnerPkr',
          'Commission per sale (PKR)',
          'What one Earn with Velocity sale pays an ambassador who misses the targets. Zero means "not decided yet" — they are shown "to be confirmed" rather than PKR 0.',
        )}
      </div>
      <div className="mt-4">
        <Button disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}
