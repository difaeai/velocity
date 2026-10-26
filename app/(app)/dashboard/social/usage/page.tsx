'use client';

/**
 * Velocity Studio → Usage & credits. How long the plan has left, how much of
 * this month's AI work is used, the credit balance, and every credit day —
 * shown as the customer pays for it, $1 a day. What a day really cost lives in
 * the admin-only AI meter and never reaches this page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { studioApi } from '@/lib/api';
import { STUDIO_CREDIT_DAY_USD, STUDIO_PLANS, type StudioCreditEntry } from '@/lib/studio';
import a from '../account.module.css';

const WHY: Record<StudioCreditEntry['why'], string> = {
  bought: 'Credits added',
  lapsed: 'Your team worked on credit — the plan had run out',
  allowance: 'Your team worked on credit — this month’s AI work was used up',
};

export default function UsagePage() {
  const { wid, ws } = useWorkspace();
  const [usage, setUsage] = useState<{ usedPct: number; creditDaysThisMonth: number } | null>(null);
  const [log, setLog] = useState<(StudioCreditEntry & { id: string })[]>([]);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    studioApi
      .usage({})
      .then(setUsage)
      .catch(() => setUsage(null));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!wid) return;
    return onSnapshot(
      query(collection(db, 'workspaces', wid, 'creditLog'), orderBy('atMs', 'desc'), limit(40)),
      (snap) => setLog(snap.docs.map((d) => ({ ...(d.data() as StudioCreditEntry), id: d.id }))),
      () => setLog([]),
    );
  }, [wid]);

  if (!ws) return null;
  const until = Math.max(ws.trialEndsAtMs, ws.paidUntilMs);
  const live = nowMs > 0 && until > nowMs;
  const trial = live && ws.paidUntilMs <= nowMs;
  const left = live ? until - nowMs : 0;
  const leftText = !nowMs
    ? '…'
    : !live
      ? 'Run out'
      : left < 86_400_000
        ? `${Math.ceil(left / 3600_000)} h`
        : `${Math.floor(left / 86_400_000)} days`;
  const credits = ws.creditDays ?? 0;
  const pct = usage?.usedPct ?? 0;

  return (
    <div className={a.wrap}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 className={a.h1}>Usage &amp; credits</h1>
        <p className={a.muted}>What your team has left this month, and the days you have bought on top.</p>
      </header>

      <div className={a.cards}>
        <section className={a.card}>
          <div className={a.cardHead}>
            <h2 className={a.cardTitle}>{STUDIO_PLANS[ws.plan].name} plan</h2>
            <Link href="/dashboard/social/upgrade" className={a.back}>
              Change plan →
            </Link>
          </div>
          <span className={a.big}>{leftText}</span>
          <p className={a.muted}>
            {!live
              ? credits > 0
                ? 'Your plan has run out — a credit day starts within half an hour.'
                : 'Your plan has run out. Pay for a plan or add credits to start your team again.'
              : trial
                ? `left of your free trial — until ${when(until)}.`
                : `left — paid until ${when(until)}.`}
          </p>
        </section>

        <section className={a.card}>
          <div className={a.cardHead}>
            <h2 className={a.cardTitle}>This month’s AI work</h2>
            <span className={a.muted}>resets on the 1st</span>
          </div>
          <span className={a.big}>{usage ? `${pct}%` : '…'}</span>
          <div className={`${a.meter} ${pct >= 90 ? a.meterHot : ''}`} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI work used">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className={a.muted}>
            Your plan&apos;s month of reels, posts, carousels, comment replies{ws.plan === 'all' || ws.plan === 'ads' ? ' and ad checks' : ''},
            spread evenly so it lasts all 30 days. When it is used up, a credit day keeps the team going.
          </p>
        </section>

        <section className={a.card}>
          <div className={a.cardHead}>
            <h2 className={a.cardTitle}>Credits</h2>
            <Link href="/dashboard/social/upgrade#credits" className={a.back}>
              Add credits →
            </Link>
          </div>
          <span className={a.big}>${(credits * STUDIO_CREDIT_DAY_USD).toFixed(2)}</span>
          <p className={a.muted}>
            {credits} day{credits === 1 ? '' : 's'} of work at ${STUDIO_CREDIT_DAY_USD} a day
            {usage?.creditDaysThisMonth ? ` · ${usage.creditDaysThisMonth} used this month` : ''}. Used only when your plan has
            run out or this month&apos;s AI work is used up.
          </p>
        </section>
      </div>

      <section className={a.card}>
        <h2 className={a.cardTitle}>Credit history</h2>
        {log.length ? (
          <ul className={a.history}>
            {log.map((e) => (
              <li key={e.id}>
                <time>{new Date(e.atMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>
                <span>{WHY[e.why] ?? e.why}</span>
                <span className={e.usd > 0 ? a.plus : a.minus}>
                  {e.usd > 0 ? '+' : '−'}${Math.abs(e.usd).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={a.muted}>No credits yet. Your plan covers your team; credits are there for the days you want more.</p>
        )}
      </section>
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
