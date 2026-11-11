'use client';

/**
 * Velocity Studio's first run, once there is an account: prove the email, pay
 * for a plan — or take the free day instead — describe the business, say which
 * networks you post on, and the console opens.
 *
 * Signing in and signing up live at /studio/login and /studio/signup; anyone
 * who reaches this page signed out is sent there with their plan. Google
 * sign-in arrives verified. An email-and-password account gets a six-digit code
 * by email and types it here; the backend refuses a workspace (and its free
 * day) to an address nobody proved.
 *
 * Paying comes before the business (owner, 2026-11-10): the receipt and the
 * transaction ID go to `studioSubmitPayment` with no workspace yet, a person
 * approves it, and the workspace made afterwards starts on that plan, paid, with
 * no trial. The free day is the way past paying.
 *
 * The pay step shows what the money buys before it asks for any: Vexa herself,
 * the three plans as small boxes with their reels and the networks each works
 * on, and then the two ways to pay — a transfer to the company's bank account,
 * or a card from any country through Stripe Checkout. The mobile wallets are
 * the rides side's, not Vexa's (owner, 2026-11-11). The card is offered only
 * while the admin's Receiving accounts page says `cardLive`; until then it says
 * "Opening soon" rather than pretending. A card needs no admin — it comes back
 * approved. A transfer leaves the page here on "thank you — waiting for your
 * transaction to be confirmed" until a person approves it.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { auth, db, storage } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { SOCIAL_PLATFORMS, studioApi, type SocialPlatform, type StudioPaymentDoc } from '@/lib/api';
import { useStudioMoney } from '@/lib/useStudioMoney';
import { useStudioPriceRaised } from '@/lib/useStudioPriceRaised';
import {
  STUDIO_BANK_TITLE,
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_TRIAL_HOURS,
  STUDIO_YEAR_DISCOUNT_PCT,
  studioPriceUsd,
  studioUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { VelocityIcon } from '@/components/BrandMark';
import { useReducedMotion, useSaveData } from '@/components/site/useReducedMotion';
import { FieldError } from '@/components/states';
import { PLATFORM_META } from '@/components/social/shared';
import { carried } from '../StudioAuth';
import s from '../auth.module.css';
import a from '../../dashboard/social/account.module.css';

const STAGES = ['Account', 'Verify email', 'Pay or try', 'Your business', 'Platforms'];

/** The five answers that become the team's brief. */
interface Brand {
  businessName: string;
  what: string;
  audience: string;
  market: string;
  language: string;
  differences: string;
  website: string;
}

export default function StudioStartPage() {
  return (
    <Suspense fallback={null}>
      <Start />
    </Suspense>
  );
}

