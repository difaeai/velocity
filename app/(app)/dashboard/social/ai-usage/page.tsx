'use client';

/**
 * Velocity AI Studio → AI keys & usage (admins only).
 *
 * Where the Gemini money goes. Every call the backend makes is priced onto a
 * meter (`aiUsage`), so this page answers "why is the bill up" from data: this
 * month against last, by day, by part of the product, by the job that asked,
 * and by workspace — Velocity's own desk and each Studio customer.
 *
 * And the keys: three slots (Velocity's own work, Studio customers, phone
 * calls), each with the last four characters, where it comes from, and the
 * last refusal Google gave it ("prepayment credits are depleted"). A key typed
 * here is proved with a one-word call before it is kept, and sealed on the
 * server. Monthly budgets stop Gemini for a workspace that has spent its month.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { aiApi, type AiBudgets, type AiKeySlot, type AiOverview, type AiUsageRow } from '@/lib/api';
import { Badge, Button, Card } from '@/components/ui';
import { AreaSpark, CountUp, FX_CSS } from '@/components/social/fx';

const SLOT_LABEL: Record<AiKeySlot, { title: string; what: string }> = {
  house: { title: 'Velocity’s own work', what: 'The content desk, Meta Ad Expert, sales agent and support desk for Velocity Rides.' },
  customers: { title: 'Studio customers', what: 'Every Velocity Studio workspace. Empty means customers use the Velocity key.' },
  voice: { title: 'Phone calls', what: 'The phone helpline and the AI calling agents (Gemini Live).' },
};

const SOURCE: Record<string, { label: string; color: string }> = {
  console: { label: 'Set on this page', color: colors.success },
  deploy: { label: 'From the deploy secret', color: colors.secondary },
  house: { label: 'Using Velocity’s key', color: colors.muted },
  missing: { label: 'No key', color: colors.danger },
};

const FEATURE: Record<string, string> = {
  content: 'Content desk (posts, reels, voice-overs, plans)',
  ads: 'Meta Ad Expert',
  sales: 'Sales agent (finding, emails)',
  agents: 'AI calling & WhatsApp agents',
  helpline: 'Phone helpline',
  support: 'Support desk replies',
  comments: 'Comment replies',
  launch: 'Studio launch read',
  studio: 'Studio',
  other: 'Other',
};

/** When the meter began: spend before it is only on Google's own pages. */
const METER_SINCE = '26 Oct 2026, 02:50 Pakistan time';

const usd = (n: number) => (n === 0 ? '$0' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Sum one map field across every workspace row. */
function sumBy(rows: AiUsageRow[], pick: (r: AiUsageRow) => Record<string, { usd?: number; calls?: number }>) {
  const out = new Map<string, { usd: number; calls: number }>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(pick(r))) {
      const cur = out.get(k) ?? { usd: 0, calls: 0 };
      out.set(k, { usd: cur.usd + (v.usd ?? 0), calls: cur.calls + (v.calls ?? 0) });
    }
  }
  return [...out.entries()].sort((a, b) => b[1].usd - a[1].usd);
}

function Bars({ items, label }: { items: [string, { usd: number; calls: number }][]; label: (k: string) => string }) {
  const max = Math.max(0.000001, ...items.map(([, v]) => v.usd));
  if (!items.length) return <p style={{ color: colors.muted, margin: 0 }}>Nothing yet this month.</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map(([k, v]) => (
        <div key={k}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>{label(k)}</span>
            <span style={{ color: colors.muted, whiteSpace: 'nowrap' }}>
              {usd(v.usd)} · {v.calls.toLocaleString('en-PK')} calls
            </span>
          </div>
          <div style={{ height: 8, background: '#eef2ef', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${(v.usd / max) * 100}%`, height: '100%', background: colors.primary, borderRadius: 99, transition: 'width .6s' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function KeySlot({ s, vaultReady, onChanged }: { s: AiOverview['slots'][number]; vaultReady: boolean; onChanged: (msg: string) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = SOURCE[s.source];

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div>
          <div style={{ fontWeight: 900 }}>{SLOT_LABEL[s.slot].title}</div>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{SLOT_LABEL[s.slot].what}</div>
        </div>
        <Badge label={src.label} color={src.color} />
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>{s.last4 ? `AIza••••••••${s.last4}` : '—'}</div>
      {s.lastError ? (
        <div role="alert" style={{ background: '#fdecec', color: colors.danger, borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>
          Google refused it{s.lastErrorAtMs ? ` ${ago(s.lastErrorAtMs)}` : ''}: {s.lastError}
        </div>
      ) : s.testedAtMs ? (
        <div style={{ color: colors.success, fontSize: 12, fontWeight: 700 }}>Worked when tested {ago(s.testedAtMs)}.</div>
      ) : null}
      <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
        {s.source === 'console' ? 'Replace the key' : 'Use a different key'}
        <input
          type="password"
          autoComplete="off"
          value={key}
          placeholder="AIza…"
          onChange={(e) => setKey(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${colors.border}`, fontSize: 14 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          disabled={busy || !vaultReady || key.trim().length < 20}
          onClick={() =>
            run(async () => {
              const r = await aiApi.setKey({ slot: s.slot, key: key.trim() });
              setKey('');
              return `Saved — ${SLOT_LABEL[s.slot].title} now uses the key ending ${r.last4}.`;
            })
          }
        >
          {busy ? 'Checking…' : 'Check & save'}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || s.source === 'missing'}
          onClick={() =>
            run(async () => {
              const r = await aiApi.testKey({ slot: s.slot });
              if (!r.ok) throw new Error(r.error ?? 'Google refused it.');
              return `${SLOT_LABEL[s.slot].title}: the key works.`;
            })
          }
        >
          Test
        </Button>
        {s.source === 'console' ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await aiApi.removeKey({ slot: s.slot });
                return `${SLOT_LABEL[s.slot].title} is back on the deploy secret.`;
              })
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <div style={{ color: colors.danger, fontSize: 12, fontWeight: 600 }}>{error}</div> : null}
    </Card>
  );
}

