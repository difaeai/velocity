'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  // onIdTokenChanged, not onAuthStateChanged: it also fires when a token is
  // refreshed, which is how a claim set at Studio sign-up reaches the console.
  useEffect(
    () =>
      onIdTokenChanged(auth, async (next) => {
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
    () => ({ user, isAdmin, workspaceId, initializing, signOut: () => fbSignOut(auth) }),
    [user, isAdmin, workspaceId, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
