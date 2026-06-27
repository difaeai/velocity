'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverRow {
  id: string;
  fullName?: string;
  email?: string;
  dob?: string;
  vehicleLabel?: string;
  vehicleType?: string;
  color?: string;
  plate?: string;
  cnic?: string;
  // Download URLs stored when driver submitted
  photoDocUrl?: string;
  licenseDocUrl?: string;
  cnicDocUrl?: string;
  cnicBackDocUrl?: string;
  selfieDocUrl?: string;
  vehicleDocUrl?: string;
  vehiclePhotoDocUrl?: string;
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

const SECTIONS = [
  { key: 'basic',   label: 'Basic info' },
  { key: 'license', label: 'Driver licence' },
  { key: 'cnic',    label: 'CNIC' },
  { key: 'selfie',  label: 'Selfie with ID' },
  { key: 'vehicle', label: 'Vehicle info' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function Drivers() {
  const [rows, setRows]   = useState<DriverRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Expanded detail / reject state
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [rejectingId, setRejectingId]     = useState<string | null>(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejectSections, setRejectSections] = useState<string[]>([]);
  const [busy, setBusy]                   = useState<string | null>(null);

  // Create-driver inline form
  const [showCreate, setShowCreate]   = useState(false);
  const [form, setForm]               = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating]       = useState(false);
  const [createResult, setCreateResult] = useState<{ uid: string; link: string | null } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'drivers'), where('verificationStatus', '==', 'pending')),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverRow, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  async function approve(id: string) {
    setBusy(id);
    try {
      await adminApi.approveDriver({ driverId: id });
      setExpanded(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      window.alert('Please enter a rejection reason so the driver knows what to fix.');
      return;
    }
    setBusy(id);
    try {
      await adminApi.rejectDriver({
        driverId: id,
        reason: rejectReason.trim(),
        rejectedSections: rejectSections.length > 0 ? rejectSections : undefined,
      });
      setRejectingId(null);
      setRejectReason('');
      setRejectSections([]);
      setExpanded(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  function toggleSection(key: string) {
    setRejectSections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
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

      {/* ── Create driver inline form ── */}
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
                  <div style={{ fontSize: 11, wordBreak: 'break-all', background: '#e8f5ee', borderRadius: 6, padding: '6px 10px' }}>{createResult.link}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: colors.muted }}>Send a password-reset email via Firebase console.</div>
              )}
            </div>
          )}
          {createError && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 12 }}>{createError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CF label="Full name *"     value={form.fullName}     onChange={(v) => setField('fullName', v)}     placeholder="Muhammad Ali" />
            <CF label="Email *"         value={form.email}        onChange={(v) => setField('email', v)}         placeholder="driver@example.com" type="email" />
            <CF label="Phone"           value={form.phone}        onChange={(v) => setField('phone', v)}         placeholder="+923001234567" />
            <CF label="CNIC"            value={form.cnic}         onChange={(v) => setField('cnic', v)}          placeholder="12345-1234567-1" />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Vehicle type *</label>
              <select value={form.vehicleType} onChange={(e) => setField('vehicleType', e.target.value)} style={inputStyle}>
                {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <CF label="Vehicle model *" value={form.vehicleLabel} onChange={(v) => setField('vehicleLabel', v)} placeholder="Toyota Corolla 2020" />
            <CF label="Number plate *"  value={form.plate}        onChange={(v) => setField('plate', v)}         placeholder="ABC-123" />
            <CF label="Franchise ID"    value={form.franchiseId}  onChange={(v) => setField('franchiseId', v)}   placeholder="(optional)" />
          </div>
          <div style={{ marginTop: 16 }}>
            <Button onClick={createDriver} disabled={creating}>{creating ? 'Creating…' : 'Create driver account'}</Button>
          </div>
        </Card>
      )}

      {error && <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p>}

      {/* ── Pending submissions ── */}
      <p style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Pending submissions ({rows.length})
      </p>

      {rows.length === 0 ? (
        <Card><span style={{ color: colors.muted }}>No pending drivers right now.</span></Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {rows.map((d) => {
            const isExpanded  = expanded === d.id;
            const isRejecting = rejectingId === d.id;

            return (
              <Card key={d.id} style={{ padding: 0, overflow: 'hidden' }}>
                {/* ── Summary row ── */}
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 12, padding: 16, cursor: 'pointer',
                    background: isExpanded ? `${colors.primary}08` : undefined,
                  }}
                  onClick={() => { setExpanded(isExpanded ? null : d.id); setRejectingId(null); }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {d.photoDocUrl ? (
                      <img
                        src={d.photoDocUrl}
                        alt="Photo"
                        style={{ width: 48, height: 48, borderRadius: 24, objectFit: 'cover', border: `2px solid ${colors.border}` }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 24, background: colors.bg, border: `2px solid ${colors.border}`, display: 'grid', placeItems: 'center', fontSize: 20 }}>
                        👤
                      </div>
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <strong style={{ fontSize: 15 }}>{d.fullName ?? 'Unknown'}</strong>
                        <Badge label="Pending" color={colors.warn} />
                      </div>
                      <div style={{ color: colors.muted, fontSize: 13 }}>
                        {(d.vehicleType ?? '').toUpperCase()} · {d.vehicleLabel ?? '—'} · {d.plate ?? '—'}
                      </div>
                    </div>
                  </div>
                  <span style={{ color: colors.muted, fontSize: 18 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* ── Expanded detail panel ── */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, padding: 20 }}>

                    {/* Personal info */}
                    <Section title="Personal information">
                      <InfoGrid>
                        <InfoCell label="Full name"  value={d.fullName}  />
                        <InfoCell label="Email"      value={d.email}     />
                        <InfoCell label="Date of birth" value={d.dob}   />
                        <InfoCell label="CNIC number" value={d.cnic}     />
                      </InfoGrid>
                    </Section>

                    {/* Vehicle info */}
                    <Section title="Vehicle information">
                      <InfoGrid>
                        <InfoCell label="Type"   value={d.vehicleType}  />
                        <InfoCell label="Model"  value={d.vehicleLabel} />
                        <InfoCell label="Colour" value={d.color}        />
                        <InfoCell label="Plate"  value={d.plate}        />
                      </InfoGrid>
                    </Section>

                    {/* Documents */}
                    <Section title="Documents &amp; photos">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                        <DocImage label="Profile photo"  url={d.photoDocUrl} />
                        <DocImage label="Selfie with ID" url={d.selfieDocUrl} />
                        <DocImage label="Driver licence" url={d.licenseDocUrl} />
                        <DocImage label="CNIC (front)"   url={d.cnicDocUrl} />
                        <DocImage label="CNIC (back)"    url={d.cnicBackDocUrl} />
                        <DocImage label="Vehicle reg."   url={d.vehicleDocUrl} />
                        {d.vehiclePhotoDocUrl && (
                          <DocImage label="Vehicle photo" url={d.vehiclePhotoDocUrl} />
                        )}
                      </div>
                    </Section>

                    {/* Action buttons */}
                    {!isRejecting && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                        <Button
                          disabled={busy === d.id}
                          onClick={() => approve(d.id)}
                        >
                          {busy === d.id ? '…' : '✓ Approve driver'}
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busy === d.id}
                          onClick={() => { setRejectingId(d.id); setRejectReason(''); setRejectSections([]); }}
                        >
                          ✕ Reject
                        </Button>
                      </div>
                    )}

                    {/* Rejection form */}
                    {isRejecting && (
                      <div style={{ marginTop: 16, background: '#fff5f5', borderRadius: 12, border: `1px solid ${colors.danger}20`, padding: 16 }}>
                        <div style={{ fontWeight: 800, color: colors.danger, marginBottom: 12 }}>Reject application</div>

                        <div style={{ marginBottom: 12 }}>
                          <label style={{ ...labelStyle, color: colors.danger }}>
                            Reason for rejection * (driver will see this message)
                          </label>
                          <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="e.g. CNIC photo is blurry. Please re-upload a clear, well-lit image."
                            rows={3}
                            style={{
                              width: '100%', padding: '10px 12px', borderRadius: 10,
                              border: `1px solid ${colors.danger}60`, background: '#fff',
                              color: colors.text, fontSize: 14, resize: 'vertical',
                              boxSizing: 'border-box', fontFamily: 'inherit',
                            }}
                          />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                          <label style={labelStyle}>
                            Sections that need correction (driver will see which sections to redo)
                          </label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {SECTIONS.map((s) => {
                              const checked = rejectSections.includes(s.key);
                              return (
                                <label
                                  key={s.key}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                    padding: '6px 12px', borderRadius: 8,
                                    border: `1px solid ${checked ? colors.danger : colors.border}`,
                                    background: checked ? `${colors.danger}10` : colors.bg,
                                    fontSize: 13, fontWeight: 600,
                                    color: checked ? colors.danger : colors.text,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleSection(s.key)}
                                    style={{ margin: 0 }}
                                  />
                                  {s.label}
                                </label>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                            Leave blank to flag all sections, or select specific ones.
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10 }}>
                          <Button
                            variant="danger"
                            disabled={busy === d.id}
                            onClick={() => reject(d.id)}
                          >
                            {busy === d.id ? '…' : 'Send rejection'}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => { setRejectingId(null); setRejectReason(''); setRejectSections([]); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>{children}</div>;
}

function InfoCell({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{value || '—'}</div>
    </div>
  );
}

function DocImage({ label, url }: { label: string; url?: string }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={label}
            style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
          />
        </a>
      ) : (
        <div style={{ height: 120, display: 'grid', placeItems: 'center', color: colors.muted, fontSize: 12 }}>
          Not uploaded
        </div>
      )}
      <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: colors.muted }}>
        {label}
      </div>
    </div>
  );
}

function CF({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
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
