/**
 * "Become a driver" / "Driver mode" entry routing — one decision, one place.
 *
 * The rule: a signed-in passenger is ALREADY authenticated, so becoming a
 * driver must never send them back through phone + OTP. Registering as a
 * driver is a role added to the account they already have, not a new account.
 * They go straight to the registration steps, and once an admin approves them
 * the driver home opens directly.
 *
 * The OTP login (`become-driver/login`) therefore only exists for a signed-OUT
 * driver — someone reinstalling the app who has no session at all.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';

type Href = Parameters<ReturnType<typeof useRouter>['push']>[0];

const CHECKLIST: Href = '/passenger/become-driver/checklist';
const SUBMITTED: Href = '/passenger/become-driver/submitted';
const DRIVER_HOME: Href = '/driver/home';
/** Signed-out only: sign up (OTP) vs. "I already have an account". */
const ACCOUNT_GATE: Href = '/passenger/become-driver/account';

/**
 * Where a user tapping "Become a driver" should land, based on the driver
 * record attached to their account.
 *
 *   not signed in            → account gate (→ OTP login)
 *   no driver record         → registration checklist  (no re-login)
 *   rejected                 → registration checklist  (fix + resubmit)
 *   approved                 → driver home
 *   pending / anything else  → application status screen
 */
export async function resolveDriverEntry(uid?: string): Promise<Href> {
  if (!uid) return ACCOUNT_GATE;
  try {
    const snap = await getDoc(doc(db, 'drivers', uid));
    if (!snap.exists()) return CHECKLIST;
    const status = (snap.get('verificationStatus') as string | undefined) ?? null;
    if (status === 'approved') return DRIVER_HOME;
    if (status === 'rejected') return CHECKLIST;
    return SUBMITTED;
  } catch {
    // A failed lookup must not trap the user — start the registration.
    return CHECKLIST;
  }
}

/**
 * `go()` navigates the current user into the right point of the driver flow.
 * Returns `busy` so callers can disable the button while the lookup runs.
 */
export function useDriverEntry(): { go: () => Promise<void>; busy: boolean } {
  const router = useRouter();
  const { user, role, refreshRole } = useAuth();
  const [busy, setBusy] = useState(false);

  const go = useCallback(async () => {
    setBusy(true);
    try {
      // Already carrying the driver claim — no lookup needed.
      if (role === 'driver') {
        router.push(DRIVER_HOME);
        return;
      }
      const href = await resolveDriverEntry(user?.uid);
      // The driver layout is guarded by the role claim, which is only minted
      // server-side on approval. Refresh the token first, or the guard bounces
      // a freshly-approved driver straight back to the passenger home.
      if (href === DRIVER_HOME) await refreshRole().catch(() => {});
      router.push(href);
    } finally {
      setBusy(false);
    }
  }, [router, user?.uid, role, refreshRole]);

  return { go, busy };
}
