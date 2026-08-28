'use client';

/**
 * Cost of Velocity — the third-party bill, line by line.
 *
 * The catalogue of vendors comes from `lib/costs.ts` (it is a fact about the
 * codebase). An amount reaches a line one of three ways, and the page is built
 * around keeping them distinguishable:
 *
 *  · **Fetched** — the backend pulled it from Google Cloud, Anthropic or Meta.
 *  · **Typed** — somebody read it off an invoice.
 *  · **Catalogue** — a published list price nobody has confirmed yet.
 *
 * A fetched figure beats a typed one, because it *is* the invoice — but only
 * until an admin pins the line, and pinning is one click. That is the safety
 * property worth protecting: no number a person entered is ever silently
 * replaced by whatever a vendor's API returned at 6am.
 *
 * It also does not let you rename a service. An override changes what a line
 * costs, never what it is, so the catalogue stays the single description of
 * what Velocity is plugged into.
 *
 * Amounts are stored in `adminConfig/platformCosts`, which — unlike `config/` —
 * no app user can read. What the company spends is not passenger-facing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { costsApi } from '@/lib/api';
import { Badge, Button, Card } from '@/components/ui';
import { CategoryBars, ChartCard, compact } from '@/components/charts';
import {
  BILLING_LABELS,
  CATEGORIES,
  COST_COLLECTION,
  COST_DOC,
  DEFAULT_USD_TO_PKR,
  STATUS_LABELS,
  type Billing,
  type CostCategory,
  type CostCurrency,
  type CostItem,
  type CostStatus,
  type FetchStatus,
  type StoredCostConfig,
  monthlyPkr,
  overrideFor,
  pkr,
  resolveCosts,
  summarise,
  toPkr,
} from '@/lib/costs';

/** One grid, used by the header and every row, so the columns line up. */
const COLS = 'minmax(260px, 2.4fr) 128px 84px 116px 120px 108px';
const TABLE_MIN_WIDTH = 940;

const STATUS_COLOR: Record<CostStatus, string> = {
  active: colors.success,
  planned: colors.secondary,
  free: colors.muted,
  paused: colors.warn,
};

/** What each fetch source is called, and what it covers. */
const SOURCES: { key: 'googleCloud' | 'anthropic' | 'meta'; label: string; covers: string }[] = [
  { key: 'googleCloud', label: 'Google Cloud', covers: 'Firebase, Maps, Gemini' },
  { key: 'anthropic', label: 'Anthropic', covers: 'Claude' },
  { key: 'meta', label: 'Meta', covers: 'WhatsApp, ad spend' },
];

const SOURCE_NAMES: Record<string, string> = {
  'google-cloud': 'Google Cloud billing',
  anthropic: 'Anthropic',
  meta: 'Meta',
};

