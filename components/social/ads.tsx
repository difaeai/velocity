/**
 * Small shared pieces of the ads desk, used by the Ads page and the overview.
 */
import { colors } from '@/lib/config';
import type { AdCampaignDoc, AdVerdict } from '@/lib/api';

/**
 * Money the way the backend says it (adsExpert.ts `money`), so the two read the same.
 * A missing amount reads "—": a first connect stores no dailyCap, and drawing it blanked the console.
 */
export function adMoney(amount: number | null | undefined, currency: string): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const small = Math.abs(amount) < 100;
  if (currency === 'USD') return `$${amount.toLocaleString('en-US', { maximumFractionDigits: small ? 3 : 0 })}`;
  const n = amount.toLocaleString('en-PK', { maximumFractionDigits: small ? 2 : 0 });
  return currency === 'PKR' ? `Rs ${n}` : `${n} ${currency}`;
}

export const GRADE_META: Record<AdVerdict['grade'], { label: string; colour: string }> = {
  good: { label: 'Winning', colour: colors.success },
  ok: { label: 'On track', colour: colors.secondary },
  bad: { label: 'Needs a fix', colour: colors.danger },
  learning: { label: 'Learning', colour: colors.muted },
  idle: { label: 'Not running', colour: colors.muted },
};

/** One word for where a campaign stands, Meta's states folded into ours. */
export function campaignState(c: AdCampaignDoc, nowMs: number): { label: string; colour: string } {
  if (c.approval === 'pending' && c.status !== 'ACTIVE') return { label: 'Waiting for your Approve', colour: colors.warn };
  if (c.review?.startsWith('Rejected')) return { label: 'Rejected by Meta', colour: colors.danger };
  if (c.review) return { label: 'In Meta review', colour: colors.warn };
  if (c.endMs && nowMs && c.endMs < nowMs) return { label: 'Finished', colour: colors.muted };
  if (c.status === 'ACTIVE' && c.effectiveStatus === 'ACTIVE') return { label: 'Running', colour: colors.success };
  if (c.status === 'ARCHIVED') return { label: 'Ended', colour: colors.muted };
  if (c.status === 'PAUSED') return { label: 'Paused', colour: colors.muted };
  return { label: c.effectiveStatus.toLowerCase().replace(/_/g, ' '), colour: colors.warn };
}

/** Green, amber or red for a number against its normal range. Lower is better unless `higherIsBetter`. */
export function tone(value: number, band: { low: number; high: number } | undefined, higherIsBetter = false): string {
  if (!band || !value) return colors.text;
  if (higherIsBetter) return value >= band.high ? colors.success : value < band.low ? colors.danger : colors.text;
  return value <= band.low ? colors.success : value > band.high ? colors.danger : colors.text;
}
