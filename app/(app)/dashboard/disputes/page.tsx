'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

type DisputeStatus = 'open' | 'resolved';

interface DisputeRow {
  id: string;
  tripId?: string;
  passengerId?: string;
  passengerName?: string;
  driverId?: string;
  driverName?: string;
  category?: string;
  description?: string;
  status?: DisputeStatus;
  resolution?: string;
  resolvedBy?: string;
  createdAt?: { seconds: number };
  resolvedAt?: { seconds: number };
}

export default function DisputesPage() {
  const [rows, setRows]           = useState<DisputeRow[]>([]);
  const [tab, setTab]             = useState<DisputeStatus>('open');
  const [selected, setSelected]   = useState<DisputeRow | null>(null);
  const [resolution, setResolution] = useState('');
  const [refund, setRefund]       = useState('');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'disputes'),
      where('status', '==', tab),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, snap =>
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DisputeRow))
    );
  }, [tab]);

  async function resolve() {
    if (!selected || !resolution.trim()) return;
    setBusy(true);
    try {
      const refundAmt = refund ? parseFloat(refund) : undefined;
      await adminApi.resolveDispute({
        disputeId: selected.id,
        resolution: resolution.trim(),
        ...(refundAmt && refundAmt > 0 ? { refundAmount: refundAmt } : {}),
      });
      setSelected(null);
      setResolution('');
      setRefund('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to resolve dispute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, marginBottom: 20 }}>
        Dispute Resolution
      </h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <Button variant={tab === 'open' ? 'primary' : 'ghost'} onClick={() => setTab('open')}>
          🔴 Open disputes
        </Button>
        <Button variant={tab === 'resolved' ? 'primary' : 'ghost'} onClick={() => setTab('resolved')}>
          ✅ Resolved
        </Button>
      </div>

      <Card>
        {rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 24, textAlign: 'center' }}>
            No {tab} disputes.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {rows.map(d => (
              <div
                key={d.id}
                style={{
                  padding: '14px 16px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  backgroundColor: selected?.id === d.id ? `${colors.primary}10` : 'transparent',
                }}
                onClick={() => { setSelected(d); setResolution(d.resolution ?? ''); }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: colors.text, fontSize: 14 }}>
                      {d.category ?? 'General complaint'}
                      {d.passengerId ? ` — Passenger ${d.passengerName ?? d.passengerId.slice(0, 8)}` : ''}
                    </div>
                    <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                      Trip: {d.tripId ?? '—'} ·{' '}
                      {d.createdAt
                        ? new Date(d.createdAt.seconds * 1000).toLocaleString('en-PK')
                        : '—'}
                    </div>
                    {d.description ? (
                      <div style={{ color: colors.text, fontSize: 13, marginTop: 6, maxWidth: 500, opacity: 0.85 }}>
                        {d.description.slice(0, 120)}{d.description.length > 120 ? '…' : ''}
                      </div>
                    ) : null}
                  </div>
                  <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(d); setResolution(d.resolution ?? ''); }}>
                    {d.status === 'open' ? 'Resolve →' : 'View'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Resolution modal */}
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: '#00000088',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <Card style={{ maxWidth: 480, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 17, fontWeight: 900, color: colors.text }}>
                {selected.category ?? 'Dispute'} — {selected.status === 'open' ? 'Resolve' : 'Details'}
              </h2>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: colors.text, marginBottom: 16 }}>
              <DetailRow label="Trip"      value={selected.tripId} />
              <DetailRow label="Passenger" value={selected.passengerName ?? selected.passengerId} />
              <DetailRow label="Driver"    value={selected.driverName ?? selected.driverId} />
              <DetailRow label="Filed"     value={
                selected.createdAt
                  ? new Date(selected.createdAt.seconds * 1000).toLocaleString('en-PK')
                  : undefined
              } />
            </div>

            {selected.description && (
              <div style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 13, color: colors.text, marginBottom: 16, lineHeight: 1.6 }}>
                {selected.description}
              </div>
            )}

            {selected.status === 'open' ? (
              <>
                <label style={{ fontSize: 12, fontWeight: 700, color: colors.muted }}>Resolution note *</label>
                <textarea
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  placeholder="Describe the resolution…"
                  rows={4}
                  style={{
                    width: '100%', padding: 10, borderRadius: 10, border: `1px solid ${colors.border}`,
                    backgroundColor: colors.surface, color: colors.text, fontSize: 13,
                    resize: 'vertical', marginTop: 6, marginBottom: 12, boxSizing: 'border-box',
                  }}
                />
                <label style={{ fontSize: 12, fontWeight: 700, color: colors.muted }}>Refund passenger (PKR, leave blank for none)</label>
                <input
                  type="number"
                  value={refund}
                  onChange={e => setRefund(e.target.value)}
                  placeholder="0"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 10, border: `1px solid ${colors.border}`,
                    backgroundColor: colors.surface, color: colors.text, fontSize: 14,
                    marginTop: 6, marginBottom: 16, boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={resolve} disabled={busy || !resolution.trim()}>
                    {busy ? 'Resolving…' : '✅ Mark resolved'}
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>Resolution:</p>
                <p style={{ fontSize: 14, color: colors.text }}>{selected.resolution}</p>
                <div style={{ marginTop: 16 }}>
                  <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ color: colors.muted, minWidth: 70 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value || '—'}</span>
    </div>
  );
}
