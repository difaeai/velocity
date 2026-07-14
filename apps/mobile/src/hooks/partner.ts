/**
 * Earn with Velocity — client state for the Partner Program.
 *
 * `usePartnerStatus` is the gate every Earn screen asks: is this user a
 * stranger, an applicant, or an approved partner? It reads the two documents
 * the backend owns (`partner_applications/{uid}` and `partners/{uid}`) live, so
 * an admin approving an application flips the app to the dashboard without the
 * partner having to restart it.
 *
 * The referral claim lives here too. A code arrives before the account does — a
 * tap on a WhatsApp link opens the app while the visitor is still signed out —
 * so it is parked in AsyncStorage and played the moment a user exists.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { doc, onSnapshot } from 'firebase/firestore';

import { api } from '../api/client';
import type { PartnerDashboard, PartnerLevel } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';

const PENDING_CODE_KEY = 'velocity_pending_referral_code';

export type PartnerStage =
  /** Never applied. Sees the landing page. */
  | 'none'
  /** Applied, waiting on a human. */
  | 'pending'
  /** Turned down; may fix the documents and apply again. */
  | 'rejected'
  /** Admin asked for clearer documents. */
  | 'resubmit'
  /** Approved — the dashboard is unlocked. */
  | 'approved'
  /** Approved but suspended; keeps their history, earns nothing. */
  | 'suspended'
  | 'loading';

export interface PartnerStatus {
  stage: PartnerStage;
  /** Why the application was turned down — shown verbatim so they know what to fix. */
  rejectionReason: string | null;
  level: PartnerLevel | null;
}

/** Live application + partner status. */
export function usePartnerStatus(): PartnerStatus {
  const { user } = useAuth();
  const [application, setApplication] = useState<{
    status?: string;
    rejectionReason?: string | null;
  } | null>(null);
  const [partner, setPartner] = useState<{ status?: string; level?: PartnerLevel } | null>(null);
  const [ready, setReady] = useState({ app: false, partner: false });

  useEffect(() => {
    if (!user) {
      setReady({ app: true, partner: true });
      return;
    }
    const unsubApp = onSnapshot(
      doc(db, 'partner_applications', user.uid),
      (snap) => {
        setApplication(snap.exists() ? (snap.data() as never) : null);
        setReady((r) => ({ ...r, app: true }));
      },
      () => setReady((r) => ({ ...r, app: true })),
    );
    const unsubPartner = onSnapshot(
      doc(db, 'partners', user.uid),
      (snap) => {
        setPartner(snap.exists() ? (snap.data() as never) : null);
        setReady((r) => ({ ...r, partner: true }));
      },
      () => setReady((r) => ({ ...r, partner: true })),
    );
    return () => {
      unsubApp();
      unsubPartner();
    };
  }, [user]);

  if (!ready.app || !ready.partner) {
    return { stage: 'loading', rejectionReason: null, level: null };
  }

  // The partner doc wins: it only exists once an admin approved, and it is what
  // every earning path keys off. A stale rejected application underneath it
  // must not be able to lock an approved partner out of their own dashboard.
  if (partner) {
    return {
      stage: partner.status === 'suspended' ? 'suspended' : 'approved',
      rejectionReason: null,
      level: partner.level ?? 'bronze',
    };
  }

  const status = application?.status;
  const stage: PartnerStage =
    status === 'pending'
      ? 'pending'
      : status === 'rejected'
        ? 'rejected'
        : status === 'resubmit'
          ? 'resubmit'
          : 'none';

  return { stage, rejectionReason: application?.rejectionReason ?? null, level: null };
}

/** The dashboard payload, with a manual `reload` for pull-to-refresh. */
export function usePartnerDashboard() {
  const [data, setData] = useState<PartnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await api.getPartnerDashboard({}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your partner dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

/** Park a code that arrived before the user had an account. */
export async function stashReferralCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_CODE_KEY, code.trim().toUpperCase()).catch(() => {});
}

export async function readStashedReferralCode(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_CODE_KEY).catch(() => null);
}

/**
 * Play a parked referral code against the freshly created account.
 *
 * Clears the code whatever the outcome. A code that failed to bind — the window
 * closed, the account is already in a fleet, the fraud guards refused it — will
 * fail identically forever, and retrying it on every launch would just mean a
 * fresh error toast every time the app opens.
 */
export async function claimStashedReferral(): Promise<{ ok: boolean; partnerName?: string }> {
  const code = await readStashedReferralCode();
  if (!code) return { ok: false };

  try {
    const res = await api.claimPartnerReferral({
      code,
      // Ties a handset to the accounts it enrols, so one phone cannot mint an
      // endless supply of "recruits" (see partners/referrals.ts).
      deviceId: deviceFingerprint(),
    });
    return { ok: true, partnerName: res.partnerName ?? undefined };
  } catch {
    return { ok: false };
  } finally {
    await AsyncStorage.removeItem(PENDING_CODE_KEY).catch(() => {});
  }
}

/**
 * A stable-enough per-device id. Not a security boundary — a determined
 * fraudster can factory-reset — but it stops the cheap version of device
 * farming, which is signing up ten accounts on one phone in one afternoon.
 */
export function deviceFingerprint(): string | undefined {
  const parts = [Device.osInternalBuildId, Device.modelId, Device.modelName, Device.osBuildId]
    .filter(Boolean)
    .join('-');
  return parts.length >= 8 ? parts : undefined;
}
