'use client';

/**
 * Ride pooling — the geography and the economics of putting riders together.
 *
 * Everything here writes to `config/poolingSettings`, which the backend reads
 * on every search and every join (domain/poolingSettings.ts). A change saved
 * here is live for the next booking: no deploy, no release. That is the point
 * of the page — the 5 km radius is a number to tune against what the ledger
 * below says, not a constant to ship.
 *
 * ── SHADOW MODE COMES FIRST ─────────────────────────────────────────────────
 *
 * In SHADOW the engine measures every combination against these limits, records
 * what it would have done, and seats the rider either way. Nothing a rider or
 * driver sees changes. In LIVE it acts on the verdict and turns joins down.
 *
 * So the order of work is: leave it in shadow, read "would have refused" below
 * until the numbers look right, and only then switch to live. Switching to live
 * with a bad limit refuses real riders a real car.
 *
 * ── TWO RADII, AND THEY ARE NOT THE SAME NUMBER ─────────────────────────────
 *
 * The candidate radius only decides what is WORTH SHOWING someone. The match
 * radius decides who may be SEATED. Widening the first shows more cars;
 * widening the second puts people in them. They were one hardcoded kilometre
 * before this page existed, which is why the spec's own example (PWD → F-10
 * with PWD → G-10) was refused: G-10 lies 1,276 m off that route, so it missed
 * by 276 metres — while the detour, once seated, is 0.47 km.
 *
 * Every range below is the range the backend clamps to. A value outside it does
 * not do what this page would say: the backend would silently fall back to its
 * default. The ranges are duplicated rather than imported because this is a
 * client component and that file pulls in firebase-admin.
 */

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card, glass } from '@/components/ui';
import { SkeletonRows } from '@/components/states';

type Mode = 'shadow' | 'live';

interface Settings {
  mode: Mode;
  candidateRadiusM: number;
  matchRadiusM: number;
  maxDetourKm: number;
  maxDetourMin: number;
  minRiderSavingPct: number;
  minDriverGainPkr: number;
  matchWindowMin: number;
  bookingCutoffMin: number;
  maxRiders: number;
}

/** Mirrors DEFAULT_POOLING in backend/functions/src/domain/poolingSettings.ts. */
const DEFAULTS: Settings = {
  mode: 'shadow',
  candidateRadiusM: 5000,
  matchRadiusM: 1000,
  maxDetourKm: 5,
  maxDetourMin: 15,
  minRiderSavingPct: 0.1,
  minDriverGainPkr: 0,
  matchWindowMin: 10,
  bookingCutoffMin: 0,
  maxRiders: 4,
};

/** label → [min, max], the backend's clamp. */
const RANGES: Record<string, [number, number]> = {
  candidateRadiusM: [500, 25_000],
  matchRadiusM: [200, 10_000],
  maxDetourKm: [0.5, 50],
  maxDetourMin: [1, 180],
  minRiderSavingPct: [0, 90],
  minDriverGainPkr: [0, 10_000],
  matchWindowMin: [0, 240],
  bookingCutoffMin: [0, 240],
  maxRiders: [2, 4],
};

interface Totals {
  evaluated: number;
  passed: number;
  refused: number;
  wouldRefuse: number;
  ridersSum: number;
  savingPctSum: number;
  savingPkrSum: number;
  driverGainSum: number;
  detourKmSum: number;
  detourMinSum: number;
  roadMeasured: number;
}

