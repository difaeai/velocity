'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

export default function Login() {
  const { user, isAdmin, initializing, signOut } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initializing && user && isAdmin) router.replace('/dashboard');
  }, [initializing, user, isAdmin, router]);

  async function submit() {
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

  const signedInNotAdmin = !initializing && !!user && !isAdmin;

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={logoStyle}>V</div>
          <strong style={{ fontSize: 20 }}>Velocity Admin</strong>
        </div>

        {signedInNotAdmin ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ color: colors.danger, fontWeight: 600 }}>
              This account doesn&apos;t have admin access.
            </p>
            <p style={{ color: colors.muted, fontSize: 13 }}>
              Ask an existing admin to grant your account the <code>admin</code> role.
            </p>
            <Button variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ color: colors.muted, fontSize: 14 }}>Sign in to the operations console.</p>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              type="email"
            />
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            {error ? <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p> : null}
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
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
      return 'Incorrect email or password.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled for this project.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

const logoStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: colors.primary,
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 900,
};
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700 };
const inputStyle: React.CSSProperties = {
  height: 42,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 12px',
  fontSize: 15,
};
