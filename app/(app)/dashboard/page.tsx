'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { StatCard } from '@/components/ui';

interface Counters {
  totalRevenue?: number;
  totalCommissions?: number;
  totalDriverPayout?: number;
  totalTrips?: number;
}

export default function Overview() {
  const [counters, setCounters] = useState<Counters>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'system', 'counters'),
        (snap) => setCounters((snap.data() as Counters | undefined) ?? {}),
        (e) => setError(e.message),
      ),
    [],
  );

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Overview</h1>
      <p style={{ color: colors.muted, marginBottom: 20 }}>Live platform metrics.</p>
      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total revenue" value={`${counters.totalRevenue ?? 0} PKR`} />
        <StatCard label="Commissions" value={`${counters.totalCommissions ?? 0} PKR`} />
        <StatCard label="Driver payouts" value={`${counters.totalDriverPayout ?? 0} PKR`} />
        <StatCard label="Completed trips" value={`${counters.totalTrips ?? 0}`} />
      </div>
    </div>
  );
}
