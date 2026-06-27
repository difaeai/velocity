'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

export default function CommissionSettingsPage() {
  const [threshold, setThreshold] = useState(5000);
  const [rate,      setRate]      = useState(10);   // stored as percentage; saved as 0.10
  const [loading,   setLoading]   = useState(true);
  const [busy,      setBusy]      = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'config', 'commissionSettings'))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.threshold) setThreshold(d.threshold as number);
          if (d.rate)      setRate(Math.round((d.rate as number) * 100));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (threshold < 100) { setError('Threshold must be at least 100 PKR.'); return; }
    if (rate < 1 || rate > 50) { setError('Rate must be between 1% and 50%.'); return; }
    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, 'config', 'commissionSettings'),
        { threshold, rate: rate / 100 },
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

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Commission settings</h1>
      <p style={{ color: colors.muted, marginBottom: 24 }}>
        Configure when drivers are locked and how much they owe per cycle.
      </p>

      {error  && <div style={{ color: colors.danger,  fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {saved  && <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ Settings saved</div>}

      {loading ? (
        <div style={{ color: colors.muted }}>Loading…</div>
      ) : (
        <Card style={{ maxWidth: 440 }}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div>
              <label style={labelStyle}>Earnings threshold (PKR)</label>
              <p style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
                Driver is locked when total fares charged since last payment reach this amount.
              </p>
              <input
                type="number"
                min={100}
                step={500}
                value={threshold}
                onChange={(e) => { setThreshold(Number(e.target.value)); setSaved(false); }}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Commission rate (%)</label>
              <p style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
                Percentage of the threshold the driver must pay to unlock. Example: 10% of 5 000 PKR = 500 PKR.
              </p>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={rate}
                onChange={(e) => { setRate(Number(e.target.value)); setSaved(false); }}
                style={inputStyle}
              />
            </div>

            <div
              style={{
                background: colors.bg,
                borderRadius: 12,
                padding: 14,
                border: `1px solid ${colors.border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                How it works
              </div>
              <ul style={{ color: colors.muted, fontSize: 13, paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                <li>Driver collects cash from passengers for each ride.</li>
                <li>When total fares reach <strong>{threshold.toLocaleString()} PKR</strong>, the driver app is locked.</li>
                <li>Driver must pay <strong>{Math.round(threshold * rate / 100).toLocaleString()} PKR</strong> ({rate}%) to Velocity to unlock.</li>
                <li>After payment the cycle resets and the driver can accept rides again.</li>
              </ul>
            </div>

            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </Card>
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
