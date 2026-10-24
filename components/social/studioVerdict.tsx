'use client';

/**
 * What our AI made of a Studio payment's receipt, as one badge and a list of
 * the checks behind it. Shared by Velocity AI Studio's Users and Payments pages.
 */

import { colors } from '@/lib/config';
import type { StudioPaymentAnalysis } from '@/lib/api';
import { Badge } from '@/components/ui';

const VERDICT = {
  match: { label: 'AI: matches', color: colors.success },
  check: { label: 'AI: check it', color: colors.warn },
  mismatch: { label: 'AI: does not match', color: colors.danger },
} as const;

/** `undefined`: sent before the check existed. `null`: the check is still reading it. */
export function VerdictBadge({ analysis }: { analysis: StudioPaymentAnalysis | null | undefined }) {
  if (analysis === undefined) return null;
  if (analysis === null) return <Badge label="AI: reading…" color={colors.muted} />;
  const v = VERDICT[analysis.verdict];
  return <Badge label={v.label} color={v.color} />;
}

export function VerdictChecks({ analysis }: { analysis: StudioPaymentAnalysis }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 13 }}>
      {analysis.checks.map((c) => (
        <li key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span
            aria-label={c.ok === true ? 'agrees' : c.ok === false ? 'contradicts' : 'unknown'}
            style={{
              fontWeight: 900,
              width: 14,
              color: c.ok === true ? colors.success : c.ok === false ? colors.danger : colors.warn,
            }}
          >
            {c.ok === true ? '✓' : c.ok === false ? '✗' : '?'}
          </span>
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}
