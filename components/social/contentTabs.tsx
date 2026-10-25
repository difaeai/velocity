'use client';

/**
 * One header for the two halves of the content page — everything the team
 * made, and the month as planned — so they read as one place. Each half keeps
 * its own route, so a link or a refresh lands on the right one.
 */

import Link from 'next/link';

import { colors } from '@/lib/config';

const TABS = [
  { key: 'content', href: '/dashboard/social/queue', label: '🎬 Everything made' },
  { key: 'calendar', href: '/dashboard/social/calendar', label: '🗓️ Calendar' },
] as const;

export function ContentTabs({ active, children }: { active: (typeof TABS)[number]['key']; children?: React.ReactNode }) {
  return (
    <header style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px', letterSpacing: '-.02em' }}>Content &amp; calendar</h1>
        <p style={{ color: colors.muted, margin: '0 0 12px' }}>
          Everything the team made, and the month ahead. Open a piece to approve it, or say what to fix.
        </p>
        <nav role="tablist" aria-label="Content" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 14, background: '#e9efeb' }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.href}
                role="tab"
                aria-selected={on}
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  fontSize: 13.5,
                  fontWeight: 800,
                  background: on ? colors.surface : 'transparent',
                  color: on ? colors.primary : colors.muted,
                  boxShadow: on ? '0 2px 8px rgba(0,57,36,.12)' : 'none',
                  transition: 'background .2s ease, color .2s ease',
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </header>
  );
}
