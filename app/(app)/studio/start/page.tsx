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
 * The pay step is two columns and three numbered steps, because in one column
 * the money ended up below the fold and nobody saw it (owner, 2026-11-12):
 * ① pick a plan, on the left with the reels and what each one does; ② how you
 * pay, on the right and sticky, with the total above it; ③ the details of
 * whichever way was picked, in that same right-hand column, ending in the
 * button that finishes it. The ways to pay are a transfer to the company's
 * bank account or a card from any country through Stripe Checkout; the mobile
 * wallets are the rides side's, not Vexa's (owner, 2026-11-11). The card is
 * offered only while the admin's Receiving accounts page says `cardLive`;
 * until then it says "Opening soon" rather than pretending. A card needs no
 * admin — it comes back approved. A transfer leaves the page here on "thank
 * you — waiting for your transaction to be confirmed" until a person approves
 * it.
 *
 * The business step does not open with empty boxes. Vexa offers to read the
 * page the customer already has — a website, an Instagram or Facebook page —
 * and comes back with the brief filled in and the networks she would start
 * them on; the other door is the form, for anyone with nothing online yet.
 * Either way the customer sees and corrects every field before it is saved.
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
  STUDIO_TRIAL_USD,
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
  const [brand, setBrand] = useState<Brand | null>(null);
  /** The networks Vexa picked out for this business when she read their page; the next step opens on them. */
  const [suggested, setSuggested] = useState<SocialPlatform[]>([]);
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

  // Nothing is free any more, not even the day (owner, 2026-11-11): the only way
  // past the pay step is an approved payment, a month of a plan or a dollar for a day.
  const stage = !verified ? 2 : !paid ? 3 : !brand ? 4 : 5;
  // The pay step is two columns, so it needs the room; every other step is one.
  const paying = stage === 3 && !isAdmin && prepay?.status !== 'pending' && !(params.get('paid') === 'card' && !prepay);

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
            <div className={`${s.inner} ${s.wide} ${paying ? s.payWide : ''}`}>
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
                  />
                )
              ) : stage === 4 ? (
                // Stage 4 and 5 are only reachable once `paid` is set, which is what the stage above checks.
                <BusinessCard
                  plan={(paid as StudioPaymentDoc).plan}
                  email={user.email}
                  onSignOut={signOut}
                  onDone={(b, picked) => {
                    setSuggested(picked);
                    setBrand(b);
                  }}
                />
              ) : (
                <PlatformsCard
                  brand={brand as Brand}
                  plan={(paid as StudioPaymentDoc).plan}
                  suggested={suggested}
                  onBack={() => setBrand(null)}
                />
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

/**
 * Pay before anything starts: a month (or a year) of a plan, or one day of it
 * for a dollar. Either by card, or by a transfer with its receipt — and the day
 * is proved exactly like the month, which is the point of charging for it.
 */
function PayCard({
  uid,
  plan,
  onPlan,
  billing,
  onBilling,
  rejected,
}: {
  uid: string;
  plan: StudioPlanId;
  onPlan: (p: StudioPlanId) => void;
  billing: StudioBilling;
  onBilling: (b: StudioBilling) => void;
  rejected: StudioPaymentDoc | null;
}) {
  const raised = useStudioPriceRaised();
  const money = useStudioMoney();
  const reduced = useReducedMotion();
  const saving = useSaveData();
  const still = reduced || saving;
  const [accounts, setAccounts] = useState<ReceivingAccounts | null>(null);
  /** What the customer picked, or null while they have picked nothing. */
  const [picked, setPicked] = useState<'transfer' | 'card' | null>(null);
  /** A month (or a year) of the plan, or one day of it for a dollar. */
  const [buying, setBuying] = useState<'plan' | 'trial'>('plan');
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

  // The card first (owner, 2026-11-11) — but opening on a way that is shut is a
  // dead end, so while the gateway is off the transfer's own details are what
  // step three shows, and the card sits beside it saying "Opening soon".
  const how = picked ?? (accounts && !accounts.cardLive ? 'transfer' : 'card');
  const setHow = setPicked;

  const trial = buying === 'trial';
  // A dollar for the day, never the plan's price and never the price clock's rise.
  const amount = trial ? STUDIO_TRIAL_USD : studioPriceUsd(plan, billing, raised);
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
      const { url } = await studioApi.cardCheckout({ plan, billing, where: 'start', ...(trial ? { trial: true } : {}) });
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
      await studioApi.submitPayment({ plan, billing, txnId: txnId.trim(), screenshotPath, ...(trial ? { trial: true } : {}) });
      // The listener on studioPayments keeps this page here, on "thank you — waiting for confirmation".
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${s.card} ${s.payCard}`}>
      <div className={s.vexaSays}>
        <span className={s.vexaFig} aria-hidden>
          {/* A cut-out with its own alpha: next/image would only re-encode it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
        </span>
        <p className={s.vexaBubble}>
          Hi, I&rsquo;m <b>Vexa</b>. Pick your plan on the left, pay on the right, and I start the moment the money is
          through.
        </p>
      </div>

      {rejected ? (
        <p className={s.error} role="alert">
          Your last payment was not received{rejected.note ? `: ${rejected.note}` : ''}. Send it again, or take a single
          day for {studioUsd(STUDIO_TRIAL_USD)} instead.
        </p>
      ) : null}

      {/* Two columns, so the money never scrolls off the screen (owner, 2026-11-12): what you are buying on the left, paying on the right. */}
      <div className={s.payGrid}>
        <div className={s.payCol}>
          <h2 className={s.stepHead}>
            <span className={s.stepBadge} aria-hidden>
              1
            </span>
            <span>
              {trial ? 'Pick the plan to try' : 'Pick your plan'}
              <small>Tap one to see what it does for you.</small>
            </span>
          </h2>

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

          {trial ? null : (
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
          )}

          {trial ? (
            <p className={s.fine}>
              You are buying <b>one day</b> of {STUDIO_PLANS[plan].name} for {studioUsd(STUDIO_TRIAL_USD)} — the same
              team, for {STUDIO_TRIAL_HOURS} hours.{' '}
              <button type="button" className={s.link} onClick={() => setBuying('plan')}>
                Pay for the whole month instead
              </button>
            </p>
          ) : (
            <p className={s.fine}>
              Want to see Vexa work first?{' '}
              <button type="button" className={s.link} onClick={() => setBuying('trial')}>
                Take one day for {studioUsd(STUDIO_TRIAL_USD)} instead
              </button>{' '}
              — {STUDIO_TRIAL_HOURS} hours of the same team. We check that dollar the same way, which is how we know you
              are real.
            </p>
          )}
        </div>

        {/* Sticky: the total, the two ways to pay and the button that finishes it stay on screen while the plans scroll. */}
        <aside className={`${s.payCol} ${s.payPay}`}>
          <h2 className={s.stepHead}>
            <span className={s.stepBadge} aria-hidden>
              2
            </span>
            <span>
              How you pay
              <small>
                {accounts?.cardLive
                  ? 'By card it starts the moment it goes through. By transfer a person checks it first.'
                  : 'A person approves the transfer, usually within a few hours, and it starts then.'}
              </small>
            </span>
          </h2>

          <div className={s.total}>
            <span>To pay today</span>
            <strong key={`${plan}-${billing}-${buying}`}>
              {local.exact ? local.text : `about ${local.text}`}
              <small>
                {studioUsd(amount)} for {trial ? `${STUDIO_TRIAL_HOURS} hours` : billing === 'year' ? 'a year' : '30 days'}
              </small>
            </strong>
          </div>

          {/* The card on the left, the transfer on the right (owner, 2026-11-11). */}
          <div className={s.payWays} role="radiogroup" aria-label="How to pay">
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
          </div>

          {/* Whichever way was picked, its own details — step three is inside it. */}
          <div key={how} className={s.paySwap}>
            <h2 className={s.stepHead}>
              <span className={s.stepBadge} aria-hidden>
                3
              </span>
              <span>
                {how === 'card' ? (accounts?.cardLive ? 'Pay by card' : 'Card, once it opens') : `Send ${owed} and show me`}
              </span>
            </h2>

            {how === 'card' && accounts?.cardLive ? (
              <div className={s.soonBox}>
                <span className={s.soonArt} aria-hidden>
                  <VisaMark />
                  <MastercardMark />
                </span>
                <p>
                  Stripe takes the payment on its own page, so we never see your card. Any country&rsquo;s Visa or Mastercard
                  works, your bank converts from dollars, and {trial ? 'your day' : 'your plan'} starts the moment it goes
                  through — nobody to wait for.
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
                  {/* The amount is in the step's own heading above; this only has to say where. */}
                  Our account
                  {accounts === null ? (
                    <p className={s.sub}>Loading the receiving account…</p>
                  ) : !iban ? (
                    <p className={s.error}>Payment details are being set up. Email business@velocityrides.app and we will send them.</p>
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
          </div>
        </aside>
      </div>
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

/** What Vexa says while she is reading, so the wait shows the work rather than a bar. */
const LOOKING = [
  'Finding your page…',
  'Reading what you sell…',
  'Working out who buys it…',
  'Picking the networks that suit you…',
];

/**
 * Vexa reading the customer's own page, rather than the customer typing it out.
 *
 * The owner's objection (2026-11-12) was that a product that claims to think
 * should not open with seven empty boxes. So the step opens with a choice:
 * hand her the page you already have and she fills the brief in, or type it
 * yourself. What she finds is shown in the same editable form either way —
 * nothing is saved behind the customer's back, and a field she could not find
 * stays empty rather than being invented.
 */
function LookUpCard({ onFound, onType }: { onFound: (found: LookUpResult) => void; onType: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setLine((n) => (n + 1) % LOOKING.length), 2200);
    return () => clearInterval(id);
  }, [busy]);

  async function look() {
    setBusy(true);
    setError(null);
    setLine(0);
    try {
      onFound(await studioApi.lookUp({ link: link.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'I could not read that page. Try another address, or tell me yourself.');
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.vexaSays}>
        <span className={s.vexaFig} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
        </span>
        <p className={s.vexaBubble}>
          I would rather work your business out than make you type it. Give me the page you already have — your website,
          your Instagram, your Facebook — and I will read it and come back with what you sell, who buys it and where I
          think you should be posting.
        </p>
      </div>

      {busy ? (
        <div className={s.looking} aria-live="polite">
          <span className={s.lookingRing} aria-hidden />
          <b key={line} className={s.lookingLine}>
            {LOOKING[line]}
          </b>
          <small>This takes a few seconds — I am actually reading it.</small>
        </div>
      ) : (
        <form
          className={s.doors}
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim().length >= 3) void look();
          }}
        >
          <div className={`${s.door} ${s.doorOn}`}>
            <span className={s.doorIcon} aria-hidden>
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m16.3 16.3 4.2 4.2" />
              </svg>
            </span>
            <b>Connect your page — I work it out</b>
            <small>Your website, Instagram, Facebook or Google listing. One address is enough.</small>
            <input
              className={s.input}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="bakehouse.pk"
              aria-label="Your website or page address"
              autoFocus
            />
            {error ? (
              <p className={s.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className={s.primary} disabled={link.trim().length < 3}>
              Look me up
            </button>
          </div>

          <div className={s.door}>
            <span className={s.doorIcon} aria-hidden>
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16" />
                <path d="M14.5 4.8a2 2 0 0 1 2.8 2.8L8.6 16.3l-3.6.9.9-3.6Z" />
              </svg>
            </span>
            <b>I&rsquo;ll tell you myself</b>
            <small>Four short answers. Quicker if you have nothing online yet.</small>
            <button type="button" className={s.ghost} onClick={onType}>
              Fill it in myself
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

type LookUpResult = Awaited<ReturnType<typeof studioApi.lookUp>>;

function BusinessCard({
  plan,
  email,
  onSignOut,
  onDone,
}: {
  /** Always the plan that was paid for — a month of it, or the day. It cannot be changed here. */
  plan: StudioPlanId;
  email: string | null;
  onSignOut: () => void;
  onDone: (brand: Brand, suggested: SocialPlatform[]) => void;
}) {
  /** The chooser, then the form — reached either by her reading the page or by the customer picking to type. */
  const [asking, setAsking] = useState(true);
  const [found, setFound] = useState<LookUpResult | null>(null);
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

  if (asking) {
    return (
      <LookUpCard
        onType={() => setAsking(false)}
        onFound={(r) => {
          // Whatever she could not find stays empty for the customer to fill; nothing is guessed into the box.
          setF({
            businessName: r.businessName,
            what: r.what,
            audience: r.audience,
            market: r.market,
            language: r.language || 'English',
            differences: r.differences,
            website: r.website,
          });
          setFound(r);
          setAsking(false);
        }}
      />
    );
  }

  return (
    <div className={s.card}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 className={s.cardTitle} style={{ fontSize: 24 }}>
          {found ? 'Here is what I found' : 'Tell your team about the business'}
        </h1>
        <p className={s.signedAs}>
          {found
            ? 'Fix anything I got wrong — this becomes your team’s brief on day one. '
            : 'Five answers become your team’s brief on day one. '}
          Signed in as {email}.{' '}
          <button type="button" onClick={onSignOut} className={s.link}>
            Not you?
          </button>
        </p>
      </div>

      {found ? (
        <div className={s.vexaSays}>
          <span className={s.vexaFig} aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
          </span>
          <p className={s.vexaBubble}>
            {found.thin
              ? 'I could not get much from that address, so most of this is still guesswork — correct it and I will work from yours.'
              : found.plan || 'That is what I read off your page. Correct anything I got wrong.'}
          </p>
        </div>
      ) : null}
      <form
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onDone(f, found?.platforms ?? []);
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

        <p className={s.fine}>
          Your plan: <b>{STUDIO_PLANS[plan].name}</b> — paid. It starts the moment your console opens.{' '}
          {found ? null : (
            <button type="button" className={s.link} onClick={() => setAsking(true)}>
              Let me read your page instead
            </button>
          )}
        </p>

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
  suggested,
  onBack,
}: {
  brand: Brand;
  plan: StudioPlanId;
  /** What Vexa picked out after reading their page; empty when nobody asked her to. */
  suggested: SocialPlatform[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<SocialPlatform[]>(suggested.length ? suggested : ['instagram', 'facebook']);
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
          {suggested.length
            ? 'These are the ones I would start you on, from what I read about you. Change any of them. '
            : 'Pick the networks Vexa should post on. '}
          Your console opens with each one ready to connect — Instagram and Facebook take one Facebook sign-in. You can
          add more later.
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
        {busy ? 'Setting up your team — keep this page open…' : 'Open my console'}
      </button>
      <div className={s.row}>
        <button type="button" className={s.link} onClick={onBack} disabled={busy}>
          ← Your business
        </button>
        <span />
      </div>
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
