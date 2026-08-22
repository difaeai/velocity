'use client';

/**
 * Files a driver and their vehicle for admin approval.
 *
 * Deliberately says "submit for approval", never "add driver": nothing exists
 * after this call except a queue entry, and a form that implies otherwise
 * produces a partner who tells their driver to start working tomorrow.
 */
import { useState } from 'react';

import { portalApi } from '@/lib/api';
import s from './portal.module.css';

const VEHICLE_TYPES = [
  { value: 'mini', label: 'Mini — hatchback, no AC' },
  { value: 'ac', label: 'AC — air conditioned' },
  { value: 'comfort', label: 'Comfort — premium sedan' },
  { value: 'xl', label: 'XL — SUV or van' },
  { value: 'bike', label: 'Bike — motorcycle' },
  { value: 'auto', label: 'Auto — rickshaw' },
];

interface Form {
  fullName: string;
  phone: string;
  cnic: string;
  licenseNumber: string;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  vehicleYear: string;
  vehicleColor: string;
  notes: string;
}

const EMPTY: Form = {
  fullName: '',
  phone: '',
  cnic: '',
  licenseNumber: '',
  vehicleType: 'mini',
  vehicleLabel: '',
  plate: '',
  vehicleYear: '',
  vehicleColor: '',
  notes: '',
};

export function AddDriverForm({
  portalId,
  onSubmitted,
}: {
  portalId: string;
  onSubmitted: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function set<K extends keyof Form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
    setDone(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName || !form.phone || !form.cnic || !form.vehicleLabel || !form.plate) {
      setError('Name, mobile, CNIC, vehicle model and number plate are all required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await portalApi.submitDriver({
        portalId,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        cnic: form.cnic.trim(),
        licenseNumber: form.licenseNumber.trim() || undefined,
        vehicleType: form.vehicleType,
        vehicleLabel: form.vehicleLabel.trim(),
        plate: form.plate.trim().toUpperCase(),
        vehicleYear: form.vehicleYear ? Number(form.vehicleYear) : undefined,
        vehicleColor: form.vehicleColor.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setDone(`${form.fullName.trim()} submitted. Velocity will review it shortly.`);
      setForm(EMPTY);
      await onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit this driver.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <div className={s.formGrid}>
        <Field label="Driver's full name" required>
          <input
            className={s.input}
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Mobile number" required hint="The number they will sign into the app with">
          <input
            className={s.input}
            type="tel"
            inputMode="tel"
            placeholder="0300 1234567"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label="CNIC" required>
          <input
            className={s.input}
            placeholder="12345-1234567-1"
            value={form.cnic}
            onChange={(e) => set('cnic', e.target.value)}
          />
        </Field>
        <Field label="Licence number">
          <input
            className={s.input}
            value={form.licenseNumber}
            onChange={(e) => set('licenseNumber', e.target.value)}
          />
        </Field>
        <Field label="Vehicle category" required>
          <select
            className={s.input}
            value={form.vehicleType}
            onChange={(e) => set('vehicleType', e.target.value)}
          >
            {VEHICLE_TYPES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Make and model" required>
          <input
            className={s.input}
            placeholder="Toyota Corolla"
            value={form.vehicleLabel}
            onChange={(e) => set('vehicleLabel', e.target.value)}
          />
        </Field>
        <Field label="Number plate" required>
          <input
            className={s.input}
            placeholder="LEB-4417"
            value={form.plate}
            onChange={(e) => set('plate', e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Year">
          <input
            className={s.input}
            inputMode="numeric"
            placeholder="2019"
            value={form.vehicleYear}
            onChange={(e) => set('vehicleYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </Field>
        <Field label="Colour">
          <input
            className={s.input}
            placeholder="Silver"
            value={form.vehicleColor}
            onChange={(e) => set('vehicleColor', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Anything Velocity should know">
        <textarea
          className={`${s.input} ${s.textarea}`}
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className={s.success} role="status">
          {done}
        </p>
      ) : null}

      <button type="submit" className={s.primary} disabled={busy}>
        {busy ? 'Submitting…' : 'Submit for approval'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={s.field}>
      <span className={s.label}>
        {label}
        {required ? <i aria-hidden="true"> *</i> : null}
      </span>
      {children}
      {hint ? <small className={s.hint}>{hint}</small> : null}
    </label>
  );
}