export default function CostsPage() {
  const { user, isAdmin } = useAuth();

  const [items, setItems] = useState<CostItem[]>([]);
  const [rate, setRate] = useState(DEFAULT_USD_TO_PKR);
  const [stored, setStored] = useState<StoredCostConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readCosts = useCallback(async (): Promise<StoredCostConfig | null> => {
    const snap = await getDoc(doc(db, COST_COLLECTION, COST_DOC));
    return (snap.data() as StoredCostConfig | undefined) ?? null;
  }, []);

  /** Reading is separate from applying so the effect never sets state inline. */
  const applyStored = useCallback((data: StoredCostConfig | null) => {
    const resolved = resolveCosts(data);
    setItems(resolved.items);
    setRate(resolved.usdToPkr);
    setStored(data);
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readCosts()
      .then((data) => {
        if (!cancelled) applyStored(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load costs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readCosts, applyStored]);

  const summary = useMemo(() => summarise(items, rate), [items, rate]);

  function patch(id: string, changes: Partial<CostItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));
    setDirty(true);
    setSaved(false);
  }

  /** Typing a figure in is what turns a guess into a number. */
  function setAmount(id: string, raw: string) {
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0) return;
    patch(id, { amount: value, estimate: false, origin: 'manual' });
  }

  function addLine() {
    const id = `custom-${Date.now().toString(36)}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        platform: '',
        service: '',
        category: 'Cloud & infrastructure',
        purpose: '',
        amount: 0,
        currency: 'PKR',
        billing: 'monthly',
        status: 'active',
        estimate: false,
        custom: true,
      },
    ]);
    setDirty(true);
    setSaved(false);
  }

  function removeLine(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    if (rate <= 0) {
      setError('The dollar rate has to be greater than zero.');
      return;
    }
    const unnamed = items.find((i) => i.custom && !i.platform.trim());
    if (unnamed) {
      setError('Give every line you added a platform name, or remove it.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const overrides: Record<string, object> = {};
      for (const item of items) {
        if (item.custom) continue;
        const diff = overrideFor(item);
        if (diff) overrides[item.id] = diff;
      }
      // mergeFields, so the backend's `fetched` map and its status survive a
      // save from here untouched — the two writers never share a field.
      await setDoc(
        doc(db, COST_COLLECTION, COST_DOC),
        {
          usdToPkr: rate,
          overrides,
          custom: items.filter((i) => i.custom),
          updatedAt: Date.now(),
          updatedBy: user?.email ?? null,
        },
        { mergeFields: ['usdToPkr', 'overrides', 'custom', 'updatedAt', 'updatedBy'] },
      );
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await costsApi.refresh({});
      applyStored(await readCosts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh from the vendors.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div style={{ color: colors.muted, padding: 20 }}>Loading…</div>;

  const byCategory = CATEGORIES.map((category) => ({
    category,
    rows: items.filter((i) => i.category === category),
  })).filter((g) => g.rows.length > 0);

  return (
    <div>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Cost of Velocity</h1>
          <p style={{ color: colors.muted, margin: 0, maxWidth: 720 }}>
            Everything Velocity pays somebody else to exist — the cloud under the apps, the AI on
            the social desk, Meta&rsquo;s WhatsApp numbers, Maps, the Play account, the blue tick.
            The list of services comes from the code; the amounts come from the vendors, or from
            your invoices.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {saved ? <span style={{ color: colors.success, fontWeight: 800, fontSize: 13 }}>✓ Saved</span> : null}
          <Button onClick={save} disabled={!isAdmin || busy || !dirty}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      {error ? (
        <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>
      ) : null}

      <SourceStrip
        status={stored?.fetchStatus}
        window={stored?.fetchWindow}
        fetchedAt={stored?.fetchedAt}
        onRefresh={refresh}
        refreshing={refreshing}
        disabled={!isAdmin || dirty}
        dirty={dirty}
      />

      {/* ── the four numbers ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <Figure
          label="Monthly run rate"
          value={pkr(summary.monthly)}
          hint={`${summary.activeCount} services being paid for`}
        />
        <Figure
          label="A year at this rate"
          value={pkr(summary.yearly)}
          hint="Twelve months of the figure on the left"
        />
        <Figure
          label="One-off and setup"
          value={pkr(summary.oneTime)}
          hint="Paid once, not part of the run rate"
        />
        <Figure
          label="Planned, not yet paying"
          value={pkr(summary.planned)}
          hint={`${summary.plannedCount} services waiting to be switched on`}
          muted
        />
      </div>

      {/* Anything the total is quietly missing says so here, not in a footnote. */}
      {summary.unpriced.length > 0 || summary.estimated.length > 0 ? (
        <Card style={{ marginBottom: 16, borderColor: `${colors.warn}55`, background: `${colors.warn}0A` }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
            How much of this total is real
          </div>
          <div style={{ color: colors.text, fontSize: 13, lineHeight: 1.6 }}>
            {summary.unpriced.length > 0 ? (
              <div>
                <strong>
                  {summary.unpriced.length} paid service{summary.unpriced.length > 1 ? 's have' : ' has'} no
                  amount against {summary.unpriced.length > 1 ? 'them' : 'it'}
                </strong>{' '}
                — {[...new Set(summary.unpriced.map((i) => i.platform))].join(', ')}. Until somebody types last
                month&rsquo;s invoice in, the run rate above is lower than the real one.
              </div>
            ) : null}
            {summary.estimated.length > 0 ? (
              <div style={{ marginTop: summary.unpriced.length > 0 ? 6 : 0 }}>
                {summary.estimated.length} line{summary.estimated.length > 1 ? 's are' : ' is'} still
                a published list price rather than something you were charged:{' '}
                {summary.estimated.map((i) => i.service).join(', ')}.
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ── where it goes ────────────────────────────────────────────────── */}
      <div style={grid2}>
        <ChartCard
          title="Where the money goes"
          subtitle="Monthly run rate by who sends the bill."
          rows={summary.byPlatform.map((p) => ({ label: p.label, values: [pkr(p.value)] }))}
        >
          <CategoryBars
            items={summary.byPlatform}
            valueFormat={(n) => `${compact(n)} PKR`}
            emptyLabel="No amounts entered yet — fill the table in below."
          />
        </ChartCard>

        <ChartCard
          title="By what it buys"
          subtitle="The same money, grouped by the job it does."
          rows={summary.byCategory.map((c) => ({ label: c.label, values: [pkr(c.value)] }))}
        >
          <CategoryBars
            items={summary.byCategory}
            valueFormat={(n) => `${compact(n)} PKR`}
            emptyLabel="No amounts entered yet — fill the table in below."
          />
        </ChartCard>
      </div>

      {/* ── the exchange rate every foreign line runs through ─────────────── */}
      <Card style={{ margin: '16px 0', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Dollar rate</div>
          <div style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
            Google and Anthropic both bill in USD, and neither reports what your card was charged
            at. This is the rate the rupee total above converts them with.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>1 USD =</span>
          <input
            type="number"
            min={1}
            step={1}
            value={rate}
            disabled={!isAdmin}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isNaN(v)) return;
              setRate(v);
              setDirty(true);
              setSaved(false);
            }}
            style={{ ...inputStyle, width: 110, fontSize: 18, fontWeight: 900 }}
          />
          <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>PKR</span>
        </div>
      </Card>

      {/* ── the bill itself ──────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 10,
              padding: '0 14px 8px',
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              color: colors.muted,
            }}
          >
            <span>Service</span>
            <span>Amount</span>
            <span>Currency</span>
            <span>Billed</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Per month</span>
          </div>

          {byCategory.map(({ category, rows }) => (
            <section key={category} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 14px 6px' }}>
                <h2 style={{ fontSize: 13.5, fontWeight: 900 }}>{category}</h2>
                <span style={{ color: colors.muted, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {pkr(rows.reduce((n, r) => n + (r.status === 'active' ? monthlyPkr(r, rate) : 0), 0))} a
                  month
                </span>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {rows.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    rate={rate}
                    editable={isAdmin}
                    onPatch={(changes) => patch(item.id, changes)}
                    onAmount={(raw) => setAmount(item.id, raw)}
                    onRemove={item.custom ? () => removeLine(item.id) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Button variant="ghost" onClick={addLine} disabled={!isAdmin}>
          + Add a service
        </Button>
        <span style={{ color: colors.muted, fontSize: 12.5 }}>
          For anything that also runs on the code — a new API, another cloud product — add it to
          the catalogue in <code>lib/costs.ts</code> so it survives, rather than here.
        </span>
      </div>

      <p style={{ color: colors.muted, fontSize: 12, marginTop: 18, maxWidth: 760, lineHeight: 1.6 }}>
        A <strong>per use</strong> line holds one month of usage. Where a vendor reports its own
        spend that number is fetched nightly; everywhere else, enter what the invoice came to. See{' '}
        <code>docs/COST_SOURCES.md</code> for what each source needs before it can answer.
        {stored?.updatedAt
          ? ` Last edited by hand ${new Date(stored.updatedAt).toLocaleString('en-PK')}.`
          : ''}
      </p>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

/**
 * Which vendors are answering. A source that was never configured is not a
 * failure and does not get an alarming colour — it is simply a credential
 * nobody has added yet, and the page works without it.
 */
function SourceStrip({
  status,
  window,
  fetchedAt,
  onRefresh,
  refreshing,
  disabled,
  dirty,
}: {
  status?: Record<'googleCloud' | 'anthropic' | 'meta', FetchStatus>;
  window?: string;
  fetchedAt?: number;
  onRefresh: () => void;
  refreshing: boolean;
  disabled: boolean;
  dirty: boolean;
}) {
  const connected = SOURCES.filter((s) => status?.[s.key]?.state === 'ok').length;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            Fetched from the vendors
            {window ? (
              <span style={{ color: colors.muted, fontWeight: 600 }}> · {window}</span>
            ) : null}
          </div>
          <div style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
            {status
              ? `${connected} of 3 sources answering. Checked ${
                  fetchedAt ? new Date(fetchedAt).toLocaleString('en-PK') : 'never'
                }.`
              : 'Nothing has been fetched yet. Add a vendor credential and every line it covers fills itself in nightly.'}
          </div>
        </div>
        <Button variant="secondary" onClick={onRefresh} disabled={disabled || refreshing}>
          {refreshing ? 'Fetching…' : 'Refresh now'}
        </Button>
      </div>

      {dirty ? (
        <div style={{ color: colors.warn, fontSize: 12, fontWeight: 600, marginTop: 8 }}>
          Save your changes first — a refresh reloads the page and would discard them.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {SOURCES.map((s) => {
          const state = status?.[s.key];
          const tone =
            state?.state === 'ok'
              ? colors.success
              : state?.state === 'error'
                ? colors.danger
                : colors.muted;
          return (
            <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
              <span style={{ minWidth: 120, fontWeight: 700 }}>{s.label}</span>
              <Badge
                label={
                  state?.state === 'ok'
                    ? `${state.lines ?? 0} lines`
                    : state?.state === 'error'
                      ? 'error'
                      : 'not connected'
                }
                color={tone}
              />
              <span style={{ color: colors.muted, flex: 1 }}>
                {state?.detail ?? s.covers}
                {state?.unmapped?.length
                  ? ` — ${state.unmapped.join(', ')}`
                  : ''}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 18,
        flex: '1 1 200px',
        minWidth: 190,
      }}
    >
      <div style={{ color: colors.muted, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 900,
          lineHeight: 1.15,
          marginTop: 6,
          whiteSpace: 'nowrap',
          color: muted ? colors.muted : colors.text,
        }}
      >
        {value}
      </div>
      <div style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>{hint}</div>
    </div>
  );
}

function Row({
  item,
  rate,
  editable,
  onPatch,
  onAmount,
  onRemove,
}: {
  item: CostItem;
  rate: number;
  editable: boolean;
  onPatch: (changes: Partial<CostItem>) => void;
  onAmount: (raw: string) => void;
  onRemove?: () => void;
}) {
  const perMonth = monthlyPkr(item, rate);
  const counted = item.status === 'active';
  const auto = item.origin === 'fetched';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 10,
        alignItems: 'start',
        background: colors.surface,
        border: `1px solid ${auto ? `${colors.success}44` : colors.border}`,
        borderRadius: 14,
        padding: 14,
        opacity: counted ? 1 : 0.72,
      }}
    >
      {/* what it is */}
      <div style={{ minWidth: 0 }}>
        {item.custom ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <input
              placeholder="Platform (who bills you)"
              value={item.platform}
              disabled={!editable}
              onChange={(e) => onPatch({ platform: e.target.value })}
              style={{ ...inputStyle, fontWeight: 800 }}
            />
            <input
              placeholder="Service"
              value={item.service}
              disabled={!editable}
              onChange={(e) => onPatch({ service: e.target.value })}
              style={inputStyle}
            />
            <select
              value={item.category}
              disabled={!editable}
              onChange={(e) => onPatch({ category: e.target.value as CostCategory })}
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              placeholder="What it buys us"
              value={item.purpose}
              disabled={!editable}
              onChange={(e) => onPatch({ purpose: e.target.value })}
              style={inputStyle}
            />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13.5 }}>{item.platform}</strong>
              {auto ? <Badge label="automatic" color={colors.success} /> : null}
              {item.pinned ? <Badge label="pinned" color={colors.secondary} /> : null}
              {item.estimate && item.amount > 0 ? <Badge label="estimate" color={colors.warn} /> : null}
              {item.status === 'active' && item.amount === 0 && !item.autoOnly ? (
                <Badge label="no amount yet" color={colors.danger} />
              ) : null}
            </div>
            <div style={{ fontSize: 12.5, color: colors.text, marginTop: 2 }}>{item.service}</div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 1.5 }}>
              {item.purpose}
            </div>
            {item.note ? (
              <div style={{ fontSize: 11.5, color: colors.muted, marginTop: 4, lineHeight: 1.5 }}>
                {item.note}
              </div>
            ) : null}
            {item.billingUrl ? (
              <a
                href={item.billingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11.5, color: colors.secondary, fontWeight: 700, display: 'inline-block', marginTop: 5 }}
              >
                Billing console ↗
              </a>
            ) : null}
          </>
        )}
      </div>

      {/* what it costs — read-only while a vendor is answering for it */}
      <div style={{ display: 'grid', gap: 5 }}>
        <input
          type="number"
          min={0}
          step="any"
          value={auto ? Number(item.amount.toFixed(2)) : item.amount}
          disabled={!editable || auto}
          onChange={(e) => onAmount(e.target.value)}
          style={{
            ...inputStyle,
            fontWeight: 800,
            textAlign: 'right',
            background: auto ? `${colors.success}0F` : colors.bg,
          }}
        />
        {item.fetchedFrom ? (
          <button
            onClick={() => onPatch({ pinned: !item.pinned })}
            disabled={!editable}
            style={{ ...linkButtonStyle, color: colors.secondary }}
          >
            {item.pinned ? 'Use the fetched number' : 'Type my own'}
          </button>
        ) : null}
      </div>

      <select
        value={item.currency}
        disabled={!editable || auto}
        onChange={(e) => onPatch({ currency: e.target.value as CostCurrency })}
        style={inputStyle}
      >
        <option value="PKR">PKR</option>
        <option value="USD">USD</option>
      </select>

      <select
        value={item.billing}
        disabled={!editable}
        onChange={(e) => onPatch({ billing: e.target.value as Billing })}
        style={inputStyle}
      >
        {(Object.keys(BILLING_LABELS) as Billing[]).map((b) => (
          <option key={b} value={b}>
            {BILLING_LABELS[b]}
          </option>
        ))}
      </select>

      <div style={{ display: 'grid', gap: 6 }}>
        <select
          value={item.status}
          disabled={!editable}
          onChange={(e) => onPatch({ status: e.target.value as CostStatus })}
          style={{ ...inputStyle, color: STATUS_COLOR[item.status], fontWeight: 700 }}
        >
          {(Object.keys(STATUS_LABELS) as CostStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {onRemove ? (
          <button onClick={onRemove} disabled={!editable} style={{ ...linkButtonStyle, color: colors.danger }}>
            Remove
          </button>
        ) : null}
      </div>

      {/* what it adds to the run rate */}
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {item.billing === 'one-time' ? (
          <>
            <div style={{ fontWeight: 800, fontSize: 13.5 }}>
              {pkr(toPkr(item.amount, item.currency, rate))}
            </div>
            <div style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>once</div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: counted ? colors.text : colors.muted }}>
              {pkr(perMonth)}
            </div>
            <div style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
              {counted ? 'in the total' : 'not counted'}
            </div>
          </>
        )}
        {auto && item.fetchedFrom ? (
          <div style={{ color: colors.muted, fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
            from {SOURCE_NAMES[item.fetchedFrom]}
            {item.fetchedWindow ? ` · ${item.fetchedWindow}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const grid2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.bg,
  color: colors.text,
  fontSize: 13,
  boxSizing: 'border-box',
};

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left',
};
