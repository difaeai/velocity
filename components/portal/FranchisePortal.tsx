'use client';

/**
 * The Pro partner's fleet portal.
 *
 * Sign-in is phone + OTP against the *same* Firebase account the partner uses in
 * the mobile app — Firebase keys phone users by number within a project, so the
 * uid that comes back here is the uid `partners/{uid}` is filed under. No account
 * linking, no second password to lose.
 *
 * The portalId in the URL is treated as a claim, never as proof: it is passed to
 * every callable, and the backend re-derives ownership from the signed-in uid. A
 * stranger who opens the link sees the sign-in screen and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { portalApi, type PortalPayload, type PortalSubmission } from '@/lib/api';
import { AddDriverForm } from './AddDriverForm';
import { DriverList } from './DriverList';
import s from './portal.module.css';

/** Pakistani numbers to the single form Firebase Auth stores them in. */
export function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92')) return `+${digits}`;
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`;
  if (digits.length === 10) return `+92${digits}`;
  return `+${digits}`;
}

function friendlyAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'auth/invalid-phone-number':
        return 'That does not look like a valid mobile number.';
      case 'auth/too-many-requests':
        return 'Too many attempts from this device. Wait a few minutes and try again.';
      case 'auth/invalid-verification-code':
        return 'That code is not right. Check the SMS and try again.';
      case 'auth/code-expired':
        return 'That code has expired. Ask for a new one.';
      case 'auth/unauthorized-domain':
        return 'This site is not authorised for sign-in yet. Tell Velocity support.';
      default:
        return e.message.replace('Firebase: ', '');
    }
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export function FranchisePortal({ portalId }: { portalId: string }) {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <main className={s.shell}>
        <p className={s.centreNote}>Loading…</p>
      </main>
    );
  }

  return user ? <Dashboard portalId={portalId} /> : <SignIn />;
}

/* ── sign in ──────────────────────────────────────────────────────────────── */

function SignIn() {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const confirmationRef = useRef<ConfirmationResult | null>(null);

  // The verifier binds to a DOM node and can only be solved once, so it is
  // created lazily and torn down after any failure — reusing a spent one is the
  // usual cause of a second "send code" silently doing nothing.
  const resetVerifier = useCallback(() => {
    try {
      verifierRef.current?.clear();
    } catch {
      /* already detached */
    }
    verifierRef.current = null;
  }, []);

  useEffect(() => resetVerifier, [resetVerifier]);

  async function sendCode() {
    setError(null);
    const e164 = toE164(phone);
    if (e164.length < 12) {
      setError('Enter your mobile number, for example 0300 1234567.');
      return;
    }
    setBusy(true);
    try {
      if (!verifierRef.current) {
        verifierRef.current = new RecaptchaVerifier(auth, 'portal-recaptcha', {
          size: 'invisible',
        });
      }
      confirmationRef.current = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      setStep('code');
    } catch (e) {
      resetVerifier();
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from the SMS.');
      return;
    }
    setBusy(true);
    try {
      await confirmationRef.current?.confirm(code.trim());
      // AuthProvider picks the session up; this component unmounts.
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.shell}>
      <div className={s.authCard}>
        <span className={s.mark} aria-hidden="true">
          V
        </span>
        <h1 className={s.authTitle}>Velocity Fleet Portal</h1>
        <p className={s.authSub}>
          {step === 'phone'
            ? 'Sign in with the same mobile number you use in the Velocity app.'
            : `We sent a 6-digit code to ${toE164(phone)}.`}
        </p>

        {step === 'phone' ? (
          <>
            <label className={s.label} htmlFor="portal-phone">
              Mobile number
            </label>
            <input
              id="portal-phone"
              className={s.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0300 1234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && sendCode()}
            />
            <button type="button" className={s.primary} onClick={sendCode} disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <label className={s.label} htmlFor="portal-code">
              Verification code
            </label>
            <input
              id="portal-code"
              className={`${s.input} ${s.codeInput}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="······"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && !busy && verify()}
            />
            <button type="button" className={s.primary} onClick={verify} disabled={busy}>
              {busy ? 'Checking…' : 'Verify and open portal'}
            </button>
            <button
              type="button"
              className={s.linkBtn}
              onClick={() => {
                resetVerifier();
                setStep('phone');
                setCode('');
                setError(null);
              }}
            >
              Use a different number
            </button>
          </>
        )}

        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}

        <p className={s.fine}>
          Only approved Pro partners can open a fleet portal. Signing in does not create one.
        </p>
      </div>
      <div id="portal-recaptcha" />
    </main>
  );
}

