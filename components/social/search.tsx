'use client';

/**
 * Where the console can take you — the rows under the one box you type in.
 *
 * Vexa is eleven pages behind five department headings, and finding anything
 * meant reading all of it (owner, 2026-11-15). So: type two letters and go.
 * "wa" is the WhatsApp agent, "ad" is the Ad Expert, "price" is the plans page.
 *
 * This searches its own small list rather than the sidebar's nav, because what
 * people type is not what the pages are called — "boost", "budget" and
 * "facebook ads" all mean the Ad Expert, and "token" and "connect" both mean
 * Connected accounts. That list of other words is the whole value of a search
 * over a menu, and the menu has nowhere to keep it.
 *
 * It had its own box until the owner counted three boxes asking him to type
 * something (2026-11-16) and asked for one that does everything. So the rows
 * moved under the Brain's prompt: the same words that send work to an agent
 * also open a page, and a sentence long enough to be a brief matches nothing —
 * nobody navigates in eight words.
 *
 * A page the plan does not include is not offered: the server would refuse it
 * and the sidebar does not show it either.
 */

import Link from 'next/link';

import type { StudioNeeds } from '@/lib/studio';
import { NavIcon, type NavIconName } from './navIcons';

export interface Spot {
  href: string;
  label: string;
  /** Which department it belongs to, shown on the row. */
  dept: string;
  icon: NavIconName;
  /** The other words people use for it. */
  keys: string;
  need: StudioNeeds;
}

const SPOTS: Spot[] = [
  { href: '/dashboard/social/queue', label: 'Content & calendar', dept: 'Content', icon: 'content', need: 'content', keys: 'posts reels videos pictures stories calendar schedule queue approve waiting drafts' },
  { href: '/dashboard/social/inbox', label: 'Comments', dept: 'Content', icon: 'comments', need: 'content', keys: 'comments replies questions answers dm messages' },
  { href: '/dashboard/social/performance', label: 'Analytics', dept: 'Content', icon: 'analytics', need: ['content', 'research'], keys: 'analytics numbers reach views likes followers growth results' },
  { href: '/dashboard/social/ads', label: 'Meta & Google Ad Expert', dept: 'Ads', icon: 'ads', need: 'ads', keys: 'ads advert campaign boost budget spend facebook instagram google roas' },
  { href: '/dashboard/social/whatsapp', label: 'WhatsApp sales', dept: 'Sales', icon: 'whatsapp', need: 'sales', keys: 'whatsapp wa chats closer conversations leads customers selling' },
  { href: '/dashboard/social/email', label: 'Email agent', dept: 'Sales', icon: 'email', need: 'sales', keys: 'email mail mailbox gmail smtp inbox outreach' },
  { href: '/dashboard/social/sales', label: 'Finding customers', dept: 'Sales', icon: 'calls', need: 'sales', keys: 'calls calling voice agents cold prospects businesses finding' },
  { href: '/dashboard/social/research', label: 'Research Assistant', dept: 'Research', icon: 'research', need: 'research', keys: 'research market competitors rivals trends what is working' },
  { href: '/dashboard/social/accounts', label: 'Connected accounts', dept: 'Set up', icon: 'plug', need: 'any', keys: 'connect connected accounts instagram facebook youtube tiktok token plug link' },
  { href: '/dashboard/social/employees', label: 'Your AI team', dept: 'Set up', icon: 'agents', need: 'content', keys: 'team employees staff hire writer designer editor' },
  { href: '/dashboard/social/automation', label: 'Settings', dept: 'Set up', icon: 'settings', need: 'content', keys: 'settings goal time run daily automation language pause' },
  { href: '/dashboard/social/upgrade', label: 'Plans & upgrade', dept: 'Account', icon: 'plan', need: 'any', keys: 'plan plans price pricing upgrade pay payment billing money' },
  { href: '/dashboard/social/usage', label: 'Usage & credits', dept: 'Account', icon: 'usage', need: 'any', keys: 'usage credits left spend ai cost' },
];

/** The five rows shown before anything is typed — one per department. */
const START = ['/dashboard/social/queue', '/dashboard/social/ads', '/dashboard/social/whatsapp', '/dashboard/social/research', '/dashboard/social/accounts'];

/**
 * The pages that match what was typed, best first.
 *
 * Three rules, each one a thing the single box has to get right:
 *  - nothing typed yet: the five departments, so the box still answers "where
 *    can I go?" without being a second box that asks;
 *  - every word has to match something, so "google ads" is not every page with
 *    the word ads on it;
 *  - more than four words is a brief, not a destination — a sentence about a
 *    reel for Lahore must not offer to open a page, or the rows would flicker
 *    under every brief anybody writes.
 */
export function pageHits(q: string, includes: (need: StudioNeeds) => boolean, max = 6): Spot[] {
  const mine = SPOTS.filter((s) => includes(s.need));
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return mine.filter((s) => START.includes(s.href));
  if (words.length > 4) return [];
  return mine
    .filter((s) => {
      const hay = `${s.label} ${s.dept} ${s.keys}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, max);
}

/** The rows themselves. `at` is the one the arrow keys have landed on. */
export function PageRows({ hits, at, onAt }: { hits: Spot[]; at: number; onAt: (i: number) => void }) {
  if (!hits.length) return null;
  return (
    <ul className="vs-list" id="vs-list">
      {hits.map((s, i) => (
        <li key={s.href}>
          <Link href={s.href} className={`vs-row${i === at ? ' on' : ''}`} onMouseEnter={() => onAt(i)}>
            <span className="vs-ico" aria-hidden>
              <NavIcon name={s.icon} size={17} />
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{s.label}</strong>
              <em>{s.dept}</em>
            </span>
            <span className="vs-go" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export const SEARCH_CSS = `
.vs-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 2px; }
.vs-row { display: flex; align-items: center; gap: 11px; padding: 8px 10px; margin: 0 -10px; border-radius: 12px; text-decoration: none;
  color: inherit; transition: background .18s ease, transform .18s ease; }
.vs-row.on { background: #f1f7f3; transform: translateX(3px); }
.vs-ico { flex: none; width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: #eef2ef; color: #004c31;
  transition: background .2s ease, color .2s ease; }
.vs-row.on .vs-ico { background: #004c31; color: #ccff00; }
.vs-row strong { display: block; font-size: 13.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vs-row em { display: block; font-style: normal; font-size: 11.5px; color: var(--muted); margin-top: 1px; }
.vs-go { flex: none; margin-left: auto; width: 7px; height: 7px; border-right: 2px solid #c3cdc7; border-top: 2px solid #c3cdc7;
  transform: rotate(45deg); transition: border-color .2s ease, transform .2s ease; }
.vs-row.on .vs-go { border-color: #004c31; transform: rotate(45deg) translate(2px, -2px); }
.vs-none { font-size: 12.5px; color: var(--muted); line-height: 1.55; padding: 8px 0; }

@media (prefers-reduced-motion: reduce) { .vs-row, .vs-ico, .vs-go { transition: none !important; } }

`;
