'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card } from '@/components/ui';

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'pending' | 'active' | 'rejected';
type VehicleType = 'mini' | 'ac' | 'comfort' | 'xl' | 'bike' | 'auto';

interface DriverRow {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  dob?: string;
  vehicleLabel?: string;
  vehicleType?: string;
  color?: string;
  plate?: string;
  cnic?: string;
  franchiseId?: string;
  verificationStatus?: string;
  rating?: number;
  tripsCount?: number;
  online?: boolean;
  cycleGrossFare?: number;
  reviewReason?: string;
  photoDocUrl?: string;
  licenseDocUrl?: string;
  cnicDocUrl?: string;
  cnicBackDocUrl?: string;
  selfieDocUrl?: string;
  vehicleDocUrl?: string;
  vehiclePhotoDocUrl?: string;
}

interface CreateForm {
  fullName: string; email: string; phone: string;
  vehicleType: VehicleType; vehicleLabel: string; plate: string;
  cnic: string; franchiseId: string;
}

interface EditForm {
  fullName: string; phone: string;
  vehicleType: string; vehicleLabel: string; plate: string;
  cnic: string; franchiseId: string;
}

const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'mini',    label: 'Mini (Hatchback · No AC)' },
  { value: 'ac',      label: 'AC (Air Conditioned)' },
  { value: 'comfort', label: 'Comfort (Premium Sedan)' },
  { value: 'xl',      label: 'XL (SUV / Van)' },
  { value: 'bike',    label: 'Bike (Motorcycle)' },
  { value: 'auto',    label: 'Auto (Rickshaw)' },
];

const REJECT_SECTIONS = [
  { key: 'basic',   label: 'Basic info' },
  { key: 'license', label: 'Driver licence' },
  { key: 'cnic',    label: 'CNIC' },
  { key: 'selfie',  label: 'Selfie with ID' },
  { key: 'vehicle', label: 'Vehicle info' },
];

