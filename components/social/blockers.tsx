'use client';

/**
 * What would stop the next run, in the order it would fail. Only genuine
 * problems appear; when there are none, nothing is drawn.
 */

import Link from 'next/link';

import { colors } from '@/lib/config';

export interface Blocker {
  label: string;
  why: string;
  href: string;
  cta: string;
  /** A hard stop, versus something that only limits what can be done. */
  hard: boolean;
}

/**
 * The things that would make the next run fail, in the order they would fail.
 *
 * Deliberately not the old checklist: a checklist with five green ticks and one
 * amber one reads as "mostly fine", and the desk is not mostly fine — it either
 * runs or it does not. Only genuine problems appear here, and when there are
 * none the strip is replaced by a single green line.
 */
export function readBlockers(
  readiness: { writer: boolean; engine?: 'claude' | 'gemini' | 'free' | 'local'; tokenVault: boolean } | null,
  staffed: number,
  connectedCount: number,
  brokenCount: number,
): Blocker[] {
  if (!readiness) return [];
  const out: Blocker[] = [];

  // This used to be the hard stop: with no key, nobody could research, write,
  // brief or reply, and a run died on the spot. The local engine ended that, so
  // it is no longer a blocker — but it is not nothing either. The piece still
  // gets written, scored and queued; it is composed from the brand material
  // rather than thought up, and it reads that way. Worth saying once, in warn
  // rather than danger, instead of letting somebody wonder why the voice
  // changed.
  if (readiness.engine === 'local') {
    out.push({
      label: 'Writing without a model',
      why: 'No model key is set, so the desk is using its local engine: it composes from the brand material, scores every candidate against the same checks and picks the best. Reliable and free, and plainer than a model. There is no live market read while it is on, and nothing auto-publishes.',
      href: '/dashboard/social/automation',
      cta: 'What this changes',
      hard: false,
    });
  }
  // Not a problem — it is a real model and it is free — but two things about
  // it are decisions rather than details, and neither is visible in the
  // writing itself. Said once, in warn, where the rest of the state is said.
  if (readiness.engine === 'free') {
    out.push({
      label: 'Writing with a free model',
      why: 'A free model is doing the thinking — the planning, the writing, the SEO, the picture and video plans, the replies, and change requests read properly again. The one thing it cannot do is search the web, so there is still no live market read: the desk says so rather than inventing one.',
      href: '/dashboard/social/automation',
      cta: 'What this changes',
      hard: false,
    });
  }
  if (staffed === 0) {
    out.push({
      label: 'Nobody is hired',
      why: 'An empty desk makes nothing. A content writer alone is enough to see a piece written end to end.',
      href: '/dashboard/social/employees',
      cta: 'Hire someone',
      hard: true,
    });
  }
  if (!readiness.tokenVault) {
    out.push({
      label: 'Credentials cannot be stored',
      why: 'SOCIAL_TOKEN_KEY is missing, so no account can be connected — a page token is a password and storing one in the clear is not an option.',
      href: '/dashboard/social/accounts',
      cta: 'Details',
      hard: true,
    });
  } else if (connectedCount === 0) {
    out.push({
      label: 'Nowhere to post',
      why: 'No account is connected yet. The team can still write and you can still approve, but nothing can go out.',
      href: '/dashboard/social/accounts',
      cta: 'Connect Instagram',
      hard: false,
    });
  }
  if (brokenCount > 0) {
    out.push({
      label: `${brokenCount} account${brokenCount === 1 ? '' : 's'} stopped working`,
      why: 'Most often an expired token. Until it is reconnected, posts to it fail at publish time rather than at approval.',
      href: '/dashboard/social/accounts',
      cta: 'Reconnect',
      hard: false,
    });
  }

  return out;
}

export function Blockers({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
      {blockers.map((b) => (
        <div
          key={b.label}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${b.hard ? `${colors.danger}3d` : `${colors.warn}3d`}`,
            background: b.hard ? `${colors.danger}0a` : `${colors.warn}0a`,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              marginTop: 6,
              flex: 'none',
              background: b.hard ? colors.danger : colors.warn,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13.5, display: 'block' }}>{b.label}</strong>
            <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>{b.why}</span>
          </div>
          <Link
            href={b.href}
            style={{ fontSize: 12.5, fontWeight: 800, color: colors.secondary, flex: 'none', paddingTop: 2 }}
          >
            {b.cta} →
          </Link>
        </div>
      ))}
    </div>
  );
}