function Start() {
  const { user, isAdmin, workspaceId, initializing, signOut } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const keep = carried(params);
  const asked = params.get('plan');
  const [plan, setPlan] = useState<StudioPlanId>(
    STUDIO_PLAN_IDS.includes(asked as StudioPlanId) ? (asked as StudioPlanId) : 'all',
  );
  const [billing, setBilling] = useState<StudioBilling>(params.get('billing') === 'year' ? 'year' : 'month');
  // The token's own flag only changes after a refresh; this carries the moment between.
  const [verifiedNow, setVerifiedNow] = useState(false);
  const verified = Boolean(user?.emailVerified) || verifiedNow;
  // "Try it free" instead of paying; the business answers, kept until the platforms are picked.
  const [trial, setTrial] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);

  useEffect(() => {
    if (initializing) return;
    if (!user) router.replace(`/studio/signup${keep}`);
    else if (workspaceId) router.replace('/dashboard/social');
  }, [initializing, user, workspaceId, keep, router]);

  // Puts someone who has not finished on the admin's Users list.
  const uid = user?.uid;
  useEffect(() => {
    if (uid && !isAdmin && !workspaceId) studioApi.touch({}).catch(() => undefined);
  }, [uid, isAdmin, workspaceId]);

  // The payment sent here, before any workspace: the page moves on by itself when it is approved.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'studioPayments'), where('uid', '==', uid)),
      (snap) => setPayments(snap.docs.map((d) => ({ ...(d.data() as StudioPaymentDoc), id: d.id }))),
      () => setPayments([]),
    );
  }, [uid]);
  const prepay = payments.filter((p) => p.wid === null).sort((x, y) => y.createdAtMs - x.createdAtMs)[0] ?? null;
  const paid = prepay?.status === 'approved' ? prepay : null;

  const stage = !verified ? 2 : !(paid || trial) ? 3 : !brand ? 4 : 5;

  return (
    <main className={`${s.page} ${s.single}`}>
      <section className={s.side}>
        <header className={s.top}>
          <Link href="/" className={s.brand}>
            <VelocityIcon size={32} />
            Vexa
          </Link>
          {user ? (
            <button type="button" className={s.topLink} style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={signOut}>
              Log out
            </button>
          ) : null}
        </header>

        <div className={s.center}>
          {initializing || !user || workspaceId ? null : (
            <div className={`${s.inner} ${s.wide}`}>
              <ol className={s.steps} aria-label="Getting started">
                {STAGES.map((label, i) => {
                  const n = i + 1;
                  const state = n < stage ? s.stepDone : n === stage ? s.stepOn : '';
                  return (
                    <li key={label} className={`${s.step} ${state}`} aria-current={n === stage ? 'step' : undefined}>
                      <span className={s.stepNum}>{n < stage ? '✓' : n}</span>
                      {label}
                    </li>
                  );
                })}
              </ol>

              {isAdmin ? (
                <div className={s.card}>
                  <p>
                    You are signed in as a Velocity admin. Velocity&apos;s own desk is in the console; to try Studio, log
                    out and sign up with a different account.
                  </p>
                  <Link href="/dashboard/social" className={s.primary}>
                    Open the console
                  </Link>
                </div>
              ) : stage === 2 ? (
                <VerifyCard email={user.email} onVerified={() => setVerifiedNow(true)} onSignOut={signOut} />
              ) : stage === 3 ? (
                prepay?.status === 'pending' ? (
                  <WaitingCard payment={prepay} />
                ) : params.get('paid') === 'card' && !prepay ? (
                  // Back from Stripe a moment before its webhook lands; the listener above moves on by itself.
                  <CardWaitCard onGiveUp={() => router.replace(`/studio/start${keep}`)} />
                ) : (
                  <PayCard
                    uid={user.uid}
                    plan={plan}
                    onPlan={setPlan}
                    billing={billing}
                    onBilling={setBilling}
                    rejected={prepay?.status === 'rejected' ? prepay : null}
                    onTrial={() => setTrial(true)}
                  />
                )
              ) : stage === 4 ? (
                <BusinessCard plan={paid?.plan ?? plan} onPlan={paid ? null : setPlan} email={user.email} onSignOut={signOut} onDone={setBrand} />
              ) : (
                <PlatformsCard brand={brand as Brand} plan={paid?.plan ?? plan} billing={paid?.billing ?? billing} paid={Boolean(paid)} onBack={() => setBrand(null)} />
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** The emailed code: sent once on arrival, typed here, and the address is proved. */
function VerifyCard({ email, onVerified, onSignOut }: { email: string | null; onVerified: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const asked = useRef(false);

  async function send() {
    setError(null);
    try {
      const res = await studioApi.sendEmailCode({});
      if (res.alreadyVerified) {
        await refresh();
        return;
      }
      setSentAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not send the code.');
      // "A code is on its way" — one was sent a moment ago, so the wait still applies.
      if (/on its way/.test(String((e as Error).message))) setSentAt(Date.now());
    }
  }

  async function refresh() {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    onVerified();
  }

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const wait = sentAt && nowMs ? Math.max(0, 45 - Math.floor((nowMs - sentAt) / 1000)) : 0;

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await studioApi.verifyEmailCode({ code: code.trim() });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
      setBusy(false);
    }
  }

  return (
    <div className={s.card} style={{ maxWidth: 440, justifySelf: 'center', width: '100%' }}>
      <div className={s.head}>
        <h1 className={s.title} style={{ fontSize: 30 }}>
          Check your email
        </h1>
        <p className={s.sub}>
          {sentAt ? (
            <>
              We sent a 6-digit code to <strong style={{ color: '#1c1b1b' }}>{email}</strong>. It works for 10 minutes.
            </>
          ) : (
            <>Sending a code to {email}…</>
          )}
        </p>
      </div>
      <form
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6 && !busy) void verify();
        }}
      >
        <input
          className={`${s.input} ${s.code}`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          placeholder="••••••"
          autoFocus
        />
        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.primary} disabled={busy || code.length !== 6}>
          {busy ? <span className={s.spinner} aria-hidden /> : null}
          {busy ? 'Checking…' : 'Verify and continue'}
        </button>
      </form>
      <div className={s.row}>
        <button type="button" onClick={send} disabled={wait > 0} className={s.link}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
        <button type="button" onClick={onSignOut} className={s.link}>
          Use a different email
        </button>
      </div>
    </div>
  );
}

/** Only the bank account: Vexa is not paid by mobile wallet (owner, 2026-11-11). */
interface ReceivingAccounts {
  bankName?: string;
  bankIban?: string;
  /** Admin → Receiving accounts: whether a card may be offered at all (the Stripe keys are a deploy secret). */
  cardLive?: boolean;
}

/** The reel each plan is sold with, without its extension: `.mp4` plays, `.jpg` is its poster. The pricing page shows the same three. */
const PLAN_FILM: Record<string, string> = {
  research: '/site/plan-ads',
  content: '/site/plan-content',
  all: '/site/plan-all',
};
/** A short name for the box; the full plan name is spelled out under the three. */
const PLAN_SHORT: Record<string, string> = { research: 'Research', content: 'Content', all: 'Whole team' };
/** The networks a plan works on, as the logo files in /site/logos. */
const PLAN_LOGOS: Record<string, string[]> = {
  research: ['instagram', 'facebook', 'google'],
  content: ['instagram', 'facebook', 'youtube', 'tiktok'],
  all: ['facebook', 'instagram', 'google-ads', 'youtube', 'tiktok', 'gmail'],
};

/* ── the marks on the ways to pay: a few paths, so no logo files ship ───── */

function BankMark() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9.5 12 4.2l9 5.3" />
      <path d="M5.2 10.4v7.4M9.7 10.4v7.4M14.3 10.4v7.4M18.8 10.4v7.4" />
      <path d="M3.2 20.3h17.6" />
    </svg>
  );
}