const ZERO: Totals = {
  evaluated: 0, passed: 0, refused: 0, wouldRefuse: 0, ridersSum: 0,
  savingPctSum: 0, savingPkrSum: 0, driverGainSum: 0, detourKmSum: 0, detourMinSum: 0,
  roadMeasured: 0,
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export default function PoolingPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'config', 'poolingSettings')),
      getDoc(doc(db, 'analytics', 'pooling')),
    ])
      .then(([cfg, an]) => {
        const d = cfg.data() ?? {};
        setS({
          mode: d.mode === 'live' ? 'live' : 'shadow',
          candidateRadiusM: num(d.candidateRadiusM, DEFAULTS.candidateRadiusM),
          matchRadiusM: num(d.matchRadiusM, DEFAULTS.matchRadiusM),
          maxDetourKm: num(d.maxDetourKm, DEFAULTS.maxDetourKm),
          maxDetourMin: num(d.maxDetourMin, DEFAULTS.maxDetourMin),
          minRiderSavingPct: num(d.minRiderSavingPct, DEFAULTS.minRiderSavingPct),
          minDriverGainPkr: num(d.minDriverGainPkr, DEFAULTS.minDriverGainPkr),
          matchWindowMin: num(d.matchWindowMin, DEFAULTS.matchWindowMin),
          bookingCutoffMin: num(d.bookingCutoffMin, DEFAULTS.bookingCutoffMin),
          maxRiders: num(d.maxRiders, DEFAULTS.maxRiders),
        });
        const a = an.data() ?? {};
        setTotals({ ...ZERO, ...Object.fromEntries(Object.keys(ZERO).map((k) => [k, num(a[k], 0)])) } as Totals);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  }

  async function save() {
    // The backend's ranges. A value outside one is silently replaced there, so
    // it is refused here instead of being saved as a lie.
    for (const [key, [min, max]] of Object.entries(RANGES)) {
      const raw = s[key as keyof Settings] as number;
      const value = key === 'minRiderSavingPct' ? raw * 100 : raw;
      if (!Number.isFinite(value) || value < min || value > max) {
        setError(`${LABELS[key] ?? key} must be between ${min} and ${max}.`);
        return;
      }
    }
    if (s.matchRadiusM > s.candidateRadiusM) {
      setError(
        'The match radius cannot be larger than the candidate radius: a rider would be seated ' +
          'on a car the search never showed them.',
      );
      return;
    }
    if (s.bookingCutoffMin > 0 && s.bookingCutoffMin < s.matchWindowMin) {
      setError(
        `Bookings would close ${s.bookingCutoffMin} minutes before departure while the car is ` +
          `asked for at ${s.matchWindowMin} minutes — the last riders to book would never make it ` +
          'into the car that was already sent. Set the cutoff at or above the matching window.',
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'config', 'poolingSettings'), { ...s }, { merge: true });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <SkeletonRows />;

  const per = (sum: number) => (totals.evaluated > 0 ? sum / totals.evaluated : 0);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <Card style={glass}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Ride pooling</h2>
        <p style={{ color: colors.muted, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          How the engine decides which Corporate &amp; Students bookings share one car. Saved here,
          live on the next booking — no app release.
        </p>
      </Card>

      {/* ── Mode ──────────────────────────────────────────────────────────── */}
      <Card style={glass}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Mode</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['shadow', 'live'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set('mode', m)}
              style={{
                flex: '1 1 220px',
                textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 12,
                cursor: 'pointer',
                border: `2px solid ${s.mode === m ? colors.primary : colors.border}`,
                background: s.mode === m ? `${colors.primary}12` : '#fff',
                color: colors.text,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
                {m === 'shadow' ? 'Shadow — measure only' : 'Live — act on the verdict'}
              </div>
              <div style={{ color: colors.muted, fontSize: 12, lineHeight: 1.5 }}>
                {m === 'shadow'
                  ? 'Every combination is judged and recorded. Nobody is turned away.'
                  : 'A combination that fails the limits below is refused, with its reason.'}
              </div>
            </button>
          ))}
        </div>
        {s.mode === 'live' && (
          <p style={{ ...warnStyle, marginTop: 12 }}>
            Live mode refuses real riders a real car. Check “would have refused” below before saving
            this, and keep the limits where the ledger says they belong.
          </p>
        )}
      </Card>

      {/* ── Geography ─────────────────────────────────────────────────────── */}
      <Card style={glass}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Geography</h3>
        <div style={gridStyle}>
          <Field
            label="Candidate radius (m)"
            hint="How far a car's pickup may be from the rider and still be shown to them. Discovery only — being inside it seats nobody. 500–25,000."
          >
            <Num value={s.candidateRadiusM} step={500} onChange={(v) => set('candidateRadiusM', v)} />
          </Field>
          <Field
            label="Match radius (m)"
            hint="How far a rider's own pickup AND drop-off may sit off the car's route and still be on it. This is what seats them. 200–10,000."
          >
            <Num value={s.matchRadiusM} step={100} onChange={(v) => set('matchRadiusM', v)} />
          </Field>
          <Field
            label="Max detour (km)"
            hint="Extra road one more rider may add to the whole journey. 0.5–50."
          >
            <Num value={s.maxDetourKm} step={0.5} onChange={(v) => set('maxDetourKm', v)} />
          </Field>
          <Field
            label="Max detour (min)"
            hint="Extra time one more rider may add, at the city speed fares already assume. 1–180."
          >
            <Num value={s.maxDetourMin} step={1} onChange={(v) => set('maxDetourMin', v)} />
          </Field>
        </div>
        <p style={hintBoxStyle}>
          A rider still has to share at least half the car&apos;s route, whatever these say — two points
          near two points is not a shared journey. The two detour limits are measured on the{' '}
          <strong>real road network</strong>, not the straight line: as the crow flies a rider can
          look like a 0.5 km diversion and cost 4 km of driving. If the mapping service is
          unavailable the engine falls back to the straight line and marks that row, which the
          ledger below counts — a straight-line row understates the detour, so do not read it as a
          limit comfortably met.
        </p>
      </Card>

      {/* ── Economics ─────────────────────────────────────────────────────── */}
      <Card style={glass}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Economics</h3>
        <div style={gridStyle}>
          <Field
            label="Minimum rider saving (%)"
            hint="Every rider in the car must save at least this much against their own solo fare. 0–90."
          >
            <Num
              value={Math.round(s.minRiderSavingPct * 100)}
              step={1}
              onChange={(v) => set('minRiderSavingPct', v / 100)}
            />
          </Field>
          <Field
            label="Minimum driver gain (PKR)"
            hint="A join must leave the car earning at least this many rupees more than before it. 0–10,000."
          >
            <Num value={s.minDriverGainPkr} step={10} onChange={(v) => set('minDriverGainPkr', v)} />
          </Field>
        </div>
        <p style={hintBoxStyle}>
          Nobody is ever charged more than riding alone, and a join never leaves the driver worse
          off — those two hold whatever is set here. These limits are about the joins that are
          <em> technically</em> allowed and still not worth making: a short-hop rider whose top-up
          eats their whole discount, or a car that gains a rupee for twenty minutes of driving.
        </p>
      </Card>

      {/* ── Timing and seats ──────────────────────────────────────────────── */}
      <Card style={glass}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Timing and seats</h3>
        <div style={gridStyle}>
          <Field
            label="Matching window (min)"
            hint="How long before a timed departure the car is asked for. 0–240."
          >
            <Num value={s.matchWindowMin} step={1} onChange={(v) => set('matchWindowMin', v)} />
          </Field>
          <Field
            label="Booking cutoff (min)"
            hint="No new booking this close to a timed departure. 0 means no cutoff. 0–240."
          >
            <Num value={s.bookingCutoffMin} step={1} onChange={(v) => set('bookingCutoffMin', v)} />
          </Field>
          <Field label="Seats per car" hint="Capped by the vehicle itself. 2–4.">
            <Num value={s.maxRiders} step={1} onChange={(v) => set('maxRiders', v)} />
          </Field>
        </div>
        <p style={hintBoxStyle}>
          The lifecycle itself is not a setting. A car keeps filling its empty seats while its
          driver is on the way, because a seat filled cuts the fare for everyone in it and pays the
          driver more. The driver tapping <strong>Start</strong> closes it for good: no rider joins
          after that, and the driver takes no other ride until every passenger is dropped off.
        </p>
      </Card>

      {/* ── The ledger ────────────────────────────────────────────────────── */}
      <Card style={glass}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>What the engine decided</h3>
        <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 12px', lineHeight: 1.5 }}>
          Every join judged since this started, first seats excluded — a car&apos;s first rider has
          nobody to share with. Averages are per judged join.
        </p>
        {totals.evaluated === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
            Nothing judged yet. The first time two riders are put in one car, it appears here.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat label="Joins judged" value={String(totals.evaluated)} />
            <Stat label="Passed the limits" value={`${totals.passed} (${Math.round((totals.passed / totals.evaluated) * 100)}%)`} />
            <Stat
              label={s.mode === 'live' ? 'Refused' : 'Would have refused'}
              value={String(s.mode === 'live' ? totals.refused : totals.wouldRefuse)}
              warn={totals.wouldRefuse > totals.passed}
            />
            <Stat label="Riders per car" value={per(totals.ridersSum).toFixed(2)} />
            <Stat label="Average rider saving" value={`${Math.round(per(totals.savingPctSum) * 100)}%`} />
            <Stat label="Saved per rider" value={`PKR ${Math.round(per(totals.savingPkrSum))}`} />
            <Stat label="Extra per car" value={`PKR ${Math.round(per(totals.driverGainSum))}`} />
            <Stat label="Average detour" value={`${per(totals.detourKmSum).toFixed(2)} km · ${Math.round(per(totals.detourMinSum))} min`} />
            <Stat
              label="Measured on real roads"
              value={`${totals.roadMeasured} of ${totals.evaluated}`}
              warn={totals.roadMeasured < totals.evaluated}
            />
          </div>
        )}
        {totals.evaluated > 0 && totals.wouldRefuse > 0 && s.mode === 'shadow' && (
          <p style={{ ...warnStyle, marginTop: 12 }}>
            {totals.wouldRefuse} of {totals.evaluated} judged joins would have been refused in live
            mode. Each one is a rider who shared a car and would not have. Read the reasons in{' '}
            <code style={codeStyle}>poolDecisions</code> before switching over.
          </p>
        )}
      </Card>

      {error && <Card style={{ ...glass, borderColor: colors.danger }}><p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p></Card>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save pooling settings'}</Button>
        {saved && <span style={{ color: colors.success, fontSize: 13, fontWeight: 700 }}>Saved — live on the next booking.</span>}
      </div>
    </div>
  );
}

function Num({ value, step, onChange }: { value: number; step: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(Number(e.target.value))}
      style={inputStyle}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <p style={{ color: colors.muted, fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>{hint}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${warn ? colors.danger : colors.border}`, background: '#fff' }}>
      <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: warn ? colors.danger : colors.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  candidateRadiusM: 'Candidate radius',
  matchRadiusM: 'Match radius',
  maxDetourKm: 'Max detour (km)',
  maxDetourMin: 'Max detour (min)',
  minRiderSavingPct: 'Minimum rider saving',
  minDriverGainPkr: 'Minimum driver gain',
  matchWindowMin: 'Matching window',
  bookingCutoffMin: 'Booking cutoff',
  maxRiders: 'Seats per car',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  color: colors.text,
  fontSize: 16,
  fontWeight: 700,
  boxSizing: 'border-box',
};
const hintBoxStyle: React.CSSProperties = {
  color: colors.muted,
  fontSize: 12,
  lineHeight: 1.6,
  margin: '12px 0 0',
};
const warnStyle: React.CSSProperties = {
  color: colors.danger,
  fontSize: 12,
  lineHeight: 1.6,
  margin: 0,
  fontWeight: 600,
};
const codeStyle: React.CSSProperties = {
  background: colors.border,
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 11,
};
