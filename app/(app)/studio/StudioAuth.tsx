'use client';

/**
 * Velocity Studio's front door: log in, or create an account.
 *
 * One form in two modes — /studio/login and /studio/signup — so a returning
 * customer and a new one land in the same place and switch with a link. Google,
 * or an email and password. Whoever is signed in is sent on: a customer with a
 * workspace to their team, an admin to the console, anyone else to the
 * first-run steps at /studio/start (verify the email, describe the business).
 * The plan and billing picked on the pricing page ride along in the query.
 */

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { takeSessionEnded, useAuth } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/site';
import { STUDIO_PLAN_IDS, STUDIO_PLANS, STUDIO_TRIAL_HOURS, type StudioPlanId } from '@/lib/studio';
import { VelocityIcon } from '@/components/BrandMark';
import { FieldError } from '@/components/states';
import { useReducedMotion } from '@/components/site/useReducedMotion';
import s from './auth.module.css';

export type AuthMode = 'login' | 'signup';

export function StudioAuth({ mode }: { mode: AuthMode }) {
  return (
    <Suspense fallback={null}>
      <AuthForm mode={mode} />
    </Suspense>
  );
}

/** The pricing page's plan and billing, as a query string for the next page. */
export function carried(params: { get: (k: string) => string | null }): string {
  const q = new URLSearchParams();
  const plan = params.get('plan');
  if (plan && STUDIO_PLAN_IDS.includes(plan as StudioPlanId)) q.set('plan', plan);
  if (params.get('billing') === 'year') q.set('billing', 'year');
  const out = q.toString();
  return out ? `?${out}` : '';
}

