'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

interface Franchise {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  phone?: string;
  city?: string;
  commissionRate: number;
  totalDrivers: number;
  totalRevenue: number;
  cycleRevenue: number;
}

interface CreateForm {
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string;
}

const EMPTY: CreateForm = { name: '', ownerName: '', email: '', phone: '', city: '' };

export default function FranchisesPage() {
  const [rows, setRows]       = useState<Franchise[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState<CreateForm>(EMPTY);
  const [busy, setBusy]       = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'franchises'), orderBy('createdAt', 'desc')),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Franchise, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  function setField(k: keyof CreateForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setSuccess(null);
    setError(null);
  }

  async function create() {
    if (!form.name || !form.ownerName || !form.email) {
      setError('Name, owner name and email are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.adminCreateFranchise({
        name: form.name,
        ownerName: form.ownerName,
        email: form.email,
        phone: form.phone || undefined,
        city: form.city || undefined,
      });
      setSuccess(`Franchise created (ID: ${res.franchiseId})`);
      setForm(EMPTY);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create franchise.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Franchises</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New franchise'}
        </Button>
      </div>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        Franchisees earn 5% of every fare made by their registered drivers.
      </p>

      {success && (
        <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ {success}</div>
      )}
      {error && (
        <div style={{ color: colors.danger, marginBottom: 14, fontWeight: 600 }}>{error}</div>
      )}

      {showForm && (
        <Card style={{ marginBottom: 24, maxWidth: 500 }}>
          <h3 style={{ fontWeight: 800, marginBottom: 14 }}>New franchise</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <FField label="Franchise name *"  value={form.name}       onChange={(v) => setField('name', v)}       placeholder="Elite Cabs Karachi" />
            <FField label="Owner name *"       value={form.ownerName}  onChange={(v) => setField('ownerName', v)}  placeholder="Ahmed Khan" />
            <FField label="Email *"            value={form.email}      onChange={(v) => setField('email', v)}      placeholder="owner@elitecabs.pk" type="email" />
            <FField label="Phone"              value={form.phone}      onChange={(v) => setField('phone', v)}      placeholder="+923001234567" />
            <FField label="City"               value={form.city}       onChange={(v) => setField('city', v)}       placeholder="Karachi" />
            <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create franchise'}</Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>No franchises yet. Create one to get started.</span>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((f) => (
            <Card key={f.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 16 }}>{f.name}</strong>
                    <Badge label={`${Math.round(f.commissionRate * 100)}% commission`} color={colors.secondary} />
                    {f.city && <Badge label={f.city} color={colors.muted} />}
                  </div>
                  <div style={{ color: colors.muted, fontSize: 13 }}>
                    Owner: {f.ownerName} · {f.email} {f.phone ? `· ${f.phone}` : ''}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 20 }}>
                    <Stat label="Drivers" value={String(f.totalDrivers ?? 0)} />
                    <Stat label="Total earned" value={`${(f.totalRevenue ?? 0).toLocaleString()} PKR`} />
                    <Stat label="This cycle" value={`${(f.cycleRevenue ?? 0).toLocaleString()} PKR`} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, wordBreak: 'break-all', maxWidth: 180 }}>
                    ID: {f.id}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FField({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 4, textTransform: 'uppercase' as const }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: 14, boxSizing: 'border-box' as const }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>{value}</div>
    </div>
  );
}
