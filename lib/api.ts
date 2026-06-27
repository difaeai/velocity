import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

function callable<Req, Res>(name: string): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await fn(data)).data;
}

/** Admin-only backend actions (each guarded by requireAdmin server-side). */
export const adminApi = {
  approveDriver: callable<{ driverId: string }, { ok: boolean }>('approveDriver'),
  rejectDriver: callable<{ driverId: string; reason?: string; suspend?: boolean }, { ok: boolean }>(
    'rejectDriver',
  ),
  setUserRole: callable<{ targetUid: string; role: 'passenger' | 'driver' | 'admin' }, { ok: boolean }>(
    'setUserRole',
  ),
  resolveSafetyEvent: callable<{ eventId: string; resolution?: string }, { ok: boolean }>(
    'resolveSafetyEvent',
  ),
  markPayoutPaid: callable<{ payoutId: string }, { ok: boolean }>('markPayoutPaid'),
  adminCreateDriver: callable<
    {
      fullName: string;
      email: string;
      phone?: string;
      vehicleType: string;
      vehicleLabel: string;
      plate: string;
      cnic?: string;
      franchiseId?: string;
    },
    { ok: boolean; uid: string; passwordResetLink: string | null }
  >('adminCreateDriver'),
  adminCreateFranchise: callable<
    { name: string; ownerName: string; email: string; phone?: string; city?: string },
    { ok: boolean; franchiseId: string }
  >('adminCreateFranchise'),
  adminAssignFranchise: callable<
    { driverId: string; franchiseId: string | null },
    { ok: boolean }
  >('adminAssignFranchise'),
};
