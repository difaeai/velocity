/**
 * Auth + role state for the whole app.
 *
 * Subscribes to Firebase Auth and reads the user's `role` from their ID-token
 * custom claims (set by the backend). The single mobile binary renders the
 * passenger or driver experience based on this role.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';

import { auth } from '../firebase';
import type { Role } from '../domain/types';

interface AuthState {
  user: User | null;
  role: Role | null;
  initializing: boolean;
  /** Force-refresh the ID token to pick up a freshly-granted role. */
  refreshRole: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function readRole(user: User | null): Promise<Role | null> {
  if (!user) return null;
  const token = await user.getIdTokenResult();
  return (token.claims.role as Role | undefined) ?? 'passenger';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      setUser(next);
      setRole(await readRole(next));
      setInitializing(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      initializing,
      refreshRole: async () => {
        const current = auth.currentUser;
        if (!current) return;
        await current.getIdToken(true);
        setRole(await readRole(current));
      },
      signOut: () => fbSignOut(auth),
    }),
    [user, role, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