export default function AiUsagePage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<AiOverview | null>(null);
  const [budgets, setBudgets] = useState<AiBudgets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await aiApi.overview({});
      setData(d);
      setBudgets(d.budgets);
      setNowMs(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the usage.');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [isAdmin, load]);

  const rows = useMemo(() => data?.workspaces ?? [], [data]);
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const byFeature = useMemo(() => sumBy(rows, (r) => r.byFeature), [rows]);
  // What one piece of content costs: the content desk's spend over the pieces it made.
  const pieces = rows.reduce((s, r) => s + (r.pieces ?? 0), 0);
  const contentUsd = byFeature.find(([k]) => k === 'content')?.[1].usd ?? 0;
  const perPiece = pieces ? contentUsd / pieces : 0;
  const byWhat = useMemo(() => sumBy(rows, (r) => r.byWhat).slice(0, 8), [rows]);
  const byModel = useMemo(() => sumBy(rows, (r) => r.byModel), [rows]);

  // Pakistan's day of the month, and how many days this month has.
  const pkt = new Date((nowMs || 0) + 5 * 3600_000);
  const today = pkt.getUTCDate();
  const daysInMonth = new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth() + 1, 0)).getUTCDate();
  const daily = Array.from({ length: today }, (_, i) =>
    rows.reduce((s, r) => s + (r.byDay[String(i + 1).padStart(2, '0')] ?? 0), 0),
  );
  const projected = today ? (total / today) * daysInMonth : 0;

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  async function saveBudgets() {
    if (!budgets) return;
    setSaving(true);
    setError(null);
    try {
      await aiApi.setBudgets(budgets);
      setNotice('Budgets saved. A workspace that reaches its budget stops using Gemini until the 1st.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the budgets.');
    } finally {
      setSaving(false);
    }
  }

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="fx" style={{ display: 'grid', gap: 18, maxWidth: 1180 }}>
      <style>{FX_CSS}</style>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>AI keys & usage</h1>
        <p style={{ color: colors.muted, margin: 0, maxWidth: 760 }}>
          Every Gemini call is priced here as it happens: what it was for, whose workspace it served, and which key paid. The key
          runs on prepaid credit, so nothing on this page is free.
        </p>
        <p style={{ color: colors.muted, margin: '6px 0 0', maxWidth: 760, fontSize: 13 }}>
          Counting since {METER_SINCE}. Anything spent before that shows only in Google AI Studio → Spend — and the credit there is
          shared by every project on that billing account, not only Velocity.
        </p>
      </div>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, fontWeight: 700, margin: 0 }}>{notice}</p> : null}

      {!data ? (
        <div className="fx-skel" style={{ height: 320, borderRadius: 20 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { label: `Spent in ${data.month}`, value: total, money: true },
              { label: 'At this rate, the month', value: projected, money: true },
              { label: 'Last month', value: data.lastMonthUsd, money: true },
              { label: pieces ? `One piece of content (${pieces} made)` : 'One piece of content', value: perPiece, money: true },
            ].map((k) => (
              <Card key={k.label} style={{ padding: 16 }}>
                <div style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>{k.label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>
                  <CountUp value={k.value} format={(n) => (k.money ? usd(n) : Math.round(n).toLocaleString('en-PK'))} />
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <strong>Spend by day</strong>
              <span style={{ color: colors.muted, fontSize: 13 }}>
                {daily.length ? `Highest: ${usd(Math.max(...daily))} on the ${daily.indexOf(Math.max(...daily)) + 1}` : ''}
              </span>
            </div>
            {daily.length >= 2 ? <AreaSpark values={daily} color={colors.primary} height={90} /> : <p style={{ color: colors.muted }}>One day so far.</p>}
          </Card>

          {perPiece > 0 ? (
            <Card style={{ padding: 16 }}>
              <strong>A month of content at today’s cost</strong>
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>
                A piece (post, reel, carousel or story, with its voice-over) costs about <strong>{usd(perPiece)}</strong>. A post and a story
                every day for 30 days is 60 pieces ≈ <strong>{usd(perPiece * 60)}</strong>; two posts and a story is 90 ≈{' '}
                <strong>{usd(perPiece * 90)}</strong>. Asking for changes or remaking a piece costs about the same again.
              </p>
            </Card>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <strong>Where it goes</strong>
              <Bars items={byFeature} label={(k) => FEATURE[k] ?? k} />
            </Card>
            <Card style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <strong>The jobs that cost the most</strong>
              <Bars items={byWhat} label={(k) => k} />
              {byModel.length ? (
                <div style={{ color: colors.muted, fontSize: 12 }}>
                  Models: {byModel.map(([m, v]) => `${m} ${usd(v.usd)}`).join(' · ')}
                </div>
              ) : null}
            </Card>
          </div>

          <div>
            <h2 style={{ fontSize: 18, fontWeight: 900, margin: '6px 0 10px' }}>Keys</h2>
            {!data.vaultReady ? (
              <p style={{ color: colors.danger, marginTop: 0 }}>SOCIAL_TOKEN_KEY is missing, so keys cannot be stored from here.</p>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
              {data.slots.map((s) => (
                <KeySlot
                  key={s.slot}
                  s={s}
                  vaultReady={data.vaultReady}
                  onChanged={(m) => {
                    setNotice(m);
                    void load();
                  }}
                />
              ))}
            </div>
          </div>

          {budgets ? (
            <Card style={{ display: 'grid', gap: 14 }}>
              <div>
                <strong>Monthly budgets</strong>
                <p style={{ color: colors.muted, fontSize: 13, margin: '4px 0 0' }}>
                  Dollars a month per workspace. When a workspace reaches its budget, Gemini stops for it until the 1st and the
                  team carries on more plainly (the free model or the local writer). 0 means no cap.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {(
                  [
                    ['houseUsd', 'Velocity’s own desk'],
                    ['customerUsd', 'Each Studio customer'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                    {label} ($ / month)
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={budgets[k]}
                      onChange={(e) => setBudgets({ ...budgets, [k]: num(e.target.value) })}
                      style={{ width: 140, padding: '8px 10px', borderRadius: 10, border: `1px solid ${colors.border}` }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: colors.muted }}>
                      <th style={{ padding: '6px 8px' }}>Workspace</th>
                      <th style={{ padding: '6px 8px' }}>Spent</th>
                      <th style={{ padding: '6px 8px' }}>Of budget</th>
                      <th style={{ padding: '6px 8px' }}>Calls</th>
                      <th style={{ padding: '6px 8px' }}>Pieces</th>
                      <th style={{ padding: '6px 8px' }}>Own budget ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const cap = r.wid === 'velocity' ? budgets.houseUsd : (budgets.perWorkspace[r.wid] ?? budgets.customerUsd);
                      const pct = cap > 0 ? Math.min(1, r.usd / cap) : 0;
                      return (
                        <tr key={r.wid} style={{ borderTop: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '8px', fontWeight: 700 }}>{r.name}</td>
                          <td style={{ padding: '8px' }}>{usd(r.usd)}</td>
                          <td style={{ padding: '8px', minWidth: 140 }}>
                            {cap > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 6, background: '#eef2ef', borderRadius: 99 }}>
                                  <div
                                    style={{
                                      width: `${pct * 100}%`,
                                      height: '100%',
                                      borderRadius: 99,
                                      background: pct >= 1 ? colors.danger : pct > 0.8 ? colors.warn : colors.success,
                                    }}
                                  />
                                </div>
                                <span style={{ color: colors.muted }}>{Math.round(pct * 100)}%</span>
                              </div>
                            ) : (
                              <span style={{ color: colors.muted }}>no cap</span>
                            )}
                          </td>
                          <td style={{ padding: '8px' }}>{r.calls.toLocaleString('en-PK')}</td>
                          <td style={{ padding: '8px' }}>{r.pieces ?? 0}</td>
                          <td style={{ padding: '8px' }}>
                            {r.wid === 'velocity' ? (
                              <span style={{ color: colors.muted }}>above</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                placeholder={String(budgets.customerUsd)}
                                value={budgets.perWorkspace[r.wid] ?? ''}
                                aria-label={`Budget for ${r.name}`}
                                onChange={(e) => {
                                  const per = { ...budgets.perWorkspace };
                                  if (e.target.value === '') delete per[r.wid];
                                  else per[r.wid] = num(e.target.value);
                                  setBudgets({ ...budgets, perWorkspace: per });
                                }}
                                style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: `1px solid ${colors.border}` }}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={6} style={{ padding: 8, color: colors.muted }}>
                          No AI calls recorded this month yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div>
                <Button disabled={saving} onClick={() => void saveBudgets()}>
                  {saving ? 'Saving…' : 'Save budgets'}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
