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

type VehicleType = 'mini' | 'ac' | 'comfort' | 'xl' | 'bike' | 'auto';
const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'mini',    label: 'Mini (Hatchback · No AC)' },
  { value: 'ac',      label: 'AC (Air Conditioned)' },
  { value: 'comfort', label: 'Comfort (Premium Sedan)' },
  { value: 'xl',      label: 'XL (SUV / Van)' },
  { value: 'bike',    label: 'Bike (Motorcycle)' },
  { value: 'auto',    label: 'Auto (Rickshaw)' },
];

interface CreateForm {
  fullName: string; email: string; phone: string;
  vehicleType: VehicleType; vehicleLabel: string; plate: string;
  cnic: string; franchiseId: string;
}
const EMPTY_FORM: CreateForm = {
  fullName: '', email: '', phone: '', vehicleType: 'mini',
  vehicleLabel: '', plate: '', cnic: '', franchiseId: '',
};

export default function Drivers() {
  const [rows, setRows]       = useState<DriverRow[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState<string | null>(null);

  // Create-driver inline form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating]     = useState(false);
  const [createResult, setCreateResult] = useState<{ uid: string; link: string | null } | null>(null);
  const [createError, setCreateError]   = useState<string | null>(null);

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

  function setField(k: keyof CreateForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setCreateResult(null);
    setCreateError(null);
  }

  async function createDriver() {
    if (!form.fullName || !form.email || !form.vehicleLabel || !form.plate) {
      setCreateError('Full name, email, vehicle model and plate are required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await adminApi.adminCreateDriver({
        fullName: form.fullName, email: form.email,
        phone: form.phone || undefined,
        vehicleType: form.vehicleType, vehicleLabel: form.vehicleLabel,
        plate: form.plate.toUpperCase(),
        cnic: form.cnic || undefined,
        franchiseId: form.franchiseId || undefined,
      });
      setCreateResult({ uid: res.uid, link: res.passwordResetLink });
      setForm(EMPTY_FORM);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create driver.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Driver approvals</h1>
        <Button onClick={() => { setShowCreate((v) => !v); setCreateResult(null); setCreateError(null); }}>
          {showCreate ? 'Cancel' : '+ Create driver'}
        </Button>
      </div>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        Pending driver onboarding submissions awaiting verification.
      </p>

      {/* ── Inline create-driver form ── */}
      {showCreate && (
        <Card style={{ marginBottom: 24, borderColor: colors.primary, borderWidth: 2 }}>
          <h3 style={{ fontWeight: 800, marginBottom: 4, fontSize: 16 }}>Create driver account</h3>
          <p style={{ color: colors.muted, fontSize: 13, marginBottom: 16 }}>
            Driver will be pre-approved. Share the password-setup link with them to activate.
          </p>

          {createResult && (
            <div style={{ background: '#f0faf4', border: `1px solid ${colors.success}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: colors.success, marginBottom: 6 }}>✓ Driver created (UID: {createResult.uid})</div>
              {createResult.link ? (
                <>
                  <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Password-setup link (share with driver):</div>
                  <div style={{ fontSize: 11, wordBreak: 'break-all', background: '#e8f5ee', borderRadius: 6, padding: '6px 10px' }}>
                    {createResult.link}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: colors.muted }}>Send a password-reset email via Firebase console.</div>
              )}
            </div>
          )}

          {createError && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 12 }}>{createError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CF label="Full name *"      value={form.fullName}     onChange={(v) => setField('fullName', v)}     placeholder="Muhammad Ali" />
            <CF label="Email *"          value={form.email}        onChange={(v) => setField('email', v)}         placeholder="driver@example.com" type="email" />
            <CF label="Phone"            value={form.phone}        onChange={(v) => setField('phone', v)}         placeholder="+923001234567" />
            <CF label="CNIC"             value={form.cnic}         onChange={(v) => setField('cnic', v)}          placeholder="12345-1234567-1" />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Vehicle type *</label>
              <select value={form.vehicleType} onChange={(e) => setField('vehicleType', e.target.value)} style={inputStyle}>
                {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <CF label="Vehicle model *"  value={form.vehicleLabel} onChange={(v) => setField('vehicleLabel', v)} placeholder="Toyota Corolla 2020" />
            <CF label="Number plate *"   value={form.plate}        onChange={(v) => setField('plate', v)}         placeholder="ABC-123" />
            <CF label="Franchise ID"     value={form.franchiseId}  onChange={(v) => setField('franchiseId', v)}   placeholder="(optional)" />
          </div>

          <div style={{ marginTop: 16 }}>
            <Button onClick={createDriver} disabled={creating}>
              {creating ? 'Creating…' : 'Create driver account'}
            </Button>
          </div>
        </Card>
      )}

      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}

      {/* ── Pending approvals ── */}
      <p style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Pending submissions
      </p>
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

function CF({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: colors.muted,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9,
  border: `1px solid ${colors.border}`, background: colors.bg,
  color: colors.text, fontSize: 13, boxSizing: 'border-box',
};
