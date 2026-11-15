'use client';

/**
 * The search box, top left of the console's home page.
 *
 * Vexa is eleven pages behind five department headings, and the owner's
 * complaint about the dashboard was that finding anything meant reading all of
 * it (2026-11-15). So: type two letters and go. "wa" is the WhatsApp agent,
 * "ad" is the Ad Expert, "price" is the plans page.
 *
 * It searches its own small list rather than the sidebar's nav, because what
 * people type is not what the pages are called — "boost", "budget" and
 * "facebook ads" all mean the Ad Expert, and "token" and "connect" both mean
 * Connected accounts. That list of other words is the whole value of a search
 * box over a menu, and the menu has nowhere to keep it.
 *
 * A page the plan does not include is not offered: the server would refuse it
 * and the sidebar does not show it either.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useWorkspace } from '@/lib/workspace';
import type { StudioNeeds } from '@/lib/studio';
import { NavIcon, type NavIconName } from './navIcons';

interface Spot {
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

export function VexaSearch() {
  const { includes } = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const mine = useMemo(() => SPOTS.filter((s) => includes(s.need)), [includes]);

  const hits = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return mine.filter((s) => START.includes(s.href));
    // Every word has to match something, so "google ads" is not every page
    // with the word ads on it.
    return mine
      .filter((s) => {
        const hay = `${s.label} ${s.dept} ${s.keys}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 7);
  }, [q, mine]);

  const open = (to: number) => {
    const hit = hits[to];
    if (hit) router.push(hit.href);
  };

  return (
    <section className="vs fx-rise" style={{ ['--i' as string]: 0 } as React.CSSProperties} aria-labelledby="vs-h">
      <div className="fx-eyebrow" style={{ color: '#004c31' }}>
        Go anywhere
      </div>
      <h2 id="vs-h">What do you want to open?</h2>

      <div className="vs-field">
        <span className="vs-mag" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAt((n) => Math.min(n + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAt((n) => Math.max(n - 1, 0));
            } else if (e.key === 'Enter') {
              open(at);
            } else if (e.key === 'Escape') {
              setQ('');
            }
          }}
          type="search"
          autoComplete="off"
          aria-label="Search Vexa"
          aria-controls="vs-list"
          placeholder="Search — ads, whatsapp, calendar, price…"
        />
        {q ? (
          <button type="button" className="vs-x" onClick={() => setQ('')} aria-label="Clear">
            ✕
          </button>
        ) : null}
      </div>

      <ul className="vs-list" id="vs-list" ref={list}>
        {hits.map((s, i) => (
          <li key={s.href}>
            <Link href={s.href} className={`vs-row${i === at ? ' on' : ''}`} onMouseEnter={() => setAt(i)}>
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
        {!hits.length ? <li className="vs-none">Nothing by that name. Try ads, posts, whatsapp or price.</li> : null}
      </ul>
    </section>
  );
}

export const SEARCH_CSS = `
.vs { display: flex; flex-direction: column; border-radius: 26px; padding: 20px 22px; background: #fff; border: 1px solid var(--line);
  box-shadow: 0 1px 2px rgba(16,40,28,.04), 0 18px 40px -28px rgba(16,40,28,.28); min-width: 0; }
.vs h2 { margin: 5px 0 13px; font-size: 20px; font-weight: 900; letter-spacing: -.02em; line-height: 1.2; }

.vs-field { position: relative; display: flex; align-items: center; }
.vs-field input { width: 100%; height: 48px; border: 1px solid var(--line); border-radius: 14px; padding: 0 38px 0 42px; font: inherit;
  font-size: 14.5px; background: #f7faf8; transition: border-color .2s ease, box-shadow .2s ease, background .2s ease; }
.vs-field input::-webkit-search-cancel-button { display: none; }
.vs-field input:focus { outline: none; background: #fff; border-color: #9fd9b9; box-shadow: 0 0 0 4px rgba(204,255,0,.28); }
.vs-mag { position: absolute; left: 15px; width: 15px; height: 15px; border: 2px solid #6f7a72; border-radius: 50%; pointer-events: none;
  transition: border-color .2s ease; }
.vs-mag::after { content: ''; position: absolute; right: -5px; bottom: -4px; width: 7px; height: 2px; border-radius: 2px; background: #6f7a72;
  transform: rotate(45deg); }
.vs-field:focus-within .vs-mag, .vs-field:focus-within .vs-mag::after { border-color: #004c31; background: #004c31; }
.vs-field:focus-within .vs-mag { background: none; }
.vs-x { position: absolute; right: 10px; width: 24px; height: 24px; border: 0; border-radius: 50%; background: #eef2ef; color: #6f7a72;
  font-size: 11px; cursor: pointer; transition: background .2s ease; }
.vs-x:hover { background: #e0e7e3; }

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

@media (prefers-reduced-motion: reduce) { .vs * { transition: none !important; } }

/* The row the search and the Pulse share: where you are going on the left,
   what Vexa is doing on the right (owner, 2026-11-15). */
.vx-top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 16px; align-items: stretch; margin-bottom: 18px; }
@media (max-width: 900px) { .vx-top { grid-template-columns: minmax(0, 1fr); } }
`;
