'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

interface DriverRow {
  id: string;
  fullName?: string;
  vehicleLabel?: string;
  plate?: string;
  vehicleType?: string;
  cnic?: string;
}

export default function Drivers() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'drivers'), where('verificationStatus', '==', 'pending')),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverRow, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      if (action === 'approve') await adminApi.approveDriver({ driverId: id });
      else await adminApi.rejectDriver({ driverId: id });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Driver approvals</h1>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        Pending driver onboarding submissions awaiting verification.
      </p>
      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}

      {rows.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>No pending drivers right now.</span>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((d) => (
            <Card key={d.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{d.fullName ?? 'Unknown'}</strong>
                    <Badge label="Pending" color={colors.warn} />
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                    {(d.vehicleType ?? '').toUpperCase()} · {d.vehicleLabel ?? '—'} · {d.plate ?? '—'}
                  </div>
                  {d.cnic ? (
                    <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>CNIC {d.cnic}</div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" disabled={busy === d.id} onClick={() => act(d.id, 'reject')}>
                    Reject
                  </Button>
                  <Button disabled={busy === d.id} onClick={() => act(d.id, 'approve')}>
                    {busy === d.id ? '…' : 'Approve'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
