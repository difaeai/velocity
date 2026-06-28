'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

interface PassengerRow {
  id: string;
  displayName?: string;
  email?: string;
  phoneNumber?: string;
  gender?: string;
  banned?: boolean;
  createdAt?: { seconds: number };
}

export default function PassengersPage() {
  const [rows, setRows]         = useState<PassengerRow[]>([]);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'all' | 'banned'>('all');
  const [busy, setBusy]         = useState<string | null>(null);
  const [selected, setSelected] = useState<PassengerRow | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap =>
      setRows(snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as PassengerRow)
        .filter(r => (r as { role?: string }).role === 'passenger' || !(r as { role?: string }).role)
      )
    );
  }, []);

  const filtered = rows.filter(r => {
    if (filter === 'banned' && !r.banned) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      r.displayName?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q) ||
      r.phoneNumber?.includes(q)
    );
  });

  async function toggleBan(p: PassengerRow) {
    setBusy(p.id);
    try {
      await adminApi.banPassenger({ passengerId: p.id, banned: !p.banned });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, marginBottom: 20 }}>
        Passenger Management
      </h1>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, phone…"
          style={{
            flex: 1, minWidth: 200, padding: '8px 14px', borderRadius: 10,
            border: `1px solid ${colors.border}`, backgroundColor: colors.surface,
            color: colors.text, fontSize: 14,
          }}
        />
        {(['all', 'banned'] as const).map(f => (
          <Button key={f} variant={filter === f ? 'primary' : 'ghost'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All passengers' : '🚫 Banned'}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Phone</th>
                <th style={th}>Gender</th>
                <th style={th}>Joined</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>
                    No passengers found.
                  </td>
                </tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}>
                    <button
                      onClick={() => setSelected(p)}
                      style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontWeight: 700, padding: 0 }}
                    >
                      {p.displayName || '—'}
                    </button>
                  </td>
                  <td style={td}>{p.email || '—'}</td>
                  <td style={td}>{p.phoneNumber || '—'}</td>
                  <td style={td}>{p.gender || '—'}</td>
                  <td style={td}>
                    {p.createdAt
                      ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('en-PK')
                      : '—'}
                  </td>
                  <td style={td}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      backgroundColor: p.banned ? `${colors.danger}22` : `${colors.primary}22`,
                      color: p.banned ? colors.danger : colors.primary,
                    }}>
                      {p.banned ? 'Banned' : 'Active'}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        variant={p.banned ? 'secondary' : 'danger'}
                        disabled={busy === p.id}
                        onClick={() => toggleBan(p)}
                      >
                        {busy === p.id ? '…' : p.banned ? 'Unban' : 'Ban'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail panel */}
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <Card style={{ maxWidth: 400, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text }}>
                {selected.displayName || 'Passenger'}
              </h2>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.muted }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: colors.text }}>
              <DetailRow label="UID"     value={selected.id} />
              <DetailRow label="Email"   value={selected.email} />
              <DetailRow label="Phone"   value={selected.phoneNumber} />
              <DetailRow label="Gender"  value={selected.gender} />
              <DetailRow label="Status"  value={selected.banned ? '🚫 Banned' : '✅ Active'} />
              <DetailRow label="Joined"  value={
                selected.createdAt
                  ? new Date(selected.createdAt.seconds * 1000).toLocaleDateString('en-PK')
                  : '—'
              } />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button
                variant={selected.banned ? 'secondary' : 'danger'}
                disabled={busy === selected.id}
                onClick={() => toggleBan(selected)}
              >
                {selected.banned ? 'Unban passenger' : 'Ban passenger'}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ color: colors.muted, minWidth: 60 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value || '—'}</span>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12 };
const td: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };
