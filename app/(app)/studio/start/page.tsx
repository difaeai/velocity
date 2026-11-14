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
import {
  socialApi,
  studioApi,
  type LaunchStateDoc,
  type SocialAccountDoc,
  type SocialPlatform,
  type StudioPaymentDoc,
} from '@/lib/api';
import { InstagramConnect } from '@/components/social/instagramConnect';
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
  type StudioWorkspace,
} from '@/lib/studio';
import { VelocityIcon } from '@/components/BrandMark';
import { useReducedMotion, useSaveData } from '@/components/site/useReducedMotion';
import { FieldError } from '@/components/states';
import { carried } from '../StudioAuth';
import s from '../auth.module.css';
import a from '../../dashboard/social/account.module.css';

const STAGES = ['Account', 'Verify email', 'Pay', 'Connect', 'Your business', 'Ready'];

/** The answers that become the team's brief. */
interface Brand {
  businessName: string;
  what: string;
  audience: string;
  market: string;
  language: string;
  differences: string;
  website: string;
  /** Anything else the owner wanted to say, in their own words. */
  notes: string;
}

/** The page Vexa was pointed at once a network is connected (or a website given), and where she would post. */
interface Connected {
  /** The address she reads: the connected Page's own, or the website they typed. */
  link: string;
  platforms: SocialPlatform[];
  /** How they got here, for the line she says on the next screen. */
  how: 'instagram' | 'facebook' | 'website';
}

