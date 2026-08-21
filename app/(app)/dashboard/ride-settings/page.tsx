'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

interface FareConfig {
  baseFare: number;
  perKm:    number;
  perMin:   number;
  minFare:  number;
}

type Category = 'bike' | 'auto' | 'mini' | 'ac' | 'comfort';

const CATEGORIES: { key: Category; label: string; icon: string; desc: string }[] = [
  { key: 'bike',    label: 'Moto',     icon: '🏍️', desc: 'Motorbike · 1 passenger' },
  { key: 'auto',    label: 'Rickshaw', icon: '🛺', desc: 'Auto rickshaw' },
  { key: 'mini',    label: 'Mini',     icon: '🚙', desc: 'Hatchback · No AC' },
  { key: 'ac',      label: 'AC',       icon: '❄️', desc: 'Air conditioned' },
  { key: 'comfort', label: 'Comfort',  icon: '🚘', desc: 'Premium sedan' },
];

const DEFAULT_FARE: FareConfig = { baseFare: 100, perKm: 30, perMin: 2, minFare: 80 };

type Fares = Record<Category, FareConfig>;

// ── Fare-engine bridge ────────────────────────────────────────────────────────
// The booking screen and the getFareEstimate/submitBid Cloud Functions price
// trips from fareConfig/{cityId} (the fare engine), NOT from config/rideFares.
// Saving here must therefore also update the engine docs, otherwise these
// numbers would only affect the home-screen teaser price.
//
// UI category → engine category (mirrors RIDE_TO_CAT in the mobile app).
const CAT_TO_ENGINE: Record<Category, 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury'> = {
  bike: 'moto',
  auto: 'rickshaw',
  mini: 'mini',
  ac: 'ac_car',
  comfort: 'luxury',
};

// Full default engine config, used to seed fareConfig/{cityId} when the doc
// doesn't exist yet (calculateFare requires every field to be present).
// Mirrors DEFAULT_ISLAMABAD_RAWALPINDI in backend/functions/src/fare/fareEngine.ts.
const ENGINE_DEFAULTS = {
  currency: 'PKR',
  categories: {
    moto:     { base: 60,  includedKm: 1.5, includedMin: 4, perKm: 14, perMin: 3,  minFare: 100, bidFloorPerKm: 12, freeWaitMin: 5, waitPerMin: 3  },
    rickshaw: { base: 80,  includedKm: 1.5, includedMin: 4, perKm: 16, perMin: 4,  minFare: 130, bidFloorPerKm: 14, freeWaitMin: 5, waitPerMin: 4  },
    mini:     { base: 120, includedKm: 1.5, includedMin: 5, perKm: 26, perMin: 6,  minFare: 200, bidFloorPerKm: 22, freeWaitMin: 5, waitPerMin: 6  },
    ac_car:   { base: 160, includedKm: 1.5, includedMin: 5, perKm: 34, perMin: 8,  minFare: 280, bidFloorPerKm: 30, freeWaitMin: 5, waitPerMin: 8  },
    luxury:   { base: 300, includedKm: 1.5, includedMin: 5, perKm: 60, perMin: 12, minFare: 600, bidFloorPerKm: 55, freeWaitMin: 8, waitPerMin: 12 },
  },
  surge: { enabled: true, maxMultiplier: 1.8 },
  pooling: {
    enabled: true,
    perRiderFactor: { 2: 0.65, 3: 0.5, 4: 0.42 },
    maxDetourMin: 8,
    detourDiscountPerMin: 0.02,
  },
  commission: { rate: 0.07, flatFee: 0 },
};

const ENGINE_CITY_IDS = ['islamabad_rawalpindi', 'karachi'];

/** Map the dashboard rates into engine CategoryRates patches. */
function engineCategoryPatch(fares: Fares) {
  const patch: Record<string, Record<string, number>> = {};
  for (const cat of Object.keys(fares) as Category[]) {
    const f = fares[cat];
    patch[CAT_TO_ENGINE[cat]] = {
      base:    f.baseFare,
      perKm:   f.perKm,
      perMin:  f.perMin,
      minFare: f.minFare,
      // Keep the driver-protection bid floor consistent with the new rate so
      // minimum acceptable bids never exceed the recommended fare.
      bidFloorPerKm: Math.max(1, Math.round(f.perKm * 0.85)),
    };
  }
  return patch;
}