/* ── dashboard ────────────────────────────────────────────────────────────── */

function Dashboard({ portalId }: { portalId: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [drivers, setDrivers] = useState<PortalSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Bumping this re-runs the fetch. Children ask for a refresh through `reload`
  // rather than holding a fetch function, which keeps every setState inside the
  // effect's own cancellation guard — a portal left mid-request when the tab is
  // closed must not write to an unmounted tree.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [portal, list] = await Promise.all([
          portalApi.getPortal({ portalId }),
          portalApi.listDrivers({ portalId, limit: 100 }),
        ]);
        if (cancelled) return;
        setData(portal);
        setDrivers(list.drivers);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open this portal.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalId, reloadKey]);

  if (loading) {
    return (
      <main className={s.shell}>
        <p className={s.centreNote}>Opening your portal…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className={s.shell}>
        <div className={s.authCard}>
          <span className={s.mark} aria-hidden="true">
            V
          </span>
          <h1 className={s.authTitle}>Portal unavailable</h1>
          <p className={s.error} role="alert">
            {error ?? 'Could not open this portal.'}
          </p>
          <button type="button" className={s.secondary} onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  const p = data.partner;

  return (
    <div className={s.page}>
      <header className={s.topbar}>
        <div className={s.wrap}>
          <span className={s.brand}>
            <span className={s.mark} aria-hidden="true">
              V
            </span>
            <span>
              <b>{p.fullName ?? 'Your fleet'}</b>
              <small>
                {p.city ? `${p.city} · ` : ''}Pro partner
              </small>
            </span>
          </span>
          <button type="button" className={s.signOut} onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>

      <main className={s.wrap}>
        <section className={s.stats} aria-label="Fleet at a glance">
          <Stat label="Drivers in your fleet" value={p.totalDrivers} />
          <Stat label="Awaiting admin approval" value={data.submissions.pending} accent />
          <Stat label="Rides completed" value={p.completedRides} />
          <Stat
            label="Earned to date"
            value={`Rs ${Math.round(p.lifetimeEarnings).toLocaleString('en-PK')}`}
          />
        </section>

        <section className={s.twoUp}>
          <Copyable
            title="Your promo code"
            body="Give this to a driver or a rider. Whoever redeems it joins the matching fleet automatically — a driver joins your driver fleet, a passenger joins your rider fleet."
            value={p.referralCode ?? '—'}
            big
          />
          <Copyable
            title="Your portal link"
            body="This is your private address for this dashboard. Anyone opening it still has to sign in as you, but treat it as yours — ask Velocity support to reissue it if it gets out."
            value={typeof window !== 'undefined' ? `${window.location.origin}/f/${p.portalId}` : ''}
          />
        </section>

        <section className={s.panel}>
          <h2 className={s.h2}>Add a driver</h2>
          <p className={s.panelNote}>
            Fill in the driver and their vehicle. Nothing is created yet — Velocity reviews every
            submission and gives the final approval. You will be notified either way.
          </p>
          <AddDriverForm portalId={portalId} onSubmitted={reload} />
        </section>

        <section className={s.panel}>
          <h2 className={s.h2}>Your drivers</h2>
          <DriverList portalId={portalId} drivers={drivers} onChanged={reload} />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={s.stat}>
      <b className={accent ? s.statAccent : undefined}>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Copyable({
  title,
  body,
  value,
  big,
}: {
  title: string;
  body: string;
  value: string;
  big?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={s.panel}>
      <h2 className={s.h2}>{title}</h2>
      <p className={s.panelNote}>{body}</p>
      <div className={s.copyRow}>
        <code className={big ? s.codeBig : s.codeSmall}>{value}</code>
        <button type="button" className={s.secondary} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