function CardMark() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.6" y="5.2" width="18.8" height="13.6" rx="3" />
      <path d="M2.6 10h18.8" />
      <path d="M6.2 14.8h3.4" />
    </svg>
  );
}

function VisaMark() {
  return (
    <svg viewBox="0 0 48 32" width={40} height={27} role="img" aria-label="Visa">
      <rect x="0.5" y="0.5" width="47" height="31" rx="5" fill="#fff" stroke="#e2e8e4" />
      <text x="24" y="21.5" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="13.5" fontStyle="italic" fontWeight="700" fill="#1a1f71">
        VISA
      </text>
    </svg>
  );
}

function MastercardMark() {
  return (
    <svg viewBox="0 0 48 32" width={40} height={27} role="img" aria-label="Mastercard">
      <rect x="0.5" y="0.5" width="47" height="31" rx="5" fill="#fff" stroke="#e2e8e4" />
      <circle cx="20.5" cy="16" r="8" fill="#eb001b" />
      <circle cx="27.5" cy="16" r="8" fill="#f79e1b" />
      <path d="M24 10.2a8 8 0 0 0 0 11.6 8 8 0 0 0 0-11.6Z" fill="#ff5f00" />
    </svg>
  );
}

/** The three plans as small boxes, each with its reel and the networks it works on, so the money has a picture against it. */
function PlanBoxes({
  plan,
  onPlan,
  billing,
  raised,
  still,
}: {
  plan: StudioPlanId;
  onPlan: (p: StudioPlanId) => void;
  billing: StudioBilling;
  raised: boolean;
  still: boolean;
}) {
  return (
    <div className={s.planBoxes} role="radiogroup" aria-label="Plan">
      {STUDIO_PLAN_IDS.map((id) => {
        const on = id === plan;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} className={`${s.planBox} ${on ? s.planBoxOn : ''}`} onClick={() => onPlan(id)}>
            <span className={s.boxFilm} aria-hidden>
              {on && !still ? (
                <video autoPlay muted loop playsInline poster={`${PLAN_FILM[id]}.jpg`}>
                  <source src={`${PLAN_FILM[id]}.mp4`} type="video/mp4" />
                </video>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${PLAN_FILM[id]}.jpg`} alt="" />
              )}
              <span className={s.boxTick} aria-hidden>
                ✓
              </span>
            </span>
            <b className={s.boxName}>{PLAN_SHORT[id]}</b>
            <span className={s.boxCost}>
              {studioUsd(studioPriceUsd(id, billing, raised))}
              <small>/{billing === 'year' ? 'year' : 'month'}</small>
            </span>
            <span className={s.boxLogos} aria-hidden>
              {PLAN_LOGOS[id].map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f} src={`/site/logos/${f}.svg`} alt="" width={16} height={16} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pay for the plan now — a bank transfer and its receipt, as the Billing page takes them — or take the free day instead. */
function PayCard({
  uid,
  plan,
  onPlan,
  billing,
  onBilling,
  rejected,
  onTrial,
}: {
  uid: string;
  plan: StudioPlanId;
  onPlan: (p: StudioPlanId) => void;
  billing: StudioBilling;
  onBilling: (b: StudioBilling) => void;
  rejected: StudioPaymentDoc | null;
  onTrial: () => void;
}) {
  const raised = useStudioPriceRaised();
  const money = useStudioMoney();
  const reduced = useReducedMotion();
  const saving = useSaveData();
  const still = reduced || saving;
  const [accounts, setAccounts] = useState<ReceivingAccounts | null>(null);
  /** Bank transfer, or a card — the card gateway is not open yet, so picking it says so. */
  const [how, setHow] = useState<'transfer' | 'card'>('transfer');
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [txnId, setTxnId] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'config', 'settlementAccounts'))
      .then((snap) => setAccounts((snap.data() as ReceivingAccounts | undefined) ?? {}))
      .catch(() => setAccounts({}));
  }, []);

  const amount = studioPriceUsd(plan, billing, raised);
  const local = money(amount);
  // The transfer itself is named in money that is owed to the penny: rupees here, dollars where the local figure is only a guide.
  const owed = local.exact ? local.text : studioUsd(amount);
  const iban = accounts?.bankIban ?? null;
  const ready = Boolean(file) && txnId.trim().length >= 6 && agreed && Boolean(iban);

  function copy() {
    if (!iban) return;
    void navigator.clipboard?.writeText(iban).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function payByCard() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await studioApi.cardCheckout({ plan, billing, where: 'start' });
      // Stripe's own page; it brings them back to ?paid=card, where the webhook has usually landed already.
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The card page would not open. Pay by bank transfer instead.');
      setBusy(false);
    }
  }

  async function send() {
    // What is missing is said at its field, not by a button that stays grey.
    setTried(true);
    if (!ready || !file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('That picture is over 10 MB.');
      const screenshotPath = `studioSignup/${uid}/payments/${Date.now()}-${file.name.replace(/[^\w.-]/g, '')}`;
      await uploadBytes(ref(storage, screenshotPath), file, { contentType: file.type || 'image/jpeg' });
      await studioApi.submitPayment({ plan, billing, txnId: txnId.trim(), screenshotPath });
      // The listener on studioPayments keeps this page here, on "thank you — waiting for confirmation".
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.vexaSays}>
        <span className={s.vexaFig} aria-hidden>
          {/* A cut-out with its own alpha: next/image would only re-encode it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
        </span>
        <p className={s.vexaBubble}>
          Hi, I&rsquo;m <b>Vexa</b>. Here is what you are buying — pick your plan, send the money, and I start work the
          moment it is approved.
        </p>
      </div>

      {rejected ? (
        <p className={s.error} role="alert">
          Your last payment was not received{rejected.note ? `: ${rejected.note}` : ''}. Send it again, or try Vexa free first.
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: 4 }}>
        <h1 className={s.cardTitle} style={{ fontSize: 24 }}>
          What you are buying
        </h1>
        <p className={s.signedAs}>Three plans. Tap one to see what it does for you.</p>
      </div>

      <PlanBoxes plan={plan} onPlan={onPlan} billing={billing} raised={raised} still={still} />

      <div key={plan} className={s.gets}>
        <b>{STUDIO_PLANS[plan].name}</b>
        <ul>
          {STUDIO_PLANS[plan].includes.slice(0, 5).map((line) => (
            <li key={line}>
              <span className={s.getsTick} aria-hidden>
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className={s.field} role="radiogroup" aria-label="Billing">
        Billing
        <div className={s.plans}>
          {(['month', 'year'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={billing === b} className={s.planChip} onClick={() => onBilling(b)}>
              {b === 'month' ? 'Monthly' : `Yearly — save ${STUDIO_YEAR_DISCOUNT_PCT}%`}
            </button>
          ))}
        </div>
      </div>

      <div className={s.total}>
        <span>To pay today</span>
        <strong key={`${plan}-${billing}`}>
          {local.exact ? local.text : `about ${local.text}`}
          <small>
            {studioUsd(amount)} for {billing === 'year' ? 'a year' : '30 days'}
          </small>
        </strong>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        <h2 className={s.cardTitle} style={{ fontSize: 20 }}>
          Pay for your plan
        </h2>
        <p className={s.signedAs}>Two ways to pay. A person approves it, usually within a few hours, and your plan starts then.</p>
      </div>

      <div className={s.payWays} role="radiogroup" aria-label="How to pay">
        <button
          type="button"
          role="radio"
          aria-checked={how === 'transfer'}
          className={`${s.payWay} ${how === 'transfer' ? s.payWayOn : ''}`}
          onClick={() => setHow('transfer')}
        >
          <span className={s.wayIcon} aria-hidden>
            <BankMark />
          </span>
          <b>Bank transfer</b>
          <small>Send it from your bank app, then upload the receipt</small>
        </button>
        <button type="button" role="radio" aria-checked={how === 'card'} className={`${s.payWay} ${how === 'card' ? s.payWayOn : ''}`} onClick={() => setHow('card')}>
          <span className={s.wayIcon} aria-hidden>
            <CardMark />
          </span>
          <b>
            Debit or credit card {accounts?.cardLive ? null : <i className={s.soon}>Opening soon</i>}
          </b>
          <small>Pay online in one go, no receipt to upload</small>
          <span className={s.wayMarks} aria-hidden>
            <VisaMark />
            <MastercardMark />
          </span>
        </button>
      </div>

      {how === 'card' && accounts?.cardLive ? (
        <div className={s.soonBox}>
          <span className={s.soonArt} aria-hidden>
            <VisaMark />
            <MastercardMark />
          </span>
          <b>Pay {studioUsd(amount)} by card</b>
          <p>
            Stripe takes the payment on its own page, so we never see your card. Any country&rsquo;s Visa or Mastercard
            works, your bank converts from dollars, and your plan starts the moment it goes through — nobody to wait
            for.
          </p>
          <button type="button" className={s.primary} disabled={busy} onClick={() => void payByCard()}>
            {busy ? 'Opening the card page…' : `Pay ${studioUsd(amount)} by card`}
          </button>
          {error ? (
            <p className={s.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : how === 'card' ? (
        <div className={s.soonBox}>
          <span className={s.soonArt} aria-hidden>
            <VisaMark />
            <MastercardMark />
          </span>
          <b>Card payments are not open yet</b>
          <p>
            We are finishing the card gateway with our bank. Until it is live, send the money by bank transfer — it is
            approved the same day and your plan starts from that moment.
          </p>
          <button type="button" className={s.primary} onClick={() => setHow('transfer')}>
            Pay by bank transfer
          </button>
        </div>
      ) : (
        <>
          <div className={s.field}>
            Send {owed} to
            {accounts === null ? (
              <p className={s.sub}>Loading the receiving account…</p>
            ) : !iban ? (
              <p className={s.error}>Payment details are being set up. Email business@velocityrides.app and we will send them — or try Vexa free below.</p>
            ) : (
              <div className={s.acct}>
                <span>
                  <small className={s.acctBank}>
                    <BankMark />
                    {accounts.bankName ?? 'Bank transfer'}
                  </small>
                  <code>{iban}</code>
                  <small>{STUDIO_BANK_TITLE}</small>
                </span>
                <button type="button" className={s.copyBtn} onClick={copy}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <label className={`${a.drop} ${file ? a.dropDone : ''}`} style={{ position: 'relative' }}>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className={s.dropArt} aria-hidden>
              <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
                <path d="M3.9 16.2 8.6 11.6l3.5 3.4 2.8-2.6 5.2 4.6" />
                <circle cx="9" cy="8.6" r="1.6" />
              </svg>
            </span>
            <b>{file ? `✓ ${file.name}` : 'Add the receipt screenshot'}</b>
            <span>{file ? 'Tap to choose a different picture' : 'A photo or screenshot of the transfer, up to 10 MB'}</span>
          </label>
          <FieldError message={tried && !file ? 'Add the screenshot of your transfer receipt — a photo of the screen is fine.' : null} />
          <label className={s.field}>
            Transaction ID
            <input
              className={s.input}
              value={txnId}
              onChange={(e) => setTxnId(e.target.value)}
              placeholder="From the receipt, e.g. 0123456789"
              aria-invalid={tried && txnId.trim().length < 6}
              aria-describedby="start-txn-error"
            />
            <FieldError id="start-txn-error" message={tried && txnId.trim().length < 6 ? 'Type the transaction ID printed on the receipt — at least 6 characters.' : null} />
          </label>
          <label className={a.agree}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>I sent {owed} to the account shown, and the receipt and transaction ID above are from that transfer.</span>
          </label>
          <FieldError message={tried && !agreed ? 'Tick this to confirm the transfer is yours.' : null} />
          {error ? (
            <p className={s.error} role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className={s.primary} onClick={send} disabled={busy}>
            {busy ? <span className={s.spinner} aria-hidden /> : null}
            {busy ? 'Sending — we are reading your receipt…' : 'Submit payment'}
          </button>
        </>
      )}

      <p className={s.fine}>
        Want to see Vexa work first?{' '}
        <button type="button" className={s.link} onClick={onTrial}>
          Start a free {STUDIO_TRIAL_HOURS}-hour trial instead
        </button>{' '}
        — no payment now: tell us about your business and go.
      </p>
    </div>
  );
}

/**
 * The receipt is in and the page stays here: thank you, and waiting for the
 * transaction to be confirmed. It moves on by itself once an admin approves it.
 */
/** Back from the card page, waiting for Stripe's webhook — seconds, normally. */
function CardWaitCard({ onGiveUp }: { onGiveUp: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className={s.card} style={{ maxWidth: 520, justifySelf: 'center', width: '100%' }}>
      <div className={s.thanks}>
        <span className={s.thanksArt} aria-hidden>
          <svg viewBox="0 0 24 24" width={34} height={34} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 4.6 4.6L19.5 6.8" />
          </svg>
        </span>
        <h1 className={s.title} style={{ fontSize: 30 }}>
          Thank you!
        </h1>
        <p className={s.sub}>
          Confirming your card payment with the bank. This page opens the next step by itself — it usually takes a few
          seconds.
        </p>
      </div>
      {slow ? (
        <>
          <p className={s.sub}>
            Still here? If the payment went through, your plan is safe and we will email you. Nothing is charged twice
            by going back.
          </p>
          <button type="button" className={s.link} onClick={onGiveUp}>
            Go back to paying
          </button>
        </>
      ) : null}
    </div>
  );
}

function WaitingCard({ payment }: { payment: StudioPaymentDoc }) {
  return (
    <div className={s.card} style={{ maxWidth: 520, justifySelf: 'center', width: '100%' }}>
      <div className={s.thanks}>
        <span className={s.thanksArt} aria-hidden>
          <svg viewBox="0 0 24 24" width={34} height={34} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 4.6 4.6L19.5 6.8" />
          </svg>
        </span>
        <h1 className={s.title} style={{ fontSize: 30 }}>
          Thank you!
        </h1>
        <p className={s.sub}>
          Waiting for your transaction to be confirmed. We have your receipt for the{' '}
          <strong style={{ color: '#1c1b1b' }}>{STUDIO_PLANS[payment.plan].name}</strong> plan ({studioUsd(payment.amountUsd)}
          {payment.billing === 'year' ? ' a year' : ' a month'}), sent {when(payment.createdAtMs)}.
        </p>
      </div>

      <ol className={s.track} aria-label="Where your payment is">
        <li className={s.trackDone}>
          <span aria-hidden>✓</span>
          Receipt received
        </li>
        <li className={s.trackOn}>
          <span aria-hidden />
          Being checked by a person
        </li>
        <li>
          <span aria-hidden />
          Your plan starts
        </li>
      </ol>

      <div className={s.vexaSays}>
        <span className={s.vexaFig} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
        </span>
        <p className={s.vexaBubble}>
          Someone checks the money arrived, usually within a few hours. This page opens your console by itself the moment
          it is approved — you can close it and log in later.
        </p>
      </div>
    </div>
  );
}

function BusinessCard({
  plan,
  onPlan,
  email,
  onSignOut,
  onDone,
}: {
  plan: StudioPlanId;
  /** Null once the plan is paid for: no chips to change it. */
  onPlan: ((p: StudioPlanId) => void) | null;
  email: string | null;
  onSignOut: () => void;
  onDone: (brand: Brand) => void;
}) {
  const [f, setF] = useState<Brand>({
    businessName: '',
    what: '',
    audience: '',
    market: '',
    language: 'English',
    differences: '',
    website: '',
  });
  const set = (k: keyof Brand) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const ready = f.businessName.trim().length >= 2 && f.what.trim().length >= 5 && f.audience.trim() && f.market.trim();

  return (
    <div className={s.card}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 className={s.cardTitle} style={{ fontSize: 24 }}>
          Tell your team about the business
        </h1>
        <p className={s.signedAs}>
          Five answers become your team&apos;s brief on day one. Signed in as {email}.{' '}
          <button type="button" onClick={onSignOut} className={s.link}>
            Not you?
          </button>
        </p>
      </div>
      <form
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onDone(f);
        }}
      >
        <label className={s.field}>
          Business name
          <input className={s.input} value={f.businessName} onChange={set('businessName')} placeholder="e.g. Bake House" />
        </label>
        <label className={s.field}>
          What do you sell?
          <textarea className={s.input} value={f.what} onChange={set('what')} placeholder="e.g. fresh bread and cakes, delivered the same day" />
        </label>
        <label className={s.field}>
          Who buys it?
          <input className={s.input} value={f.audience} onChange={set('audience')} placeholder="e.g. families and offices" />
        </label>
        <div className={s.grid2}>
          <label className={s.field}>
            Where?
            <input className={s.input} value={f.market} onChange={set('market')} placeholder="e.g. Lahore, Pakistan" />
          </label>
          <label className={s.field}>
            Language of your posts
            <input className={s.input} value={f.language} onChange={set('language')} placeholder="e.g. Urdu and English" />
          </label>
        </div>
        <label className={s.field}>
          Why do people pick you? (optional)
          <textarea
            className={s.input}
            value={f.differences}
            onChange={set('differences')}
            placeholder="e.g. baked at 5am every day, free delivery over Rs 2,000"
          />
        </label>
        <label className={s.field}>
          Website (optional)
          <input className={s.input} value={f.website} onChange={set('website')} placeholder="https://" />
        </label>

        {onPlan ? (
          <div className={s.field} role="radiogroup" aria-label="Your free day">
            Your free day
            <div className={s.plans}>
              {STUDIO_PLAN_IDS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={id === plan} className={s.planChip} onClick={() => onPlan(id)}>
                  {STUDIO_PLANS[id].name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className={s.fine}>
            Your plan: <b>{STUDIO_PLANS[plan].name}</b> — paid. It starts the moment your console opens.
          </p>
        )}

        <button type="submit" className={s.primary} disabled={!ready}>
          Next: where you post
        </button>
      </form>
    </div>
  );
}

/** The networks Vexa should post on; the console opens with each one ready to connect. */
function PlatformsCard({
  brand,
  plan,
  billing,
  paid,
  onBack,
}: {
  brand: Brand;
  plan: StudioPlanId;
  billing: StudioBilling;
  paid: boolean;
  onBack: () => void;
}) {
  const router = useRouter();
  const raised = useStudioPriceRaised();
  const [chosen, setChosen] = useState<SocialPlatform[]>(['instagram', 'facebook']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (p: SocialPlatform) => setChosen((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await studioApi.createWorkspace({ ...brand, plan, platforms: chosen });
      // The workspace claim only reaches the console in a fresh token.
      await auth.currentUser?.getIdToken(true);
      router.replace('/dashboard/social');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 className={s.cardTitle} style={{ fontSize: 24 }}>
          Where do you post?
        </h1>
        <p className={s.signedAs}>
          Pick the networks Vexa should post on. Your console opens with each one ready to connect — Instagram and Facebook
          take one Facebook sign-in. You can add more later.
        </p>
      </div>
      <div className={s.field} role="group" aria-label="Networks">
        <div className={s.plans}>
          {SOCIAL_PLATFORMS.map((p) => (
            <button key={p} type="button" role="checkbox" aria-checked={chosen.includes(p)} className={s.planChip} onClick={() => toggle(p)}>
              {chosen.includes(p) ? '✓ ' : ''}
              {PLATFORM_META[p].label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={s.primary} disabled={busy} onClick={go}>
        {busy ? <span className={s.spinner} aria-hidden /> : null}
        {busy ? 'Setting up your team — keep this page open…' : paid ? 'Open my console' : `Start my free ${STUDIO_TRIAL_HOURS} hours`}
      </button>
      <div className={s.row}>
        <button type="button" className={s.link} onClick={onBack} disabled={busy}>
          ← Your business
        </button>
        <span />
      </div>
      {paid ? null : (
        <p className={s.fine}>
          No card needed. After {STUDIO_TRIAL_HOURS} hours, pick a plan —{' '}
          {billing === 'year' ? `${studioUsd(studioPriceUsd(plan, 'year', raised))} a year` : `$${studioPriceUsd(plan, 'month', raised)} a month`} for{' '}
          {STUDIO_PLANS[plan].name} — or add credits at $1 a day. Pay by bank transfer.
        </p>
      )}
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
