'use client';

/**
 * Velocity Studio sign-up: an account, the business in five answers, a plan.
 *
 * The answers become the team's brief on day one, so the first thing they make
 * is about this business rather than a template. The plan starts as a one-day
 * trial; paying is on the Billing page inside the console.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { studioApi } from '@/lib/api';
import { STUDIO_PLAN_IDS, STUDIO_PLANS, STUDIO_TRIAL_HOURS, type StudioPlanId } from '@/lib/studio';
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
  const asked = useSearchParams().get('plan');
  const [plan, setPlan] = useState<StudioPlanId>(
    STUDIO_PLAN_IDS.includes(asked as StudioPlanId) ? (asked as StudioPlanId) : 'all',
  );

  useEffect(() => {
    if (!initializing && workspaceId) router.replace('/dashboard/social');
  }, [initializing, workspaceId, router]);

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
        ) : (
          <BusinessCard plan={plan} email={user.email} onSignOut={signOut} />
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

  return (
    <Card>
      <h2 style={h2}>{mode === 'new' ? '1. Create your account' : '1. Sign in'}</h2>
      <div style={{ display: 'grid', gap: 10 }}>
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
          {busy ? 'One moment…' : mode === 'new' ? 'Create account' : 'Sign in'}
        </Button>
        <button type="button" onClick={() => setMode(mode === 'new' ? 'existing' : 'new')} style={linkButton}>
          {mode === 'new' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </Card>
  );
}

function BusinessCard({ plan, email, onSignOut }: { plan: StudioPlanId; email: string | null; onSignOut: () => void }) {
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
      <h2 style={h2}>2. Tell the team about your business</h2>
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
          No card needed. After {STUDIO_TRIAL_HOURS} hours, pay ${STUDIO_PLANS[plan].usd}/month by bank transfer, EasyPaisa
          or JazzCash to carry on.
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
