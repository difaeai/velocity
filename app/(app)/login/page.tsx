'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { takeSessionEnded, useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';
import { FieldError } from '@/components/states';
import { VelocityIcon } from '@/components/BrandMark';

export default function Login() {
  const { user, isAdmin, workspaceId, initializing, signOut } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<{ email?: string; password?: string }>({});
  const [sessionEnded] = useState(() => typeof window !== 'undefined' && takeSessionEnded());

  useEffect(() => {
    if (!initializing && user && isAdmin) router.replace('/dashboard');
    else if (!initializing && user && workspaceId) router.replace('/dashboard/social');
  }, [initializing, user, isAdmin, workspaceId, router]);

  async function submit() {
    const problems = {
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? undefined : 'Enter the email of your admin account, like name@velocityrides.app.',
      password: password ? undefined : 'Enter your password — it is case-sensitive.',
    };
    setFields(problems);
    if (problems.email || problems.password) return;
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setError(e instanceof FirebaseError ? mapErr(e.code) : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  const signedInNotAdmin = !initializing && !!user && !isAdmin && !workspaceId;

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <VelocityIcon size={36} />
          <strong style={{ fontSize: 20 }}>Velocity Rides Admin</strong>
        </div>

        {signedInNotAdmin ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ color: colors.danger, fontWeight: 600 }}>
              This account doesn&apos;t have admin access.
            </p>
            <p style={{ color: colors.muted, fontSize: 13 }}>
              Ask an existing admin to grant your account the <code>admin</code> role — or{' '}
              <a href="/studio/start" style={{ color: colors.secondary, fontWeight: 700 }}>
                start Velocity Studio
              </a>{' '}
              for your own business.
            </p>
            <Button variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {sessionEnded ? (
              <p role="status" style={{ background: '#fff7e6', border: '1px solid #f5d9a8', borderRadius: 10, padding: 10, fontSize: 13 }}>
                Your session ended, so you were signed out. Sign in again — anything you were typing is saved in this browser.
              </p>
            ) : null}
            <p style={{ color: colors.muted, fontSize: 14 }}>Sign in to the operations console.</p>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              type="email"
              aria-invalid={Boolean(fields.email)}
              aria-describedby="login-email-error"
            />
            <FieldError id="login-email-error" message={fields.email} />
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              aria-invalid={Boolean(fields.password)}
              aria-describedby="login-password-error"
            />
            <FieldError id="login-password-error" message={fields.password} />
            {error ? <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p> : null}
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <p style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
              Velocity Studio customer?{' '}
              <a href="/studio/login" style={{ color: colors.secondary, fontWeight: 700 }}>
                Log in here
              </a>
            </p>
          </div>
        )}
      </Card>
    </main>
  );
}

function mapErr(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an admin account. Check both for a typo — the password is case-sensitive.';
    case 'auth/too-many-requests':
      return 'Too many tries — Firebase paused sign-in for this account for a few minutes. Wait, then try again.';
    case 'auth/network-request-failed':
      return 'You are offline — your connection dropped, not Velocity. Reconnect and sign in again.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in is switched off for this project — our setup, not you. An admin has to enable it in Firebase.';
    default:
      return 'Sign-in failed on our side — not your fault. Try again in a minute.';
  }
}

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700 };
const inputStyle: React.CSSProperties = {
  height: 42,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 12px',
  fontSize: 15,
};
