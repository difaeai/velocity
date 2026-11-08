'use client';

/**
 * A plan card's list: each line is something Vexa says about that plan, beside
 * a small picture of the job or the logo of the network it is done on.
 *
 * One line is lit at a time and its picture plays. While she is reading the
 * card's line the lit one is the line she has reached; otherwise the light walks
 * down the list, but only while the list is on screen. With reduced motion
 * nothing walks and only her reading lights a line.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { StudioPlanId } from '@/lib/studio';
import { planVoice, useVexa } from './Assistant';
import { bulletMarks } from './captions';
import { voiceNow } from './siteSound';
import { useReducedMotion } from './useReducedMotion';
import s from './planJobs.module.css';

const BEAT_MS = 1700;
const at = (i: number) => ({ ['--d' as string]: i }) as CSSProperties;

function Logo({ name }: { name: string }) {
  // Tiny static brand marks: next/image would only re-encode them.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/site/logos/${name}.svg`} alt="" width={24} height={24} draggable={false} />;
}

const Pic = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ART: Record<string, ReactNode> = {
  market: (
    <Pic>
      <path d="M4 24h20" />
      <rect className={s.bar} x="6" y="14" width="4" height="10" rx="1" fill="currentColor" stroke="none" />
      <rect className={s.bar} style={at(1)} x="12" y="9" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect className={s.bar} style={at(2)} x="18" y="4" width="4" height="20" rx="1" fill="currentColor" stroke="none" />
    </Pic>
  ),
  rivals: (
    <Pic>
      <circle cx="14" cy="14" r="11" opacity=".4" />
      <circle cx="14" cy="14" r="5.5" opacity=".4" />
      <path className={s.sweep} d="M14 14V3" />
      <circle className={s.blip} cx="20" cy="9" r="2" fill="currentColor" stroke="none" />
    </Pic>
  ),
  social: (
    <span className={s.pair}>
      <Logo name="instagram" />
      <Logo name="facebook" />
    </span>
  ),
  audience: (
    <Pic>
      {[
        [7, 0],
        [21, 1],
        [14, 2],
      ].map(([x, d]) => (
        <g key={x} className={s.person} style={at(d)}>
          <circle cx={x} cy="10" r="3.2" />
          <path d={`M${x - 5} 23c0-4 2-6.5 5-6.5s5 2.500 5 6.500`} />
        </g>
      ))}
    </Pic>
  ),
  see: (
    <Pic>
      <g className={s.blink}>
        <path d="M2 14c3-5.500 7-8 12-8s9 2.500 12 8c-3 5.500-7 8-12 8s-9-2.500-12-8Z" />
        <circle className={s.pupil} cx="14" cy="14" r="3.500" fill="currentColor" stroke="none" />
      </g>
    </Pic>
  ),
  calendar: (
    <Pic>
      <rect x="3.500" y="5.500" width="21" height="19" rx="3" />
      <path d="M3.500 11h21M9 3v4M19 3v4" />
      {[
        [9, 15.500],
        [14, 15.500],
        [19, 15.500],
        [9, 20],
        [14, 20],
        [19, 20],
      ].map(([x, y], i) => (
        <circle key={i} className={s.day} style={at(i)} cx={x} cy={y} r="1.500" fill="currentColor" stroke="none" />
      ))}
    </Pic>
  ),
  film: (
    <Pic>
      <rect x="3" y="6" width="22" height="16" rx="3" />
      <path className={s.strip} d="M3 9.500h22M3 18.500h22" strokeDasharray="2.500 3" />
      <path className={s.play} d="M12 11l5.500 3-5.500 3Z" fill="currentColor" stroke="none" />
    </Pic>
  ),
  clock: (
    <Pic>
      <circle cx="14" cy="14" r="11" />
      <path d="M14 14l5 3" />
      <path className={s.hand} d="M14 14V6" />
    </Pic>
  ),
  comments: (
    <Pic>
      <path d="M4 7a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-9l-5 4.500V20a3 3 0 0 1-3-3Z" />
      {[9, 14, 19].map((x, i) => (
        <circle key={x} className={s.dot} style={at(i)} cx={x} cy="12" r="1.500" fill="currentColor" stroke="none" />
      ))}
    </Pic>
  ),
  product: (
    <Pic>
      <path d="M14 3l10 5.500v11L14 25 4 19.500v-11Z" />
      <path d="M4 8.500 14 14l10-5.500M14 14v11" opacity=".5" />
      <path className={s.scan} d="M1 14h26" strokeWidth="2.200" />
    </Pic>
  ),
  route: (
    <Pic>
      <path className={s.draw} pathLength={100} d="M4 24c7 0 4-10 10-10s4-9 10-9" />
      <circle className={s.arrive} cx="24" cy="5" r="2.500" fill="currentColor" stroke="none" />
      <circle cx="4" cy="24" r="1.800" fill="currentColor" stroke="none" />
    </Pic>
  ),
  metaAds: (
    <span className={s.trio}>
      <Logo name="meta" />
      <Logo name="instagram" />
      <Logo name="facebook" />
    </span>
  ),
  googleAds: <Logo name="google-ads" />,
  mail: <Logo name="gmail" />,
  solo: (
    <Pic>
      <path className={s.star} d="M14 3c1 6 4 9 10 11-6 2-9 5-10 11-1-6-4-9-10-11 6-2 9-5 10-11Z" fill="currentColor" stroke="none" />
    </Pic>
  ),
};

/** The same order as the plan's `includes` in lib/studio.ts. */
const PICTURES: Partial<Record<StudioPlanId, string[]>> = {
  research: ['market', 'social', 'audience', 'see'],
  content: ['calendar', 'film', 'clock', 'comments'],
  all: ['product', 'rivals', 'route', 'film', 'metaAds', 'googleAds', 'comments', 'mail', 'solo'],
};

