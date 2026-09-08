'use client';

/**
 * The market desk — where we stand against inDrive and Yango, and what to do
 * about it.
 *
 * Three things live here, in the order you need them:
 *
 *  1. POSITION. One row per vehicle class for a reference trip, showing their
 *     price, ours and whether the undercut promise actually holds. A red row is
 *     a class where we are NOT cheap enough; the fix is our own rates, and the
 *     row links straight to Ride settings.
 *  2. THEIR RATES. The competitor rate cards. Every number here came from
 *     somebody observing a real quote — there is no import, no scrape and no
 *     default, because neither company publishes a fare we may read. Cards go
 *     stale on purpose: past the freshness window they stop being shown to
 *     riders at all.
 *  3. RIDER REPORTS. What riders told us they were quoted. Fit them into a card
 *     with one button once there are enough of them.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

type Competitor = 'indrive' | 'yango';
type VehicleCategory = 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';
type RateSource = 'ops_survey' | 'rider_reports' | 'published';

interface RateCard {
  base: number;
  includedKm: number;
  includedMin: number;
  perKm: number;
  perMin: number;
  minFare: number;
  competitorClass: string;
  source: RateSource;
  sampleSize: number;
  verifiedAt: number;
  note?: string;
}

interface PositionRow {
  category: VehicleCategory;
  available: boolean;
  competitors: { competitor: Competitor; label: string; fare: number; ageDays: number }[];
  cheapest: { competitor: Competitor; label: string; fare: number } | null;
  targetFare: number | null;
  velocityFare: number;
  engineFare: number;
  savings: number | null;
  savingsPct: number | null;
  guaranteeMet: boolean;
  excluded?: { competitor: Competitor; label: string; reason: string }[];
}

interface Settings {
  enabled: boolean;
  undercutPct: number;
  maxAgeDays: number;
  minSampleSize: number;
  showCompetitorNames: boolean;
  disclaimer: string;
}

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  undercutPct: 0.15,
  maxAgeDays: 45,
  minSampleSize: 3,
  showCompetitorNames: true,
  disclaimer:
    'Estimated from fares recently checked in those apps for this city — not a live quote. Their price changes with demand.',
};

const CITIES = [
  { id: 'islamabad_rawalpindi', label: 'Islamabad / Rawalpindi' },
  { id: 'karachi', label: 'Karachi' },
];

const CATEGORIES: { key: VehicleCategory; label: string; icon: string }[] = [
  { key: 'moto', label: 'Moto', icon: '🏍️' },
  { key: 'rickshaw', label: 'Rickshaw', icon: '🛺' },
  { key: 'mini', label: 'Mini', icon: '🚗' },
  { key: 'ac_car', label: 'AC Car', icon: '❄️' },
  { key: 'luxury', label: 'Luxury', icon: '⭐' },
];

const COMPETITORS: { key: Competitor; label: string }[] = [
  { key: 'indrive', label: 'inDrive' },
  { key: 'yango', label: 'Yango' },
];

const SOURCES: { key: RateSource; label: string }[] = [
  { key: 'ops_survey', label: 'Checked in-app by our team' },
  { key: 'rider_reports', label: 'Reported by riders' },
  { key: 'published', label: 'Published by the operator' },
];

const EMPTY_CARD: RateCard = {
  base: 0, includedKm: 0, includedMin: 0, perKm: 0, perMin: 0, minFare: 0,
  competitorClass: '', source: 'ops_survey', sampleSize: 1, verifiedAt: 0, note: '',
};

const DAY = 24 * 60 * 60 * 1000;

function ageLabel(verifiedAt: number): string {
  if (!verifiedAt) return 'never';
  const days = Math.floor((Date.now() - verifiedAt) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const label: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 800, color: colors.primary,
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3,
};
const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 8,
  border: `1px solid ${colors.border}`, background: 'transparent',
  color: colors.text, fontSize: 13,
};

export default function MarketRatesPage() {
  const [cityId, setCityId] = useState(CITIES[0].id);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cards, setCards] = useState<Partial<Record<Competitor, Partial<Record<VehicleCategory, RateCard>>>>>({});
  const [position, setPosition] = useState<PositionRow[]>([]);
  const [refDistanceKm, setRefDistanceKm] = useState(8);
  const [refDurationMin, setRefDurationMin] = useState(25);
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which card is open in the editor, as "competitor:category".
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<RateCard>(EMPTY_CARD);

  /**
   * Everything the page shows, fetched without touching state. Keeping the
   * fetch pure lets the effect drop a response that lost a race to a city
   * switch, and keeps every setState on the far side of an await.
   */
  const fetchAll = useCallback(async (id: string, km: number, mins: number) => {
    const [ratesSnap, settingsSnap] = await Promise.all([
      getDoc(doc(db, 'marketRates', id)),
      getDoc(doc(db, 'config', 'marketComparison')),
    ]);

    // Pending rider reports, counted per competitor + category so the "fit"
    // buttons can say whether there is anything to fit.
    const reportsSnap = await getDocs(
      query(
        collection(db, 'competitorQuoteReports'),
        where('cityId', '==', id),
        orderBy('createdAt', 'desc'),
        limit(500),
      ),
    );
    const counts: Record<string, number> = {};
    reportsSnap.forEach((d) => {
      const key = `${d.get('competitor')}:${d.get('category')}`;
      counts[key] = (counts[key] ?? 0) + 1;
    });

    let rows: PositionRow[] = [];
    let positionError: string | null = null;
    try {
      const res = await adminApi.adminMarketPosition({ cityId: id, distanceKm: km, durationMin: mins });
      rows = res.rows as PositionRow[];
    } catch (e) {
      // A city with no fare config cannot be positioned. That is a fare-engine
      // gap, not a market one, and the cards below are still worth showing.
      positionError = e instanceof Error ? e.message : 'Could not compute the market position.';
    }

    return {
      cards: ratesSnap.exists() ? (ratesSnap.data().competitors ?? {}) : {},
      settings: settingsSnap.exists()
        ? { ...DEFAULT_SETTINGS, ...(settingsSnap.data() as Partial<Settings>) }
        : DEFAULT_SETTINGS,
      counts,
      rows,
      positionError,
    };
  }, []);

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAll>>) => {
    setCards(data.cards);
    setSettings(data.settings);
    setReportCounts(data.counts);
    setPosition(data.rows);
    setError(data.positionError);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchAll(cityId, refDistanceKm, refDurationMin)
      .then((data) => { if (alive) apply(data); })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load the market data.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [cityId, refDistanceKm, refDurationMin, fetchAll, apply]);

  /** Re-read after a write. Called from handlers, never from an effect. */
  const reload = useCallback(async () => {
    apply(await fetchAll(cityId, refDistanceKm, refDurationMin));
  }, [cityId, refDistanceKm, refDurationMin, fetchAll, apply]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  function openEditor(competitor: Competitor, category: VehicleCategory) {
    const key = `${competitor}:${category}`;
    setEditing(key);
    setDraft(cards[competitor]?.[category] ?? { ...EMPTY_CARD });
    setError(null);
  }

  async function saveCard(competitor: Competitor, category: VehicleCategory) {
    if (!draft.competitorClass.trim()) {
      setError('Record which of their tiers you sampled — "Economy", "City", and so on.');
      return;
    }
    if (draft.perKm <= 0 && draft.base <= 0) {
      setError('A card with no base and no per-km rate prices nothing.');
      return;
    }
    setBusy(`save:${competitor}:${category}`);
    setError(null);
    try {
      await adminApi.adminUpsertMarketRates({
        cityId, competitor, category,
        rates: {
          base: draft.base,
          includedKm: draft.includedKm,
          includedMin: draft.includedMin,
          perKm: draft.perKm,
          perMin: draft.perMin,
          minFare: draft.minFare,
          competitorClass: draft.competitorClass.trim(),
          source: draft.source,
          sampleSize: draft.sampleSize,
          note: draft.note ?? '',
        },
      });
      setEditing(null);
      flash('Saved. Riders see the new comparison within five minutes.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the card.');
    } finally {
      setBusy(null);
    }
  }

  async function removeCard(competitor: Competitor, category: VehicleCategory) {
    setBusy(`del:${competitor}:${category}`);
    try {
      await adminApi.adminDeleteMarketRates({ cityId, competitor, category });
      setEditing(null);
      flash('Card removed — that class shows no comparison now.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the card.');
    } finally {
      setBusy(null);
    }
  }

  async function fitFromReports(competitor: Competitor, category: VehicleCategory) {
    setBusy(`fit:${competitor}:${category}`);
    setError(null);
    try {
      const res = await adminApi.adminFitMarketRates({ cityId, competitor, category });
      if (!res.ok) {
        setError(
          `Not enough usable reports yet — ${res.reportCount} in the window, ${res.needed} needed, ` +
          'and they must not all be the same distance.',
        );
        return;
      }
      flash(`Fitted from ${res.reportCount} rider reports.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fit the reports.');
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    if (settings.undercutPct < 0 || settings.undercutPct > 0.6) {
      setError('The undercut has to sit between 0% and 60%.');
      return;
    }
    setBusy('settings');
    setError(null);
    try {
      await setDoc(doc(db, 'config', 'marketComparison'), settings, { merge: true });
      flash('Settings saved.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the settings.');
    } finally {
      setBusy(null);
    }
  }

  const behind = position.filter((r) => r.available && !r.guaranteeMet);

  if (loading) return <div style={{ color: colors.muted, padding: 20 }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Market rates</h1>
      <p style={{ color: colors.muted, marginBottom: 20, maxWidth: 760, lineHeight: 1.5 }}>
        What inDrive and Yango charge here, and whether we are still under them. Neither company
        publishes a fare we may read — inDrive has no fixed price at all, and Yango does not
        disclose per-km rates in Pakistan — so every number below is one somebody observed. A
        class with no fresh card shows riders no comparison at all.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        {CITIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCityId(c.id)}
            style={{
              padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${cityId === c.id ? colors.primary : colors.border}`,
              background: cityId === c.id ? `${colors.primary}22` : 'transparent',
              color: cityId === c.id ? colors.primary : colors.muted,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {notice && <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>✓ {notice}</div>}

      {/* ── 1. Where we stand ── */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>📊</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: colors.text }}>Where we stand</div>
            <div style={{ fontSize: 12, color: colors.muted }}>
              A reference trip priced through the live fare engine and the cards below
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 96 }}>
              <label style={label}>Distance km</label>
              <input
                style={input} type="number" min={0.5} max={500} step={0.5} value={refDistanceKm}
                onChange={(e) => setRefDistanceKm(Number(e.target.value) || 0)}
              />
            </div>
            <div style={{ width: 96 }}>
              <label style={label}>Minutes</label>
              <input
                style={input} type="number" min={1} max={600} value={refDurationMin}
                onChange={(e) => setRefDurationMin(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>

        {behind.length > 0 && (
          <div style={{
            border: `1px solid ${colors.danger}`, background: `${colors.danger}18`,
            borderRadius: 10, padding: 12, margin: '10px 0 14px', fontSize: 13, lineHeight: 1.5,
          }}>
            <strong style={{ color: colors.danger }}>
              We are not {Math.round(settings.undercutPct * 100)}% under the market in{' '}
              {behind.map((r) => CATEGORIES.find((c) => c.key === r.category)?.label).join(', ')}.
            </strong>{' '}
            The undercut already pulls each fare down as far as the driver floor allows; below that
            it stops, because a fare no driver takes is not a cheaper ride. To go lower, cut the
            per-km rate or the bid floor for those classes in{' '}
            <Link href="/dashboard/ride-settings" style={{ color: colors.primary, fontWeight: 700 }}>
              Ride settings
            </Link>.
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ color: colors.muted, textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Class</th>
                <th style={{ padding: '8px 6px' }}>inDrive</th>
                <th style={{ padding: '8px 6px' }}>Yango</th>
                <th style={{ padding: '8px 6px' }}>Target</th>
                <th style={{ padding: '8px 6px' }}>Velocity</th>
                <th style={{ padding: '8px 6px' }}>Rider saves</th>
                <th style={{ padding: '8px 6px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {position.map((row) => {
                const cat = CATEGORIES.find((c) => c.key === row.category);
                const fareOf = (k: Competitor) =>
                  row.competitors.find((c) => c.competitor === k)?.fare;
                return (
                  <tr key={row.category} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '10px 6px', fontWeight: 700 }}>
                      {cat?.icon} {cat?.label}
                    </td>
                    {COMPETITORS.map((c) => (
                      <td key={c.key} style={{ padding: '10px 6px', color: colors.muted }}>
                        {fareOf(c.key) != null ? `PKR ${fareOf(c.key)!.toLocaleString()}` : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '10px 6px', color: colors.muted }}>
                      {row.targetFare != null ? `PKR ${row.targetFare.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '10px 6px', fontWeight: 800 }}>
                      PKR {row.velocityFare.toLocaleString()}
                      {row.engineFare !== row.velocityFare && (
                        <span style={{ color: colors.muted, fontWeight: 500, fontSize: 11 }}>
                          {' '}(engine {row.engineFare.toLocaleString()})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 6px' }}>
                      {row.savingsPct != null && row.available
                        ? `${row.savingsPct}% · PKR ${(row.savings ?? 0).toLocaleString()}`
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 6px' }}>
                      {!row.available ? (
                        <span style={{ color: colors.muted }}>No verified rates</span>
                      ) : row.guaranteeMet ? (
                        <span style={{ color: colors.success, fontWeight: 700 }}>Under the market</span>
                      ) : (
                        <span style={{ color: colors.danger, fontWeight: 700 }}>Floor blocked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 2. Their rate cards ── */}
      {COMPETITORS.map((comp) => (
        <Card key={comp.key} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 2 }}>
            {comp.label} rates
          </div>
          <div style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>
            {comp.key === 'indrive'
              ? 'inDrive recommends a fare and lets the rider move it. Fit its recommended prices — they are what a rider compares against.'
              : 'Yango quotes a fixed price before the ride. Record the quote it shows for the routes you sample.'}
          </div>

          {CATEGORIES.map((cat) => {
            const key = `${comp.key}:${cat.key}`;
            const card = cards[comp.key]?.[cat.key];
            const stale = card ? (Date.now() - card.verifiedAt) / DAY > settings.maxAgeDays : false;
            const thin = card ? card.sampleSize < settings.minSampleSize : false;
            const pending = reportCounts[key] ?? 0;
            const open = editing === key;

            return (
              <div key={cat.key} style={{ borderTop: `1px solid ${colors.border}`, padding: '12px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                      {cat.icon} {cat.label}
                      {card && (
                        <span style={{ color: colors.muted, fontWeight: 500 }}>
                          {' '}· their &ldquo;{card.competitorClass}&rdquo;
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {card ? (
                        <>
                          PKR {card.base} + {card.perKm}/km
                          {card.perMin ? ` + ${card.perMin}/min` : ''} · min PKR {card.minFare} ·{' '}
                          {card.sampleSize} sample{card.sampleSize === 1 ? '' : 's'} · checked {ageLabel(card.verifiedAt)}
                          {stale && <span style={{ color: colors.danger, fontWeight: 700 }}> · STALE, not shown to riders</span>}
                          {!stale && thin && <span style={{ color: colors.danger, fontWeight: 700 }}> · TOO FEW SAMPLES, not shown</span>}
                        </>
                      ) : (
                        <span>No card — riders see no comparison for this class.</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {pending > 0 && (
                      <Button
                        onClick={() => fitFromReports(comp.key, cat.key)}
                        disabled={busy === `fit:${key}`}
                      >
                        {busy === `fit:${key}` ? 'Fitting…' : `Fit ${pending} report${pending === 1 ? '' : 's'}`}
                      </Button>
                    )}
                    <Button onClick={() => (open ? setEditing(null) : openEditor(comp.key, cat.key))}>
                      {open ? 'Close' : card ? 'Edit' : 'Add card'}
                    </Button>
                  </div>
                </div>

                {open && (
                  <div style={{
                    marginTop: 12, padding: 14, borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
                  }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={label}>Their name for this tier</label>
                      <input
                        style={input} value={draft.competitorClass}
                        placeholder={comp.key === 'indrive' ? 'City' : 'Economy'}
                        onChange={(e) => setDraft({ ...draft, competitorClass: e.target.value })}
                      />
                    </div>
                    {([
                      ['base', 'Base fare (PKR)'],
                      ['perKm', 'Per km (PKR)'],
                      ['perMin', 'Per minute (PKR)'],
                      ['minFare', 'Minimum fare (PKR)'],
                      ['includedKm', 'Included km'],
                      ['includedMin', 'Included minutes'],
                      ['sampleSize', 'Quotes observed'],
                    ] as [keyof RateCard, string][]).map(([field, text]) => (
                      <div key={field}>
                        <label style={label}>{text}</label>
                        <input
                          style={input} type="number" min={0} value={draft[field] as number}
                          onChange={(e) => setDraft({ ...draft, [field]: Number(e.target.value) || 0 })}
                        />
                      </div>
                    ))}
                    <div>
                      <label style={label}>Where it came from</label>
                      <select
                        style={input} value={draft.source}
                        onChange={(e) => setDraft({ ...draft, source: e.target.value as RateSource })}
                      >
                        {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={label}>Which routes did you sample?</label>
                      <input
                        style={input} value={draft.note ?? ''}
                        placeholder="F-10 → Blue Area, Saddar → Airport, checked 14:00 on a weekday"
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Button
                        onClick={() => saveCard(comp.key, cat.key)}
                        disabled={busy === `save:${key}`}
                      >
                        {busy === `save:${key}` ? 'Saving…' : 'Save card'}
                      </Button>
                      {card && (
                        <button
                          onClick={() => removeCard(comp.key, cat.key)}
                          disabled={busy === `del:${key}`}
                          style={{
                            padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                            cursor: 'pointer', border: `1px solid ${colors.danger}`,
                            background: 'transparent', color: colors.danger,
                          }}
                        >
                          {busy === `del:${key}` ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: colors.muted, alignSelf: 'center' }}>
                        Saving stamps today as the date this was last confirmed.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      ))}

      {/* ── 3. The rules ── */}
      <Card>
        <div style={{ fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 2 }}>
          Comparison rules
        </div>
        <div style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
          These apply to every city. The app and the backend read the same document.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <div>
            <label style={label}>Undercut (%)</label>
            <input
              style={input} type="number" min={0} max={60} step={1}
              value={Math.round(settings.undercutPct * 100)}
              onChange={(e) => setSettings({ ...settings, undercutPct: (Number(e.target.value) || 0) / 100 })}
            />
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              How far under the cheaper of the two we aim to land.
            </div>
          </div>
          <div>
            <label style={label}>Freshness window (days)</label>
            <input
              style={input} type="number" min={1} max={365}
              value={settings.maxAgeDays}
              onChange={(e) => setSettings({ ...settings, maxAgeDays: Number(e.target.value) || 1 })}
            />
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Older cards stop being shown, and stop being undercut against.
            </div>
          </div>
          <div>
            <label style={label}>Minimum samples</label>
            <input
              style={input} type="number" min={1} max={100}
              value={settings.minSampleSize}
              onChange={(e) => setSettings({ ...settings, minSampleSize: Number(e.target.value) || 1 })}
            />
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Below this a card is a guess, so it is not shown.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={label}>Disclaimer shown under the comparison</label>
          <textarea
            style={{ ...input, minHeight: 62, fontFamily: 'inherit' }}
            value={settings.disclaimer}
            onChange={(e) => setSettings({ ...settings, disclaimer: e.target.value })}
          />
          <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            These are estimates from observed fares, not live quotes from their apps. Saying so is
            what keeps the panel truthful — do not empty this.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            Show the comparison and apply the undercut
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={settings.showCompetitorNames}
              onChange={(e) => setSettings({ ...settings, showCompetitorNames: e.target.checked })}
            />
            Name them (off shows &ldquo;Other ride app&rdquo;)
          </label>
          <Button onClick={saveSettings} disabled={busy === 'settings'}>
            {busy === 'settings' ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
