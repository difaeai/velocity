/**
 * The one countdown a registered driver is shown: a paper that runs out within
 * the month.
 *
 * Mirrors backend/functions/src/drivers/documentExpiry.ts, which pushes the
 * same warning at 30/14/7/3/1 days and suspends the driver the day a paper
 * lapses. Same date preference as the server — what the verification engine
 * read off the card beats what the driver typed — and the same day count, so
 * the screen and the push never disagree.
 */
export type ExpiringDocument = 'license' | 'cnic' | 'vehicleRegistration';

/** Warn from this many days out: the server's first push goes at the same mark. */
export const EXPIRY_WARN_DAYS = 30;

export const EXPIRING_DOCUMENT_LABEL: Record<ExpiringDocument, string> = {
  license: 'driving licence',
  cnic: 'CNIC',
  vehicleRegistration: 'vehicle registration',
};

const TYPED_FIELD = {
  license: 'licenseExpiry',
  cnic: 'cnicExpiry',
  vehicleRegistration: 'vehicleDocExpiry',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpiryProfile {
  licenseExpiry?: string;
  cnicExpiry?: string;
  vehicleDocExpiry?: string;
  verification?: { expiries?: Partial<Record<ExpiringDocument, { resolved?: string | null }>> };
}

export interface ExpiringSoon {
  key: ExpiringDocument;
  label: string;
  daysLeft: number;
}

/**
 * Papers running out within EXPIRY_WARN_DAYS, soonest first. A lapsed one is
 * not listed: by then the server has already stopped the driver, and says so.
 */
export function documentsExpiringSoon(
  profile: ExpiryProfile | null | undefined,
  now: number = Date.now(),
): ExpiringSoon[] {
  if (!profile) return [];
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const out: ExpiringSoon[] = [];
  for (const key of Object.keys(TYPED_FIELD) as ExpiringDocument[]) {
    const raw = profile.verification?.expiries?.[key]?.resolved ?? profile[TYPED_FIELD[key]];
    // Both the engine (ISO) and the app's date picker write year-month-day.
    const m = raw?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) continue;
    const daysLeft = Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - today) / DAY_MS);
    if (daysLeft >= 0 && daysLeft <= EXPIRY_WARN_DAYS) {
      out.push({ key, label: EXPIRING_DOCUMENT_LABEL[key], daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
