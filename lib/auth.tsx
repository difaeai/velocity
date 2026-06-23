'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';

import { auth } from './firebase';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  initializing: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (next) => {
        setUser(next);
        if (next) {
          const token = await next.getIdTokenResult();
          setIsAdmin(token.claims.role === 'admin');
        } else {
          setIsAdmin(false);
        }
        setInitializing(false);
      }),
    [],
  );

  const value = useMemo<AuthState>(
    () => ({ user, isAdmin, initializing, signOut: () => fbSignOut(auth) }),
    [user, isAdmin, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
