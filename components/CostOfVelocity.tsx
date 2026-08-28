'use client';

/**
 * The fifth tile on the Overview — the one that costs money rather than makes
 * it. It reads the same document the breakdown page writes, so the headline and
 * the detail can never disagree, and it is a link because a total on its own
 * only ever raises the question of what is in it.
 *
 * The preview is the top three vendors, not all eleven: the point of a tile is
 * the one number plus enough shape to know whether the number is surprising.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { CategoryBars, compact } from '@/components/charts';
import {
  COST_COLLECTION,
  COST_DOC,
  type StoredCostConfig,
  pkr,
  resolveCosts,
  summarise,
} from '@/lib/costs';

export function CostOfVelocityTile() {
  const [stored, setStored] = useState<StoredCostConfig | null | undefined>(undefined);

  useEffect(
    () =>
      onSnapshot(
        doc(db, COST_COLLECTION, COST_DOC),
        (snap) => setStored((snap.data() as StoredCostConfig | undefined) ?? null),
        () => setStored(null),
      ),
    [],
  );

  const { items, usdToPkr } = resolveCosts(stored ?? null);
  const s = summarise(items, usdToPkr);
  const priced = s.monthly > 0 || s.oneTime > 0;

  // Three named vendors and a tail, so no bar is a sliver nobody can read.
  const top = s.byPlatform.slice(0, 3);
  const tail = s.byPlatform.slice(3).reduce((n, p) => n + p.value, 0);
  const bars = tail > 0 ? [...top, { label: `${s.byPlatform.length - 3} more`, value: tail }] : top;

  return (
    <Link
      href="/dashboard/costs"
      style={{
        display: 'block',
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 18,
        color: colors.text,
      }}
    >
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: colors.muted, fontSize: 12.5, fontWeight: 600 }}>
              Cost of Velocity
            </span>
            <span style={{ color: colors.secondary, fontSize: 12, fontWeight: 800 }}>
              Full breakdown →
            </span>
          </div>

          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15, marginTop: 6 }}>
            {priced ? pkr(s.monthly) : 'Not priced yet'}
            {priced ? (
              <span style={{ color: colors.muted, fontSize: 14, fontWeight: 700 }}> a month</span>
            ) : null}
          </div>

          <div style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>
            {priced
              ? [
                  `${s.activeCount} services being paid for`,
                  `${pkr(s.yearly)} a year`,
                  s.oneTime > 0 ? `${pkr(s.oneTime)} one-off` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `${s.activeCount} third-party services are on the bill — put a number against each one.`}
          </div>

          {s.unpriced.length > 0 && priced ? (
            <div style={{ color: colors.warn, fontSize: 12, marginTop: 5, fontWeight: 600 }}>
              {s.unpriced.length} of {s.activeCount} {s.unpriced.length === 1 ? 'has' : 'have'} no
              amount yet, so the total is low.
            </div>
          ) : null}
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          {bars.length ? (
            <CategoryBars
              items={bars}
              valueFormat={(n) => `${compact(n)} PKR`}
              emptyLabel="Nothing priced yet."
            />
          ) : (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
              Firebase, Meta, Anthropic, Google Maps and the rest — open the breakdown to say what
              each one costs.
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
