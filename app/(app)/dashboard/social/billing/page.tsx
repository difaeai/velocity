'use client';

/**
 * Velocity Studio → Plan & billing.
 *
 * Where a customer sees what they are on and until when, and pays. There is no
 * card gateway yet: they send the money to the receiving accounts on file
 * (the same `config/settlementAccounts` the driver top-ups use), then tell us
 * with the receipt screenshot and the transaction ID — both. Our AI reads the
 * receipt the moment it arrives; an admin checks the money arrived and
 * approves, and the month starts then.
 */

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import { agentPrice, agentsApi, studioApi, type AgentPackage, type AgentState, type StudioPaymentDoc } from '@/lib/api';
import {
  PKR_PER_USD,
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_YEAR_DISCOUNT_PCT,
  planIncludes,
  studioPaidAfter,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { Button, Card } from '@/components/ui';

interface ReceivingAccounts {
  easypaisaNumber?: string;
  jazzcashNumber?: string;
  bankName?: string;
  bankIban?: string;
  accountTitle?: string;
}

export default function BillingPage() {
  const { wid, ws } = useWorkspace();
  const [plan, setPlan] = useState<StudioPlanId | null>(null);
  const [billing, setBilling] = useState<StudioBilling>('month');
  const [accounts, setAccounts] = useState<ReceivingAccounts | null>(null);
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  const [txnId, setTxnId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // An AI agents package chosen on the Sales page arrives as ?agents=1&numbers=1&calls=20&min=2&wa=300.
  const [askedPkg, setAgentPkg] = useState<AgentPackage | null>(null);
  const [agentCard, setAgentCard] = useState<Pick<AgentState, 'price' | 'usdToPkr'> | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('agents')) return;
    const n = (k: string, d: number) => Math.max(0, Number(q.get(k)) || d);
    const t = setTimeout(
      () =>
        setAgentPkg({ agents: n('agents', 1), numbers: n('numbers', 1), callsPerDay: n('calls', 10), avgCallMin: n('min', 2), waMessagesPerMonth: n('wa', 0) }),
      0,
    );
    agentsApi
      .state({})
      .then((s) => setAgentCard({ price: s.price, usdToPkr: s.usdToPkr }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the agent prices.'));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'config', 'settlementAccounts'))
      .then((snap) => setAccounts((snap.data() as ReceivingAccounts | undefined) ?? {}))
      .catch(() => setAccounts({}));
  }, []);

  useEffect(() => {
    if (!wid) return;
    // Filtered by workspace only, sorted here: no composite index for a list this short.
    return onSnapshot(query(collection(db, 'studioPayments'), where('wid', '==', wid)), (snap) =>
      setPayments(
        snap.docs
          .map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id }))
          .sort((a, b) => b.createdAtMs - a.createdAtMs),
      ),
    );
  }, [wid]);

  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!wid || !ws) {
    return <p style={{ color: colors.muted }}>Billing is for Velocity Studio workspaces.</p>;
  }

  const chosen = plan ?? ws.plan;
  // The agents work from the Sales page, so only the plan with it can buy a package (the server says the same).
  const agentsOk = planIncludes(ws.plan, 'sales');
  const agentPkg = agentsOk ? askedPkg : null;
  const agentQuote = agentPkg && agentCard ? agentPrice(agentPkg, agentCard.price, agentCard.usdToPkr) : null;
  const amount = agentPkg ? (agentQuote?.usd ?? 0) : studioPriceUsd(chosen, billing);
  const amountPkr = agentPkg ? (agentQuote?.pkr ?? 0) : amount * PKR_PER_USD;
  const pending = payments.find((p) => p.status === 'pending');
  const until = Math.max(ws.trialEndsAtMs, ws.paidUntilMs);
  const live = nowMs > 0 && until > nowMs;
  const onTrial = ws.paidUntilMs <= nowMs && ws.trialEndsAtMs > nowMs;
  // Switching plans while days are still paid: say what those days become before anyone pays.
  const daysLeft = nowMs > 0 ? Math.floor((ws.paidUntilMs - nowMs) / 86_400_000) : 0;
  const switchUntil = !agentPkg && chosen !== ws.plan && daysLeft > 0 ? studioPaidAfter(ws, chosen, billing, nowMs) : null;

  async function send() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!file) throw new Error('Attach the receipt screenshot.');
      if (file.size > 10 * 1024 * 1024) throw new Error('That picture is over 10 MB.');
      const screenshotPath = `workspaces/${wid}/payments/${Date.now()}-${file.name.replace(/[^\w.-]/g, '')}`;
      await uploadBytes(ref(storage, screenshotPath), file, { contentType: file.type || 'image/jpeg' });
      await studioApi.submitPayment(
        agentPkg ? { agents: agentPkg, txnId: txnId.trim(), screenshotPath } : { plan: chosen, billing, txnId: txnId.trim(), screenshotPath },
      );
      setTxnId('');
      setFile(null);
      setNotice('Thank you — we will check the payment and switch your plan on, usually within a few hours.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px' }}>Plan &amp; billing</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          {ws.name} is on the <strong style={{ color: colors.text }}>{STUDIO_PLANS[ws.plan].name}</strong> plan —{' '}
          {nowMs === 0
            ? '…'
            : !live
              ? 'paused: nothing is paid for right now.'
              : onTrial
                ? `free trial until ${when(ws.trialEndsAtMs)}.`
                : `paid until ${when(ws.paidUntilMs)}.`}
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}
      {askedPkg && !agentsOk ? (
        <p style={{ color: colors.warn, margin: 0 }}>
          AI agents come with the Sales agents and Meta Ad Expert + Everything plans. Pay for one of them below first,
          then add the package from the Sales page.
        </p>
      ) : null}

      {agentPkg ? (
        <Card>
          <h2 style={h2}>1. Your AI agents package</h2>
          <p style={{ margin: '0 0 8px', fontSize: 14 }}>
            {agentPkg.agents} AI agent{agentPkg.agents === 1 ? '' : 's'} · {agentPkg.numbers} phone number{agentPkg.numbers === 1 ? '' : 's'} ·{' '}
            {agentPkg.callsPerDay} calls a day (about {agentQuote?.minutes.toLocaleString('en-PK') ?? '…'} minutes a month) ·{' '}
            {agentPkg.waMessagesPerMonth} WhatsApp messages — for 30 days.
          </p>
          <button
            type="button"
            onClick={() => setAgentPkg(null)}
            style={{ border: 'none', background: 'none', padding: 0, color: colors.secondary, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Pay for my Studio plan instead
          </button>
        </Card>
      ) : (
      <Card>
        <h2 style={h2}>1. Choose the plan to pay for</h2>
        <div role="radiogroup" aria-label="Pay for" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['month', 'year'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={billing === b}
              onClick={() => setBilling(b)}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: `${billing === b ? 2 : 1}px solid ${billing === b ? colors.primary : colors.border}`,
                background: colors.surface,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 800,
                color: colors.text,
              }}
            >
              {b === 'month' ? 'A month' : `A year — save ${STUDIO_YEAR_DISCOUNT_PCT}%`}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }} role="radiogroup">
          {STUDIO_PLAN_IDS.map((id) => {
            const p = STUDIO_PLANS[id];
            const on = id === chosen;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPlan(id)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 14,
                  border: `${on ? 2 : 1}px solid ${on ? colors.primary : colors.border}`,
                  background: colors.surface,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: colors.text,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                  <strong>{p.name}</strong>
                  <span style={{ marginLeft: 'auto', fontWeight: 900, fontSize: 18 }}>${studioPriceUsd(id, billing)}</span>
                  <span style={{ fontSize: 12, color: colors.muted }}>/{billing}</span>
                </span>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>
                  {p.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {switchUntil ? (
          <p style={{ margin: '12px 0 0', fontSize: 13.5, color: colors.muted, lineHeight: 1.5 }}>
            Your {daysLeft} day{daysLeft === 1 ? '' : 's'} left on {STUDIO_PLANS[ws.plan].name} carry over at what they are worth,
            on top of the {billing === 'year' ? 'year' : 'month'} you pay for now:{' '}
            <strong style={{ color: colors.text }}>
              {STUDIO_PLANS[chosen].name} until {when(switchUntil)}
            </strong>
            .
          </p>
        ) : null}
      </Card>
      )}

      <Card>
        <h2 style={h2}>
          2. Send ${amount} (about Rs {amountPkr.toLocaleString('en-PK')})
          {!agentPkg && billing === 'year' ? ` for a year — you save $${STUDIO_PLANS[chosen].usd * 12 - amount}` : ''}
        </h2>
        {accounts === null ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading where to pay…</p>
        ) : !accounts.easypaisaNumber && !accounts.jazzcashNumber && !accounts.bankIban ? (
          <p style={{ color: colors.warn, margin: 0 }}>
            Payment details are being set up. Email business@velocityrides.app and we will send them.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            {accounts.easypaisaNumber ? <Pay label="EasyPaisa" value={accounts.easypaisaNumber} title={accounts.accountTitle} /> : null}
            {accounts.jazzcashNumber ? <Pay label="JazzCash" value={accounts.jazzcashNumber} title={accounts.accountTitle} /> : null}
            {accounts.bankIban ? (
              <Pay label={accounts.bankName ? `Bank — ${accounts.bankName}` : 'Bank transfer'} value={accounts.bankIban} title={accounts.accountTitle} />
            ) : null}
          </div>
        )}
      </Card>

      <Card>
        <h2 style={h2}>3. Tell us you paid</h2>
        {pending ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            We have your payment for {pending.kind === 'agents' ? 'the ' : pending.billing === 'year' ? 'a year of the ' : 'the '}
            <strong>{pending.kind === 'agents' ? 'AI agents package' : `${STUDIO_PLANS[pending.plan].name} plan`}</strong>, sent{' '}
            {when(pending.createdAtMs)}. It is being checked — it switches on as soon as it is approved.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={label}>
              Receipt screenshot
              <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label style={label}>
              Transaction ID
              <input
                value={txnId}
                onChange={(e) => setTxnId(e.target.value)}
                placeholder="from the receipt, e.g. 0123456789"
                style={input}
              />
            </label>
            <div>
              <Button onClick={send} disabled={busy || !file || txnId.trim().length < 6 || (agentPkg !== null && !agentQuote)}>
                {busy
                  ? 'Sending — our AI is reading the receipt…'
                  : agentPkg
                    ? 'I paid for the AI agents package'
                    : `I paid for ${billing === 'year' ? 'a year of ' : ''}${STUDIO_PLANS[chosen].name}`}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {payments.length ? (
        <Card>
          <h2 style={h2}>Payments</h2>
          <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
            {payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ minWidth: 120 }}>{when(p.createdAtMs)}</span>
                <span style={{ flex: 1 }}>
                  {p.kind === 'agents' ? 'AI agents package' : STUDIO_PLANS[p.plan].name}
                  {p.billing === 'year' ? ' · a year' : ''} · ${p.amountUsd}
                  {p.txnId ? ` · ${p.txnId}` : ''}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: p.status === 'approved' ? colors.success : p.status === 'rejected' ? colors.danger : colors.warn,
                  }}
                >
                  {p.status === 'pending' ? 'Being checked' : p.status === 'approved' ? 'Approved' : 'Not received'}
                </span>
                {p.note ? <span style={{ width: '100%', color: colors.muted, fontSize: 12.5 }}>{p.note}</span> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Pay({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', padding: '8px 10px', borderRadius: 10, background: colors.bg }}>
      <span style={{ minWidth: 160, color: colors.muted, fontWeight: 700 }}>{label}</span>
      <code style={{ fontSize: 15, fontWeight: 800 }}>{value}</code>
      {title ? <span style={{ color: colors.muted }}>({title})</span> : null}
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const label: React.CSSProperties = { display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 800, color: colors.muted };
const input: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
};
