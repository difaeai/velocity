'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi, type DriverCommissionReport } from '@/lib/api';
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
  vehicleDocUrl?: string;
  vehiclePhotoDocUrl?: string;
  extraVehiclePhotoDocUrls?: string[];
  licenseExpiry?: string;
  cnicExpiry?: string;
  vehicleDocExpiry?: string;
  /** Which car in drivers/{id}/vehicles the flat fields above are a copy of. */
  activeVehicleId?: string;
  /** True while one of this driver's cars is waiting on a review here. */
  vehicleReviewPending?: boolean;
  /** What the verification engine made of this application. */
  verification?: VerificationRecord;
  /** The live face scan the driver did before submitting. */
  faceScan?: {
    status?: 'pending' | 'passed' | 'failed' | 'review';
    matchesDocuments?: 'match' | 'mismatch' | 'unclear';
    posesMatched?: number;
    posesAsked?: number;
    reasons?: string[];
  };
  /** The photo the driver took of the car they are driving right now. */
  vehicleCheck?: {
    status?: 'pending' | 'approved' | 'rejected';
    vehicleId?: string;
    plate?: string | null;
    photoUrl?: string | null;
    confirmedAt?: { seconds: number };
    reason?: string | null;
  };
}

/**
 * The engine's verdict, as it lands on `drivers/{uid}.verification`.
 *
 * `status: 'verifying'` means it is reading the documents right now; the other
 * values are settled. `decidedBy` is 'engine' for an automatic decision and an
 * admin uid when a human overrode it — and `overrodeEngine` names what it
 * overrode, which is the row worth going back and looking at later.
 */
interface VerificationRecord {
  status?: 'verifying' | 'approved' | 'rejected' | 'review' | 'rerunning';
  riskScore?: number | null;
  reasons?: { code: string; detail: string; severity: 'fatal' | 'major' | 'minor'; section?: string }[];
  expiries?: Record<string, { state: string; daysLeft: number | null; resolved: string | null; conflict?: boolean }>;
  duplicates?: { field: string; value: string; driverId: string; status: string; banned: boolean }[];
  report?: {
    crossChecks?: Record<string, string>;
    fraudSignals?: string[];
    overallConfidence?: string;
    summary?: string;
    documents?: { kind: string; looksLike: string; legible: boolean; tampering: string; notes?: string }[];
  } | null;
  aiChecked?: boolean;
  mode?: string;
  decidedBy?: string;
  overrodeEngine?: string | null;
}

interface VehicleRow {
  id: string;
  vehicleType?: string;
  make?: string;
  color?: string;
  plate?: string;
  label?: string;
  docUrl?: string | null;
  photoUrl?: string | null;
  status?: 'pending' | 'approved' | 'rejected';
  reviewReason?: string | null;
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

      <EngineSettings />

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
                        {/* Something about this driver's car is waiting on a
                            human. Surfaced on the collapsed row so a queue of
                            them is visible without opening every card. */}
                        {(d.vehicleReviewPending || d.vehicleCheck?.status === 'pending') && (
                          <Badge label="🚗 Car review" color={colors.warn} />
                        )}
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

                    {/* The car photo the driver took before their last shift.
                        This is what the passenger's plate is actually backed by,
                        so it gets judged here rather than being filed away. */}
                    <CarPhotoCheck driver={d} />

                    {/* Every car on the account. A car added after signup cannot
                        be driven until it is approved here — that review is the
                        only thing standing between a driver and an unvetted car. */}
                    <DriverCars driverId={d.id} activeVehicleId={d.activeVehicleId} />

