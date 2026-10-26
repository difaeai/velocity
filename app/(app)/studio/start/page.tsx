'use client';

/**
 * Velocity Studio's first run, once there is an account: prove the email, then
 * describe the business in five answers, and the free day starts.
 *
 * Signing in and signing up live at /studio/login and /studio/signup; anyone
 * who reaches this page signed out is sent there with their plan. Google
 * sign-in arrives verified. An email-and-password account gets a six-digit code
 * by email and types it here; the backend refuses a workspace (and its free
 * day) to an address nobody proved. The answers become the team's brief on day
 * one. Paying is in the console, once the free day is used.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { studioApi } from '@/lib/api';
import {
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_TRIAL_HOURS,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { VelocityIcon } from '@/components/BrandMark';
import { carried } from '../StudioAuth';
import s from '../auth.module.css';

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
  const billing: StudioBilling = params.get('billing') === 'year' ? 'year' : 'month';
  // The token's own flag only changes after a refresh; this carries the moment between.
  const [verifiedNow, setVerifiedNow] = useState(false);
  const verified = Boolean(user?.emailVerified) || verifiedNow;

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

  const stage = !verified ? 2 : 3;

  return (
    <main className={`${s.page} ${s.single}`}>
      <section className={s.side}>
        <header className={s.top}>
          <Link href="/" className={s.brand}>
            <VelocityIcon size={32} />
            Velocity Studio
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
                {['Account', 'Verify email', 'Your business'].map((label, i) => {
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
              ) : !verified ? (
                <VerifyCard email={user.email} onVerified={() => setVerifiedNow(true)} onSignOut={signOut} />
              ) : (
                <BusinessCard plan={plan} onPlan={setPlan} billing={billing} email={user.email} onSignOut={signOut} />
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

function BusinessCard({
  plan,
  onPlan,
  billing,
  email,
  onSignOut,
}: {
  plan: StudioPlanId;
  onPlan: (p: StudioPlanId) => void;
  billing: StudioBilling;
  email: string | null;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    businessName: '',
    what: '',
    audience: '',
    market: '',
    language: 'English',
    differences: '',
    website: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const ready = f.businessName.trim().length >= 2 && f.what.trim().length >= 5 && f.audience.trim() && f.market.trim();

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await studioApi.createWorkspace({ ...f, plan });
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
          if (ready && !busy) void go();
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

        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.primary} disabled={busy || !ready}>
          {busy ? <span className={s.spinner} aria-hidden /> : null}
          {busy ? 'Setting up your team — keep this page open…' : `Start my free ${STUDIO_TRIAL_HOURS} hours`}
        </button>
        <p className={s.fine}>
          No card needed. After {STUDIO_TRIAL_HOURS} hours, pick a plan —{' '}
          {billing === 'year' ? `$${studioPriceUsd(plan, 'year')} a year` : `$${STUDIO_PLANS[plan].usd} a month`} for{' '}
          {STUDIO_PLANS[plan].name} — or add credits at $1 a day. Pay by bank transfer, EasyPaisa or JazzCash.
        </p>
      </form>
    </div>
  );
}