/** Where a signed-in account belongs. */
export function homeFor(a: { isAdmin: boolean; workspaceId: string | null }, keep: string): string {
  return a.workspaceId ? '/dashboard/social' : a.isAdmin ? '/dashboard' : `/studio/start${keep}`;
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const { user, isAdmin, workspaceId, initializing } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const keep = carried(params);
  const plan = params.get('plan') as StudioPlanId | null;
  const signup = mode === 'signup';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [peek, setPeek] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() =>
    typeof window !== 'undefined' && takeSessionEnded()
      ? 'Your session ended, so you were signed out. Log in again — anything you were typing is saved in this browser.'
      : null,
  );
  // Shown after a submit, at the field, with how to fix it — not a grey button with no reason.
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!initializing && user) router.replace(homeFor({ isAdmin, workspaceId }, keep));
  }, [initializing, user, isAdmin, workspaceId, keep, router]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : '';
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError(authMessage(code, mode));
      setBusy(false);
    }
  }

  const withEmail = () =>
    run(async () => {
      if (signup) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    });

  async function forgot() {
    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      setError('Type your email above, then press “Forgot password?” again.');
      return;
    }
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (e) {
      // Never say whether an account exists; only a malformed address is worth reporting.
      if (e instanceof FirebaseError && e.code === 'auth/invalid-email') {
        setError(authMessage(e.code, mode));
        return;
      }
    }
    setNotice(`If ${email.trim()} has an account, a link to set a new password is on its way. Check spam too.`);
  }

  const emailProblem = /\S+@\S+\.\S+/.test(email.trim()) ? null : 'Enter your email like you@business.com.';
  const passwordProblem =
    password.length >= 6 ? null : signup ? 'Use at least 6 characters.' : 'Enter your password — it has at least 6 characters.';
  const ready = !emailProblem && !passwordProblem;
  const signedIn = !initializing && Boolean(user);

  return (
    <main className={s.page}>
      <section className={s.side}>
        <header className={s.top}>
          <Link href="/" className={s.brand}>
            <VelocityIcon size={32} />
            Velocity Studio
          </Link>
          <Link href={signup ? `/studio/login${keep}` : `/studio/signup${keep}`} className={s.topLink}>
            {signup ? 'Log in' : 'Sign up'}
          </Link>
        </header>

        <div className={s.center}>
          <div className={s.inner}>
            {signup && plan && STUDIO_PLANS[plan] ? (
              <span className={s.planPill}>
                <span className={s.planDot}>✓</span>
                Free for {STUDIO_TRIAL_HOURS} hours: <b>{STUDIO_PLANS[plan].name}</b>
              </span>
            ) : null}

            <div className={s.head}>
              <h1 className={s.title}>{signup ? 'Your AI team, in two minutes' : 'Welcome back'}</h1>
              <p className={s.sub}>
                {signup
                  ? `Create your account. The first ${STUDIO_TRIAL_HOURS} hours are free — no card.`
                  : 'Log in to see what your team did while you were away.'}
              </p>
            </div>

            <div className={s.card}>
              {signedIn ? (
                <p className={s.sub} style={{ textAlign: 'center' }} role="status">
                  Signing you in…
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className={s.google}
                    disabled={busy}
                    onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}
                  >
                    <GoogleMark /> Continue with Google
                  </button>
                  <div className={s.or}>OR</div>
                  <form
                    style={{ display: 'grid', gap: 12 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      setTried(true);
                      if (ready && !busy) void withEmail();
                    }}
                  >
                    {signup ? (
                      <label className={s.field}>
                        Your name
                        <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                      </label>
                    ) : null}
                    <label className={s.field}>
                      Email
                      <input
                        className={s.input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        type="email"
                        autoComplete="email"
                        placeholder="you@business.com"
                        aria-invalid={tried && Boolean(emailProblem)}
                        aria-describedby="studio-email-error"
                      />
                      <FieldError id="studio-email-error" message={tried ? emailProblem : null} />
                    </label>
                    <label className={s.field}>
                      Password
                      <span className={s.pw}>
                        <input
                          className={s.input}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          type={peek ? 'text' : 'password'}
                          autoComplete={signup ? 'new-password' : 'current-password'}
                          placeholder={signup ? 'At least 6 characters' : ''}
                          aria-invalid={tried && Boolean(passwordProblem)}
                          aria-describedby="studio-password-error"
                        />
                        <button
                          type="button"
                          className={s.peek}
                          onClick={() => setPeek(!peek)}
                          aria-label={peek ? 'Hide password' : 'Show password'}
                        >
                          {peek ? 'Hide' : 'Show'}
                        </button>
                      </span>
                      <FieldError id="studio-password-error" message={tried ? passwordProblem : null} />
                    </label>
                    {error ? (
                      <p className={s.error} role="alert">
                        {error}
                      </p>
                    ) : null}
                    {notice ? (
                      <p className={s.notice} role="status">
                        {notice}
                      </p>
                    ) : null}
                    <button type="submit" className={s.primary} disabled={busy}>
                      {busy ? <span className={s.spinner} aria-hidden /> : null}
                      {busy ? 'One moment…' : signup ? 'Create account' : 'Log in'}
                    </button>
                  </form>
                  {signup ? null : (
                    <div className={s.row}>
                      <span />
                      <button type="button" className={s.link} onClick={forgot}>
                        Forgot password?
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <p className={s.switch}>
              {signup ? 'Already have an account? ' : 'New to Velocity Studio? '}
              <Link href={signup ? `/studio/login${keep}` : `/studio/signup${keep}`} className={s.link}>
                {signup ? 'Log in' : 'Create an account'}
              </Link>
            </p>
            <p className={s.fine}>
              By continuing, you agree to Velocity&apos;s <a href={TERMS_URL}>Terms</a> and{' '}
              <a href={PRIVACY_URL}>Privacy Policy</a>.
            </p>
          </div>
        </div>
      </section>

      <Showcase title={signup ? 'Make your own Digital Marketing Agency.' : 'Your team kept working while you were away.'} />
    </main>
  );
}

const WIDE = '(min-width: 901px)';
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** The product beside the form: the studio film behind what the team does, one line at a time. */
function Showcase({ title }: { title: string }) {
  const reduced = useReducedMotion();
  // Phones never see this panel, so they never download its film.
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  return (
    <aside className={s.show} aria-hidden>
      {wide && !reduced ? (
        <video className={s.film} src="/site/studio.mp4" poster="/site/studio.jpg" muted loop autoPlay playsInline />
      ) : null}
      <div className={s.showBody}>
        <span className={s.showKicker}>Velocity Studio</span>
        <h2 className={s.showTitle}>{title}</h2>
        <ul className={s.feed}>
          {FEED.map((f) => (
            <li key={f.title}>
              <span className={s.feedIcon}>{f.icon}</span>
              <span>
                {f.title}
                <small>{f.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

const FEED = [
  { icon: '🔎', title: 'Market read', detail: 'Your buyers, your competitors, an audience test' },
  { icon: '🗓️', title: '30 days of content, made ahead', detail: 'Reels, posts and carousels on a calendar' },
  { icon: '💬', title: 'Posted at your time, comments answered', detail: 'Instagram and Facebook, on its own' },
  { icon: '📈', title: 'Meta Ad Expert on your ads', detail: 'Winners kept running, losers paused' },
];

export function authMessage(code: string, mode: AuthMode = 'login'): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Log in instead.';
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return mode === 'login'
        ? 'Email or password is wrong. Signed up with Google? Use “Continue with Google”.'
        : 'Email or password is wrong.';
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a minute, or set a new password with “Forgot password?”.';
    case 'auth/operation-not-allowed':
      return 'Email sign-up is not switched on yet. Use Google, or email business@velocityrides.app.';
    case 'auth/account-exists-with-different-credential':
      return 'That email already signs in with a password. Use the email form.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/network-request-failed':
      return 'You are offline — your connection dropped, not Velocity. Reconnect and try again.';
    default:
      return 'Signing in failed on our side — not your fault. Try again in a minute.';
  }
}

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
