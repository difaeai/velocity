'use client';

/**
 * The Pricing Engine desk.
 *
 * Four things, in the order you need them when something looks wrong:
 *
 *  1. FUEL. What litre price the engine believes, how many sources agreed and
 *     how old it is. The "Check now" button runs the fetch in front of you and
 *     prints what every source said, including the ones that were thrown out —
 *     which is how you tell "fuel has not moved" from "the scrapers broke".
 *  2. ZONES. Every tracked cell: its multiplier, its drivers, its waiting
 *     riders, and whether its factor is frozen because the drop in supply
 *     looked staged. A frozen zone can be released here when you know what
 *     actually happened — a cordon, a power cut.
 *  3. DRIVERS WATCHED. Who has been going offline and back repeatedly. Nothing
 *     is done to them automatically beyond the queue place they already lost;
 *     this list exists so a pattern is visible to a person.
 *  4. SETTINGS. Every cap. The ceiling is capped again server-side at 2.0, so a
 *     fat finger here cannot double the country's fares.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  pricingApi,
  type FuelRunReport,
  type PricingDashboard,
  type PricingSettingsPatch,
} from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card, StatCard } from '@/components/ui';

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `Rs.${n.toFixed(2)}`;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function ago(ms: number | undefined): string {
  if (!ms) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export default function PricingEnginePage() {
  const [data, setData] = useState<PricingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fuelRun, setFuelRun] = useState<FuelRunReport | null>(null);
  const [manual, setManual] = useState({ product: 'petrol' as 'petrol' | 'diesel', pricePkr: '', effectiveDate: '' });

  const load = useCallback(async () => {
    const fresh = await pricingApi.dashboard({});
    setData(fresh);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void pricingApi
      .dashboard({})
      .then((fresh) => {
        if (!alive) return;
        setData(fresh);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load the pricing engine.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function run<T>(key: string, job: () => Promise<T>, done: (result: T) => void) {
    setBusy(key);
    setError(null);
    try {
      done(await job());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: PricingSettingsPatch, label: string) =>
    run('save', () => pricingApi.update(patch), () => {
      flash(label);
      void load();
    });

  if (loading) {
    return <div style={{ color: colors.muted, padding: 24 }}>Loading the pricing engine…</div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: colors.danger }}>{error ?? 'No pricing data.'}</p>
        <Button onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  const { config, fuel, zones, summary, flaggedDrivers } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 60 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: colors.text }}>Pricing engine</h1>
        <p style={{ color: colors.muted, fontSize: 14, margin: '6px 0 0' }}>
          Fuel-linked per-km rates, a capped peak factor, and the driver queue. The engine ticks every
          minute; the fuel check runs daily at 06:15.
        </p>
      </header>

      {notice && (
        <div style={{ background: `${colors.success}1A`, color: colors.success, padding: 12, borderRadius: 10, fontWeight: 700 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ background: `${colors.danger}1A`, color: colors.danger, padding: 12, borderRadius: 10, fontWeight: 700 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Zones tracked" value={String(summary.zonesTracked)} />
        <StatCard label="Above normal fare" value={String(summary.surging)} />
        <StatCard label="Frozen (suspected)" value={String(summary.frozen)} />
        <StatCard label="Drivers watched" value={String(summary.flaggedDrivers)} />
      </div>

      {/* ── 1. Fuel ─────────────────────────────────────────────────────── */}
      <Card>
        <SectionTitle
          title="Fuel"
          hint="A price is believed only when two independent mirrors of the OGRA notification agree. Short of that, the last confirmed price stands and fares do not move."
        />

        {fuel.stale && (
          <p style={{ color: colors.warn, fontWeight: 700, fontSize: 13 }}>
            No fresh price. Past {config.fuel.maxAgeDays} days the fuel adjustment switches itself off and
            fares fall back to the authored rate cards.
          </p>
        )}

        <table style={tableStyle}>
          <thead>
            <tr>
              {['Product', 'Believed price', 'Effective', 'Confirmed', 'Sources', 'Baseline', 'Effect on per-km'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fuel.prices.map((row) => {
              const baseline = fuel.baseline[row.product];
              const move = row.pricePkr && baseline ? row.pricePkr / baseline - 1 : 0;
              return (
                <tr key={row.product}>
                  <td style={tdStyle}>
                    <strong style={{ textTransform: 'capitalize' }}>{row.product}</strong>
                  </td>
                  <td style={tdStyle}>{money(row.pricePkr)}</td>
                  <td style={tdStyle}>{row.effectiveDate ?? '—'}</td>
                  <td style={tdStyle}>
                    {row.ageDays === null ? '—' : row.ageDays === 0 ? 'today' : `${row.ageDays}d ago`}
                  </td>
                  <td style={tdStyle}>
                    {row.confirmations === 0 ? (
                      <Badge label="none" color={colors.danger} />
                    ) : row.confirmations === 1 ? (
                      <Badge label="1 — hand-typed" color={colors.warn} />
                    ) : (
                      <Badge label={`${row.confirmations} agreed`} color={colors.success} />
                    )}
                    <div style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>{row.sources.join(', ') || '—'}</div>
                  </td>
                  <td style={tdStyle}>{money(baseline)}</td>
                  <td style={tdStyle}>
                    {/* The fare effect is the fuel move times the class's fuel
                        share, so it is always smaller than the pump move. */}
                    <span style={{ color: move > 0.001 ? colors.warn : move < -0.001 ? colors.success : colors.muted, fontWeight: 700 }}>
                      {move === 0 ? 'none' : `${move > 0 ? '+' : ''}${(move * 100).toFixed(1)}% fuel`}
                    </span>
                    <div style={{ color: colors.muted, fontSize: 11 }}>
                      {move === 0 ? 'rates as authored' : `≈ ${(move * 35).toFixed(1)}% on a mini's per-km`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            disabled={busy === 'fuel'}
            onClick={() =>
              void run('fuel', () => pricingApi.refreshFuel({}), (res) => {
                setFuelRun(res.report);
                flash(
                  res.report.degraded
                    ? 'Nothing could be confirmed — previous prices are holding.'
                    : res.report.changed
                      ? 'Fuel prices updated.'
                      : 'Checked — no change.',
                );
                void load();
              })
            }
          >
            {busy === 'fuel' ? 'Checking…' : 'Check now'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy === 'tick'}
            onClick={() =>
              void run('tick', () => pricingApi.runTick({}), (res) => {
                flash(
                  `Tick: ${res.report.zonesPriced} zones priced, ${res.report.surging} above normal, ${res.report.forfeited} queue places forfeited.`,
                );
                void load();
              })
            }
          >
            {busy === 'tick' ? 'Running…' : 'Run tick now'}
          </Button>
          <span style={{ color: colors.muted, fontSize: 12 }}>
            Rate cards themselves live in{' '}
            <Link href="/dashboard/ride-settings" style={{ color: colors.secondary }}>Ride settings</Link>.
          </span>
        </div>

        {fuelRun && (
          <div style={{ marginTop: 16, background: colors.bg, borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
              What each source said at {new Date(fuelRun.ranAt).toLocaleTimeString()}
            </div>
            {fuelRun.sources.map((s) => (
              <div key={s.sourceId} style={{ fontSize: 12, color: s.error ? colors.danger : colors.text }}>
                {s.sourceId}: {s.error ? s.error : `${s.rows} usable row(s)`}
              </div>
            ))}
            {fuelRun.products.map((p) => (
              <div key={p.product} style={{ fontSize: 12, marginTop: 8 }}>
                <strong style={{ textTransform: 'capitalize' }}>{p.product}</strong>{' '}
                {p.pricePkr === null ? (
                  <span style={{ color: colors.danger }}>
                    not confirmed ({p.rejection}) — previous price holds
                  </span>
                ) : (
                  <span>
                    {money(p.pricePkr)} from {p.confirmations} source(s)
                    {p.stepLimited ? ' — move was limited to one step' : ''}
                  </span>
                )}
                <div style={{ color: colors.muted }}>
                  readings: {p.observed.map((o) => `${o.sourceId} ${o.pricePkr}`).join(' · ') || 'none'}
                </div>
              </div>
            ))}
          </div>
        )}

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: colors.muted }}>
            Type a price in by hand
          </summary>
          <p style={{ color: colors.muted, fontSize: 12, maxWidth: 620 }}>
            For the day both mirrors are down or wrong and fares are visibly off. It is stored with your
            account as the source and one confirmation, so a hand-typed price is never mistaken for a
            corroborated one.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={manual.product}
              onChange={(e) => setManual({ ...manual, product: e.target.value as 'petrol' | 'diesel' })}
              style={inputStyle}
            >
              <option value="petrol">Petrol</option>
              <option value="diesel">Diesel</option>
            </select>
            <input
              style={inputStyle}
              placeholder="PKR / litre"
              value={manual.pricePkr}
              onChange={(e) => setManual({ ...manual, pricePkr: e.target.value })}
            />
            <input
              style={inputStyle}
              type="date"
              value={manual.effectiveDate}
              onChange={(e) => setManual({ ...manual, effectiveDate: e.target.value })}
            />
            <Button
              variant="secondary"
              disabled={busy === 'manual' || !manual.pricePkr || !manual.effectiveDate}
              onClick={() =>
                void run(
                  'manual',
                  () =>
                    pricingApi.setFuelPrice({
                      product: manual.product,
                      pricePkr: Number(manual.pricePkr),
                      effectiveDate: manual.effectiveDate,
                    }),
                  () => {
                    flash('Price saved.');
                    setManual({ ...manual, pricePkr: '' });
                    void load();
                  },
                )
              }
            >
              Save price
            </Button>
          </div>
        </details>
      </Card>

      {/* ── 2. Zones ────────────────────────────────────────────────────── */}
      <Card>
        <SectionTitle
          title="Zones"
          hint={`Busiest first. A factor never moves more than ${config.peak.rampUpPerTick} a minute and never exceeds ${config.peak.maxMultiplier}x.`}
        />
        {zones.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>
            No zone has had a request recently, so nothing is being tracked. This is the normal state
            overnight.
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Zone', 'Factor', 'Riders waiting', 'Drivers (free/online)', 'Queue', 'Why', 'Updated', ''].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.key} style={z.suspicious ? { background: `${colors.warn}0F` } : undefined}>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12 }}>{z.zone}</code>
                    <div style={{ color: colors.muted, fontSize: 11 }}>{z.cityId}</div>
                  </td>
                  <td style={tdStyle}>
                    <strong style={{ fontSize: 16, color: z.multiplier > 1.001 ? colors.warn : colors.text }}>
                      {z.multiplier.toFixed(2)}x
                    </strong>
                  </td>
                  <td style={tdStyle}>{z.openRequests}</td>
                  <td style={tdStyle}>
                    {z.availableDrivers}/{z.onlineDrivers}
                  </td>
                  <td style={tdStyle}>{z.queueSize}</td>
                  <td style={{ ...tdStyle, maxWidth: 320 }}>
                    {z.frozen && <Badge label="frozen" color={colors.warn} />}
                    <div style={{ fontSize: 12, marginTop: z.frozen ? 4 : 0 }}>
                      {z.explanation ?? 'Normal fares'}
                    </div>
                    {z.suspicious && z.shock && (
                      <div style={{ color: colors.warn, fontSize: 11, marginTop: 4 }}>{z.shock}</div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: colors.muted, fontSize: 12 }}>{ago(z.updatedAt)}</td>
                  <td style={tdStyle}>
                    {z.frozen && (
                      <Button
                        variant="ghost"
                        disabled={busy === `thaw:${z.key}`}
                        onClick={() =>
                          void run(
                            `thaw:${z.key}`,
                            () => pricingApi.clearFreeze({ zoneKey: z.key }),
                            () => {
                              flash('Freeze released — the factor will price the shortage from the next tick.');
                              void load();
                            },
                          )
                        }
                      >
                        Release
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── 3. Drivers watched ──────────────────────────────────────────── */}
      <Card>
        <SectionTitle
          title="Drivers watched"
          hint="Repeated offline-and-back cycles. They have already lost their queue place each time; nothing else happens automatically, because a driver on bad signal looks identical from here."
        />
        {flaggedDrivers.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>Nobody is flagged.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Driver', 'Cycles in the last hour', 'Returned during a shortage', 'Last seen'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flaggedDrivers.map((d) => (
                <tr key={d.driverId}>
                  <td style={tdStyle}>
                    <Link href={`/dashboard/drivers?uid=${d.driverId}`} style={{ color: colors.secondary }}>
                      <code style={{ fontSize: 12 }}>{d.driverId}</code>
                    </Link>
                  </td>
                  <td style={tdStyle}>{d.cyclesLastHour ?? '—'}</td>
                  <td style={tdStyle}>
                    {d.lastOpportunisticReturnAt ? (
                      <Badge label={ago(d.lastOpportunisticReturnAt)} color={colors.warn} />
                    ) : (
                      <span style={{ color: colors.muted }}>no</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: colors.muted, fontSize: 12 }}>{ago(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── 4. Settings ─────────────────────────────────────────────────── */}
      <Card>
        <SectionTitle title="Settings" hint="Every one of these caps how far the engine may move somebody's money." />

        <Toggle
          label="Fuel-linked rates"
          on={config.fuel.enabled}
          detail="Move per-km rates with the notified pump price."
          onChange={(on) => void save({ fuel: { enabled: on } }, on ? 'Fuel linking on.' : 'Fuel linking off — rate cards stand as authored.')}
        />
        <Toggle
          label="Peak factor"
          on={config.peak.enabled}
          detail={`Raise fares in busy zones, never past ${config.peak.maxMultiplier}x.`}
          onChange={(on) => void save({ peak: { enabled: on } }, on ? 'Peak factor on.' : 'Peak factor off — every zone is 1.00x.')}
        />
        <Toggle
          label="Manufactured-scarcity detection"
          on={config.integrity.enabled}
          detail="Freeze the factor when supply drops suddenly while demand holds."
          onChange={(on) => void save({ integrity: { enabled: on } }, on ? 'Detection on.' : 'Detection off — supply drops are taken at face value.')}
        />
        <Toggle
          label="FIFO driver queue"
          on={config.queue.enabled}
          detail="Serve drivers in the order they came online. Going offline forfeits the place."
          onChange={(on) => void save({ queue: { enabled: on } }, on ? 'Queue on.' : 'Queue off — every driver may bid immediately.')}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
          <NumberSetting
            label="Highest peak factor"
            value={config.peak.maxMultiplier}
            step={0.05}
            min={1}
            max={2}
            hint="The engine's own ceiling. The city rate card caps it again; the lower wins."
            onSave={(v) => void save({ peak: { maxMultiplier: v } }, `Ceiling set to ${v}x.`)}
          />
          <NumberSetting
            label="Rise per minute"
            value={config.peak.rampUpPerTick}
            step={0.01}
            min={0.01}
            max={0.5}
            hint="Most the factor may climb in one tick."
            onSave={(v) => void save({ peak: { rampUpPerTick: v } }, 'Ramp updated.')}
          />
          <NumberSetting
            label="Quiet-zone threshold"
            value={config.peak.minActivity}
            step={1}
            min={0}
            max={100}
            hint="Below this many riders plus drivers, a zone is never surged."
            onSave={(v) => void save({ peak: { minActivity: Math.round(v) } }, 'Threshold updated.')}
          />
          <NumberSetting
            label="Supply drop that counts"
            value={config.integrity.dropPct}
            step={0.05}
            min={0.05}
            max={0.95}
            hint={`A fall of ${pct(config.integrity.dropPct)} or more within ${config.integrity.maxSuddenSamples} ticks, with demand holding.`}
            onSave={(v) => void save({ integrity: { dropPct: v } }, 'Detector updated.')}
          />
          <NumberSetting
            label="Freeze length (minutes)"
            value={config.integrity.freezeMinutes}
            step={5}
            min={1}
            max={240}
            hint="How long the factor is held at its pre-drop value."
            onSave={(v) => void save({ integrity: { freezeMinutes: Math.round(v) } }, 'Freeze length updated.')}
          />
          <NumberSetting
            label="Drivers per queue tier"
            value={config.queue.tierSize}
            step={1}
            min={1}
            max={50}
            hint="How many drivers may claim a new request at once."
            onSave={(v) => void save({ queue: { tierSize: Math.round(v) } }, 'Queue tiers updated.')}
          />
          <NumberSetting
            label="Seconds between tiers"
            value={config.queue.tierSeconds}
            step={1}
            min={0}
            max={60}
            hint="How long before the next tier of drivers may claim."
            onSave={(v) => void save({ queue: { tierSeconds: Math.round(v) } }, 'Queue tiers updated.')}
          />
          <NumberSetting
            label="Open to all after (seconds)"
            value={config.queue.openToAllAfterSec}
            step={5}
            min={5}
            max={300}
            hint="Past this, any driver may take the ride whatever their rank. No request is ever stranded."
            onSave={(v) => void save({ queue: { openToAllAfterSec: Math.round(v) } }, 'Open-to-all updated.')}
          />
          <NumberSetting
            label="Offline grace (seconds)"
            value={config.queue.graceSec}
            step={10}
            min={0}
            max={600}
            hint="How long a driver may drop off the network without losing their place."
            onSave={(v) => void save({ queue: { graceSec: Math.round(v) } }, 'Grace window updated.')}
          />
          <NumberSetting
            label="Petrol baseline (PKR/litre)"
            value={config.fuel.baseline.petrol}
            step={1}
            min={1}
            max={5000}
            hint="The price the rate cards were authored against. Move this ONLY when the cards are re-authored."
            onSave={(v) =>
              void save(
                { fuel: { baseline: { ...config.fuel.baseline, petrol: v } } },
                'Petrol baseline updated.',
              )
            }
          />
          <NumberSetting
            label="Diesel baseline (PKR/litre)"
            value={config.fuel.baseline.diesel}
            step={1}
            min={1}
            max={5000}
            hint="As above, for the classes that run on diesel."
            onSave={(v) =>
              void save(
                { fuel: { baseline: { ...config.fuel.baseline, diesel: v } } },
                'Diesel baseline updated.',
              )
            }
          />
        </div>

        <p style={{ color: colors.muted, fontSize: 12, marginTop: 16 }}>
          Last changed {ago(config.updatedAt || undefined)}
          {config.updatedBy ? ` by ${config.updatedBy}` : ''}.
        </p>
      </Card>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: colors.text }}>{title}</h2>
      <p style={{ color: colors.muted, fontSize: 13, margin: '4px 0 0', maxWidth: 760 }}>{hint}</p>
    </div>
  );
}

function Toggle({
  label,
  detail,
  on,
  onChange,
}: {
  label: string;
  detail: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 0',
        borderBottom: `1px solid ${colors.border}`,
        cursor: 'pointer',
      }}
    >
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontWeight: 700, fontSize: 14, color: colors.text }}>{label}</span>
        <span style={{ display: 'block', color: colors.muted, fontSize: 12 }}>{detail}</span>
      </span>
    </label>
  );
}

/**
 * A number with its own Save, rather than saving on every keystroke.
 *
 * These are caps on fares. Committing "1" on the way to typing "1.25" would
 * briefly pin the whole country at no surge, and committing "2" on the way to
 * "0.2" would be worse.
 */
function NumberSetting({
  label,
  value,
  hint,
  step,
  min,
  max,
  onSave,
}: {
  label: string;
  value: number;
  hint: string;
  step: number;
  min: number;
  max: number;
  onSave: (value: number) => void;
}) {
  // Re-sync the box when the saved value changes under it — after our own save,
  // or because somebody else moved the setting. Done during render rather than
  // in an effect (React's documented "adjusting state when a prop changes"),
  // because an effect here fires a second render pass on every parent reload.
  const [draft, setDraft] = useState(String(value));
  const [syncedTo, setSyncedTo] = useState(value);
  if (syncedTo !== value) {
    setSyncedTo(value);
    setDraft(String(value));
  }

  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const dirty = valid && parsed !== value;

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ ...inputStyle, width: 110 }}
        />
        <Button variant="secondary" disabled={!dirty} onClick={() => onSave(parsed)}>
          Save
        </Button>
      </div>
      <div style={{ color: valid ? colors.muted : colors.danger, fontSize: 11, marginTop: 4, maxWidth: 260 }}>
        {valid ? hint : `Must be between ${min} and ${max}.`}
      </div>
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  color: colors.muted,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  borderBottom: `1px solid ${colors.border}`,
};

const tdStyle: React.CSSProperties = {
  padding: '10px',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.text,
  verticalAlign: 'top',
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: 13,
  color: colors.text,
  background: colors.surface,
};