export default function RideSettingsPage() {
  const [fares, setFares]           = useState<Fares>({
    bike:    { ...DEFAULT_FARE, baseFare: 50,  perKm: 15, perMin: 1, minFare: 50  },
    auto:    { ...DEFAULT_FARE, baseFare: 60,  perKm: 18, perMin: 2, minFare: 70  },
    mini:    { ...DEFAULT_FARE, baseFare: 80,  perKm: 25, minFare: 60  },
    ac:      { ...DEFAULT_FARE, baseFare: 120, perKm: 35, minFare: 100 },
    comfort: { ...DEFAULT_FARE, baseFare: 160, perKm: 50, minFare: 140 },
  });
  const [searchRadiusKm, setSearchRadiusKm] = useState(2);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'config', 'rideFares')),
      getDoc(doc(db, 'config', 'rideSettings')),
    ]).then(([faresSnap, settingsSnap]) => {
      if (faresSnap.exists()) {
        const d = faresSnap.data() as Partial<Fares>;
        setFares((prev) => ({
          bike:    { ...prev.bike,    ...(d.bike    ?? {}) },
          auto:    { ...prev.auto,    ...(d.auto    ?? {}) },
          mini:    { ...prev.mini,    ...(d.mini    ?? {}) },
          ac:      { ...prev.ac,      ...(d.ac      ?? {}) },
          comfort: { ...prev.comfort, ...(d.comfort ?? {}) },
        }));
      }
      if (settingsSnap.exists()) {
        setSearchRadiusKm(settingsSnap.get('searchRadiusKm') ?? 2);
      }
    })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function setField(cat: Category, field: keyof FareConfig, raw: string) {
    const val = Number(raw);
    if (isNaN(val)) return;
    setFares((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }));
    setSaved(false);
    setError(null);
  }

  async function save() {
    for (const cat of CATEGORIES) {
      const f = fares[cat.key];
      if (f.perKm <= 0)    { setError(`${cat.label}: per-km rate must be > 0.`); return; }
      if (f.baseFare < 0)  { setError(`${cat.label}: base fare can't be negative.`); return; }
      if (f.minFare < 0)   { setError(`${cat.label}: minimum fare can't be negative.`); return; }
    }
    if (searchRadiusKm <= 0 || searchRadiusKm > 50) {
      setError('Search radius must be between 0.1 and 50 km.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Seed any missing fare-engine docs with full defaults first, then merge
      // the dashboard rates into every city so booking estimates, bid floors
      // and the server-side fare functions all follow these numbers.
      const patch = engineCategoryPatch(fares);
      const engineWrites = ENGINE_CITY_IDS.map(async (cityId) => {
        const ref  = doc(db, 'fareConfig', cityId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, { cityId, ...ENGINE_DEFAULTS, updatedAt: Date.now() });
        }
        await setDoc(ref, { categories: patch, updatedAt: Date.now() }, { merge: true });
      });

      await Promise.all([
        setDoc(doc(db, 'config', 'rideFares'), fares, { merge: true }),
        setDoc(doc(db, 'config', 'rideSettings'), { searchRadiusKm }, { merge: true }),
        ...engineWrites,
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ color: colors.muted, padding: 20 }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Ride settings</h1>
      <p style={{ color: colors.muted, marginBottom: 24 }}>
        Set per-kilometre rates and base fares for each vehicle category. These prices are used
        by the app to calculate fares and display estimates to passengers.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {saved && <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ Settings saved</div>}

      {/* Driver notification radius */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 24 }}>📡</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>Driver search radius</div>
            <div style={{ fontSize: 12, color: colors.muted }}>
              Notify all online drivers within this distance when a passenger requests a ride
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 800,
              color: colors.primary,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 3,
            }}>
              Radius (km)
            </label>
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={searchRadiusKm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!isNaN(v)) { setSearchRadiusKm(v); setSaved(false); }
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: `2px solid ${colors.primary}`,
                background: `${colors.primary}08`,
                color: colors.text,
                fontSize: 24,
                fontWeight: 900,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>
              Default 2 km — increase for rural areas, decrease for dense cities
            </div>
          </div>
          <div style={{
            padding: '12px 20px',
            background: colors.surface,
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
            textAlign: 'center',
            minWidth: 120,
          }}>
            <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>Coverage area</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: colors.primary }}>
              ~{(Math.PI * searchRadiusKm ** 2).toFixed(1)} km²
            </div>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
        {CATEGORIES.map(({ key, label, icon, desc }) => {
          const f = fares[key];
          const exampleFare = Math.max(f.minFare, f.baseFare + f.perKm * 5 + f.perMin * 10);
          return (
            <Card key={key}>
              {/* Category header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 24 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>{label}</div>
                  <div style={{ fontSize: 12, color: colors.muted }}>{desc}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>Example · 5 km / 10 min</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: colors.primary }}>
                    {exampleFare.toLocaleString()} PKR
                  </div>
                </div>
              </div>

              {/* Fare fields */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <FareField
                  label="Base fare (PKR)"
                  hint="Charged at trip start"
                  value={f.baseFare}
                  onChange={(v) => setField(key, 'baseFare', v)}
                />
                <FareField
                  label="Per km (PKR)"
                  hint="Rate per kilometre"
                  value={f.perKm}
                  onChange={(v) => setField(key, 'perKm', v)}
                  highlight
                />
                <FareField
                  label="Per minute (PKR)"
                  hint="Rate per minute in ride"
                  value={f.perMin}
                  onChange={(v) => setField(key, 'perMin', v)}
                />
                <FareField
                  label="Minimum fare (PKR)"
                  hint="Lowest possible fare"
                  value={f.minFare}
                  onChange={(v) => setField(key, 'minFare', v)}
                />
              </div>

              {/* Formula preview */}
              <div style={{
                marginTop: 12,
                padding: '8px 12px',
                background: colors.bg,
                borderRadius: 8,
                fontSize: 12,
                color: colors.muted,
              }}>
                Formula: max({f.minFare} PKR, {f.baseFare} + {f.perKm}×km + {f.perMin}×min)
              </div>
            </Card>
          );
        })}
      </div>

      <Button onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save all fares'}
      </Button>
    </div>
  );
}

function FareField({
  label, hint, value, onChange, highlight = false,
}: {
  label: string; hint: string; value: number; onChange: (v: string) => void; highlight?: boolean;
}) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 800,
        color: highlight ? colors.primary : colors.muted,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.4,
        marginBottom: 3,
      }}>
        {label}
      </label>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 10,
          border: `${highlight ? 2 : 1}px solid ${highlight ? colors.primary : colors.border}`,
          background: highlight ? `${colors.primary}08` : colors.bg,
          color: colors.text,
          fontSize: 18,
          fontWeight: 900,
          boxSizing: 'border-box' as const,
        }}
      />
      <div style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{hint}</div>
    </div>
  );
}
