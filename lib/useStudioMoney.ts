'use client';

import { useSyncExternalStore } from 'react';

import { studioMoney, type StudioMoney } from './studio';

const never = () => () => {};
const here = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

/**
 * Prices in the money of whoever is looking, worked out from the zone their
 * browser keeps — so only Pakistan is quoted in rupees.
 *
 * The server cannot know where a visitor is, so it renders the dollar price and
 * the right one takes over on hydration; a subscription rather than state in an
 * effect keeps that one render, with no flash of the wrong currency after paint.
 */
export function useStudioMoney(): (usd: number) => StudioMoney {
  const zone = useSyncExternalStore(never, here, () => '');
  return (usd) => studioMoney(usd, zone);
}
