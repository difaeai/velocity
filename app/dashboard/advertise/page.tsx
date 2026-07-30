'use client';

/**
 * Advertise — the "Find your Customers" desk.
 *
 * Businesses pay to push an offer to Velocity users inside a radius around their
 * shop. Four jobs, four tabs:
 *
 *   Requests    — approve the payment. This is the money gate: a screenshot, a
 *                 quoted amount, and the offer they intend to run, side by side.
 *                 Approving mints the plan and starts the clock.
 *   Advertisers — who is running, on what radius, until when. Suspend lives here.
 *   Live offers — every creative currently reaching phones. Publishing is NOT
 *                 gated on a second review (by design — an approved advertiser
 *                 publishes freely), so this tab is the lever for the offer that
 *                 should never have gone out.
 *   Settings    — prices per band, the notification budget, and the accounts
 *                 advertisers pay into. Changing a price never re-prices a plan
 *                 already sold; the quote is snapshotted at submission.
 *
 * REVIEWING A REQUEST — what to actually check
 * The amount on the screenshot must match "Quoted" exactly. The radius decides
 * the band and the band decides the price, so an advertiser who paid the 3 km
 * price for a 5 km radius should be approved DOWN to 3 km (the radius field on
 * the row does this) rather than rejected outright.
 */

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card, StatCard, Badge } from '@/components/ui';

type Tab = 'requests' | 'advertisers' | 'offers' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'advertisers', label: 'Advertisers' },
  { key: 'offers', label: 'Live offers' },
  { key: 'settings', label: 'Settings' },
];

interface Creative {
  title?: string;
  businessName?: string;
  offerDetails?: string;
  imageUrl?: string;
}

interface AdRequest {
  id: string;
  uid: string;
  status: string;
  radiusKm?: number;
  tierKey?: string;
  adSlots?: number;
  months?: number;
  monthlyFee?: number;
  totalFee?: number;
  currency?: string;
  city?: string;
  contactPhone?: string;
  center?: { lat: number; lng: number; address?: string | null };
  draft?: Creative;
  paymentProofUrl?: string;
  paymentMethod?: string;
  paymentReference?: string | null;
  submittedAt?: { seconds: number };
}

interface Advertiser {
  id: string;
  status: string;
  businessName?: string;
  city?: string;
  contactPhone?: string;
  radiusKm?: number;
  adSlots?: number;
  liveAds?: number;
  months?: number;
  monthlyFee?: number;
  totalFee?: number;
  expiresAt?: { seconds: number };
  totalNotified?: number;
  totalReach?: number;
  totalClicks?: number;
  suspensionReason?: string | null;
}

interface LiveAd {
  id: string;
  ownerUid: string;
  title?: string;
  businessName?: string;
  offerDetails?: string;
  imageUrl?: string;
  status: string;
  radiusKm?: number;
  city?: string;
  notified?: number;
  reach?: number;
  clicks?: number;
  moderationReason?: string | null;
  createdAt?: { seconds: number };
}

function when(ts?: { seconds: number }): string {
  return ts ? new Date(ts.seconds * 1000).toLocaleString() : '—';
}

function pkr(n?: number): string {
  return `Rs ${Math.round(n ?? 0).toLocaleString('en-PK')}`;
}

function daysLeft(ts?: { seconds: number }): number | null {
  if (!ts) return null;
  return Math.ceil((ts.seconds * 1000 - Date.now()) / 86_400_000);
}

