'use client';

/**
 * Velocity AI Studio → AI agents & billing (admins only).
 *
 * The whole business of selling AI agents in one place:
 *  - The phone line: the Twilio account (SID + token, proved before it is
 *    kept), its numbers, buying one, and giving each to a workspace's agent.
 *  - The rate card: what a minute, a number and a WhatsApp message cost us,
 *    and what we charge — with the margin worked out as you type.
 *  - Every client's month: their package, what they used, what it cost us,
 *    what they pay, and the margin. A package can be given here directly (a
 *    cash deal, a trial) or arrives through a payment on Payments · AI checked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { agentsApi, type AgentClientRow, type AgentNumber, type AgentPackage, type AgentRateCard, type AgentsOverview } from '@/lib/api';
import { Badge, Button, Card } from '@/components/ui';
import { FX_CSS } from '@/components/social/fx';

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n < 10 && n % 1 ? 2 : 0 })}`;
const date = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const input = { padding: '8px 10px', borderRadius: 10, border: `1px solid ${colors.border}`, fontSize: 14 } as const;

const COUNTRIES = [
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['AE', 'United Arab Emirates'],
] as const;

const COST_FIELDS: [keyof AgentRateCard['cost'], string][] = [
  ['callPerMin', 'Phone line, per minute (Twilio → Pakistani mobile)'],
  ['aiVoicePerMin', 'AI voice, per minute (Gemini Live)'],
  ['numberPerMonth', 'A phone number, per month'],
  ['waTemplate', 'WhatsApp template (marketing)'],
  ['waMessage', 'WhatsApp message (service / utility)'],
  ['aiReply', 'One AI-written WhatsApp reply'],
];
const PRICE_FIELDS: [keyof AgentRateCard['price'], string][] = [
  ['perAgentMonth', 'Per AI agent, per month'],
  ['perNumberMonth', 'Per phone number, per month'],
  ['perMin', 'Per call minute'],
  ['perWaMessage', 'Per WhatsApp message'],
];

/** The backend's quote, with costs — admins hold the whole card. */
function fullQuote(pkg: AgentPackage, card: AgentRateCard) {
  const minutes = Math.ceil(pkg.callsPerDay * 30 * pkg.avgCallMin);
  const price =
    pkg.agents * card.price.perAgentMonth +
    pkg.numbers * card.price.perNumberMonth +
    minutes * card.price.perMin +
    pkg.waMessagesPerMonth * card.price.perWaMessage;
  const cost =
    pkg.numbers * card.cost.numberPerMonth +
    minutes * (card.cost.callPerMin + card.cost.aiVoicePerMin) +
    pkg.waMessagesPerMonth * (0.2 * card.cost.waTemplate + 0.8 * card.cost.waMessage + card.cost.aiReply);
  return { minutes, price, cost, margin: price - cost, pct: price > 0 ? Math.round(((price - cost) / price) * 100) : 0 };
}

const START_PKG: AgentPackage = { agents: 1, numbers: 1, callsPerDay: 20, avgCallMin: 2, waMessagesPerMonth: 300 };

function PackageFields({ pkg, onChange }: { pkg: AgentPackage; onChange: (p: AgentPackage) => void }) {
  const f = (k: keyof AgentPackage, label: string, step = 1) => (
    <label key={k} style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={pkg[k]}
        onChange={(e) => onChange({ ...pkg, [k]: Math.max(0, Number(e.target.value) || 0) })}
        style={{ ...input, width: 110 }}
      />
    </label>
  );
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {f('agents', 'AI agents')}
      {f('numbers', 'Phone numbers')}
      {f('callsPerDay', 'Calls a day')}
      {f('avgCallMin', 'Minutes a call', 0.5)}
      {f('waMessagesPerMonth', 'WhatsApp a month', 50)}
    </div>
  );
}

