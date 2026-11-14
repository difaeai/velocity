'use client';

/**
 * The two parts of the hero's offer that have to move with the price clock.
 *
 * The clock is per visitor: three days at today's price, then it really does
 * go up (`components/site/priceClock.ts`, PR #181). The price cards already
 * read it, so a hero with the figure baked into the HTML would tell a
 * returning visitor $32 while the card under it charged more. These two read
 * the same clock, so the page can never contradict itself.
 */

import { Bell } from '@/components/site/Icons';
import { usePriceRaised, usePriceSecondsLeft } from '@/components/site/priceClock';
import { STUDIO_ALL_USD, STUDIO_PRICE_RISE_USD, studioUsd } from '@/lib/studio';

import s from './studio.module.css';

/** The whole team's price as it stands for this visitor right now. */
export function HeroPrice() {
  const raised = usePriceRaised();
  return <>{studioUsd(STUDIO_ALL_USD + (raised ? STUDIO_PRICE_RISE_USD : 0))}</>;
}

const two = (n: number) => String(Math.floor(n)).padStart(2, '0');

/**
 * How long this price has left, beside the figure it applies to (owner,
 * 2026-11-14) rather than under the button, where it read as a condition on
 * the purchase instead of on the price.
 */
export function BuyTimer() {
  const left = usePriceSecondsLeft();

  // Still asking, or this visitor's window is over and the price already rose:
  // either way there is no countdown, and the price beside it is the whole point.
  if (left === null || left <= 0) return null;

  const days = Math.floor(left / 86400);
  return (
    <span className={s.buyTimer} role="timer" aria-label="Time left at this price">
      <Bell className={s.buyTimerBell} />
      Ends in
      <b>
        {days ? `${days}d ` : ''}
        {two((left / 3600) % 24)}:{two((left / 60) % 60)}:{two(left % 60)}
      </b>
    </span>
  );
}
