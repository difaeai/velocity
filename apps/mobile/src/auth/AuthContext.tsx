/**
 * Auth + role state for the whole app.
 *
 * Subscribes to Firebase Auth and reads the user's `role` from their ID-token
 * custom claims (set by the backend). The single mobile binary renders the
 * passenger or driver experience based on this role.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import { auth } from '../firebase';
import { signOutEverywhere } from './phoneSignIn';
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

/** A sign-in that ended without the Sign out button: a revoked token, an account closed elsewhere. */
let sessionEnded = false;

/** True once, on the sign-in screen after a session ended on its own — then forgotten. */
export function takeSessionEnded(): boolean {
  const ended = sessionEnded;
  sessionEnded = false;
  return ended;
}

async function readRole(user: User | null): Promise<Role | null> {
  if (!user) return null;
  const token = await user.getIdTokenResult();
  return (token.claims.role as Role | undefined) ?? 'passenger';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [initializing, setInitializing] = useState(true);
  const signedIn = useRef(false);
  const leaving = useRef(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      if (signedIn.current && !next && !leaving.current) sessionEnded = true;
      signedIn.current = Boolean(next);
      leaving.current = false;
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
      // Clears the native session as well as the JS one. Phone verification runs on
      // the native SDK, and a native session left signed in could be replayed
      // against the session-exchange callable on a later launch.
      signOut: () => {
        leaving.current = true;
        return signOutEverywhere();
      },
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
