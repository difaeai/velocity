'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

interface SafetyRow {
  id: string;
  kind?: string;
  tripId?: string;
  driverId?: string;
  passengerId?: string;
  note?: string;
}

export default function Safety() {
  const [rows, setRows] = useState<SafetyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'safetyEvents'), where('status', '==', 'open')),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SafetyRow, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  async function resolve(id: string) {
    setBusy(id);
    try {
      await adminApi.resolveSafetyEvent({ eventId: id });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Safety desk</h1>
      <p style={{ color: colors.muted, marginBottom: 20 }}>Open SOS and route-deviation alerts.</p>
      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}

      {rows.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>No open safety events. 🎉</span>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((e) => (
            <Card key={e.id} style={{ borderColor: colors.danger }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{e.kind === 'route_deviation' ? 'Route deviation' : 'SOS'}</strong>
                    <Badge label="Open" color={colors.danger} />
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                    Trip {e.tripId ?? '—'} · driver {e.driverId ?? '—'}
                  </div>
                  {e.note ? <div style={{ fontSize: 13, marginTop: 4 }}>{e.note}</div> : null}
                </div>
                <Button disabled={busy === e.id} onClick={() => resolve(e.id)}>
                  {busy === e.id ? '…' : 'Resolve'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
