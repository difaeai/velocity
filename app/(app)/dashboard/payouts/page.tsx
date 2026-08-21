'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

interface PayoutRow {
  id: string;
  driverId?: string;
  amount?: number;
  method?: string;
  account?: string;
}

export default function Payouts() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'payouts'), where('status', '==', 'pending')),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayoutRow, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  async function markPaid(id: string) {
    setBusy(id);
    try {
      await adminApi.markPayoutPaid({ payoutId: id });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Payouts</h1>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        Pending driver cash-outs. Disburse via your gateway, then mark as paid.
      </p>
      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}

      {rows.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>No pending payouts.</span>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((p) => (
            <Card key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{p.amount ?? 0} PKR</strong>
                    <Badge label={p.method ?? 'jazzcash'} color={colors.secondary} />
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                    driver {p.driverId ?? '—'} · {p.account ?? 'no account on file'}
                  </div>
                </div>
                <Button disabled={busy === p.id} onClick={() => markPaid(p.id)}>
                  {busy === p.id ? '…' : 'Mark paid'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