                    {/* Stats for active drivers */}
                    {tab === 'active' && (
                      <Section title="Stats">
                        <InfoGrid>
                          <InfoCell label="Rating"        value={d.rating ? `★ ${d.rating.toFixed(1)}` : '★ 5.0'} />
                          <InfoCell label="Trips"         value={String(d.tripsCount ?? 0)} />
                          <InfoCell label="Status"        value={d.online ? 'Online' : 'Offline'} />
                          <InfoCell label="Unsettled fares" value={`${d.cycleGrossFare ?? 0} PKR`} />
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

                    {/* What the engine found. Above the documents on purpose:
                        it tells the reviewer where to look before they start
                        clicking through six photographs. */}
                    {tab !== 'active' && (
                      <VerificationPanel
                        driverId={d.id}
                        verification={d.verification}
                        faceScan={d.faceScan}
                      />
                    )}

                    {/* Documents (only for pending) */}
                    {tab === 'pending' && (
                      <Section title="Documents &amp; photos">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                          <DocImage label="Profile photo"  url={d.photoDocUrl} />
                          <DocImage label="Driver licence" url={d.licenseDocUrl} expiry={d.licenseExpiry} />
                          <DocImage label="CNIC (front)"   url={d.cnicDocUrl}    expiry={d.cnicExpiry} />
                          <DocImage label="CNIC (back)"    url={d.cnicBackDocUrl} />
                          <DocImage label="Vehicle reg."   url={d.vehicleDocUrl} expiry={d.vehicleDocExpiry} />
                          {d.vehiclePhotoDocUrl && <DocImage label="Vehicle (front, plate)" url={d.vehiclePhotoDocUrl} />}
                          {(d.extraVehiclePhotoDocUrls ?? []).map((url, i) => (
                            <DocImage key={url} label={`Vehicle photo ${i + 2}`} url={url} />
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Document expiry alerts (visible on all tabs) */}
                    {(d.licenseExpiry || d.cnicExpiry || d.vehicleDocExpiry) && (
                      <DocExpiryAlerts
                        licenseExpiry={d.licenseExpiry}
                        cnicExpiry={d.cnicExpiry}
                        vehicleDocExpiry={d.vehicleDocExpiry}
                      />
                    )}

                    {/* Commission, the daily target, and the manual credit lever.
                        Only for drivers who are actually working — a pending or
                        rejected application has no cycle to look at. */}
                    {tab === 'active' && <DriverCommissionPanel driverId={d.id} />}

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

// ── The driver's car ───────────────────────────────────────────────────────────

/** How long a car photo stands — mirrors VEHICLE_CHECK_TTL_DAYS on the backend. */
const CAR_PHOTO_TTL_DAYS = 30;

/**
 * The photo the driver took of the car they are driving right now.
 *
 * Approving is a formality; REJECTING is the point. It takes the driver offline
 * on the spot and forces a new photo before they can go back on, which is the
 * only fast lever there is when the car in the picture is not the car on file.
 */
/**
 * One driver's commission position, their recent target days, and the manual
 * bonus lever.
 *
 * The driver-facing word is BONUS everywhere; `commissionCredit` survives only
 * as a field name (see the note in backend domain/dailyTarget.ts).
 *
 * WHY IT IS LAZY. The report is three Firestore reads behind a callable, and a
 * driver list can hold hundreds of rows — fetching it for every row would make
 * opening this page cost a query per driver for information almost none of them
 * are being looked at for. So it loads when the panel is expanded, once.
 *
 * WHY THE LEVER IS HERE AT ALL. There is no gateway top-up yet, so a driver who
 * settles in cash at the office, or who is owed a target bonus a bug lost, can
 * only be made whole by hand. The same control claws credit back off somebody
 * who farmed the target. Both need a reason, and the backend audit-logs every
 * adjustment against the admin who made it.
 */
function DriverCommissionPanel({ driverId }: { driverId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DriverCommissionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await adminApi.adminGetDriverCommission({ driverId, days: 14 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !report && !loading) void load();
  }

  async function adjust(sign: 1 | -1) {
    const pkr = Math.round(Number(amount));
    if (!Number.isFinite(pkr) || pkr <= 0) {
      setError('Enter an amount in PKR.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Say why — this is audit-logged.');
      return;
    }
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await adminApi.adminAdjustCommissionCredit({
        driverId,
        amount: sign * pkr,
        reason: reason.trim(),
      });
      setDone(
        res.applied >= 0
          ? `Granted a PKR ${res.applied.toLocaleString()} bonus.`
          : `Removed PKR ${Math.abs(res.applied).toLocaleString()} of bonus.`,
      );
      setAmount('');
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not adjust.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button type="button" onClick={toggle} style={panelToggle}>
        {open ? '▾' : '▸'} Commission, daily target &amp; bonus
      </button>

      {!open ? null : loading && !report ? (
        <div style={{ color: colors.muted, fontSize: 13, padding: '10px 2px' }}>Loading…</div>
      ) : (
        <div style={panelBox}>
          {error && <div style={{ color: colors.danger, fontSize: 13, fontWeight: 600 }}>{error}</div>}
          {done && <div style={{ color: colors.success, fontSize: 13, fontWeight: 700 }}>{done}</div>}

          {report && (
            <>
              <div style={moneyGrid}>
                <Money label="Unsettled fares" value={report.driver.cycleGrossFare} />
                <Money label="Of that, from closed days" value={report.driver.settleableGross} />
                <Money
                  label={`Commission due at ${Math.round(report.settings.rate * 100)}%`}
                  value={report.driver.grossDue}
                />
                <Money label="Paid by their bonus" value={report.driver.creditApplied} />
                <Money label="Driver owes now" value={report.driver.due} strong />
                <Money label="Bonus available" value={report.driver.commissionCredit} strong />
                <Money label="Bonus earned, lifetime" value={report.driver.commissionCreditEarned} />
              </div>

              {/* Recent days, so a farmed pattern is visible rather than inferred. */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
                  Last {report.days.length} days
                  {report.settings.dailyTargetEnabled
                    ? ` · target ${report.settings.dailyTargetRides} ${report.settings.dailyTargetPoolOnly ? 'pool rides' : 'rides'} → that day is commission-free` +
                      (report.settings.dailyTargetBonus > 0
                        ? ` + PKR ${report.settings.dailyTargetBonus.toLocaleString()}`
                        : '')
                    : ' · target is off'}
                </div>
                {report.days.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: colors.muted }}>No completed rides yet.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: colors.muted, textAlign: 'left' }}>
                        <th style={th}>Day</th>
                        <th style={th}>Rides</th>
                        <th style={th}>Pool</th>
                        <th style={th}>Counted</th>
                        <th style={th}>Riders</th>
                        <th style={th}>Fares</th>
                        <th style={th}>Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.days.map((d) => (
                        <tr key={d.day} style={{ borderTop: `1px solid ${colors.border}` }}>
                          <td style={td}>{d.day}</td>
                          <td style={td}>{d.rides}</td>
                          <td style={td}>{d.poolRides}</td>
                          <td style={td}>{d.qualifyingRides}</td>
                          <td style={td}>{d.riders}</td>
                          <td style={td}>{Math.round(d.grossFare).toLocaleString()}</td>
                          {/* What the day actually cost the driver: free if it hit
                              the target, otherwise the rate on its cash. */}
                          <td style={{ ...td, fontWeight: d.met ? 800 : 400 }}>
                            {d.met
                              ? `free${d.bonusGranted > 0 ? ` + PKR ${d.bonusGranted.toLocaleString()}` : ''}`
                              : `PKR ${Math.round(d.cashFare * report.settings.rate).toLocaleString()}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* The manual lever. */}
              <div style={{ marginTop: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
                  Adjust bonus by hand
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '0 0 130px' }}>
                    <label style={smallLabel}>Amount (PKR)</label>
                    <input
                      type="number"
                      min={1}
                      step={100}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      style={smallInput}
                    />
                  </div>
                  <div style={{ flex: '1 1 220px' }}>
                    <label style={smallLabel}>Reason (audit-logged)</label>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. paid 500 cash at the office"
                      style={smallInput}
                    />
                  </div>
                  <Button disabled={saving} onClick={() => adjust(1)}>
                    {saving ? '…' : '+ Grant'}
                  </Button>
                  <Button variant="danger" disabled={saving} onClick={() => adjust(-1)}>
                    {saving ? '…' : '- Claw back'}
                  </Button>
                </div>
                <div style={{ fontSize: 11.5, color: colors.muted, marginTop: 8, lineHeight: 1.6 }}>
                  A bonus pays this driver&apos;s commission automatically and can never be
                  withdrawn as cash. A clawback larger than their balance takes what is there
                  and stops — a bonus never goes negative.
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: strong ? 17 : 15, fontWeight: strong ? 900 : 700, color: colors.text }}>
        PKR {Math.round(value).toLocaleString()}
      </div>
    </div>
  );
}

const panelToggle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 800,
  color: colors.primary,
  fontFamily: 'inherit',
};
const panelBox: React.CSSProperties = {
  marginTop: 10,
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 14,
  display: 'grid',
  gap: 8,
};
const moneyGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 12,
};
const th: React.CSSProperties = { padding: '4px 6px', fontWeight: 700 };
const td: React.CSSProperties = { padding: '5px 6px', color: colors.text };
const smallLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 700,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 3,
};
const smallInput: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  color: colors.text,
  fontSize: 14,
  boxSizing: 'border-box',
};

function CarPhotoCheck({ driver }: { driver: DriverRow }) {
  const [busy, setBusy] = useState(false);
  // Read the clock once, when the card opens. "How old is this photo" is a
  // question about the world rather than about props, so it must not be
  // recomputed on every re-render.
  const [openedAt] = useState(() => Date.now());
  const check = driver.vehicleCheck;

  if (!check?.confirmedAt) {
    return (
      <Section title="Car photo verification">
        <div style={{ background: colors.bg, borderRadius: 10, padding: '12px 14px', fontSize: 13, color: colors.muted }}>
          No photo submitted yet — this driver cannot go online until they take one.
        </div>
      </Section>
    );
  }

  const takenAt = new Date(check.confirmedAt.seconds * 1000);
  const ageDays = Math.floor((openedAt - takenAt.getTime()) / 86_400_000);
  const stale = ageDays >= CAR_PHOTO_TTL_DAYS;
  const statusColor =
    check.status === 'rejected' ? colors.danger
    : check.status === 'approved' ? colors.success
    : colors.warn;

  async function review(approve: boolean) {
    let reason: string | undefined;
    if (!approve) {
      const entered = prompt('Why is this photo being rejected? The driver will see this.');
      if (entered === null) return;
      if (!entered.trim()) { alert('Please give a reason so the driver knows what to fix.'); return; }
      reason = entered.trim();
    }
    setBusy(true);
    try {
      await adminApi.adminReviewVehiclePhoto({ driverId: driver.id, approve, reason });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Car photo verification">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {check.photoUrl ? (
          <a href={check.photoUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={check.photoUrl}
              alt="Car photo"
              style={{ width: 200, height: 140, objectFit: 'cover', borderRadius: 10, border: `1px solid ${colors.border}`, display: 'block' }}
            />
          </a>
        ) : null}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Badge label={check.status ?? 'pending'} color={statusColor} />
            {stale && <Badge label="Expired" color={colors.muted} />}
          </div>
          <div style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>
            Taken {takenAt.toLocaleString('en-PK')} ({ageDays === 0 ? 'today' : `${ageDays}d ago`})
          </div>
          <div style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>
            Declared plate: <strong style={{ color: colors.text }}>{check.plate ?? driver.plate ?? '—'}</strong>
          </div>
          {check.reason && (
            <div style={{ fontSize: 13, color: colors.danger, marginBottom: 8 }}>{check.reason}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button disabled={busy || check.status === 'approved'} onClick={() => review(true)}>
              {busy ? '…' : '✓ Photo matches'}
            </Button>
            <Button variant="danger" disabled={busy || check.status === 'rejected'} onClick={() => review(false)}>
              {busy ? '…' : '✕ Reject & take offline'}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * Every car on this driver's account.
 *
 * Subscribed only while the card is expanded — one listener per open driver,
 * not one per driver in the list.
 */
function DriverCars({ driverId, activeVehicleId }: { driverId: string; activeVehicleId?: string }) {
  const [cars, setCars] = useState<VehicleRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'drivers', driverId, 'vehicles'),
      (snap) => setCars(snap.docs.map((v) => ({ id: v.id, ...(v.data() as Omit<VehicleRow, 'id'>) }))),
      () => setCars([]),
    );
  }, [driverId]);

  // 'primary' is the id the onboarding car is seeded under, and the fallback the
  // security rules use when a driver has no activeVehicleId yet.
  const activeId = activeVehicleId ?? 'primary';

  async function review(vehicleId: string, approve: boolean) {
    let reason: string | undefined;
    if (!approve) {
      const entered = prompt('Why is this car being rejected? The driver will see this.');
      if (entered === null) return;
      if (!entered.trim()) { alert('Please give a reason so the driver knows what to fix.'); return; }
      reason = entered.trim();
    }
    setBusy(vehicleId);
    try {
      await adminApi.adminReviewDriverVehicle({ driverId, vehicleId, approve, reason });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (cars.length === 0) return null;

  return (
    <Section title={`Cars on this account (${cars.length})`}>
      <div style={{ display: 'grid', gap: 10 }}>
        {cars.map((v) => {
          const isActive = v.id === activeId;
          const statusColor =
            v.status === 'approved' ? colors.success
            : v.status === 'rejected' ? colors.danger
            : colors.warn;
          return (
            <div
              key={v.id}
              style={{
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                background: colors.bg, borderRadius: 10, padding: 12,
                border: `1px solid ${isActive ? colors.primary : colors.border}`,
              }}
            >
              {v.photoUrl ? (
                <a href={v.photoUrl} target="_blank" rel="noopener noreferrer">
                  <img src={v.photoUrl} alt={v.label ?? 'Car'} style={{ width: 92, height: 68, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                </a>
              ) : (
                <div style={{ width: 92, height: 68, borderRadius: 8, display: 'grid', placeItems: 'center', border: `1px solid ${colors.border}`, fontSize: 22 }}>🚗</div>
              )}
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <strong style={{ fontSize: 14 }}>{v.label ?? v.make ?? 'Car'}</strong>
                  <Badge label={v.status ?? 'pending'} color={statusColor} />
                  {isActive && <Badge label="Driving now" color={colors.primary} />}
                </div>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  {(v.vehicleType ?? '').toUpperCase()} · {v.plate ?? '—'}
                </div>
                {v.reviewReason && (
                  <div style={{ fontSize: 12, color: colors.danger, marginTop: 3 }}>{v.reviewReason}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {v.docUrl && (
                  <a href={v.docUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: colors.primary, alignSelf: 'center' }}>
                    Registration ↗
                  </a>
                )}
                <Button disabled={busy === v.id || v.status === 'approved'} onClick={() => review(v.id, true)}>
                  {busy === v.id ? '…' : '✓ Approve'}
                </Button>
                <Button variant="danger" disabled={busy === v.id || v.status === 'rejected'} onClick={() => review(v.id, false)}>
                  {busy === v.id ? '…' : '✕ Reject'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
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

function expiryStatus(expiry?: string): 'expired' | 'soon' | 'ok' | null {
  if (!expiry) return null;
  const d = new Date(expiry);
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff < 0) return 'expired';
  if (diff < 30 * 24 * 60 * 60 * 1000) return 'soon';
  return 'ok';
}

/**
 * The engine's one switch, where the people who live with it can reach it.
 *
 * Three modes, and the middle one is the one that matters: `suggest` runs every
 * check and records every verdict but lets nothing through without a person.
 * That is how you find out whether to trust the thing before you let it decide
 * — watch a week of its verdicts against your own, then turn it to `full`.
 *
 * Deliberately on this page rather than in a settings screen somewhere else: a
 * switch that turns off automatic rejections belongs next to the list of people
 * who were automatically rejected.
 */
function EngineSettings() {
  const [config, setConfig] = useState<{
    mode: 'full' | 'suggest' | 'off';
    autoApproveMaxRisk: number;
    autoRejectMinRisk: number;
    minDaysBeforeExpiry: number;
  } | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    adminApi
      .adminVerificationSettings({})
      .then((r) => { setConfig(r.config); setAiConfigured(r.aiConfigured); })
      .catch(() => undefined);
  }, []);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await adminApi.adminVerificationSettings({ patch });
      setConfig(r.config);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!config) return null;

  const modeColor =
    config.mode === 'full' ? colors.primary : config.mode === 'suggest' ? '#f59e0b' : colors.muted;
  const modeLabel =
    config.mode === 'full' ? 'Deciding automatically'
      : config.mode === 'suggest' ? 'Advising only — every driver still waits for a human'
        : 'Off — no automatic checks';

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>Verification engine</div>
        <Badge label={modeLabel} color={modeColor} />
        {!aiConfigured && (
          <Badge label="No ANTHROPIC_API_KEY — everything goes to review" color={colors.danger} />
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: colors.muted, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
        >
          {open ? 'Hide settings' : 'Settings'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['full', 'suggest', 'off'] as const).map((m) => (
              <Button
                key={m}
                variant={config.mode === m ? 'primary' : 'ghost'}
                disabled={busy}
                onClick={() => save({ mode: m })}
              >
                {m === 'full' ? 'Decide automatically' : m === 'suggest' ? 'Advise only' : 'Off'}
              </Button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.6 }}>
            <strong style={{ color: colors.text }}>Decide automatically</strong> — a clean
            application is approved and a clearly bad one refused, both within seconds. Anything in
            between still reaches this queue.<br />
            <strong style={{ color: colors.text }}>Advise only</strong> — every check runs and every
            verdict is recorded, but nothing is decided. Use this to see whether you agree with it
            before you let it act.<br />
            <strong style={{ color: colors.text }}>Off</strong> — no AI reading at all. The
            duplicate-CNIC and expiry checks still run, and everything lands here.
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
            <NumberKnob
              label="Approve at or below risk"
              value={config.autoApproveMaxRisk}
              disabled={busy}
              onCommit={(v) => save({ autoApproveMaxRisk: v })}
            />
            <NumberKnob
              label="Reject at or above risk"
              value={config.autoRejectMinRisk}
              disabled={busy}
              onCommit={(v) => save({ autoRejectMinRisk: v })}
            />
            <NumberKnob
              label="Min days before a document expires"
              value={config.minDaysBeforeExpiry}
              disabled={busy}
              onCommit={(v) => save({ minDaysBeforeExpiry: v })}
            />
          </div>
          {err && <div style={{ color: colors.danger, fontSize: 12 }}>{err}</div>}
        </div>
      )}
    </Card>
  );
}

/** A number you can type into, that only saves when you have finished typing. */
function NumberKnob({
  label, value, disabled, onCommit,
}: { label: string; value: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>
        {label}
      </label>
      <input
        type="number"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        // Saved on blur rather than on every keystroke: typing "60" over "10"
        // passes through "6", and a threshold that briefly reads 6 would be a
        // threshold that briefly rejects almost everybody.
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n !== value) onCommit(n);
          else setDraft(String(value));
        }}
        style={{
          width: 90, padding: '6px 10px', borderRadius: 8,
          border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text,
          fontSize: 14, fontWeight: 700,
        }}
      />
    </div>
  );
}

/**
 * What the engine found, for the human who has to make the call after it.
 *
 * Written to be read in ten seconds by someone with forty applications to get
 * through: the verdict and the risk number first, then the specific things that
 * were wrong, then the raw model read underneath for anyone who wants to argue
 * with it. The point is never to tell the admin what to do — the approve and
 * reject buttons are theirs — it is to put the evidence in front of them so the
 * decision is theirs on purpose rather than by default.
 */
function VerificationPanel({
  driverId,
  verification,
  faceScan,
  onRechecked,
}: {
  driverId: string;
  verification?: VerificationRecord;
  faceScan?: DriverRow['faceScan'];
  onRechecked?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const status = verification?.status;
  const risk = verification?.riskScore ?? null;
  const reasons = verification?.reasons ?? [];
  const duplicates = verification?.duplicates ?? [];
  const report = verification?.report;

  const verdictColor =
    status === 'approved' ? colors.primary
      : status === 'rejected' ? colors.danger
        : status === 'verifying' || status === 'rerunning' ? '#6366f1'
          : '#f59e0b';

  const verdictLabel =
    status === 'approved' ? 'Engine approved'
      : status === 'rejected' ? 'Engine rejected'
        : status === 'verifying' ? 'Reading documents…'
          : status === 'rerunning' ? 'Re-checking…'
            : status === 'review' ? 'Needs a human'
              : 'Not checked';

  async function recheck() {
    setBusy(true);
    setErr(null);
    try {
      await adminApi.adminRerunDriverVerification({ driverId });
      onRechecked?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Re-check failed.');
    } finally {
      setBusy(false);
    }
  }

  // A driver who submitted before the engine existed has no record at all.
  // Say so plainly rather than rendering an empty box that looks like a pass.
  if (!verification) {
    return (
      <Section title="Automatic verification">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: colors.muted }}>
            This application has not been through the engine.
          </div>
          <Button variant="ghost" disabled={busy} onClick={recheck}>
            {busy ? 'Checking…' : 'Run check now'}
          </Button>
        </div>
        {err && <div style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{err}</div>}
      </Section>
    );
  }

  return (
    <Section title="Automatic verification">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge label={verdictLabel} color={verdictColor} />
        {risk !== null && (
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
            Risk{' '}
            <span style={{ color: risk >= 60 ? colors.danger : risk >= 20 ? '#f59e0b' : colors.primary }}>
              {risk}
            </span>
            <span style={{ color: colors.muted, fontWeight: 600 }}>/100</span>
          </div>
        )}
        {faceScan?.status && (
          <Badge
            label={`Face scan: ${faceScan.status}${
              faceScan.posesAsked ? ` (${faceScan.posesMatched ?? 0}/${faceScan.posesAsked} poses)` : ''
            }`}
            color={faceScan.status === 'passed' ? colors.primary : colors.danger}
          />
        )}
        {faceScan?.matchesDocuments && faceScan.matchesDocuments !== 'match' && (
          <Badge
            label={`Face vs ID: ${faceScan.matchesDocuments}`}
            color={faceScan.matchesDocuments === 'mismatch' ? colors.danger : '#f59e0b'}
          />
        )}
        {verification.aiChecked === false && <Badge label="No AI — deterministic checks only" color={colors.muted} />}
        {verification.mode && verification.mode !== 'full' && (
          <Badge label={`Mode: ${verification.mode}`} color="#6366f1" />
        )}
        {verification.overrodeEngine && (
          <Badge label={`Human overrode: ${verification.overrodeEngine}`} color="#8b5cf6" />
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="ghost" disabled={busy} onClick={recheck}>
            {busy ? 'Checking…' : '↻ Re-check'}
          </Button>
        </div>
      </div>
      {err && <div style={{ color: colors.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}

      {/* Identity reuse first — it is a fact rather than a judgement, and it is
          the one finding that should stop an admin approving on autopilot. */}
      {duplicates.length > 0 && (
        <div style={{ background: '#fff5f5', border: `1px solid ${colors.danger}`, borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: colors.danger, marginBottom: 4 }}>
            ALREADY ON THE PLATFORM
          </div>
          {duplicates.map((dup, i) => (
            <div key={i} style={{ fontSize: 13, color: colors.danger }}>
              {dup.field} <code>{dup.value}</code> → driver{' '}
              <code>{dup.driverId}</code> ({dup.status}){dup.banned ? ' — BANNED ACCOUNT' : ''}
            </div>
          ))}
        </div>
      )}

      {reasons.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {reasons.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 10, alignItems: 'baseline',
                background: colors.bg, borderRadius: 8, padding: '8px 12px',
                borderLeft: `3px solid ${
                  r.severity === 'fatal' ? colors.danger : r.severity === 'major' ? '#f59e0b' : colors.border
                }`,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 800, color: colors.muted, minWidth: 48, textTransform: 'uppercase' }}>
                {r.severity}
              </span>
              <span style={{ fontSize: 13, color: colors.text, flex: 1 }}>{r.detail}</span>
              <code style={{ fontSize: 10, color: colors.muted }}>{r.code}</code>
            </div>
          ))}
        </div>
      ) : status === 'approved' ? (
        <div style={{ fontSize: 13, color: colors.muted }}>Nothing was found wrong with this application.</div>
      ) : null}

      {report?.summary && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, color: colors.muted, cursor: 'pointer' }}>
            What the model actually read
          </summary>
          <div style={{ fontSize: 13, color: colors.text, marginTop: 8, lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}>{report.summary}</div>
            {report.crossChecks && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {Object.entries(report.crossChecks).map(([k, v]) => (
                  <Badge
                    key={k}
                    label={`${k.replace(/Consistency$/, '')}: ${v}`}
                    color={v === 'match' ? colors.primary : v === 'mismatch' ? colors.danger : colors.muted}
                  />
                ))}
              </div>
            )}
            {(report.documents ?? []).map((doc, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.muted, paddingLeft: 8 }}>
                <strong style={{ color: colors.text }}>{doc.kind}</strong> — reads as {doc.looksLike},{' '}
                {doc.legible ? 'legible' : 'not legible'}, tampering: {doc.tampering}
                {doc.notes ? ` — ${doc.notes}` : ''}
              </div>
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}

function DocImage({ label, url, expiry }: { label: string; url?: string; expiry?: string }) {
  const status = expiryStatus(expiry);
  const expiryColor = status === 'expired' ? colors.danger : status === 'soon' ? '#f59e0b' : colors.primary;
  return (
    <div style={{ background: colors.bg, borderRadius: 10, overflow: 'hidden', border: `1px solid ${status && status !== 'ok' ? expiryColor : colors.border}` }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
        </a>
      ) : (
        <div style={{ height: 120, display: 'grid', placeItems: 'center', color: colors.muted, fontSize: 12 }}>Not uploaded</div>
      )}
      <div style={{ padding: '6px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted }}>{label}</div>
        {expiry && (
          <div style={{ fontSize: 10, fontWeight: 700, color: expiryColor, marginTop: 2 }}>
            {status === 'expired' ? '⚠️ EXPIRED ' : status === 'soon' ? '⚡ Expiring ' : ''}
            {new Date(expiry).toLocaleDateString('en-PK')}
          </div>
        )}
      </div>
    </div>
  );
}

function DocExpiryAlerts({
  licenseExpiry, cnicExpiry, vehicleDocExpiry,
}: { licenseExpiry?: string; cnicExpiry?: string; vehicleDocExpiry?: string }) {
  const checks = [
    { label: 'Driving licence', expiry: licenseExpiry },
    { label: 'CNIC',            expiry: cnicExpiry },
    { label: 'Vehicle reg.',    expiry: vehicleDocExpiry },
  ].filter(c => {
    const s = expiryStatus(c.expiry);
    return s === 'expired' || s === 'soon';
  });
  if (checks.length === 0) return null;
  return (
    <div style={{ backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>⚠️ Document expiry alerts</div>
      {checks.map(c => (
        <div key={c.label} style={{ fontSize: 12, color: colors.text, marginBottom: 2 }}>
          • <strong>{c.label}</strong>{' '}
          {expiryStatus(c.expiry) === 'expired' ? 'EXPIRED' : 'expires soon'}{' '}
          — {c.expiry ? new Date(c.expiry).toLocaleDateString('en-PK') : ''}
        </div>
      ))}
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
