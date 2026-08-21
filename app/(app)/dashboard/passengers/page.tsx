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
  role?: string;
  banned?: boolean;
  createdAt?: { seconds: number };
}

const GENDERS = ['male', 'female', 'other', 'unspecified'] as const;
const ROLES   = ['passenger', 'driver', 'admin'] as const;

// ── Shared modal shell ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#00000099', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <Card style={{ maxWidth: 480, width: '92%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: colors.muted, lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </Card>
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 13px', borderRadius: 10, border: `1px solid ${colors.border}`,
  backgroundColor: colors.bg, color: colors.text, fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
      <span style={{ color: colors.muted, minWidth: 72, fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, color: colors.text }}>{value || '—'}</span>
    </div>
  );
}

// ── Create Modal ──────────────────────────────────────────────────────────────
function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [gender, setGender]     = useState('unspecified');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  async function submit() {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!email.trim() && !phone.trim()) { setError('Provide email or phone.'); return; }
    setBusy(true); setError('');
    try {
      await adminApi.adminCreatePassenger({
        displayName: name.trim(),
        email:    email.trim()  || undefined,
        phone:    phone.trim()  || undefined,
        gender:   gender        || undefined,
        password: password.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create passenger.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add passenger" onClose={onClose}>
      <Field label="Full name *">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ali Hassan" style={inputStyle} />
      </Field>
      <Field label="Email">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="ali@example.com" type="email" style={inputStyle} />
      </Field>
      <Field label="Phone (with country code)">
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+923001234567" style={inputStyle} />
      </Field>
      <Field label="Gender">
        <select value={gender} onChange={e => setGender(e.target.value)} style={selectStyle}>
          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </Field>
      <Field label="Password (optional)">
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to skip" type="password" style={inputStyle} />
      </Field>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create passenger'}</Button>
      </div>
    </Modal>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ passenger, onClose }: { passenger: PassengerRow; onClose: () => void }) {
  const [name, setName]     = useState(passenger.displayName ?? '');
  const [email, setEmail]   = useState(passenger.email ?? '');
  const [gender, setGender] = useState(passenger.gender ?? 'unspecified');
  const [role, setRole]     = useState((passenger.role as typeof ROLES[number]) ?? 'passenger');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  async function submit() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      await adminApi.adminUpdatePassenger({
        passengerId: passenger.id,
        displayName: name.trim()  || undefined,
        email:       email.trim() || undefined,
        gender:      gender       || undefined,
        role:        role         || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update passenger.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit passenger" onClose={onClose}>
      <p style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>UID: {passenger.id}</p>
      <Field label="Full name">
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Email">
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={inputStyle} />
      </Field>
      <Field label="Gender">
        <select value={gender} onChange={e => setGender(e.target.value)} style={selectStyle}>
          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </Field>
      <Field label="Role">
        <select value={role} onChange={e => setRole(e.target.value as typeof ROLES[number])} style={selectStyle}>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </Modal>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────
function ViewModal({ passenger, onEdit, onDelete, onBan, busy, onClose }: {
  passenger: PassengerRow;
  onEdit: () => void;
  onDelete: () => void;
  onBan: () => void;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={passenger.displayName || 'Passenger'} onClose={onClose}>
      <DetailRow label="UID"    value={passenger.id} />
      <DetailRow label="Email"  value={passenger.email} />
      <DetailRow label="Phone"  value={passenger.phoneNumber} />
      <DetailRow label="Gender" value={passenger.gender} />
      <DetailRow label="Role"   value={passenger.role} />
      <DetailRow label="Status" value={passenger.banned ? '🚫 Banned' : '✅ Active'} />
      <DetailRow label="Joined" value={passenger.createdAt ? new Date(passenger.createdAt.seconds * 1000).toLocaleDateString('en-PK') : undefined} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
        <Button variant="secondary" onClick={onEdit}>✏️ Edit</Button>
        <Button variant={passenger.banned ? 'secondary' : 'ghost'} onClick={onBan} disabled={busy}>
          {busy ? '…' : passenger.banned ? 'Unban' : '🚫 Ban'}
        </Button>
        <Button variant="danger" onClick={onDelete}>🗑️ Delete</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

// ── Delete confirm Modal ───────────────────────────────────────────────────────
function DeleteModal({ passenger, onClose }: { passenger: PassengerRow; onClose: () => void }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true); setError('');
    try {
      await adminApi.adminDeletePassenger({ passengerId: passenger.id });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete passenger?" onClose={onClose}>
      <p style={{ color: colors.text, fontSize: 14, marginBottom: 6 }}>
        You are about to permanently delete:
      </p>
      <p style={{ color: colors.danger, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
        {passenger.displayName || passenger.email || passenger.phoneNumber || passenger.id}
      </p>
      <p style={{ color: colors.muted, fontSize: 13, marginBottom: 18 }}>
        This removes their Firebase Auth account and all Firestore data. This cannot be undone.
      </p>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete permanently'}</Button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type ModalState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'view';   passenger: PassengerRow }
  | { type: 'edit';   passenger: PassengerRow }
  | { type: 'delete'; passenger: PassengerRow };

export default function PassengersPage() {
  const [rows, setRows]       = useState<PassengerRow[]>([]);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<'all' | 'banned'>('all');
  const [busy, setBusy]       = useState<string | null>(null);
  const [modal, setModal]     = useState<ModalState>({ type: 'none' });

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap =>
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PassengerRow))
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

  const passengers = rows.filter(r => r.role === 'passenger' || !r.role).length;
  const banned     = rows.filter(r => r.banned).length;

  async function toggleBan(p: PassengerRow) {
    setBusy(p.id);
    try {
      await adminApi.banPassenger({ passengerId: p.id, banned: !p.banned });
      // If view modal was open, close it so list refreshes cleanly
      if (modal.type === 'view') setModal({ type: 'none' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, margin: 0 }}>Passenger Management</h1>
        <Button variant="primary" onClick={() => setModal({ type: 'create' })}>+ Add passenger</Button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total users',  value: rows.length },
          { label: 'Passengers',   value: passengers },
          { label: 'Banned',       value: banned },
        ].map(s => (
          <div key={s.label} style={{
            backgroundColor: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 12, padding: '12px 20px', minWidth: 110,
          }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: colors.primary }}>{s.value}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

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
                <th style={th}>Role</th>
                <th style={th}>Joined</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: colors.muted }}>
                    No passengers found.
                  </td>
                </tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}>
                    <button
                      onClick={() => setModal({ type: 'view', passenger: p })}
                      style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontWeight: 700, padding: 0, fontSize: 13 }}
                    >
                      {p.displayName || '—'}
                    </button>
                  </td>
                  <td style={td}>{p.email || '—'}</td>
                  <td style={td}>{p.phoneNumber || '—'}</td>
                  <td style={td}>{p.gender || '—'}</td>
                  <td style={td}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      backgroundColor: p.role === 'admin' ? `${colors.secondary}22` : `${colors.primary}22`,
                      color: p.role === 'admin' ? colors.secondary : colors.primary,
                    }}>
                      {p.role || 'passenger'}
                    </span>
                  </td>
                  <td style={td}>{p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('en-PK') : '—'}</td>
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
                    <div style={{ display: 'flex', gap: 5 }}>
                      <Button variant="ghost" onClick={() => setModal({ type: 'edit', passenger: p })}>✏️</Button>
                      <Button variant={p.banned ? 'secondary' : 'ghost'} disabled={busy === p.id} onClick={() => toggleBan(p)}>
                        {busy === p.id ? '…' : p.banned ? 'Unban' : '🚫'}
                      </Button>
                      <Button variant="danger" onClick={() => setModal({ type: 'delete', passenger: p })}>🗑️</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modals */}
      {modal.type === 'create' && (
        <CreateModal onClose={() => setModal({ type: 'none' })} />
      )}
      {modal.type === 'view' && (
        <ViewModal
          passenger={modal.passenger}
          busy={busy === modal.passenger.id}
          onEdit={() => setModal({ type: 'edit', passenger: modal.passenger })}
          onDelete={() => setModal({ type: 'delete', passenger: modal.passenger })}
          onBan={() => toggleBan(modal.passenger)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'edit' && (
        <EditModal passenger={modal.passenger} onClose={() => setModal({ type: 'none' })} />
      )}
      {modal.type === 'delete' && (
        <DeleteModal passenger={modal.passenger} onClose={() => setModal({ type: 'none' })} />
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12 };
const td: React.CSSProperties = { padding: '11px 12px', verticalAlign: 'middle' };