function ClientRow({ c, card, onDone }: { c: AgentClientRow; card: AgentRateCard; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pkg, setPkg] = useState<AgentPackage>(c.plan ?? START_PKG);
  const [months, setMonths] = useState(1);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = fullQuote(pkg, card);
  const live = c.planLive;

  async function save(remove = false) {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.setPlan({ wid: c.id, package: remove ? null : pkg, months, ...(price ? { priceUsd: Number(price) } : {}) });
      onDone(remove ? `${c.name}: package removed.` : `${c.name}: package saved.`);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr style={{ borderTop: `1px solid ${colors.border}` }}>
        <td style={{ padding: 8 }}>
          <div style={{ fontWeight: 800 }}>{c.name}</div>
          <div style={{ color: colors.muted, fontSize: 12 }}>
            {c.agents.length ? c.agents.map((a) => `${a.name}${a.mode === 'ai' ? ' (AI dials)' : ''}`).join(', ') : 'No agents yet'}
          </div>
        </td>
        <td style={{ padding: 8 }}>
          {c.id === 'velocity' ? (
            <Badge label="House — no caps" color={colors.secondary} />
          ) : c.plan ? (
            <div>
              <Badge label={live ? 'Paid' : 'Lapsed'} color={live ? colors.success : colors.muted} />
              <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                {c.plan.callsPerDay}/day · {c.plan.numbers} no. · {usd(c.plan.priceUsd)} · to {date(c.plan.paidUntilMs)}
              </div>
            </div>
          ) : (
            <span style={{ color: colors.muted }}>No package</span>
          )}
        </td>
        <td style={{ padding: 8, fontSize: 13 }}>
          {c.usage.calls} calls · {Math.round(c.usage.seconds / 60)} min
          <div style={{ color: colors.muted, fontSize: 12 }}>
            WhatsApp {c.usage.waOut + c.usage.waTemplates} out / {c.usage.waIn} in · {c.numbers} number{c.numbers === 1 ? '' : 's'}
          </div>
        </td>
        <td style={{ padding: 8 }}>{usd(c.costUsd)}</td>
        <td style={{ padding: 8 }}>{usd(c.billUsd)}</td>
        <td style={{ padding: 8, fontWeight: 800, color: c.marginUsd < 0 ? colors.danger : colors.success }}>{usd(c.marginUsd)}</td>
        <td style={{ padding: 8 }}>
          {c.id !== 'velocity' ? (
            <Button variant="ghost" onClick={() => setOpen(!open)}>
              {open ? 'Close' : c.plan ? 'Change' : 'Give a package'}
            </Button>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} style={{ padding: '4px 8px 16px', background: '#fafcfb' }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <PackageFields pkg={pkg} onChange={setPkg} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                  Months paid now
                  <input type="number" min={0} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value) || 0)} style={{ ...input, width: 90 }} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                  Agreed price ($, optional)
                  <input type="number" min={0} placeholder={q.price.toFixed(2)} value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...input, width: 140 }} />
                </label>
                <div style={{ fontSize: 13 }}>
                  {q.minutes} min · price {usd(price ? Number(price) : q.price)} · our cost {usd(q.cost)} ·{' '}
                  <strong style={{ color: (price ? Number(price) : q.price) < q.cost ? colors.danger : colors.success }}>
                    margin {usd((price ? Number(price) : q.price) - q.cost)}
                  </strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button disabled={busy} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save package'}
                </Button>
                {c.plan ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
                    Remove package
                  </Button>
                ) : null}
              </div>
              {error ? <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function AgentsBillingPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<AgentsOverview | null>(null);
  const [card, setCard] = useState<AgentRateCard | null>(null);
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [country, setCountry] = useState('US');
  const [available, setAvailable] = useState<{ phone: string; place: string }[] | null>(null);
  const [pkg, setPkg] = useState<AgentPackage>(START_PKG);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await agentsApi.overview({});
      setData(d);
      setCard(d.card);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the agents.');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [isAdmin, load]);

  const q = useMemo(() => (card ? fullQuote(pkg, card) : null), [pkg, card]);
  const totals = useMemo(() => {
    const cs = data?.clients ?? [];
    return { cost: cs.reduce((s, c) => s + c.costUsd, 0), bill: cs.reduce((s, c) => s + c.billUsd, 0) };
  }, [data]);

  if (!isAdmin) return <p style={{ color: colors.muted }}>Admins only.</p>;

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const m = await fn();
      if (m) setNotice(m);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const assign = (n: AgentNumber, value: string) => {
    const [wid, agentId] = value ? value.split('|') : [null, null];
    return run(`assign-${n.sid}`, async () => {
      await agentsApi.numbers({ action: 'assign', sid: n.sid, wid: wid || null, agentId: agentId || null });
      return `${n.phone} ${wid ? 'given to the agent' : 'is free again'}.`;
    });
  };

  const agentOptions = (data?.clients ?? []).flatMap((c) => c.agents.map((a) => ({ value: `${c.id}|${a.id}`, label: `${c.name} — ${a.name}` })));

  return (
    <div className="fx" style={{ display: 'grid', gap: 18, maxWidth: 1180 }}>
      <style>{FX_CSS}</style>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>AI agents & billing</h1>
        <p style={{ color: colors.muted, margin: 0, maxWidth: 780 }}>
          The phone line your AI agents call from, what each minute and message costs you, what clients pay, and every client’s
          month with its margin.
        </p>
      </div>
      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, fontWeight: 700, margin: 0 }}>{notice}</p> : null}

      {!data || !card ? (
        <div className="fx-skel" style={{ height: 320, borderRadius: 20 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {[
              ['Phone line', data.twilio?.ok ? `Twilio · ${data.twilio.friendlyName}` : 'Not connected', data.twilio?.ok],
              ['Voice bridge', data.bridge ? 'Deployed — AI can talk on calls' : 'Not deployed yet', Boolean(data.bridge)],
              ['This month, clients pay', usd(totals.bill), true],
              ['This month, it costs you', usd(totals.cost), true],
            ].map(([label, value, ok]) => (
              <Card key={String(label)} style={{ padding: 16 }}>
                <div style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 6, color: ok ? colors.text : colors.danger }}>{value}</div>
              </Card>
            ))}
          </div>

          <Card style={{ display: 'grid', gap: 12 }}>
            <strong>Phone line (Twilio)</strong>
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
              Twilio calls Pakistani mobiles at about $0.18 a minute but does not rent Pakistani numbers. An agent calls from a
              Twilio number (US, UK…) — or from a client’s own number once it is verified in Twilio as a caller ID, which then
              shows here too.
            </p>
            {data.twilio?.ok ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge label="Connected" color={colors.success} />
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{data.twilio.accountSid}</span>
                <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void run('refresh', async () => void (await agentsApi.numbers({ action: 'refresh' })))}>
                  Refresh numbers
                </Button>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                Account SID
                <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="AC…" style={{ ...input, width: 300 }} />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                Auth token
                <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} style={{ ...input, width: 260 }} />
              </label>
              <Button
                disabled={Boolean(busy) || !data.vaultReady || !sid || !token}
                onClick={() =>
                  void run('twilio', async () => {
                    const r = await agentsApi.connectTwilio({ accountSid: sid.trim(), authToken: token.trim() });
                    setToken('');
                    return `Connected to ${r.friendlyName}: ${r.numbers.length} number${r.numbers.length === 1 ? '' : 's'} found.`;
                  })
                }
              >
                {busy === 'twilio' ? 'Checking…' : data.twilio ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
          </Card>

          {data.twilio?.ok ? (
            <Card style={{ display: 'grid', gap: 12 }}>
              <strong>Numbers</strong>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: colors.muted }}>
                      <th style={{ padding: '6px 8px' }}>Number</th>
                      <th style={{ padding: '6px 8px' }}>Kind</th>
                      <th style={{ padding: '6px 8px' }}>Calls for</th>
                      <th style={{ padding: '6px 8px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.numbers.map((n) => (
                      <tr key={n.sid} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td style={{ padding: 8, fontWeight: 700 }}>{n.phone}</td>
                        <td style={{ padding: 8 }}>{n.kind === 'twilio' ? 'Twilio number' : 'Own number (verified)'}</td>
                        <td style={{ padding: 8 }}>
                          <select
                            value={n.wid && n.agentId ? `${n.wid}|${n.agentId}` : ''}
                            disabled={Boolean(busy)}
                            onChange={(e) => void assign(n, e.target.value)}
                            style={{ ...input, minWidth: 240 }}
                            aria-label={`Who calls from ${n.phone}`}
                          >
                            <option value="">Nobody</option>
                            {agentOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: 8 }}>
                          {n.kind === 'twilio' ? (
                            <Button
                              variant="ghost"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                if (window.confirm(`Release ${n.phone}? Twilio takes it back and it cannot be bought again.`)) {
                                  void run('release', async () => {
                                    await agentsApi.numbers({ action: 'release', sid: n.sid });
                                    return `${n.phone} released.`;
                                  });
                                }
                              }}
                            >
                              Release
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {!data.numbers.length ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 8, color: colors.muted }}>
                          No numbers yet. Buy one below.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 700, color: colors.muted }}>
                  Buy a number in
                  <select value={country} onChange={(e) => setCountry(e.target.value)} style={input}>
                    {COUNTRIES.map(([c, name]) => (
                      <option key={c} value={c}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('search', async () => {
                      const r = await agentsApi.numbers({ action: 'search', country });
                      setAvailable(r.available ?? []);
                    })
                  }
                >
                  {busy === 'search' ? 'Searching…' : 'Find numbers'}
                </Button>
              </div>
              {available ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {available.length ? (
                    available.map((a) => (
                      <Button
                        key={a.phone}
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (window.confirm(`Buy ${a.phone}? Twilio bills it every month (about $${card.cost.numberPerMonth}).`)) {
                            void run('buy', async () => {
                              await agentsApi.numbers({ action: 'buy', phone: a.phone });
                              setAvailable(null);
                              return `${a.phone} bought. Give it to an agent above.`;
                            });
                          }
                        }}
                      >
                        {a.phone}
                        {a.place ? ` · ${a.place}` : ''}
                      </Button>
                    ))
                  ) : (
                    <span style={{ color: colors.muted }}>None on sale there right now.</span>
                  )}
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card style={{ display: 'grid', gap: 14 }}>
            <div>
              <strong>Rate card</strong>
              <p style={{ color: colors.muted, fontSize: 13, margin: '4px 0 0' }}>
                Left: what it costs you (published rates, October 2026 — change them when an invoice says otherwise). Right: what
                clients pay. Packages and every client’s bill are priced from this.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
              {(
                [
                  ['cost', 'What it costs you ($)', COST_FIELDS],
                  ['price', 'What clients pay ($)', PRICE_FIELDS],
                ] as const
              ).map(([side, title, fields]) => (
                <div key={side} style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
                  {fields.map(([k, label]) => (
                    <label key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', fontSize: 13 }}>
                      <span>{label}</span>
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        value={(card[side] as Record<string, number>)[k]}
                        onChange={(e) => setCard({ ...card, [side]: { ...card[side], [k]: Math.max(0, Number(e.target.value) || 0) } })}
                        style={{ ...input, width: 110 }}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              Rupees per dollar (what clients are asked to send)
              <input
                type="number"
                min={1}
                value={card.usdToPkr}
                onChange={(e) => setCard({ ...card, usdToPkr: Math.max(1, Number(e.target.value) || 1) })}
                style={{ ...input, width: 100 }}
              />
            </label>
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12, display: 'grid', gap: 10 }}>
              <strong style={{ fontSize: 14 }}>Try a package</strong>
              <PackageFields pkg={pkg} onChange={setPkg} />
              {q ? (
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 14 }}>
                  <span>{q.minutes.toLocaleString('en-PK')} minutes a month</span>
                  <span>
                    Client pays <strong>{usd(q.price)}</strong> (Rs {Math.round(q.price * card.usdToPkr).toLocaleString('en-PK')})
                  </span>
                  <span>Costs you {usd(q.cost)}</span>
                  <strong style={{ color: q.margin < 0 ? colors.danger : colors.success }}>
                    Margin {usd(q.margin)} ({q.pct}%)
                  </strong>
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('card', async () => {
                    await agentsApi.setRateCard(card);
                    return 'Rate card saved.';
                  })
                }
              >
                {busy === 'card' ? 'Saving…' : 'Save rate card'}
              </Button>
              <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setCard(data.defaults)}>
                Back to published rates
              </Button>
            </div>
          </Card>

          <Card style={{ display: 'grid', gap: 12 }}>
            <strong>Clients this month ({data.month})</strong>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted }}>
                    <th style={{ padding: '6px 8px' }}>Client</th>
                    <th style={{ padding: '6px 8px' }}>Package</th>
                    <th style={{ padding: '6px 8px' }}>Used</th>
                    <th style={{ padding: '6px 8px' }}>Costs you</th>
                    <th style={{ padding: '6px 8px' }}>Pays</th>
                    <th style={{ padding: '6px 8px' }}>Margin</th>
                    <th style={{ padding: '6px 8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <ClientRow key={c.id} c={c} card={card} onDone={(m) => void run('plan', async () => m)} />
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: colors.muted, fontSize: 12, margin: 0 }}>
              A client buys a package on their Sales page and pays on Billing; the payment waits for you on Payments · AI checked,
              like a plan. “Costs you” is calls, WhatsApp and the numbers they hold, from the rate card.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
