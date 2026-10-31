'use client';

/**
 * Velocity Studio → Checkout. What is being bought comes in the URL from the
 * Plans page — `?plan=content&billing=year`, `?credits=5`, or an AI agents
 * package from the Sales page (`?agents=1&numbers=1&calls=20&min=2&wa=300`).
 *
 * There is no card gateway yet: the customer sends the money to the receiving
 * accounts on file (the same `config/settlementAccounts` the driver top-ups
 * use), then tells us with the receipt screenshot and the transaction ID —
 * both. Our AI reads the receipt the moment it arrives; an admin checks the
 * money arrived and approves, and the plan (or the credits) starts then.
 */

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import {
  agentPrice,
  agentsApi,
  studioApi,
  studioPaymentLabel,
  type AgentPackage,
  type AgentState,
  type StudioPaymentDoc,
} from '@/lib/api';
import {
  PKR_PER_USD,
  STUDIO_CREDIT_DAY_USD,
  STUDIO_CREDIT_PACKS,
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_YEAR_DISCOUNT_PCT,
  planIncludes,
  studioPaidAfter,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import a from '../account.module.css';
import { FieldError, SkeletonRows, SuccessState } from '@/components/states';

interface ReceivingAccounts {
  easypaisaNumber?: string;
  jazzcashNumber?: string;
  bankName?: string;
  bankIban?: string;
  accountTitle?: string;
}

type Method = { key: string; label: string; value: string };

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const { wid, ws } = useWorkspace();
  const params = useSearchParams();
  const askedPlan = params.get('plan') as StudioPlanId | null;
  const askedCredits = Number(params.get('credits'));
  const [plan, setPlan] = useState<StudioPlanId | null>(askedPlan && STUDIO_PLAN_IDS.includes(askedPlan) ? askedPlan : null);
  const [billing, setBilling] = useState<StudioBilling>(params.get('billing') === 'year' ? 'year' : 'month');
  const [credits, setCredits] = useState<number | null>(
    (STUDIO_CREDIT_PACKS as readonly number[]).includes(askedCredits) ? askedCredits : null,
  );
  const [accounts, setAccounts] = useState<ReceivingAccounts | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  const [txnId, setTxnId] = useState('');
  const [tried, setTried] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentCard, setAgentCard] = useState<Pick<AgentState, 'price' | 'usdToPkr'> | null>(null);

  // An AI agents package chosen on the Sales page.
  const n = (k: string, d: number) => Math.max(0, Number(params.get(k)) || d);
  const askedPkg: AgentPackage | null = params.get('agents')
    ? { agents: n('agents', 1), numbers: n('numbers', 1), callsPerDay: n('calls', 10), avgCallMin: n('min', 2), waMessagesPerMonth: n('wa', 0) }
    : null;
  const wantsAgents = Boolean(askedPkg);

  useEffect(() => {
    if (!wantsAgents) return;
    agentsApi
      .state({})
      .then((s) => setAgentCard({ price: s.price, usdToPkr: s.usdToPkr }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the agent prices.'));
  }, [wantsAgents]);

  useEffect(() => {
    getDoc(doc(db, 'config', 'settlementAccounts'))
      .then((snap) => setAccounts((snap.data() as ReceivingAccounts | undefined) ?? {}))
      .catch(() => setAccounts({}));
  }, []);

  useEffect(() => {
    if (!wid) return;
    // Filtered by workspace only, sorted here: no composite index for a list this short.
    return onSnapshot(
      query(collection(db, 'studioPayments'), where('wid', '==', wid)),
      (snap) =>
        setPayments(
          snap.docs.map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id })).sort((x, y) => y.createdAtMs - x.createdAtMs),
        ),
      () => setPayments([]),
    );
  }, [wid]);

  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!wid || !ws) return <p className={a.muted}>Checkout is for Velocity Studio workspaces.</p>;

  // The agents work from the Sales page, so only a plan with it can buy a package (the server says the same).
  const agentPkg = askedPkg && planIncludes(ws.plan, 'sales') ? askedPkg : null;
  const agentQuote = agentPkg && agentCard ? agentPrice(agentPkg, agentCard.price, agentCard.usdToPkr) : null;
  const kind: 'agents' | 'credits' | 'plan' = agentPkg ? 'agents' : credits ? 'credits' : 'plan';
  // A workspace on a plan no longer sold (ads only) is offered the whole team.
  const chosen = plan ?? (STUDIO_PLAN_IDS.includes(ws.plan) ? ws.plan : 'all');
  const P = STUDIO_PLANS[chosen];
  const amount = kind === 'agents' ? (agentQuote?.usd ?? 0) : kind === 'credits' ? (credits ?? 0) * STUDIO_CREDIT_DAY_USD : studioPriceUsd(chosen, billing);
  const amountPkr = kind === 'agents' ? (agentQuote?.pkr ?? 0) : amount * PKR_PER_USD;
  const pending = payments.find((p) => p.status === 'pending');
  const paidNow = nowMs > 0 && ws.paidUntilMs > nowMs;
  const onTrial = nowMs > 0 && !paidNow && ws.trialEndsAtMs > nowMs;
  // Switching plans while days are still paid: say what those days become before anyone pays.
  const daysLeft = nowMs > 0 ? Math.floor((ws.paidUntilMs - nowMs) / 86_400_000) : 0;
  const switchUntil = kind === 'plan' && chosen !== ws.plan && daysLeft > 0 ? studioPaidAfter(ws, chosen, billing, nowMs) : null;

  const methods: Method[] = accounts
    ? [
        accounts.easypaisaNumber ? { key: 'ep', label: 'EasyPaisa', value: accounts.easypaisaNumber } : null,
        accounts.jazzcashNumber ? { key: 'jc', label: 'JazzCash', value: accounts.jazzcashNumber } : null,
        accounts.bankIban ? { key: 'bank', label: accounts.bankName ? `Bank — ${accounts.bankName}` : 'Bank transfer', value: accounts.bankIban } : null,
      ].filter((m): m is Method => m !== null)
    : [];
  const picked = methods.find((m) => m.key === method) ?? methods[0];

  const title =
    kind === 'agents' ? 'Your AI agents package' : kind === 'credits' ? 'Add credits' : chosen === ws.plan && paidNow ? `Renew ${P.name}` : `Upgrade to ${P.name}`;

  async function send() {
    // What is missing is said at its field, not by a button that stays grey.
    setTried(true);
    if (!ready) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!file) throw new Error('Attach the receipt screenshot.');
      if (file.size > 10 * 1024 * 1024) throw new Error('That picture is over 10 MB.');
      const screenshotPath = receiptPath(wid as string, file.name);
      await uploadBytes(ref(storage, screenshotPath), file, { contentType: file.type || 'image/jpeg' });
      const proof = { txnId: txnId.trim(), screenshotPath };
      await studioApi.submitPayment(
        kind === 'agents' && agentPkg
          ? { agents: agentPkg, ...proof }
          : kind === 'credits'
            ? { credits: credits ?? 0, ...proof }
            : { plan: chosen, billing, ...proof },
      );
      setTxnId('');
      setFile(null);
      setAgreed(false);
      setTried(false);
      setNotice('our team checks it, usually within a few hours. It switches on the moment it is approved, and you can follow it under Payments below.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  function copy(m: Method) {
    void navigator.clipboard?.writeText(m.value).then(() => {
      setCopied(m.key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const ready = Boolean(file) && txnId.trim().length >= 6 && agreed && amount > 0 && methods.length > 0;

  return (
    <div className={a.wrap}>
      <div className={a.checkout}>
        <section>
          <div className={a.colHead}>
            <Link href="/dashboard/social/upgrade" className={a.back}>
              ← All plans
            </Link>
            <h1 className={a.h1}>{title}</h1>
            <p className={a.lead}>
              {kind === 'credits'
                ? `$${STUDIO_CREDIT_DAY_USD} buys a day of your team's work. Days are used one at a time, only when your plan has run out or this month's AI work is used up.`
                : kind === 'agents'
                  ? 'AI calling and WhatsApp for 30 days, on top of your plan.'
                  : P.tagline}
            </p>
          </div>

          {askedPkg && !agentPkg ? (
            <p className={a.error}>
              AI agents come with the Sales agents and Meta Ad Expert + Everything plans. Pay for one of them first, then add the
              package from the Sales page.
            </p>
          ) : null}

          <h2 className={a.label}>{kind === 'credits' ? 'How many days' : kind === 'agents' ? 'Package' : 'Plan details'}</h2>
          {kind === 'plan' ? (
            <>
              <div className={a.options} role="radiogroup" aria-label="Billing">
                {(['month', 'year'] as const).map((b) => (
                  <button key={b} type="button" role="radio" aria-checked={billing === b} className={a.option} onClick={() => setBilling(b)}>
                    {b === 'year' ? <em>Save {STUDIO_YEAR_DISCOUNT_PCT}%</em> : null}
                    <b>{b === 'month' ? 'Monthly' : 'Yearly'}</b>
                    <span>
                      ${studioPriceUsd(chosen, b)} · billed {b === 'month' ? 'every 30 days' : 'once for 365 days'}
                    </span>
                  </button>
                ))}
              </div>
              <div className={a.options} role="radiogroup" aria-label="Plan" style={{ marginTop: 12 }}>
                {STUDIO_PLAN_IDS.map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={id === chosen} className={a.option} onClick={() => setPlan(id)}>
                    <b>{STUDIO_PLANS[id].name}</b>
                    <span>${studioPriceUsd(id, billing)} / {billing}</span>
                  </button>
                ))}
              </div>
            </>
          ) : kind === 'credits' ? (
            <div className={a.options} role="radiogroup" aria-label="Credits">
              {STUDIO_CREDIT_PACKS.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={credits === d} className={a.option} onClick={() => setCredits(d)}>
                  <b>{d} days</b>
                  <span>${d * STUDIO_CREDIT_DAY_USD} · ${STUDIO_CREDIT_DAY_USD} a day</span>
                </button>
              ))}
            </div>
          ) : agentPkg ? (
            <div className={a.box}>
              <p style={{ fontSize: 14, lineHeight: 1.55 }}>
                {agentPkg.agents} AI agent{agentPkg.agents === 1 ? '' : 's'} · {agentPkg.numbers} phone number
                {agentPkg.numbers === 1 ? '' : 's'} · {agentPkg.callsPerDay} calls a day (about{' '}
                {agentQuote?.minutes.toLocaleString('en-PK') ?? '…'} minutes a month) · {agentPkg.waMessagesPerMonth} WhatsApp
                messages — for 30 days.
              </p>
            </div>
          ) : null}

          <h2 className={a.label}>Payment method</h2>
          {accounts === null ? (
            <SkeletonRows rows={2} />
          ) : !methods.length ? (
            <p className={a.error}>Payment details are being set up. Email business@velocityrides.app and we will send them.</p>
          ) : (
            <div className={a.box}>
              <div className={a.methods} role="radiogroup" aria-label="Pay with">
                {methods.map((m) => (
                  <button key={m.key} type="button" role="radio" aria-checked={picked?.key === m.key} className={a.method} onClick={() => setMethod(m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>
              {picked ? (
                <div className={a.account}>
                  <span>
                    <small>Send Rs {amountPkr.toLocaleString('en-PK')} to</small>
                    <code>{picked.value}</code>
                    {accounts.accountTitle ? <small>{accounts.accountTitle}</small> : null}
                  </span>
                  <button type="button" className={a.copy} onClick={() => copy(picked)}>
                    {copied === picked.key ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          <h2 className={a.label}>Proof of payment</h2>
          {pending ? (
            <div className={a.box}>
              <p style={{ fontSize: 14, lineHeight: 1.55 }}>
                We have your payment for <strong>{studioPaymentLabel(pending, `the ${STUDIO_PLANS[pending.plan].name} plan`)}</strong>,
                sent {when(pending.createdAtMs)}. It is being checked — it switches on as soon as it is approved.
              </p>
            </div>
          ) : (
            <div className={a.box}>
              <label className={`${a.drop} ${file ? a.dropDone : ''}`} style={{ position: 'relative' }}>
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <b>{file ? `✓ ${file.name}` : 'Add the receipt screenshot'}</b>
                <span>{file ? 'Tap to choose a different picture' : 'A photo or screenshot of the transfer, up to 10 MB'}</span>
              </label>
              <FieldError message={tried && !file ? 'Add the screenshot of your transfer receipt — a photo of the screen is fine.' : null} />
              <label className={a.field}>
                Transaction ID
                <input
                  className={a.input}
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                  placeholder="From the receipt, e.g. 0123456789"
                  aria-invalid={tried && txnId.trim().length < 6}
                  aria-describedby="txn-error"
                />
              </label>
              <FieldError
                id="txn-error"
                message={tried && txnId.trim().length < 6 ? 'Type the transaction ID printed on the receipt — at least 6 characters.' : null}
              />
            </div>
          )}
        </section>

        <aside className={a.order} aria-label="Order">
          <h2 className={a.orderTitle}>
            {kind === 'credits' ? `${credits} days of work` : kind === 'agents' ? 'AI agents' : `${P.name} plan`}
          </h2>
          <div className={a.lines}>
            <h3>Order details</h3>
            <div className={a.line}>
              <span>
                {kind === 'credits' ? 'Credits' : kind === 'agents' ? 'AI agents package' : P.name}
                <small>
                  {kind === 'credits'
                    ? `${credits} days × $${STUDIO_CREDIT_DAY_USD}`
                    : kind === 'agents'
                      ? '30 days'
                      : billing === 'year'
                        ? `365 days · you save $${P.usd * 12 - amount}`
                        : '30 days'}
                </small>
              </span>
              <span>${amount}</span>
            </div>
            {switchUntil ? (
              <div className={a.line}>
                <span>
                  Days you already paid for
                  <small>
                    {daysLeft} day{daysLeft === 1 ? '' : 's'} of {STUDIO_PLANS[ws.plan].name} carry over — {P.name} until {when(switchUntil)}
                  </small>
                </span>
                <span>$0</span>
              </div>
            ) : null}
            <div className={`${a.line} ${a.total}`}>
              <span>Total due today</span>
              <span>
                ${amount} · Rs {amountPkr.toLocaleString('en-PK')}
              </span>
            </div>
          </div>

          <p className={a.info}>
            {kind === 'credits'
              ? 'Each day your team works on credit shows as $1 on your Usage page. Unused days stay on your balance.'
              : kind === 'agents'
                ? 'The package starts when the payment is approved and runs for 30 days.'
                : onTrial
                  ? 'Your free trial keeps running until the payment is approved. Then your paid time starts — nothing stops in between.'
                  : 'Paying early never loses a day: the new time is added to the end of what you already have.'}
          </p>

          {error ? <p className={a.error}>{error}</p> : null}
          {notice ? (
            <SuccessState
              title="Payment sent — thank you!"
              reassurance="Your receipt and transaction ID reached us. There is nothing else you need to do."
              next={notice}
            />
          ) : null}

          {pending ? null : (
            <>
              <label className={a.agree}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>
                  I sent Rs {amountPkr.toLocaleString('en-PK')} to the account shown, and the receipt and transaction ID above are
                  from that transfer.
                </span>
              </label>
              <FieldError message={tried && !agreed ? 'Tick this to confirm the transfer is yours.' : null} />
              <button type="button" className={a.btn} onClick={send} disabled={busy || amount <= 0 || methods.length === 0}>
                {busy ? <span className={a.spinner} aria-hidden /> : null}
                {busy ? 'Sending — our AI is reading the receipt…' : 'Submit payment'}
              </button>
            </>
          )}
        </aside>
      </div>

      {payments.length ? (
        <section className={a.card}>
          <h2 className={a.cardTitle}>Payments</h2>
          <ul className={a.history}>
            {payments.map((p) => (
              <li key={p.id}>
                <time>{when(p.createdAtMs)}</time>
                <span style={{ flex: 1 }}>
                  {studioPaymentLabel(p, STUDIO_PLANS[p.plan].name)}
                  {p.billing === 'year' ? ' · a year' : ''} · ${p.amountUsd}
                  {p.txnId ? ` · ${p.txnId}` : ''}
                  {p.note ? <span className={a.muted} style={{ display: 'block' }}>{p.note}</span> : null}
                </span>
                <span
                  className={a.status}
                  style={{ color: p.status === 'approved' ? '#047857' : p.status === 'rejected' ? '#ba1a1a' : '#b45309' }}
                >
                  {p.status === 'pending' ? 'Being checked' : p.status === 'approved' ? 'Approved' : 'Not received'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Where a receipt is uploaded: under the workspace, where the server checks it came from. */
const receiptPath = (wid: string, name: string) => `workspaces/${wid}/payments/${Date.now()}-${name.replace(/[^\w.-]/g, '')}`;

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
