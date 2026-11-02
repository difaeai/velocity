'use client';

/**
 * Commute demand that came in over WhatsApp: everyone who scanned the QR and
 * told the bot (backend/functions/src/whatsapp/leads.ts) where they start,
 * where they work and when. One row per WhatsApp number.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Badge, Button, Card, StatCard } from '@/components/ui';

interface Pin {
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
}

interface Lead {
  id: string;
  phone: string;
  name?: string;
  step: 'pickup' | 'dropoff' | 'timings' | 'done';
  pickup?: Pin | null;
  dropoff?: Pin | null;
  timings?: string | null;
  extraMessages?: { text: string; at: string }[];
  updatedAt?: Timestamp;
}

const STEP_LABEL: Record<Lead['step'], string> = {
  pickup: 'Waiting for pickup pin',
  dropoff: 'Waiting for office pin',
  timings: 'Waiting for timings',
  done: 'Complete',
};

const mapsUrl = (p: Pin) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
const pinLabel = (p: Pin) => p.name || p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
const when = (t?: Timestamp) => (t ? t.toDate().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function downloadCsv(rows: Lead[], joined: Set<string>) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Name', 'WhatsApp', 'Status', 'Pickup', 'Pickup lat', 'Pickup lng', 'Office', 'Office lat', 'Office lng', 'Timings', 'Joined app', 'Updated'],
    ...rows.map((r) => [
      r.name, r.phone, STEP_LABEL[r.step],
      r.pickup ? pinLabel(r.pickup) : '', r.pickup?.lat, r.pickup?.lng,
      r.dropoff ? pinLabel(r.dropoff) : '', r.dropoff?.lat, r.dropoff?.lng,
      r.timings, joined.has(r.phone) ? 'Yes' : 'No', when(r.updatedAt),
    ]),
  ];
  const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'whatsapp-commute-demand.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

function PinCell({ pin }: { pin?: Pin | null }) {
  if (!pin) return <span style={{ color: colors.muted }}>—</span>;
  return (
    <a href={mapsUrl(pin)} target="_blank" rel="noreferrer" style={{ color: colors.secondary, fontWeight: 700 }}>
      📍 {pinLabel(pin)}
    </a>
  );
}

export default function WhatsAppLeads() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        // shortcut: newest 500 only, add paging when demand outgrows one screen.
        query(collection(db, 'whatsappLeads'), orderBy('updatedAt', 'desc'), limit(500)),
        (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lead, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  );

  // Who has since signed up with the same number: the QR's real conversion.
  const phonesKey = rows.map((r) => r.phone).join(',');
  useEffect(() => {
    const phones = phonesKey ? phonesKey.split(',') : [];
    const chunks = Array.from({ length: Math.ceil(phones.length / 30) }, (_, i) => phones.slice(i * 30, i * 30 + 30));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, 'users'), where('phoneNumber', 'in', c)))))
      .then((snaps) => setJoined(new Set(snaps.flatMap((s) => s.docs.map((d) => d.get('phoneNumber') as string)))))
      .catch((e: Error) => setError(e.message));
  }, [phonesKey]);

  const done = useMemo(() => rows.filter((r) => r.step === 'done').length, [rows]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>WhatsApp demand</h1>
      <p style={{ color: colors.muted, marginBottom: 20 }}>
        People who scanned the WhatsApp QR and shared their pickup, office and timings.
      </p>
      {error ? <p style={{ color: colors.danger, marginBottom: 16 }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard label="Chats" value={String(rows.length)} />
        <StatCard label="Complete" value={String(done)} />
        <StatCard label="Left halfway" value={String(rows.length - done)} />
        <StatCard label="Joined the app" value={String(rows.filter((r) => joined.has(r.phone)).length)} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <img src="/brand/whatsapp-qr.png" alt="WhatsApp QR code" width={96} height={96} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>The QR code</strong>
            <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
              Opens WhatsApp to +92 316 5004012 with &ldquo;Hi Velocity&rdquo; typed in.
            </div>
          </div>
          <a href="/brand/whatsapp-qr.png" download style={{ color: colors.secondary, fontWeight: 700 }}>PNG</a>
          <a href="/brand/whatsapp-qr.svg" download style={{ color: colors.secondary, fontWeight: 700 }}>SVG (print)</a>
          <Button disabled={rows.length === 0} onClick={() => downloadCsv(rows, joined)}>Download CSV</Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <span style={{ color: colors.muted }}>No WhatsApp chats yet.</span>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted }}>
                {['Person', 'Pickup', 'Office', 'Timings', 'Status', 'Updated'].map((h) => (
                  <th key={h} style={{ padding: '8px 6px', borderBottom: `1px solid ${colors.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 700 }}>{r.name || '—'}</div>
                    <a href={`https://wa.me/${r.id}`} target="_blank" rel="noreferrer" style={{ color: colors.muted }}>
                      {r.phone}
                    </a>
                    {joined.has(r.phone) ? <div style={{ marginTop: 4 }}><Badge label="Joined app" color={colors.success} /></div> : null}
                  </td>
                  <td style={{ padding: '8px 6px' }}><PinCell pin={r.pickup} /></td>
                  <td style={{ padding: '8px 6px' }}><PinCell pin={r.dropoff} /></td>
                  <td style={{ padding: '8px 6px' }}>
                    {r.timings || <span style={{ color: colors.muted }}>—</span>}
                    {r.extraMessages?.length ? (
                      <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                        Also said: &ldquo;{r.extraMessages[r.extraMessages.length - 1]?.text}&rdquo;
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <Badge label={STEP_LABEL[r.step]} color={r.step === 'done' ? colors.success : colors.warn} />
                  </td>
                  <td style={{ padding: '8px 6px', color: colors.muted, whiteSpace: 'nowrap' }}>{when(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
