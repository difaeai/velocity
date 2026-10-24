'use client';

/**
 * Velocity Studio sign-up: an account, a verified email, the business in five
 * answers, a plan.
 *
 * Google sign-in arrives verified. An email-and-password account gets a
 * six-digit code by email and types it on the next screen; the backend refuses
 * a workspace (and its free day) to an address nobody proved. The answers
 * become the team's brief on day one. Paying is on the Billing page inside the
 * console, once the free day is used.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi } from '@/lib/api';
import {
  STUDIO_PLAN_IDS,
  STUDIO_PLANS,
  STUDIO_TRIAL_HOURS,
  studioPriceUsd,
  type StudioBilling,
  type StudioPlanId,
} from '@/lib/studio';
import { Button, Card } from '@/components/ui';
import { VelocityIcon } from '@/components/BrandMark';

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
  const asked = params.get('plan');
  const [plan, setPlan] = useState<StudioPlanId>(
    STUDIO_PLAN_IDS.includes(asked as StudioPlanId) ? (asked as StudioPlanId) : 'all',
  );
  const billing: StudioBilling = params.get('billing') === 'year' ? 'year' : 'month';
  // The token's own flag only changes after a refresh; this carries the moment between.
  const [verifiedNow, setVerifiedNow] = useState(false);
  const verified = Boolean(user?.emailVerified) || verifiedNow;

  useEffect(() => {
    if (!initializing && workspaceId) router.replace('/dashboard/social');
  }, [initializing, workspaceId, router]);

  // Puts someone who has not finished on the admin's Users list.
  const uid = user?.uid;
  useEffect(() => {
    if (uid && !isAdmin && !workspaceId) studioApi.touch({}).catch(() => undefined);
  }, [uid, isAdmin, workspaceId]);

  return (
    <main style={{ minHeight: '100vh', background: colors.bg, padding: '32px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 18 }}>
        <Link href="/studio" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <VelocityIcon size={34} />
          <strong style={{ fontSize: 20 }}>Velocity Studio</strong>
        </Link>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px' }}>Your AI social media team, in two minutes</h1>
          <p style={{ color: colors.muted, margin: 0, lineHeight: 1.6 }}>
            Tell us about your business, pick a plan, and the team starts. The first {STUDIO_TRIAL_HOURS} hours are free.
          </p>
        </div>

        <PlanPicker plan={plan} onPlan={setPlan} />

        {initializing ? null : !user ? (
          <AccountCard />
        ) : isAdmin ? (
          <Card>
            <p style={{ margin: '0 0 10px' }}>
              You are signed in as a Velocity admin. Velocity&apos;s own desk is in the console; to try Studio, sign in
              with a different account.
            </p>
            <Button variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          </Card>
        ) : !verified ? (
          <VerifyCard email={user.email} onVerified={() => setVerifiedNow(true)} onSignOut={signOut} />
        ) : (
          <BusinessCard plan={plan} billing={billing} email={user.email} onSignOut={signOut} />
        )}
      </div>
    </main>
  );
}

function PlanPicker({ plan, onPlan }: { plan: StudioPlanId; onPlan: (p: StudioPlanId) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }} role="radiogroup">
      {STUDIO_PLAN_IDS.map((id) => {
        const p = STUDIO_PLANS[id];
        const on = id === plan;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPlan(id)}
            style={{
              textAlign: 'left',
              padding: 14,
              borderRadius: 14,
              border: `${on ? 2 : 1}px solid ${on ? colors.primary : colors.border}`,
              background: colors.surface,
              cursor: 'pointer',
              font: 'inherit',
              color: colors.text,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <strong style={{ fontSize: 15 }}>{p.name}</strong>
              <span style={{ marginLeft: 'auto', fontWeight: 900, fontSize: 18 }}>${p.usd}</span>
              <span style={{ fontSize: 12, color: colors.muted }}>/mo</span>
            </span>
            <span style={{ display: 'block', fontSize: 12.5, color: colors.muted, marginTop: 4, lineHeight: 1.45 }}>
              {p.tagline}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AccountCard() {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'new') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      setError(e instanceof FirebaseError ? authMessage(e.code) : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : '';
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(authMessage(code));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={h2}>{mode === 'new' ? '1. Create your account' : '1. Sign in'}</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        <button type="button" onClick={google} disabled={busy} style={googleButton}>
          <GoogleMark /> Continue with Google
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: colors.muted, fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: colors.border }} />
          or with your email
          <span style={{ flex: 1, height: 1, background: colors.border }} />
        </div>
        {mode === 'new' ? (
          <Field label="Your name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={input} autoComplete="name" />
          </Field>
        ) : null}
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={input} type="email" autoComplete="email" />
        </Field>
        <Field label="Password">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
            type="password"
            autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
        </Field>
        {error ? <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p> : null}
        <Button onClick={go} disabled={busy || !email.trim() || password.length < 6}>
          {busy ? 'One moment…' : mode === 'new' ? 'Create account — we will email you a code' : 'Sign in'}
        </Button>
        <button type="button" onClick={() => setMode(mode === 'new' ? 'existing' : 'new')} style={linkButton}>
          {mode === 'new' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </Card>
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
    <Card>
      <h2 style={h2}>2. Check your email</h2>
      <p style={{ fontSize: 13.5, color: colors.muted, margin: '-4px 0 12px', lineHeight: 1.6 }}>
        {sentAt ? (
          <>
            We sent a 6-digit code to <strong style={{ color: colors.text }}>{email}</strong>. It works for 10 minutes.
          </>
        ) : (
          <>Sending a code to {email}…</>
        )}
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="Verification code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
            style={{ ...input, fontSize: 22, letterSpacing: 8, fontWeight: 800, maxWidth: 220 }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit code"
            placeholder="••••••"
          />
        </Field>
        {error ? (
          <p role="alert" style={{ color: colors.danger, margin: 0, fontSize: 13 }}>
            {error}
          </p>
        ) : null}
        <Button onClick={verify} disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Verify and continue'}
        </Button>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={send} disabled={wait > 0} style={{ ...linkButton, opacity: wait > 0 ? 0.5 : 1 }}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
          <button type="button" onClick={onSignOut} style={linkButton}>
            Use a different email
          </button>
        </div>
      </div>
    </Card>
  );
}

function BusinessCard({
  plan,
  billing,
  email,
  onSignOut,
}: {
  plan: StudioPlanId;
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
    <Card>
      <h2 style={h2}>Last step: tell the team about your business</h2>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '-6px 0 12px' }}>
        Signed in as {email}.{' '}
        <button type="button" onClick={onSignOut} style={linkButton}>
          Not you?
        </button>
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="Business name">
          <input value={f.businessName} onChange={set('businessName')} style={input} placeholder="e.g. Bake House" />
        </Field>
        <Field label="What do you sell?">
          <textarea value={f.what} onChange={set('what')} style={{ ...input, minHeight: 64 }} placeholder="e.g. fresh bread and cakes, delivered the same day" />
        </Field>
        <Field label="Who buys it?">
          <input value={f.audience} onChange={set('audience')} style={input} placeholder="e.g. families and offices" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Field label="Where?">
            <input value={f.market} onChange={set('market')} style={input} placeholder="e.g. Lahore, Pakistan" />
          </Field>
          <Field label="Language of your posts">
            <input value={f.language} onChange={set('language')} style={input} placeholder="e.g. Urdu and English" />
          </Field>
        </div>
        <Field label="Why do people pick you? (optional)">
          <textarea value={f.differences} onChange={set('differences')} style={{ ...input, minHeight: 64 }} placeholder="e.g. baked at 5am every day, free delivery over Rs 2,000" />
        </Field>
        <Field label="Website (optional)">
          <input value={f.website} onChange={set('website')} style={input} placeholder="https://" />
        </Field>
        {error ? <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p> : null}
        <Button onClick={go} disabled={busy || !ready}>
          {busy ? 'Setting up your team…' : `Start my free day — ${STUDIO_PLANS[plan].name} plan`}
        </Button>
        <p style={{ fontSize: 12, color: colors.muted, margin: 0 }}>
          No card needed. After {STUDIO_TRIAL_HOURS} hours, pay{' '}
          {billing === 'year' ? `$${studioPriceUsd(plan, 'year')} for a year` : `$${STUDIO_PLANS[plan].usd}/month`} by bank
          transfer, EasyPaisa or JazzCash to carry on.
        </p>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 800, color: colors.muted }}>
      {label}
      {children}
    </label>
  );
}

function authMessage(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.';
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is wrong.';
    case 'auth/operation-not-allowed':
      return 'Email sign-up is not switched on yet. Please contact us.';
    case 'auth/account-exists-with-different-credential':
      return 'That email already signs in with a password. Use the email form below.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    default:
      return 'That did not work. Try again.';
  }
}

const h2: React.CSSProperties = { fontSize: 16, fontWeight: 800, margin: '0 0 12px' };
const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  color: colors.text,
  background: colors.surface,
  fontWeight: 400,
};
const googleButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  padding: '11px 14px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
  fontFamily: 'inherit',
  fontSize: 14.5,
  fontWeight: 800,
  cursor: 'pointer',
};

/** Google's "G", as its sign-in guidelines ask the button to carry. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: colors.secondary,
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