/** Three is enough to aim the morning research; all of it is optional. */
const COMPETITOR_ROWS = 3;

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
  const [payments, setPayments] = useState<StudioPaymentDoc[]>([]);
  /** Their workspace once the money has cleared; `setupAtMs === null` while sign-up is unfinished. */
  const [ws, setWs] = useState<StudioWorkspace | null>(null);
  /** The page they connected, and what Vexa read off it. */
  const [connected, setConnected] = useState<Connected | null>(null);
  const [found, setFound] = useState<LookUpResult | null>(null);
  /** The brief, saved: from here the analysis runs and GO opens the console. */
  const [saved, setSaved] = useState<{ knowledge: string; links: string[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (initializing) return;
    if (!user) router.replace(`/studio/signup${keep}`);
    // A finished workspace belongs in the console. One still being set up —
    // opened the moment the money cleared, so a Page had something to connect
    // to — stays here until its owner presses GO.
    else if (workspaceId && ws && ws.setupAtMs !== null) router.replace('/dashboard/social');
  }, [initializing, user, workspaceId, ws, keep, router]);

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
  // Their workspace, from the moment it exists: the connect step reads it and the redirect above waits on it.
  useEffect(() => {
    // Only ever null → set, for the length of this page: a claim is not taken away mid sign-up.
    if (!workspaceId) return;
    return onSnapshot(
      doc(db, 'workspaces', workspaceId),
      (snap) => setWs(snap.exists() ? (snap.data() as StudioWorkspace) : null),
      () => setWs(null),
    );
  }, [workspaceId]);

  const prepay = payments.filter((p) => p.wid === null).sort((x, y) => y.createdAtMs - x.createdAtMs)[0] ?? null;
  const paid = prepay?.status === 'approved' ? prepay : null;

  /**
   * Paid for, so the workspace is opened now rather than at the end of sign-up
   * (owner, 2026-11-14): connecting a Facebook Page needs a workspace to connect
   * it to. It is a shell until the business is described — no brief, and the
   * daily run is off — and `setupAtMs: null` is what keeps the console from
   * opening on it.
   */
  const making = useRef(false);
  useEffect(() => {
    if (!paid || workspaceId || isAdmin || making.current) return;
    making.current = true;
    void (async () => {
      try {
        await studioApi.createWorkspace({});
        // The workspace claim only reaches this page in a fresh token.
        await auth.currentUser?.getIdToken(true);
      } catch (e) {
        making.current = false;
        setOpening(e instanceof Error ? e.message : 'Your workspace could not be opened.');
      }
    })();
  }, [paid, workspaceId, isAdmin]);

  /**
   * The plan that was paid for. `prepay` only finds the payment while it has no
   * workspace on it — and opening the workspace is what puts one there — so once
   * that has happened the workspace itself is the proof, and the record of which
   * plan. Without this the page drops back to the pay step the moment it succeeds.
   */
  const bought = paid?.plan ?? ws?.plan ?? null;

  // Nothing is free any more, not even the day (owner, 2026-11-11): the only way
  // past the pay step is an approved payment, a month of a plan or a dollar for a day.
  const stage = !verified ? 2 : !bought ? 3 : !connected ? 4 : !saved ? 5 : 6;
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
              ) : // Stage 4 and after are only reachable once `paid` is set, which is what the stage above checks.
              stage === 4 ? (
                workspaceId && ws ? (
                  <ConnectCard
                    wid={workspaceId}
                    onDone={(c, f) => {
                      setFound(f);
                      setConnected(c);
                    }}
                  />
                ) : (
                  <OpeningCard error={opening} />
                )
              ) : stage === 5 ? (
                <BusinessCard
                  found={found}
                  connected={connected as Connected}
                  plan={bought as StudioPlanId}
                  email={user.email}
                  onSignOut={signOut}
                  onBack={() => setConnected(null)}
                  onSaved={(knowledge, links) => setSaved({ knowledge, links })}
                />
              ) : (
                <ReadyCard
                  wid={workspaceId as string}
                  name={ws?.brand.name || 'your business'}
                  knowledge={(saved as { knowledge: string }).knowledge}
                  links={(saved as { links: string[] }).links}
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
      {STUDIO_PLAN_IDS.map((id, i) => {
        const on = id === plan;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`${s.planBox} ${on ? s.planBoxOn : ''}`}
            // Each card arrives after the one before it; `still` stops the whole sequence dead.
            style={still ? undefined : { animationDelay: `${0.06 * i}s` }}
            onClick={() => onPlan(id)}
          >
            {/* The reel is the card: the price and the name are read off it, not under it. */}
            <span className={s.boxArt}>
              <span className={s.boxFilm} aria-hidden>
                {on && !still ? (
                  <video autoPlay muted loop playsInline poster={`${PLAN_FILM[id]}.jpg`}>
                    <source src={`${PLAN_FILM[id]}.mp4`} type="video/mp4" />
                  </video>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${PLAN_FILM[id]}.jpg`} alt="" />
                )}
              </span>
              <span className={s.boxOver}>
                <b className={s.boxName}>{PLAN_SHORT[id]}</b>
                <span key={`${billing}-${raised}`} className={s.boxCost}>
                  {studioUsd(studioPriceUsd(id, billing, raised))}
                  <small>/{billing === 'year' ? 'year' : 'month'}</small>
                </span>
              </span>
              <span className={s.boxTick} aria-hidden>
                ✓
              </span>
            </span>
            <span className={s.boxLogos} aria-hidden>
              {PLAN_LOGOS[id].map((f, n) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={f}
                  src={`/site/logos/${f}.svg`}
                  alt=""
                  width={16}
                  height={16}
                  style={still ? undefined : { animationDelay: `${0.18 + 0.05 * n}s` }}
                />
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
              {/* One track, two halves, the chosen one filled: a switch rather than two loose chips. */}
              <div className={s.billSeg}>
                {(['month', 'year'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={billing === b}
                    className={s.billHalf}
                    onClick={() => onBilling(b)}
                  >
                    {b === 'month' ? 'Monthly' : 'Yearly'}
                    {b === 'year' ? <i className={s.billSave}>save {STUDIO_YEAR_DISCOUNT_PCT}%</i> : null}
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
  'Opening your page…',
  'Reading what you sell…',
  'Working out who buys it…',
  'Picking the networks that suit you…',
];

/** Vexa, with whatever she is saying beside her. */
function VexaSays({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.vexaSays}>
      <span className={s.vexaFig} aria-hidden>
        {/* A cut-out with its own alpha: next/image would only re-encode it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
      </span>
      <p className={s.vexaBubble}>{children}</p>
    </div>
  );
}

/** The second between the money clearing and the workspace existing — and the one place it can fail. */
function OpeningCard({ error }: { error: string | null }) {
  return (
    <div className={s.card}>
      <VexaSays>
        {error
          ? 'Your payment is in, but I could not open your workspace just now. Nothing has been lost — your plan is paid for.'
          : 'Thank you — your payment is in. Opening your workspace…'}
      </VexaSays>
      {error ? (
        <>
          <p className={s.error} role="alert">
            {error}
          </p>
          <button type="button" className={s.primary} onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      ) : (
        <div className={s.looking} aria-live="polite">
          <span className={s.lookingRing} aria-hidden />
          <b className={s.lookingLine}>Hiring your team…</b>
          <small>A moment. Your money is already on your plan.</small>
        </div>
      )}
    </div>
  );
}

/**
 * Step four: connect the page Vexa is about to work on.
 *
 * Connecting comes before anything is asked about the business (owner,
 * 2026-11-14), because the whole point is that she tells them what their
 * business is rather than making them type it. Instagram and Facebook are one
 * Facebook sign-in — the same handshake the console uses, against the
 * workspace the payment just opened. Anyone with neither gives a website
 * instead, and she reads that the same way.
 */
function ConnectCard({ wid, onDone }: { wid: string; onDone: (c: Connected, found: LookUpResult) => void }) {
  const [accounts, setAccounts] = useState<SocialAccountDoc[]>([]);
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, `workspaces/${wid}/socialAccounts`),
        (snap) => setAccounts(snap.docs.map((d) => d.data() as SocialAccountDoc)),
        () => setAccounts([]),
      ),
    [wid],
  );

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setLine((n) => (n + 1) % LOOKING.length), 2200);
    return () => clearInterval(id);
  }, [busy]);

  const ig = accounts.find((a) => a.platform === 'instagram');
  const fb = accounts.find((a) => a.platform === 'facebook');
  const igOn = ig?.status === 'connected' ? ig : null;
  const fbOn = fb?.status === 'connected' ? fb : null;
  const handle = igOn?.handle ? igOn.handle.replace(/^@/, '') : null;
  // What is connected gives Vexa a real address to read; otherwise whatever they typed.
  const from: Connected | null = handle
    ? { link: `instagram.com/${handle}`, platforms: fbOn ? ['instagram', 'facebook'] : ['instagram'], how: 'instagram' }
    : fbOn?.externalId
      ? { link: `facebook.com/${fbOn.externalId}`, platforms: ['facebook'], how: 'facebook' }
      : null;
  const typed = site.trim();

  async function go() {
    const base: Connected = from ?? { link: typed, platforms: [], how: 'website' };
    setBusy(true);
    setError(null);
    setLine(0);
    try {
      const look = await studioApi.lookUp({ link: base.link });
      // Hers and theirs both: a network she suggests is worth offering even when nothing is connected to it yet.
      onDone({ ...base, platforms: Array.from(new Set([...base.platforms, ...look.platforms])) }, look);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'I could not read that page. Try another address.');
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className={s.card}>
        <VexaSays>Give me a few seconds with it — I am actually reading the page, not guessing.</VexaSays>
        <div className={s.looking} aria-live="polite">
          <span className={s.lookingRing} aria-hidden />
          <b key={line} className={s.lookingLine}>
            {LOOKING[line]}
          </b>
          <small>Then I will show you what I found and you can correct me.</small>
        </div>
      </div>
    );
  }

  return (
    <div className={s.card}>
      <VexaSays>
        Connect the page you already post on and I will do the rest — read it, work out what you sell and who buys it,
        and have your first month planned before you have typed a word.
      </VexaSays>

      {/* The real Facebook handshake, exactly as the console runs it: Instagram and the Page in one sign-in. */}
      <div className={s.connectHost}>
        <InstagramConnect account={ig} />
      </div>

      {from ? (
        <p className={s.connectedLine}>
          <span aria-hidden>✓</span>
          Connected — {igOn?.displayName ?? (handle ? `@${handle}` : null) ?? fbOn?.displayName ?? 'your Facebook Page'}
        </p>
      ) : (
        <>
          <div className={s.orLine} aria-hidden>
            <span>or</span>
          </div>
          <label className={s.field}>
            No Instagram or Facebook yet? Give me your website.
            <input
              className={s.input}
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="bakehouse.pk"
              aria-label="Your website address"
            />
          </label>
        </>
      )}

      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}

      <button type="button" className={s.primary} disabled={!from && typed.length < 3} onClick={() => void go()}>
        {from ? 'Next — read my page' : 'Next — read my website'}
      </button>
    </div>
  );
}

type LookUpResult = Awaited<ReturnType<typeof studioApi.lookUp>>;

/** What the owner knows about their own market, in their words, for the read that follows. */
function knowledgeFrom(f: Brand, rivals: { name: string; url: string }[]): string {
  const named = rivals.map((r) => r.name).filter(Boolean);
  return [
    `${f.businessName} — ${f.what}`,
    `Customers: ${f.audience}. Where: ${f.market}. Posts are written in ${f.language}.`,
    f.differences ? `Why people pick us: ${f.differences}` : '',
    f.notes,
    named.length ? `Who we are up against: ${named.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Step five: what she read, for them to correct.
 *
 * Nothing here was invented — a field she could not find off the page comes
 * back empty rather than plausible, which is the only version of this worth
 * showing. Two boxes are theirs alone: anything she could not know, and who
 * else is in their market, which is what the morning research reads around.
 */
function BusinessCard({
  found,
  connected,
  plan,
  email,
  onSignOut,
  onBack,
  onSaved,
}: {
  /** Null only if the look-up somehow returned nothing; the form is then empty and theirs to fill. */
  found: LookUpResult | null;
  connected: Connected;
  /** Always the plan that was paid for. It cannot be changed here. */
  plan: StudioPlanId;
  email: string | null;
  onSignOut: () => void;
  onBack: () => void;
  onSaved: (knowledge: string, links: string[]) => void;
}) {
  const [f, setF] = useState<Brand>({
    businessName: found?.businessName ?? '',
    what: found?.what ?? '',
    audience: found?.audience ?? '',
    market: found?.market ?? '',
    language: found?.language || 'English',
    differences: found?.differences ?? '',
    website: found?.website || (connected.how === 'website' ? connected.link : ''),
    notes: '',
  });
  const [rivals, setRivals] = useState(() =>
    Array.from({ length: COMPETITOR_ROWS }, () => ({ name: '', url: '' })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Brand) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const setRival = (i: number, k: 'name' | 'url', v: string) =>
    setRivals((rs) => rs.map((r, n) => (n === i ? { ...r, [k]: v } : r)));

  const ready = f.businessName.trim().length >= 2 && f.what.trim().length >= 5 && f.audience.trim() && f.market.trim();

  async function send() {
    setBusy(true);
    setError(null);
    const competitors = rivals
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), url: r.url.trim() }));
    try {
      await studioApi.saveBusiness({
        businessName: f.businessName.trim(),
        what: f.what.trim(),
        audience: f.audience.trim(),
        market: f.market.trim(),
        language: f.language.trim() || 'English',
        differences: f.differences.trim(),
        notes: f.notes.trim(),
        website: f.website.trim(),
        competitors,
        platforms: connected.platforms,
      });
      // Everything she now has a reason to read, handed to the market analysis as its own starting point.
      const links = [f.website, connected.how === 'website' ? connected.link : '', ...competitors.map((c) => c.url)]
        .map((l) => l.trim())
        .filter(Boolean);
      onSaved(knowledgeFrom(f, competitors), Array.from(new Set(links)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 className={s.cardTitle} style={{ fontSize: 24 }}>
          {found ? 'Here is your business' : 'Tell me about the business'}
        </h1>
        <p className={s.signedAs}>
          {found ? 'Fix anything I got wrong — this becomes your team’s brief on day one. ' : ''}
          Signed in as {email}.{' '}
          <button type="button" onClick={onSignOut} className={s.link}>
            Not you?
          </button>
        </p>
      </div>

      <VexaSays>
        {found?.thin
          ? 'I could not get much from that page, so most of this is still guesswork — correct it and I will work from yours.'
          : found?.plan || 'That is what I read off your page. Correct anything I got wrong.'}
      </VexaSays>

      <form
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void send();
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
          Anything else I should know? (optional)
          <textarea
            className={s.input}
            value={f.notes}
            onChange={set('notes')}
            placeholder="e.g. we are quiet in Ramzan, our best month is December, never mention the old branch"
          />
        </label>

        {/* Named by the owner, not guessed: this is who the morning research reads around. */}
        <div className={s.field}>
          Who else is in your market? (optional)
          <small className={s.hint}>I read around them every morning — never copy them.</small>
          <div className={s.rivals}>
            {rivals.map((r, i) => (
              <div key={i} className={s.rivalRow}>
                <input
                  className={s.input}
                  value={r.name}
                  onChange={(e) => setRival(i, 'name', e.target.value)}
                  placeholder={i === 0 ? 'Their name' : ''}
                  aria-label={`Competitor ${i + 1} name`}
                />
                <input
                  className={s.input}
                  value={r.url}
                  onChange={(e) => setRival(i, 'url', e.target.value)}
                  placeholder={i === 0 ? 'their website or page' : ''}
                  aria-label={`Competitor ${i + 1} page`}
                />
              </div>
            ))}
          </div>
        </div>

        <label className={s.field}>
          Website (optional)
          <input className={s.input} value={f.website} onChange={set('website')} placeholder="https://" />
        </label>

        <p className={s.fine}>
          Your plan: <b>{STUDIO_PLANS[plan].name}</b> — paid.
        </p>

        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className={s.primary} disabled={!ready || busy}>
          {busy ? <span className={s.spinner} aria-hidden /> : null}
          {busy ? 'Saving…' : 'Submit — go and work it out'}
        </button>
      </form>
      <div className={s.row}>
        <button type="button" className={s.link} onClick={onBack} disabled={busy}>
          ← Connect a different page
        </button>
        <span />
      </div>
    </div>
  );
}

/** The lines on the last screen: what she is doing, while she does it. */
const WORKING = [
  'Reading your pages end to end…',
  'Searching your market…',
  'Sizing up who you are up against…',
  'Putting a test audience in front of your offer…',
  'Writing your brief…',
];

/**
 * Step six: she goes away and does the work, then says she is ready.
 *
 * This is the real market read (`adminLaunchMarket`) — their own pages, a live
 * search and the audience test — not a progress bar over nothing. It is the
 * first box of the launch sequence, so the console picks the same run up where
 * this leaves it. GO lights up when it is done; the line underneath is there
 * because a read that takes three minutes must never hold a paying customer
 * out of their own console.
 */
function ReadyCard({ wid, name, knowledge, links }: { wid: string; name: string; knowledge: string; links: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<LaunchStateDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Minutes, not seconds — the page watches the state document rather than this promise.
    socialApi
      .launchMarket({ knowledge, links })
      .catch((e) => setError(e instanceof Error ? e.message : 'I could not finish reading your market.'));
  }, [knowledge, links]);

  useEffect(
    () =>
      onSnapshot(
        doc(db, `workspaces/${wid}/socialLaunch/state`),
        (snap) => setState(snap.exists() ? (snap.data() as LaunchStateDoc) : null),
        () => undefined,
      ),
    [wid],
  );

  const market = state?.steps?.market;
  // `needs_you` means she finished and wants a decision — which is a question for the console, not for this screen.
  const done = market?.status === 'done' || market?.status === 'needs_you' || Boolean(error);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setLine((n) => (n + 1) % WORKING.length), 3200);
    return () => clearInterval(id);
  }, [done]);

  return (
    <div className={s.card}>
      <VexaSays>
        {done
          ? error
            ? `I have your brief for ${name} and I can start. I will finish reading the market from inside.`
            : `I have read your pages, searched your market and written your brief. I am ready to work for ${name}.`
          : `Give me a minute or two with ${name} — I am reading everything you gave me.`}
      </VexaSays>

      {done ? (
        <>
          {market?.note ? <p className={s.fine}>{market.note}</p> : null}
          <button type="button" className={s.goBtn} onClick={() => router.replace('/dashboard/social')}>
            GO
          </button>
          <p className={s.fine}>One last thing inside: tell me what you want out of all this.</p>
        </>
      ) : (
        <>
          <div className={s.looking} aria-live="polite">
            <span className={s.lookingRing} aria-hidden />
            <b key={line} className={s.lookingLine}>
              {WORKING[line]}
            </b>
            <small>Nothing is posted anywhere until you tell me to.</small>
          </div>
          <p className={s.fine}>
            Taking a while?{' '}
            <button type="button" className={s.link} onClick={() => router.replace('/dashboard/social')}>
              Go in and watch it there
            </button>
            .
          </p>
        </>
      )}
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