export default function AdvertisePage() {
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<AdRequest[]>([]);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [ads, setAds] = useState<LiveAd[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, 'businessAdApplications'), where('status', '==', 'pending')),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdRequest);
          // Oldest first — nobody who paid waits behind someone who paid later.
          list.sort((a, b) => (a.submittedAt?.seconds ?? 0) - (b.submittedAt?.seconds ?? 0));
          setRequests(list);
        },
        (e) => setError(e.message),
      ),
      onSnapshot(
        collection(db, 'businessAdvertisers'),
        (snap) => setAdvertisers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Advertiser)),
        (e) => setError(e.message),
      ),
      onSnapshot(
        collection(db, 'businessAds'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as LiveAd)
            .filter((a) => a.status !== 'removed');
          list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
          setAds(list);
        },
        (e) => setError(e.message),
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

  const active = advertisers.filter((a) => a.status === 'active');
  const liveOffers = ads.filter((a) => a.status === 'active');
  const totalReach = advertisers.reduce((sum, a) => sum + (a.totalReach ?? 0), 0);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, color: colors.text }}>📣 Advertise</h1>
        <p style={{ color: colors.muted, marginTop: 6, fontSize: 14 }}>
          Businesses buy a radius around their shop and push one offer at a time to
          Velocity users inside it. Each user gets a given offer at most once every{' '}
          <strong>12 hours</strong>, inside a daily per-user ceiling. Approving a
          request is a <strong>payment check</strong>: the screenshot must match the
          quoted amount.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatCard label="Pending requests" value={String(requests.length)} />
        <StatCard label="Active advertisers" value={String(active.length)} />
        <StatCard label="Live offers" value={String(liveOffers.length)} />
        <StatCard label="People reached" value={totalReach.toLocaleString('en-PK')} />
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
            {t.key === 'requests' && requests.length > 0 ? ` (${requests.length})` : ''}
          </button>
        ))}
      </div>

      {error ? <div style={{ color: colors.danger, fontSize: 13, fontWeight: 700 }}>{error}</div> : null}

      {tab === 'requests' ? (
        <Requests rows={requests} busy={busy} run={run} />
      ) : tab === 'advertisers' ? (
        <Advertisers rows={advertisers} busy={busy} run={run} />
      ) : tab === 'offers' ? (
        <Offers rows={ads} busy={busy} run={run} />
      ) : (
        <Settings />
      )}
    </div>
  );
}

type Runner = (key: string, fn: () => Promise<unknown>) => Promise<void>;

// ── Requests ─────────────────────────────────────────────────────────────────