const EMPTY_CREATE: CreateForm = {
  fullName: '', email: '', phone: '', vehicleType: 'mini',
  vehicleLabel: '', plate: '', cnic: '', franchiseId: '',
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function DriversPage() {
  const [tab, setTab] = useState<Tab>('pending');

  // Per-tab driver lists
  const [pending,  setPending]  = useState<DriverRow[]>([]);
  const [active,   setActive]   = useState<DriverRow[]>([]);
  const [rejected, setRejected] = useState<DriverRow[]>([]);

  // UI state
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [busy,       setBusy]       = useState<string | null>(null);

  // Pending-tab: rejection flow
  const [rejectingId,       setRejectingId]       = useState<string | null>(null);
  const [rejectReason,      setRejectReason]       = useState('');
  const [rejectSections,    setRejectSections]     = useState<string[]>([]);

  // Active-tab: edit modal
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState<EditForm>({
    fullName: '', phone: '', vehicleType: 'mini', vehicleLabel: '', plate: '', cnic: '', franchiseId: '',
  });
  const [editError,  setEditError]  = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);

  // Create-driver form
  const [showCreate,    setShowCreate]    = useState(false);
  const [createForm,    setCreateForm]    = useState<CreateForm>(EMPTY_CREATE);
  const [creating,      setCreating]      = useState(false);
  const [createResult,  setCreateResult]  = useState<{ uid: string; link: string | null } | null>(null);
  const [createError,   setCreateError]   = useState<string | null>(null);

  // Subscribe to all three status groups in parallel
  useEffect(() => {
    const statuses: [string, React.Dispatch<React.SetStateAction<DriverRow[]>>][] = [
      ['pending',   setPending],
      ['approved',  setActive],
      ['rejected',  setRejected],
    ];
    const unsubs = statuses.map(([status, setter]) =>
      onSnapshot(
        query(collection(db, 'drivers'), where('verificationStatus', '==', status)),
        (snap) => setter(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverRow, 'id'>) }))),
        () => undefined,
      ),
    );
    // Also subscribe to suspended drivers alongside rejected
    const unsubSuspended = onSnapshot(
      query(collection(db, 'drivers'), where('verificationStatus', '==', 'suspended')),
      (snap) => setRejected((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        const newOnes = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DriverRow, 'id'>) }))
          .filter((d) => !ids.has(d.id));
        return [...prev.filter((r) => r.verificationStatus === 'rejected'), ...newOnes];
      }),
      () => undefined,
    );
    return () => { unsubs.forEach((u) => u()); unsubSuspended(); };
  }, []);

  // ── Pending actions ──────────────────────────────────────────────────────────

  async function approve(id: string) {
    setBusy(id);
    try {
      await adminApi.approveDriver({ driverId: id });
      setExpanded(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      alert('Please enter a rejection reason so the driver knows what to fix.');
      return;
    }
    setBusy(id);
    try {
      await adminApi.rejectDriver({
        driverId: id,
        reason: rejectReason.trim(),
        rejectedSections: rejectSections.length > 0 ? rejectSections : undefined,
      });
      setRejectingId(null); setRejectReason(''); setRejectSections([]);
      setExpanded(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function suspend(id: string) {
    if (!confirm('Suspend this driver? They will lose driver access immediately.')) return;
    setBusy(id);
    try {
      await adminApi.rejectDriver({ driverId: id, suspend: true, reason: 'Suspended by admin.' });
      setExpanded(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function restore(id: string) {
    if (!confirm('Restore this driver to approved status?')) return;
    setBusy(id);
    try {
      await adminApi.approveDriver({ driverId: id });
      setExpanded(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Permanently delete this driver? This cannot be undone.')) return;
    setBusy(id);
    try {
      await adminApi.deleteDriver({ driverId: id });
      setExpanded(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  // ── Edit actions ─────────────────────────────────────────────────────────────

  function openEdit(d: DriverRow) {
    setEditingId(d.id);
    setEditForm({
      fullName:     d.fullName     ?? '',
      phone:        d.phone        ?? '',
      vehicleType:  d.vehicleType  ?? 'mini',
      vehicleLabel: d.vehicleLabel ?? '',
      plate:        d.plate        ?? '',
      cnic:         d.cnic         ?? '',
      franchiseId:  d.franchiseId  ?? '',
    });
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.fullName || !editForm.vehicleLabel || !editForm.plate) {
      setEditError('Name, vehicle model, and plate are required.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await adminApi.updateDriver({
        driverId:     editingId,
        fullName:     editForm.fullName,
        phone:        editForm.phone || undefined,
        vehicleType:  editForm.vehicleType,
        vehicleLabel: editForm.vehicleLabel,
        plate:        editForm.plate,
        cnic:         editForm.cnic || undefined,
        franchiseId:  editForm.franchiseId || null,
      });
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  // ── Create driver ────────────────────────────────────────────────────────────

  function setCreate(k: keyof CreateForm, v: string) {
    setCreateForm((f) => ({ ...f, [k]: v }));
    setCreateResult(null); setCreateError(null);
  }

  async function createDriver() {
    if (!createForm.fullName || !createForm.email || !createForm.vehicleLabel || !createForm.plate) {
      setCreateError('Full name, email, vehicle model and plate are required.');
      return;
    }
    setCreating(true); setCreateError(null);
    try {
      const res = await adminApi.adminCreateDriver({
        fullName: createForm.fullName, email: createForm.email,
        phone: createForm.phone || undefined,
        vehicleType: createForm.vehicleType, vehicleLabel: createForm.vehicleLabel,
        plate: createForm.plate.toUpperCase(),
        cnic: createForm.cnic || undefined,
        franchiseId: createForm.franchiseId || undefined,
      });
      setCreateResult({ uid: res.uid, link: res.passwordResetLink });
      setCreateForm(EMPTY_CREATE);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create driver.');
    } finally {
      setCreating(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const rows = tab === 'pending' ? pending : tab === 'active' ? active : rejected;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Drivers</h1>
        <Button onClick={() => { setShowCreate((v) => !v); setCreateResult(null); setCreateError(null); }}>
          {showCreate ? 'Cancel' : '+ Create driver'}
        </Button>
      </div>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        Manage driver accounts — review applications, edit profiles, and control access.
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
              <div style={{ fontWeight: 800, color: colors.success, marginBottom: 6 }}>
                ✓ Driver created — they will appear in the Active tab immediately.
              </div>
              <div style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>UID: <code>{createResult.uid}</code></div>
              {createResult.link ? (
                <>
                  <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 8 }}>Password-setup link (share with driver):</div>
                  <div style={{ fontSize: 11, wordBreak: 'break-all', background: '#e8f5ee', borderRadius: 6, padding: '6px 10px' }}>{createResult.link}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>Send a password-reset email via Firebase console to let them set their password.</div>
              )}
            </div>
          )}
          {createError && (
            <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 12, padding: '8px 12px', background: '#fff5f5', borderRadius: 8, border: `1px solid ${colors.danger}30` }}>
              Error: {createError}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CF label="Full name *"     value={createForm.fullName}     onChange={(v) => setCreate('fullName', v)}     placeholder="Muhammad Ali" />
            <CF label="Email *"         value={createForm.email}        onChange={(v) => setCreate('email', v)}         placeholder="driver@example.com" type="email" />
            <CF label="Phone"           value={createForm.phone}        onChange={(v) => setCreate('phone', v)}         placeholder="+923001234567" />
            <CF label="CNIC"            value={createForm.cnic}         onChange={(v) => setCreate('cnic', v)}          placeholder="12345-1234567-1" />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Vehicle type *</label>
              <select value={createForm.vehicleType} onChange={(e) => setCreate('vehicleType', e.target.value)} style={inputStyle}>
                {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <CF label="Vehicle model *" value={createForm.vehicleLabel} onChange={(v) => setCreate('vehicleLabel', v)} placeholder="Toyota Corolla 2020" />
            <CF label="Number plate *"  value={createForm.plate}        onChange={(v) => setCreate('plate', v)}         placeholder="ABC-123" />
            <CF label="Franchise ID"    value={createForm.franchiseId}  onChange={(v) => setCreate('franchiseId', v)}   placeholder="(optional)" />
          </div>
          <div style={{ marginTop: 16 }}>
            <Button onClick={createDriver} disabled={creating}>{creating ? 'Creating…' : 'Create driver account'}</Button>
          </div>
        </Card>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {([
          { key: 'pending',  label: `Pending (${pending.length})` },
          { key: 'active',   label: `Active (${active.length})` },
          { key: 'rejected', label: `Rejected / Suspended (${rejected.length})` },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setExpanded(null); setEditingId(null); }}
            style={{
              flex: 1, padding: '10px 14px', border: 'none', cursor: 'pointer', fontWeight: 700,
              fontSize: 13,
              background: tab === t.key ? colors.primary : colors.bg,
              color: tab === t.key ? '#fff' : colors.text,
              borderRight: t.key !== 'rejected' ? `1px solid ${colors.border}` : 'none',
              transition: 'background 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Edit modal ── */}
      {editingId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Edit driver</h2>
              <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: colors.muted }}>✕</button>
            </div>
            {editError && (
              <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14, padding: '8px 12px', background: '#fff5f5', borderRadius: 8 }}>
                {editError}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <CF label="Full name *"     value={editForm.fullName}     onChange={(v) => setEditForm((f) => ({ ...f, fullName: v }))}     placeholder="Muhammad Ali" />
              <CF label="Phone"           value={editForm.phone}        onChange={(v) => setEditForm((f) => ({ ...f, phone: v }))}         placeholder="+923001234567" />
              <CF label="CNIC"            value={editForm.cnic}         onChange={(v) => setEditForm((f) => ({ ...f, cnic: v }))}          placeholder="12345-1234567-1" />
              <CF label="Franchise ID"    value={editForm.franchiseId}  onChange={(v) => setEditForm((f) => ({ ...f, franchiseId: v }))}   placeholder="(leave blank to unassign)" />
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Vehicle type</label>
                <select value={editForm.vehicleType} onChange={(e) => setEditForm((f) => ({ ...f, vehicleType: e.target.value }))} style={inputStyle}>
                  {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <CF label="Vehicle model *" value={editForm.vehicleLabel} onChange={(v) => setEditForm((f) => ({ ...f, vehicleLabel: v }))} placeholder="Toyota Corolla 2020" />
              <CF label="Number plate *"  value={editForm.plate}        onChange={(v) => setEditForm((f) => ({ ...f, plate: v }))}         placeholder="ABC-123" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Driver list ── */}
      {rows.length === 0 ? (
        <Card><span style={{ color: colors.muted }}>
          {tab === 'pending' ? 'No pending applications right now.' :
           tab === 'active'  ? 'No active drivers yet. Create one above.' :
                               'No rejected or suspended drivers.'}
        </span></Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((d) => {
            const isExpanded = expanded === d.id;
            const isRejecting = rejectingId === d.id;
            const isBusy = busy === d.id;

            return (
              <Card key={d.id} style={{ padding: 0, overflow: 'hidden' }}>
                {/* Summary row */}
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 12, padding: '14px 16px', cursor: 'pointer',
                    background: isExpanded ? `${colors.primary}0c` : undefined,
                  }}
                  onClick={() => {
                    setExpanded(isExpanded ? null : d.id);
                    setRejectingId(null); setRejectReason(''); setRejectSections([]);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {d.photoDocUrl ? (
                      <img src={d.photoDocUrl} alt="Photo" style={{ width: 44, height: 44, borderRadius: 22, objectFit: 'cover', border: `2px solid ${colors.border}` }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 22, background: colors.bg, border: `2px solid ${colors.border}`, display: 'grid', placeItems: 'center', fontSize: 18 }}>👤</div>
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <strong style={{ fontSize: 15 }}>{d.fullName ?? 'Unknown'}</strong>
                        {tab === 'active' && (
                          <>
                            <Badge label={d.online ? 'Online' : 'Offline'} color={d.online ? colors.success : colors.muted} />
                            <span style={{ fontSize: 12, color: colors.muted }}>★ {(d.rating ?? 5).toFixed(1)} · {d.tripsCount ?? 0} trips</span>
                          </>
                        )}
                        {tab === 'pending'  && <Badge label="Pending"   color={colors.warn} />}
                        {tab === 'rejected' && <Badge label={d.verificationStatus === 'suspended' ? 'Suspended' : 'Rejected'} color={colors.danger} />}
                      </div>
                      <div style={{ color: colors.muted, fontSize: 13 }}>
                        {(d.vehicleType ?? '').toUpperCase()} · {d.vehicleLabel ?? '—'} · {d.plate ?? '—'}
                        {d.email && ` · ${d.email}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Quick action buttons on active drivers */}
                    {tab === 'active' && !isExpanded && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); openEdit(d); }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          disabled={isBusy}
                          onClick={(e) => { e.stopPropagation(); suspend(d.id); }}
                        >
                          Suspend
                        </Button>
                      </>
                    )}
                    <span style={{ color: colors.muted, fontSize: 16 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, padding: 20 }}>

                    {/* Personal info */}
                    <Section title="Personal information">
                      <InfoGrid>
                        <InfoCell label="Full name"    value={d.fullName} />
                        <InfoCell label="Email"        value={d.email} />
                        <InfoCell label="Phone"        value={d.phone} />
                        <InfoCell label="CNIC"         value={d.cnic} />
                        <InfoCell label="Date of birth" value={d.dob} />
                        <InfoCell label="Franchise"    value={d.franchiseId} />
                      </InfoGrid>
                    </Section>

                    {/* Vehicle info */}
                    <Section title="Vehicle information">
                      <InfoGrid>
                        <InfoCell label="Type"   value={d.vehicleType} />
                        <InfoCell label="Model"  value={d.vehicleLabel} />
                        <InfoCell label="Colour" value={d.color} />
                        <InfoCell label="Plate"  value={d.plate} />
                      </InfoGrid>
                    </Section>

                    {/* Stats for active drivers */}
                    {tab === 'active' && (
                      <Section title="Stats">
                        <InfoGrid>
                          <InfoCell label="Rating"        value={d.rating ? `★ ${d.rating.toFixed(1)}` : '★ 5.0'} />
                          <InfoCell label="Trips"         value={String(d.tripsCount ?? 0)} />
                          <InfoCell label="Status"        value={d.online ? 'Online' : 'Offline'} />
                          <InfoCell label="Cycle fare"    value={`${d.cycleGrossFare ?? 0} PKR`} />
                        </InfoGrid>
                      </Section>
                    )}

                    {/* Rejection reason for rejected tab */}
                    {tab === 'rejected' && d.reviewReason && (
                      <Section title="Rejection reason">
                        <div style={{ background: '#fff5f5', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: colors.danger }}>
                          {d.reviewReason}
                        </div>
                      </Section>
                    )}

                    {/* Documents (only for pending) */}
                    {tab === 'pending' && (
                      <Section title="Documents &amp; photos">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                          <DocImage label="Profile photo"  url={d.photoDocUrl} />
                          <DocImage label="Selfie with ID" url={d.selfieDocUrl} />
                          <DocImage label="Driver licence" url={d.licenseDocUrl} />
                          <DocImage label="CNIC (front)"   url={d.cnicDocUrl} />
                          <DocImage label="CNIC (back)"    url={d.cnicBackDocUrl} />
                          <DocImage label="Vehicle reg."   url={d.vehicleDocUrl} />
                          {d.vehiclePhotoDocUrl && <DocImage label="Vehicle photo" url={d.vehiclePhotoDocUrl} />}
                        </div>
                      </Section>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                      {tab === 'pending' && !isRejecting && (
                        <>
                          <Button disabled={isBusy} onClick={() => approve(d.id)}>
                            {isBusy ? '…' : '✓ Approve driver'}
                          </Button>
                          <Button variant="ghost" onClick={() => openEdit(d)}>Edit info</Button>
                          <Button
                            variant="danger"
                            disabled={isBusy}
                            onClick={() => { setRejectingId(d.id); setRejectReason(''); setRejectSections([]); }}
                          >
                            ✕ Reject
                          </Button>
                        </>
                      )}

                      {tab === 'active' && (
                        <>
                          <Button onClick={() => openEdit(d)}>Edit info</Button>
                          <Button variant="danger" disabled={isBusy} onClick={() => suspend(d.id)}>
                            {isBusy ? '…' : 'Suspend'}
                          </Button>
                          <Button variant="danger" disabled={isBusy} onClick={() => remove(d.id)}>
                            {isBusy ? '…' : 'Delete account'}
                          </Button>
                        </>
                      )}

                      {tab === 'rejected' && (
                        <>
                          <Button disabled={isBusy} onClick={() => restore(d.id)}>
                            {isBusy ? '…' : '↩ Restore to active'}
                          </Button>
                          <Button variant="ghost" onClick={() => openEdit(d)}>Edit info</Button>
                          <Button variant="danger" disabled={isBusy} onClick={() => remove(d.id)}>
                            {isBusy ? '…' : 'Delete account'}
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Reject form */}
                    {isRejecting && (
                      <div style={{ marginTop: 16, background: '#fff5f5', borderRadius: 12, border: `1px solid ${colors.danger}20`, padding: 16 }}>
                        <div style={{ fontWeight: 800, color: colors.danger, marginBottom: 12 }}>Reject application</div>
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ ...labelStyle, color: colors.danger }}>
                            Reason for rejection * (driver will see this)
                          </label>
                          <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="e.g. CNIC photo is blurry — please re-upload a clear image."
                            rows={3}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${colors.danger}60`, background: '#fff', color: colors.text, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                          />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                          <label style={labelStyle}>Sections that need correction</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {REJECT_SECTIONS.map((s) => {
                              const checked = rejectSections.includes(s.key);
                              return (
                                <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', borderRadius: 8, border: `1px solid ${checked ? colors.danger : colors.border}`, background: checked ? `${colors.danger}10` : colors.bg, fontSize: 13, fontWeight: 600, color: checked ? colors.danger : colors.text }}>
                                  <input type="checkbox" checked={checked} onChange={() => setRejectSections((prev) => prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key])} style={{ margin: 0 }} />
                                  {s.label}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <Button variant="danger" disabled={isBusy} onClick={() => reject(d.id)}>
                            {isBusy ? '…' : 'Send rejection'}
                          </Button>
                          <Button variant="ghost" onClick={() => { setRejectingId(null); setRejectReason(''); setRejectSections([]); }}>
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

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>{children}</div>;
}

function InfoCell({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{value ?? '—'}</div>
    </div>
  );
}

function DocImage({ label, url }: { label: string; url?: string }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
        </a>
      ) : (
        <div style={{ height: 120, display: 'grid', placeItems: 'center', color: colors.muted, fontSize: 12 }}>Not uploaded</div>
      )}
      <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: colors.muted }}>{label}</div>
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
