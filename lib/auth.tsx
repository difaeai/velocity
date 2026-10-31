'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth';

import { auth } from './firebase';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  /** The Velocity Studio workspace this account owns (`ws` claim), or null. */
  workspaceId: string | null;
  initializing: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** Set when a sign-in ends without the Sign out button: a revoked token, a deleted account. */
const SESSION_ENDED = 'velocity.sessionEnded';

/** True once, on the log-in page after a session ended on its own — then forgotten. */
export function takeSessionEnded(): boolean {
  try {
    const ended = sessionStorage.getItem(SESSION_ENDED) === '1';
    sessionStorage.removeItem(SESSION_ENDED);
    return ended;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const signedIn = useRef(false);
  const leaving = useRef(false);

  // onIdTokenChanged, not onAuthStateChanged: it also fires when a token is
  // refreshed, which is how a claim set at Studio sign-up reaches the console.
  useEffect(
    () =>
      onIdTokenChanged(auth, async (next) => {
        if (signedIn.current && !next && !leaving.current) {
          try {
            sessionStorage.setItem(SESSION_ENDED, '1');
          } catch {
            /* storage blocked */
          }
        }
        signedIn.current = Boolean(next);
        leaving.current = false;
        setUser(next);
        if (next) {
          const token = await next.getIdTokenResult();
          setIsAdmin(token.claims.role === 'admin');
          setWorkspaceId(typeof token.claims.ws === 'string' ? token.claims.ws : null);
        } else {
          setIsAdmin(false);
          setWorkspaceId(null);
        }
        setInitializing(false);
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAdmin,
      workspaceId,
      initializing,
      signOut: () => {
        leaving.current = true;
        return fbSignOut(auth);
      },
    }),
    [user, isAdmin, workspaceId, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