function Requests({ rows, busy, run }: { rows: AdRequest[]; busy: string | null; run: Runner }) {
  if (rows.length === 0) {
    return (
      <Card>
        <p style={{ color: colors.muted, margin: 0 }}>No advertising requests waiting. 🎉</p>
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {rows.map((r) => (
        <RequestRow key={r.id} r={r} busy={busy} run={run} />
      ))}
    </div>
  );
}

function RequestRow({ r, busy, run }: { r: AdRequest; busy: string | null; run: Runner }) {
  const [reason, setReason] = useState('');
  // Pre-filled with what they asked for; an admin lowers it to approve down onto
  // the cheaper band when the payment only covers that.
  const [radius, setRadius] = useState(String(r.radiusKm ?? 3));
  const key = `req-${r.id}`;
  const working = busy === key;

  return (
    <Card>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: colors.text, fontSize: 17 }}>
              {r.draft?.businessName ?? 'Business'}
            </h3>
            <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
              {r.city ?? '—'} · {r.contactPhone ?? 'no number'} · submitted {when(r.submittedAt)}
            </div>
            <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>uid {r.uid}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: colors.primary }}>
              {pkr(r.totalFee)}
            </div>
            <div style={{ color: colors.muted, fontSize: 12 }}>
              quoted · {pkr(r.monthlyFee)}/mo × {r.months} months
            </div>
            <div style={{ color: colors.muted, fontSize: 12 }}>
              {r.radiusKm} km · {r.adSlots} offer{r.adSlots === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {/* The offer they intend to push. Read this before approving: it goes
              to every phone inside the radius. */}
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={panelHeadStyle}>The offer they will push</div>
            {r.draft?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.draft.imageUrl}
                alt="Offer"
                style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
              />
            ) : null}
            <div style={{ padding: 12 }}>
              <div style={{ fontWeight: 800, color: colors.text, fontSize: 14 }}>
                {r.draft?.title ?? '—'}
              </div>
              <div style={{ color: colors.muted, fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {r.draft?.offerDetails ?? '—'}
              </div>
            </div>
          </div>

          {/* The payment. This is the whole reason a human is in the loop. */}
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={panelHeadStyle}>
              Payment proof · {r.paymentMethod ?? '—'}
              {r.paymentReference ? ` · ref ${r.paymentReference}` : ''}
            </div>
            {r.paymentProofUrl ? (
              <a href={r.paymentProofUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.paymentProofUrl}
                  alt="Payment screenshot"
                  style={{ width: '100%', height: 180, objectFit: 'contain', display: 'block', background: colors.bg }}
                />
              </a>
            ) : (
              <div style={{ padding: 12, color: colors.danger, fontSize: 13 }}>No screenshot attached.</div>
            )}
            <div style={{ padding: 12, fontSize: 12, color: colors.muted }}>
              Must show <strong>{pkr(r.totalFee)}</strong>. Click to open full size.
              {r.center ? (
                <>
                  {' '}
                  <a
                    href={`https://www.google.com/maps?q=${r.center.lat},${r.center.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: colors.secondary, fontWeight: 700 }}
                  >
                    Shop location ↗
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: colors.muted, fontWeight: 700 }}>
            Approve at radius (km)
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              style={{ ...inputStyle, width: 80, marginLeft: 8 }}
            />
          </label>
          <Button
            onClick={() =>
              run(key, () =>
                adminApi.adminReviewBusinessAdApplication({
                  uid: r.uid,
                  decision: 'approve',
                  radiusKm: Number(radius) || r.radiusKm,
                }),
              )
            }
            disabled={working}
          >
            {working ? 'Working…' : 'Approve'}
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Reason — shown to the business verbatim"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          <Button
            variant="secondary"
            onClick={() =>
              run(key, () =>
                adminApi.adminReviewBusinessAdApplication({
                  uid: r.uid,
                  decision: 'resubmit',
                  reason: reason.trim(),
                }),
              )
            }
            disabled={working || reason.trim().length === 0}
          >
            Ask to resubmit
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              run(key, () =>
                adminApi.adminReviewBusinessAdApplication({
                  uid: r.uid,
                  decision: 'reject',
                  reason: reason.trim(),
                }),
              )
            }
            disabled={working || reason.trim().length === 0}
          >
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Advertisers ──────────────────────────────────────────────────────────────

function Advertisers({ rows, busy, run }: { rows: Advertiser[]; busy: string | null; run: Runner }) {
  if (rows.length === 0) {
    return (
      <Card>
        <p style={{ color: colors.muted, margin: 0 }}>No advertisers yet.</p>
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((a) => {
        const left = daysLeft(a.expiresAt);
        const key = `adv-${a.id}`;
        const working = busy === key;
        const rate = (a.totalReach ?? 0) > 0
          ? Math.round(((a.totalClicks ?? 0) / (a.totalReach ?? 1)) * 1000) / 10
          : 0;
        return (
          <Card key={a.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong style={{ color: colors.text, fontSize: 15 }}>
                    {a.businessName ?? 'Business'}
                  </strong>
                  <Badge
                    label={a.status}
                    color={
                      a.status === 'active'
                        ? colors.success
                        : a.status === 'suspended'
                          ? colors.danger
                          : colors.warn
                    }
                  />
                </div>
                <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                  {a.city ?? '—'} · {a.contactPhone ?? 'no number'} · {a.radiusKm} km ·{' '}
                  {a.liveAds ?? 0}/{a.adSlots ?? 1} offers live
                </div>
                <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {a.months} months · {pkr(a.totalFee)} · expires {when(a.expiresAt)}
                  {left !== null ? ` (${left} days)` : ''}
                </div>
                {a.suspensionReason ? (
                  <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>
                    Suspended: {a.suspensionReason}
                  </div>
                ) : null}
                <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>uid {a.id}</div>
              </div>

              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                <Metric label="reached" value={String(a.totalReach ?? 0)} />
                <Metric label="sent" value={String(a.totalNotified ?? 0)} />
                <Metric label="opened" value={String(a.totalClicks ?? 0)} accent />
                <Metric label="open rate" value={`${rate}%`} />
                <Button
                  variant={a.status === 'suspended' ? 'secondary' : 'danger'}
                  onClick={() =>
                    run(key, () =>
                      adminApi.adminSuspendAdvertiser({
                        uid: a.id,
                        suspended: a.status !== 'suspended',
                        reason:
                          a.status !== 'suspended'
                            ? 'Suspended by Velocity pending review.'
                            : undefined,
                      }),
                    )
                  }
                  disabled={working}
                >
                  {working ? '…' : a.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: 17, fontWeight: 900, color: accent ? colors.primary : colors.text }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: colors.muted }}>{label}</div>
    </div>
  );
}

// ── Live offers ──────────────────────────────────────────────────────────────

function Offers({ rows, busy, run }: { rows: LiveAd[]; busy: string | null; run: Runner }) {
  if (rows.length === 0) {
    return (
      <Card>
        <p style={{ color: colors.muted, margin: 0 }}>No offers published yet.</p>
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {rows.map((ad) => {
        const key = `ad-${ad.id}`;
        const working = busy === key;
        return (
          <Card key={ad.id}>
            <div style={{ display: 'grid', gap: 10 }}>
              {ad.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ad.imageUrl}
                  alt={ad.title ?? 'Offer'}
                  style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 10 }}
                />
              ) : null}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong style={{ color: colors.primary, fontSize: 12 }}>{ad.businessName}</strong>
                <Badge
                  label={ad.status === 'active' ? 'live' : 'paused'}
                  color={ad.status === 'active' ? colors.success : colors.warn}
                />
              </div>
              <div style={{ fontWeight: 800, color: colors.text, fontSize: 15 }}>{ad.title}</div>
              <div style={{ color: colors.muted, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {ad.offerDetails}
              </div>
              <div style={{ color: colors.muted, fontSize: 12 }}>
                {ad.city ?? '—'} · {ad.radiusKm} km · {ad.reach ?? 0} reached · {ad.clicks ?? 0} opened
              </div>
              {ad.moderationReason ? (
                <div style={{ color: colors.danger, fontSize: 12 }}>
                  Taken down: {ad.moderationReason}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(key, () =>
                      adminApi.adminSetBusinessAdStatus({
                        adId: ad.id,
                        status: ad.status === 'active' ? 'paused' : 'active',
                        reason:
                          ad.status === 'active' ? 'Paused by Velocity pending review.' : undefined,
                      }),
                    )
                  }
                  disabled={working}
                >
                  {ad.status === 'active' ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    run(key, () =>
                      adminApi.adminSetBusinessAdStatus({
                        adId: ad.id,
                        status: 'removed',
                        reason: 'Removed by Velocity for breaching the advertising rules.',
                      }),
                    )
                  }
                  disabled={working}
                >
                  Take down
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * Prices, the notification budget, and where the money goes.
 *
 * Written straight to `config/businessAdSettings` (admins may write config/* per
 * the rules), which is the same doc getBusinessAdSettings reads. A plan already
 * sold is unaffected: the quote is snapshotted onto the application at submission.
 */
function Settings() {
  const [near, setNear] = useState({ maxRadiusKm: '3', monthlyFee: '5500', adSlots: '1' });
  const [wide, setWide] = useState({ maxRadiusKm: '5', monthlyFee: '7000', adSlots: '3' });
  const [cooldown, setCooldown] = useState('12');
  const [dailyCap, setDailyCap] = useState('6');
  const [pay, setPay] = useState({
    bankName: '',
    bankAccountTitle: '',
    bankAccount: '',
    easypaisaTitle: '',
    easypaisaAccount: '',
    jazzcashTitle: '',
    jazzcashAccount: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'businessAdSettings'), (snap) => {
      const d = snap.data();
      if (!d) return;
      const tiers = (d.tiers ?? []) as { maxRadiusKm?: number; monthlyFee?: number; adSlots?: number }[];
      if (tiers[0]) {
        setNear({
          maxRadiusKm: String(tiers[0].maxRadiusKm ?? 3),
          monthlyFee: String(tiers[0].monthlyFee ?? 5500),
          adSlots: String(tiers[0].adSlots ?? 1),
        });
      }
      if (tiers[1]) {
        setWide({
          maxRadiusKm: String(tiers[1].maxRadiusKm ?? 5),
          monthlyFee: String(tiers[1].monthlyFee ?? 7000),
          adSlots: String(tiers[1].adSlots ?? 3),
        });
      }
      if (d.notifyCooldownHours) setCooldown(String(d.notifyCooldownHours));
      if (d.maxNotifPerUserPerDay) setDailyCap(String(d.maxNotifPerUserPerDay));
      if (d.payment) {
        setPay((prev) => ({
          bankName: d.payment.bankName ?? prev.bankName,
          bankAccountTitle: d.payment.bankAccountTitle ?? prev.bankAccountTitle,
          bankAccount: d.payment.bankAccount ?? prev.bankAccount,
          easypaisaTitle: d.payment.easypaisaTitle ?? prev.easypaisaTitle,
          easypaisaAccount: d.payment.easypaisaAccount ?? prev.easypaisaAccount,
          jazzcashTitle: d.payment.jazzcashTitle ?? prev.jazzcashTitle,
          jazzcashAccount: d.payment.jazzcashAccount ?? prev.jazzcashAccount,
        }));
      }
    });
    return unsub;
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await setDoc(
        doc(db, 'config', 'businessAdSettings'),
        {
          tiers: [
            {
              key: 'near',
              maxRadiusKm: Number(near.maxRadiusKm),
              monthlyFee: Number(near.monthlyFee),
              adSlots: Number(near.adSlots),
            },
            {
              key: 'wide',
              maxRadiusKm: Number(wide.maxRadiusKm),
              monthlyFee: Number(wide.monthlyFee),
              adSlots: Number(wide.adSlots),
            },
          ],
          currency: 'PKR',
          notifyCooldownHours: Number(cooldown),
          maxNotifPerUserPerDay: Number(dailyCap),
          payment: {
            bankName: pay.bankName || null,
            bankAccountTitle: pay.bankAccountTitle || null,
            bankAccount: pay.bankAccount || null,
            easypaisaTitle: pay.easypaisaTitle || null,
            easypaisaAccount: pay.easypaisaAccount || null,
            jazzcashTitle: pay.jazzcashTitle || null,
            jazzcashAccount: pay.jazzcashAccount || null,
          },
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
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <h3 style={{ margin: 0, color: colors.text, fontSize: 16 }}>Price bands</h3>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
          A radius falls into the first band whose ceiling it does not exceed. The
          band decides both the monthly price and how many offers may run at once.
          Changing these never re-prices a plan already sold.
        </p>
        <div style={{ display: 'grid', gap: 14, marginTop: 10 }}>
          <TierEditor label="Band 1 (short radius)" value={near} onChange={setNear} />
          <TierEditor label="Band 2 (wide radius)" value={wide} onChange={setWide} />
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: 0, color: colors.text, fontSize: 16 }}>Notification budget</h3>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
          The cooldown is a clock, not a re-entry trigger: anyone inside a radius
          hears from that advertiser once per window, whether they walked in or live
          there. The daily cap is across ALL advertisers and protects the user —
          lower it if people start turning Velocity notifications off.
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
          <Field label="Cooldown per offer (hours)" value={cooldown} onChange={setCooldown} />
          <Field label="Max offers per user per day" value={dailyCap} onChange={setDailyCap} />
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: 0, color: colors.text, fontSize: 16 }}>Payment accounts</h3>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
          Shown to advertisers on the payment step. The account title matters — a
          business owner who sees a name they don&apos;t recognise will not send money
          to it.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 10 }}>
          <Field label="Bank name" value={pay.bankName} onChange={(v) => setPay({ ...pay, bankName: v })} />
          <Field label="Bank account title" value={pay.bankAccountTitle} onChange={(v) => setPay({ ...pay, bankAccountTitle: v })} />
          <Field label="Bank account / IBAN" value={pay.bankAccount} onChange={(v) => setPay({ ...pay, bankAccount: v })} />
          <Field label="Easypaisa title" value={pay.easypaisaTitle} onChange={(v) => setPay({ ...pay, easypaisaTitle: v })} />
          <Field label="Easypaisa number" value={pay.easypaisaAccount} onChange={(v) => setPay({ ...pay, easypaisaAccount: v })} />
          <Field label="JazzCash title" value={pay.jazzcashTitle} onChange={(v) => setPay({ ...pay, jazzcashTitle: v })} />
          <Field label="JazzCash number" value={pay.jazzcashAccount} onChange={(v) => setPay({ ...pay, jazzcashAccount: v })} />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {saved ? <span style={{ color: colors.success, fontSize: 13, fontWeight: 700 }}>Saved.</span> : null}
        {error ? <span style={{ color: colors.danger, fontSize: 13, fontWeight: 700 }}>{error}</span> : null}
      </div>
    </div>
  );
}

function TierEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { maxRadiusKm: string; monthlyFee: string; adSlots: string };
  onChange: (v: { maxRadiusKm: string; monthlyFee: string; adSlots: string }) => void;
}) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: colors.text, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field
          label="Radius ceiling (km)"
          value={value.maxRadiusKm}
          onChange={(v) => onChange({ ...value, maxRadiusKm: v })}
        />
        <Field
          label="Monthly fee (PKR)"
          value={value.monthlyFee}
          onChange={(v) => onChange({ ...value, monthlyFee: v })}
        />
        <Field
          label="Offers at a time"
          value={value.adSlots}
          onChange={(v) => onChange({ ...value, adSlots: v })}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: colors.muted, fontWeight: 700 }}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px',
  borderRadius: 9,
  border: `1px solid ${colors.border}`,
  fontSize: 13,
  color: colors.text,
  background: colors.surface,
};

const panelHeadStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: colors.bg,
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 12,
  fontWeight: 800,
  color: colors.muted,
};
