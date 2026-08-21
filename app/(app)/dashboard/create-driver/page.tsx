'use client';

import { useState } from 'react';

import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

type VehicleType = 'mini' | 'ac' | 'comfort' | 'xl' | 'bike' | 'auto';

const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'mini',    label: 'Mini (Hatchback · No AC)' },
  { value: 'ac',      label: 'AC (Air Conditioned)' },
  { value: 'comfort', label: 'Comfort (Premium Sedan)' },
  { value: 'xl',      label: 'XL (SUV / Van)' },
  { value: 'bike',    label: 'Bike (Motorcycle)' },
  { value: 'auto',    label: 'Auto (Rickshaw)' },
];

interface Form {
  fullName:     string;
  email:        string;
  phone:        string;
  vehicleType:  VehicleType;
  vehicleLabel: string;
  plate:        string;
  cnic:         string;
  franchiseId:  string;
}

const EMPTY: Form = {
  fullName: '', email: '', phone: '', vehicleType: 'mini',
  vehicleLabel: '', plate: '', cnic: '', franchiseId: '',
};

export default function CreateDriverPage() {
  const [form, setForm]               = useState<Form>(EMPTY);
  const [busy, setBusy]               = useState(false);
  const [result, setResult]           = useState<{ uid: string; resetLink: string | null } | null>(null);
  const [error, setError]             = useState<string | null>(null);

  function set(k: keyof Form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setResult(null);
    setError(null);
  }

  async function submit() {
    if (!form.fullName || !form.email || !form.vehicleLabel || !form.plate) {
      setError('Full name, email, vehicle model and plate are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.adminCreateDriver({
        fullName:     form.fullName,
        email:        form.email,
        phone:        form.phone || undefined,
        vehicleType:  form.vehicleType,
        vehicleLabel: form.vehicleLabel,
        plate:        form.plate.toUpperCase(),
        cnic:         form.cnic || undefined,
        franchiseId:  form.franchiseId || undefined,
      });
      setResult({ uid: res.uid, resetLink: res.passwordResetLink });
      setForm(EMPTY);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create driver.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Create driver account</h1>
      <p style={{ color: colors.muted, marginBottom: 24 }}>
        Directly register a new driver. They will receive a password-setup link to activate their account.
      </p>

      {result && (
        <Card style={{ marginBottom: 20, borderColor: colors.success, borderWidth: 2 }}>
          <div style={{ fontWeight: 800, color: colors.success, marginBottom: 8 }}>
            ✓ Driver created (UID: {result.uid})
          </div>
          {result.resetLink ? (
            <>
              <div style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
                Share this password-setup link with the driver:
              </div>
              <div
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  wordBreak: 'break-all',
                  color: colors.text,
                }}
              >
                {result.resetLink}
              </div>
            </>
          ) : (
            <div style={{ color: colors.muted, fontSize: 13 }}>
              Send the driver a password-reset email via Firebase console to let them set their password.
            </div>
          )}
        </Card>
      )}

      {error && (
        <div style={{ color: colors.danger, marginBottom: 16, fontWeight: 600 }}>{error}</div>
      )}

      <Card style={{ maxWidth: 560 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Full name *" value={form.fullName}     onChange={(v) => set('fullName', v)}     placeholder="Muhammad Ali" />
          <Field label="Email *"     value={form.email}        onChange={(v) => set('email', v)}         placeholder="driver@example.com" type="email" />
          <Field label="Phone"       value={form.phone}        onChange={(v) => set('phone', v)}         placeholder="+923001234567" />
          <Field label="CNIC"        value={form.cnic}         onChange={(v) => set('cnic', v)}          placeholder="12345-1234567-1" />

          <div>
            <label style={labelStyle}>Vehicle type *</label>
            <select
              value={form.vehicleType}
              onChange={(e) => set('vehicleType', e.target.value as VehicleType)}
              style={selectStyle}
            >
              {VEHICLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <Field label="Vehicle model *" value={form.vehicleLabel} onChange={(v) => set('vehicleLabel', v)} placeholder="Toyota Corolla 2020" />
          <Field label="Number plate *"  value={form.plate}        onChange={(v) => set('plate', v)}         placeholder="ABC-123" />
          <Field label="Franchise ID"    value={form.franchiseId}  onChange={(v) => set('franchiseId', v)}   placeholder="(optional — paste franchise ID)" />

          <Button onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create driver account'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: colors.muted,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.bg,
  color: colors.text,
  fontSize: 14,
  boxSizing: 'border-box',
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};