/** Which line she has reached while she reads this plan's voice line. */
function useReading(plan: StudioPlanId, lines: string[]) {
  const owner = planVoice(plan);
  const talking = useVexa().line === owner;
  const [reached, setReached] = useState(-1);

  useEffect(() => {
    if (!talking) return;
    const marks = bulletMarks(owner, lines);
    let timer = 0;
    const tick = () => {
      const v = voiceNow();
      const share = v.length ? v.at / v.length : 0;
      setReached(marks.reduce((cur, mark, i) => (mark >= 0 && mark <= share ? i : cur), -1));
      timer = window.setTimeout(tick, 200);
    };
    timer = window.setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [talking, owner, lines]);

  return { talking, reached: talking ? reached : -1 };
}

export function PlanJobs({ plan, lines, className }: { plan: StudioPlanId; lines: string[]; className: string }) {
  const reduced = useReducedMotion();
  const { talking, reached } = useReading(plan, lines);
  const list = useRef<HTMLUListElement>(null);
  const [inView, setInView] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    if (list.current) io.observe(list.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduced || talking) return;
    const t = setInterval(() => setBeat((b) => b + 1), BEAT_MS);
    return () => clearInterval(t);
  }, [inView, reduced, talking]);

  const lit = talking ? reached : reduced ? -1 : beat % lines.length;
  // A short list shares a card as tall as the longest plan's: its rows grow to fill it.
  const roomy = lines.length <= 5;

  return (
    <ul ref={list} className={`${className} ${roomy ? s.fill : ''}`}>
      {lines.map((line, j) => (
        <li key={line} className={`${s.job} ${roomy ? s.roomy : ''} ${j === lit ? s.on : ''}`} style={{ ['--j' as string]: j }}>
          <span className={s.tile} aria-hidden>
            {ART[PICTURES[plan]?.[j] ?? 'solo']}
          </span>
          <span className={s.words}>{line}</span>
        </li>
      ))}
    </ul>
  );
}
