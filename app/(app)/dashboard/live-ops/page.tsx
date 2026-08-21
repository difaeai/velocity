'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Card } from '@/components/ui';

interface DriverPin {
  id: string;
  fullName?: string;
  lastLocation?: { lat: number; lng: number };
  online?: boolean;
  verificationStatus?: string;
  plate?: string;
  vehicleLabel?: string;
}

interface ActiveTrip {
  id: string;
  status: string;
  offeredFare?: number;
  fare?: number;
  passengerGender?: string;
  pickup?: { lat?: number; lng?: number; address?: string };
  dropoff?: { lat?: number; lng?: number; address?: string };
  driverInfo?: { displayName?: string; plate?: string };
}

// Pakistan bounding box
const BOUNDS = { minLat: 23.5, maxLat: 37.5, minLng: 60.5, maxLng: 77.5 };

function latToY(lat: number, h: number) {
  return ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * h;
}
function lngToX(lng: number, w: number) {
  return ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * w;
}

export default function LiveOpsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drivers, setDrivers]   = useState<DriverPin[]>([]);
  const [trips, setTrips]       = useState<ActiveTrip[]>([]);
  const [tooltip, setTooltip]   = useState<{ x: number; y: number; text: string } | null>(null);
  const [stats, setStats]       = useState({ online: 0, active: 0, idle: 0 });

  useEffect(() => {
    const dQ = query(collection(db, 'drivers'), where('verificationStatus', '==', 'approved'));
    const tripQ = query(collection(db, 'trips'), where('status', 'in', ['matched', 'arriving', 'arrived', 'in_progress']));

    const unsubD = onSnapshot(dQ, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DriverPin);
      setDrivers(rows);
      setStats({
        online: rows.filter(r => r.online).length,
        active: 0,
        idle: rows.filter(r => r.online).length,
      });
    });
    const unsubT = onSnapshot(tripQ, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ActiveTrip);
      setTrips(rows);
      setStats(s => ({ ...s, active: rows.length, idle: Math.max(0, s.online - rows.length) }));
    });

    return () => { unsubD(); unsubT(); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Dark map background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = '#1e2030';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * W;
      const y = (i / 10) * H;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Active trip lines
    trips.forEach(t => {
      if (!t.pickup?.lat || !t.dropoff?.lat) return;
      const x1 = lngToX(t.pickup.lng ?? 0, W);
      const y1 = latToY(t.pickup.lat, H);
      const x2 = lngToX(t.dropoff.lng ?? 0, W);
      const y2 = latToY(t.dropoff.lat, H);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `${colors.primary}60`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Driver pins
    drivers.forEach(d => {
      if (!d.lastLocation) return;
      const x = lngToX(d.lastLocation.lng, W);
      const y = latToY(d.lastLocation.lat, H);

      // Glow
      if (d.online) {
        const grad = ctx.createRadialGradient(x, y, 2, x, y, 14);
        grad.addColorStop(0, `${colors.primary}55`);
        grad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Dot
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = d.online ? colors.primary : '#444';
      ctx.fill();
    });
  }, [drivers, trips]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = canvas.width;
    const H = canvas.height;

    const hit = drivers.find(d => {
      if (!d.lastLocation) return false;
      const x = lngToX(d.lastLocation.lng, W);
      const y = latToY(d.lastLocation.lat, H);
      return Math.hypot(x - mx, y - my) < 10;
    });

    if (hit) {
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        text: `${hit.fullName ?? 'Driver'} · ${hit.plate ?? '—'} · ${hit.online ? 'Online' : 'Offline'}`,
      });
    } else {
      setTooltip(null);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, marginBottom: 8 }}>
        Live Ops Map
      </h1>
      <p style={{ color: colors.muted, marginBottom: 20, fontSize: 13 }}>
        Real-time driver locations across Pakistan. Updates every 30 seconds as drivers move.
      </p>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <StatChip label="Online drivers" value={stats.online} color={colors.primary} />
        <StatChip label="Active trips"   value={stats.active} color="#f59e0b" />
        <StatChip label="Idle drivers"   value={stats.idle}   color={colors.muted} />
        <StatChip label="Total approved" value={drivers.length} color={colors.text} />
      </div>

      {/* Map canvas */}
      <Card style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={900}
          height={500}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip && (
          <div style={{
            position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 12,
            backgroundColor: '#1e2030', borderRadius: 8, padding: '6px 10px',
            fontSize: 12, fontWeight: 700, color: colors.text, pointerEvents: 'none',
            border: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
          }}>
            {tooltip.text}
          </div>
        )}
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Legend color={colors.primary} label="Online driver" />
          <Legend color="#444" label="Offline driver" />
          <Legend color={`${colors.primary}60`} label="Active trip route" />
        </div>
      </Card>

      {/* Active trips table */}
      <h2 style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginTop: 24, marginBottom: 12 }}>
        Active trips ({trips.length})
      </h2>
      <Card>
        {trips.length === 0 ? (
          <p style={{ color: colors.muted, padding: 16 }}>No active trips right now.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>
                <th style={th}>Trip ID</th>
                <th style={th}>Status</th>
                <th style={th}>Driver</th>
                <th style={th}>Fare</th>
                <th style={th}>Pickup</th>
                <th style={th}>Dropoff</th>
              </tr>
            </thead>
            <tbody>
              {trips.map(t => (
                <tr key={t.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={td}><code style={{ fontSize: 11 }}>{t.id.slice(0, 12)}…</code></td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, backgroundColor: `${colors.primary}20`, color: colors.primary }}>
                      {t.status}
                    </span>
                  </td>
                  <td style={td}>{t.driverInfo?.displayName ?? '—'}</td>
                  <td style={td}>{t.fare ?? t.offeredFare ?? '—'} PKR</td>
                  <td style={td}>{t.pickup?.address?.slice(0, 30) ?? '—'}</td>
                  <td style={td}>{t.dropoff?.address?.slice(0, 30) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, border: `1px solid ${colors.border}`, padding: '12px 16px', minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#00000066', borderRadius: 6, padding: '3px 8px' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
      <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12 };
const td: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };
