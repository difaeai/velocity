'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, setDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

/** Mirrors DEFAULT_CANCELLATION in backend/functions/src/domain/cancellation.ts. */
const DEFAULTS = { passengerRate: 5, driverRate: 8, outstandingLimit: 300 };

interface Debtor {
  id: string;
  outstanding?: number;
  balance?: number;
}

export default function CancellationSettingsPage() {
  const [passengerRate, setPassengerRate] = useState(DEFAULTS.passengerRate); // % — saved as 0.05
  const [driverRate, setDriverRate] = useState(DEFAULTS.driverRate);          // % — saved as 0.08
  const [outstandingLimit, setOutstandingLimit] = useState(DEFAULTS.outstandingLimit);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [debtors, setDebtors] = useState<Debtor[]>([]);

  useEffect(() => {
    getDoc(doc(db, 'config', 'cancellationSettings'))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (typeof d.passengerFeeRate === 'number') setPassengerRate(Math.round(d.passengerFeeRate * 100));
        if (typeof d.driverFeeRate === 'number') setDriverRate(Math.round(d.driverFeeRate * 100));
        if (typeof d.outstandingLimit === 'number') setOutstandingLimit(d.outstandingLimit);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Everyone currently carrying an unpaid fee, biggest debt first.
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'wallets'), where('outstanding', '>', 0)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Debtor);
        rows.sort((a, b) => (b.outstanding ?? 0) - (a.outstanding ?? 0));
        setDebtors(rows);
      },
      (e) => setError(e.message),
    );
  }, []);

  async function save() {
    if (passengerRate < 0 || passengerRate > 50) { setError('Passenger fee must be between 0% and 50%.'); return; }
    if (driverRate < 0 || driverRate > 50) { setError('Driver fee must be between 0% and 50%.'); return; }
    if (outstandingLimit < 0) { setError('The block threshold cannot be negative.'); return; }
    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, 'config', 'cancellationSettings'),
        {
          passengerFeeRate: passengerRate / 100,
          driverFeeRate: driverRate / 100,
          outstandingLimit,
        },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  const totalOwed = debtors.reduce((sum, d) => sum + (d.outstanding ?? 0), 0);
  const blockedCount = outstandingLimit > 0
    ? debtors.filter((d) => (d.outstanding ?? 0) >= outstandingLimit).length
    : 0;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Cancellation fees</h1>
      <p style={{ color: colors.muted, marginBottom: 24, maxWidth: 720 }}>
        What it costs to walk away from a confirmed ride, and how much unpaid fee an account may carry
        before it&apos;s blocked. Cancelling a request no driver has accepted yet is always free.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {saved && <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ Settings saved</div>}

      {loading ? (
        <div style={{ color: colors.muted }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(340px, 460px) minmax(300px, 1fr)', alignItems: 'start' }}>
          <Card>
            <div style={{ display: 'grid', gap: 20 }}>
              <div>
                <label style={labelStyle}>Passenger cancellation fee (%)</label>
                <p style={hintStyle}>
                  Charged when a passenger cancels after a driver has accepted and is on the way.
                  A share of the fare that was locked in when the offer was accepted.
                </p>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={passengerRate}
                  onChange={(e) => { setPassengerRate(Number(e.target.value)); setSaved(false); }}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Driver cancellation fee (%)</label>
                <p style={hintStyle}>
                  Charged when the driver drops a ride they already accepted. Set higher than the
                  passenger fee — a driver cancelling mid-approach costs the passenger the whole ride.
                </p>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={driverRate}
                  onChange={(e) => { setDriverRate(Number(e.target.value)); setSaved(false); }}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Block threshold (PKR outstanding)</label>
                <p style={hintStyle}>
                  Unpaid fees pile up as an outstanding balance. Once someone reaches this much,
                  passengers can&apos;t book and drivers can&apos;t bid until they settle. Set to 0 to
                  never block.
                </p>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={outstandingLimit}
                  onChange={(e) => { setOutstandingLimit(Number(e.target.value)); setSaved(false); }}
                  style={inputStyle}
                />
              </div>

              <div style={explainerStyle}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                  How it works
                </div>
                <ul style={{ color: colors.muted, fontSize: 13, paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                  <li>Cancelling while still <em>searching for a driver</em> is free, always.</li>
                  <li>
                    After a driver accepts, a passenger who cancels owes <strong>{passengerRate}%</strong> of the
                    fare (e.g. <strong>PKR {Math.round(500 * passengerRate / 100)}</strong> on a 500 PKR ride);
                    a driver who cancels owes <strong>{driverRate}%</strong> (<strong>PKR {Math.round(500 * driverRate / 100)}</strong>).
                  </li>
                  <li>The fee is taken from their wallet balance first. Anything the balance can&apos;t cover becomes <em>outstanding to Velocity</em>.</li>
                  <li>
                    {outstandingLimit > 0
                      ? <>At <strong>PKR {outstandingLimit.toLocaleString()}</strong> outstanding the account is blocked. They clear it by paying Velocity and uploading a screenshot — it lands in <strong>Settlements</strong> for review, same as driver commission.</>
                      : <>Blocking is <strong>off</strong> — fees accrue but nobody is ever stopped from riding or driving.</>}
                  </li>
                </ul>
              </div>

              <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </Card>

          {/* Who owes what, right now */}
          <Card>
            <div style={{ fontSize: 15, fontWeight: 800, color: colors.text, marginBottom: 2 }}>
              Outstanding fees
            </div>
            <div style={{ color: colors.muted, fontSize: 13, marginBottom: 16 }}>
              PKR {totalOwed.toLocaleString()} owed across {debtors.length} account
              {debtors.length === 1 ? '' : 's'}
              {outstandingLimit > 0 && ` · ${blockedCount} blocked`}
            </div>

            {debtors.length === 0 ? (
              <div style={{ color: colors.muted, fontSize: 13 }}>Nobody owes a cancellation fee. 🎉</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {debtors.map((d) => {
                  const owed = d.outstanding ?? 0;
                  const blocked = outstandingLimit > 0 && owed >= outstandingLimit;
                  return (
                    <div key={d.id} style={debtorRowStyle}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, fontFamily: 'monospace' }}>
                          {d.id.slice(0, 12)}…
                        </div>
                        <div style={{ fontSize: 11, color: colors.muted }}>
                          wallet balance PKR {(d.balance ?? 0).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: blocked ? colors.danger : colors.text }}>
                          PKR {owed.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: blocked ? colors.danger : colors.muted, textTransform: 'uppercase' }}>
                          {blocked ? '🔒 Blocked' : 'Carrying'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};
const hintStyle: React.CSSProperties = {
  color: colors.muted,
  fontSize: 12,
  marginBottom: 6,
  lineHeight: 1.5,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  color: colors.text,
  fontSize: 16,
  fontWeight: 700,
  boxSizing: 'border-box',
};
const explainerStyle: React.CSSProperties = {
  background: colors.bg,
  borderRadius: 12,
  padding: 14,
  border: `1px solid ${colors.border}`,
};
const debtorRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 10,
  background: colors.bg,
  border: `1px solid ${colors.border}`,
};
