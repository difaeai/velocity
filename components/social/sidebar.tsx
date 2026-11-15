'use client';

/**
 * The console's sidebar.
 *
 * What it replaces was a flat list of links under two headings. That is a filing
 * cabinet, not a nav: it tells you where things are filed, never what any of
 * them is for, and a person who has just paid for Vexa opens it and cannot say
 * which of eleven links is "the thing that posts my reels".
 *
 * So the links are grouped by the question the owner actually arrives with, and
 * every group says in one line what that part of the business does:
 *
 *   Content   — this is what goes out
 *   Ads       — this is what you pay to be seen
 *   Sales     — this is Vexa talking to people and closing them
 *   Research  — this is what the market is doing
 *   Set up    — connect it once, then forget it
 *
 * Mechanically there are four things worth knowing:
 *
 *  • **One highlight, not one per row.** A single pill is measured onto the
 *    active link and glides between them (`useLayoutEffect` reads the row's box,
 *    CSS transitions the transform). Twenty rows each fading their own
 *    background reads as twenty things changing; one thing moving reads as one.
 *  • **Groups fold.** Height is animated with `grid-template-rows: 1fr → 0fr`,
 *    which is the only way to transition to content-height without measuring it
 *    in JavaScript. The open/shut state is per browser, in `localStorage`.
 *  • **The whole thing folds to a rail.** 252px to 76px, labels clipped rather
 *    than unmounted so the fold is smooth, and a hovered icon in rail mode
 *    shows its label in a tooltip — otherwise a rail is a row of riddles.
 *  • **It is one component for both consoles.** Velocity's own admin sidebar
 *    and a Vexa customer's sidebar were the same forty lines of markup twice;
 *    now they are the same component with different groups.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useDraft } from '@/lib/draft';
import { NAV_ICON_CSS, NavIcon, type NavIconName } from './navIcons';

export interface SideItem {
  href: string;
  label: string;
  icon: NavIconName;
  /** Other paths that should light this row up — a page and its sub-pages. */
  also?: string[];
}

export interface SideGroup {
  /** '' for the ungrouped rows at the top, which never fold. */
  title: string;
  /** One line saying what this part of the business does. The point of the group. */
  caption?: string;
  /** The accent this group's icons and highlight take. */
  tint?: string;
  items: SideItem[];
}

/** Whether a row owns the current path. */
const owns = (item: SideItem, pathname: string): boolean =>
  pathname === item.href || (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function Sidebar({
  groups,
  pathname,
  brand,
  top,
  footer,
  storageKey,
}: {
  groups: SideGroup[];
  pathname: string;
  /** The logo row — a link to wherever "home" is for this console. */
  brand: React.ReactNode;
  /** Anything between the brand and the nav (the section switcher, the plan line). */
  top?: React.ReactNode;
  /** The account menu and the help launcher. */
  footer?: React.ReactNode;
  storageKey: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number; tint: string } | null>(null);

  // How you left the menu is this browser's business, not the account's, and it
  // has to survive a reload. `useDraft` is exactly that — a scrap of text kept
  // in this browser — so it is used rather than a second copy of the same idea.
  const [railRaw, setRail] = useDraft(`${storageKey}.rail`);
  const [shutRaw, setShut] = useDraft(`${storageKey}.shut`);
  const rail = railRaw === '1';
  let shut: Record<string, boolean> = {};
  try {
    shut = shutRaw ? (JSON.parse(shutRaw) as Record<string, boolean>) : {};
  } catch {
    /* somebody edited it by hand, or it was written by an older version */
  }

  const toggleRail = () => setRail(rail ? '' : '1');
  const toggleGroup = (title: string) => setShut(JSON.stringify({ ...shut, [title]: !shut[title] }));

  // The highlight is measured onto the open row rather than drawn by it, so one
  // element glides instead of two fading. Layout effect: before the paint, so it
  // never flashes at the top on the first render.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const row = nav?.querySelector<HTMLElement>('[data-open="1"]');
    if (!nav || !row) {
      setPill(null);
      return;
    }
    setPill({
      y: row.offsetTop,
      h: row.offsetHeight,
      tint: row.dataset.tint || 'var(--forest)',
    });
  }, [pathname, groups, shutRaw, rail]);

  return (
    <aside className={`sb${rail ? ' rail' : ''}`} data-tour="nav">
      <style>{NAV_ICON_CSS + SIDEBAR_CSS}</style>

      <div className="sb-brand">
        {brand}
        <button
          type="button"
          className="sb-fold"
          onClick={toggleRail}
          aria-label={rail ? 'Widen the menu' : 'Narrow the menu'}
          title={rail ? 'Widen the menu' : 'Narrow the menu'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 6.5 9 12l5.5 5.5" />
          </svg>
        </button>
      </div>

      {rail ? null : top}

      <nav ref={navRef} className="sb-nav">
        {pill ? (
          <span
            className="sb-pill"
            aria-hidden
            style={{ transform: `translateY(${pill.y}px)`, height: pill.h, ['--tint' as string]: pill.tint }}
          />
        ) : null}

        {groups.map((group) => {
          const folded = Boolean(group.title) && Boolean(shut[group.title]);
          const tint = group.tint ?? 'var(--forest)';
          // A folded group that holds the open page keeps a mark, so you can see
          // where you are without opening it.
          const holdsOpen = group.items.some((i) => owns(i, pathname));
          return (
            <div key={group.title || 'root'} className="sb-group" style={{ ['--tint' as string]: tint }}>
              {group.title ? (
                <button
                  type="button"
                  className={`sb-title${folded ? ' folded' : ''}${holdsOpen ? ' here' : ''}`}
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!folded}
                  data-label={group.title}
                >
                  <span className="t">{group.title}</span>
                  <svg className="sb-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
                  </svg>
                </button>
              ) : null}

              <div className={`sb-fold-box${folded ? ' shut' : ''}`}>
                <div className="sb-fold-in">
                  {group.caption && !rail ? <p className="sb-caption">{group.caption}</p> : null}
                  {group.items.map((item) => {
                    const open = owns(item, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`sb-row${open ? ' ni-live open' : ''}`}
                        data-open={open ? '1' : '0'}
                        data-tint={tint}
                        data-label={item.label}
                        aria-current={open ? 'page' : undefined}
                      >
                        <NavIcon name={item.icon} />
                        <span className="sb-label">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sb-foot">{footer}</div>
    </aside>
  );
}

export const SIDEBAR_CSS = `
.sb { --w: 252px; --forest:#004c31; --lime:#ccff00; --line:#e2e8e4; --muted:#6f7a72;
  width: var(--w); flex: none; padding: 16px 14px 14px; display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh; overflow: visible; z-index: 30;
  background: var(--glass-sheen, rgba(255,255,255,.72)); backdrop-filter: var(--glass-blur, blur(14px)); -webkit-backdrop-filter: var(--glass-blur, blur(14px));
  border-right: 1px solid var(--glass-edge, var(--line));
  transition: width .42s cubic-bezier(.3,1,.35,1), padding .42s cubic-bezier(.3,1,.35,1); }
.sb.rail { --w: 76px; padding-left: 12px; padding-right: 12px; }

.sb-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; min-height: 36px; }
.sb-brand > a { display: flex; align-items: center; gap: 10px; min-width: 0; font-weight: 900; letter-spacing: -.01em; }
.sb-fold { margin-left: auto; width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 8px;
  border: 1px solid var(--line); background: #fff; color: var(--muted); cursor: pointer; opacity: 0; transition: opacity .2s ease, color .2s ease, border-color .2s ease; }
.sb:hover .sb-fold, .sb-fold:focus-visible { opacity: 1; }
.sb-fold:hover { color: var(--forest); border-color: #a8d5bd; }
.sb-fold svg { transition: transform .42s cubic-bezier(.3,1.5,.5,1); }
/* 76px will not hold a wordmark, a name and a button side by side, so the rail
   stacks what is left of the brand: the mark, then the button under it. */
.sb.rail .sb-brand { flex-direction: column; gap: 8px; }
.sb.rail .sb-brand > a { gap: 0; }
.sb.rail .sb-brand > a > *:not(:first-child) { display: none; }
.sb.rail .sb-fold { opacity: 1; margin: 0; }
.sb.rail .sb-fold svg { transform: rotate(180deg); }

.sb-nav { position: relative; display: grid; gap: 2px; margin-top: 6px; overflow-y: auto; overflow-x: visible; flex: 1; min-height: 0;
  scrollbar-width: thin; padding-right: 2px; }

/* the one highlight, measured onto the open row */
.sb-pill { position: absolute; left: 0; right: 2px; top: 0; border-radius: 12px; pointer-events: none; z-index: 0;
  background: linear-gradient(100deg, color-mix(in srgb, var(--tint) 13%, transparent), color-mix(in srgb, var(--tint) 5%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent);
  transition: transform .4s cubic-bezier(.3,1.2,.4,1), height .4s cubic-bezier(.3,1.2,.4,1), background .3s ease; }
.sb-pill::before { content: ''; position: absolute; left: 0; top: 50%; width: 3px; height: 17px; margin-top: -8.5px; border-radius: 0 3px 3px 0; background: var(--tint); }

.sb-group { display: grid; }
.sb-title { display: flex; align-items: center; gap: 6px; width: 100%; padding: 15px 10px 5px; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 10.5px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); text-align: left;
  transition: color .2s ease; }
.sb-title:hover { color: var(--forest); }
.sb-title .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-title.here .t { color: var(--tint); }
.sb-chev { margin-left: auto; flex: none; opacity: .55; transition: transform .35s cubic-bezier(.3,1.4,.5,1), opacity .2s ease; }
.sb-title:hover .sb-chev { opacity: 1; }
.sb-title.folded .sb-chev { transform: rotate(-90deg); }
.sb-title.folded.here::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--tint); flex: none; margin-left: 2px; }

/* 0fr → 1fr is how a height animates to content without measuring it */
.sb-fold-box { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .36s cubic-bezier(.3,1,.35,1), opacity .25s ease; }
.sb-fold-box > .sb-fold-in { overflow: hidden; display: grid; gap: 2px; min-height: 0; }
.sb-fold-box.shut { grid-template-rows: 0fr; opacity: 0; }

.sb-caption { margin: 0 0 6px; padding: 0 10px; font-size: 11.5px; line-height: 1.45; color: var(--muted); }

.sb-row { position: relative; z-index: 1; display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 12px;
  font-size: 13.5px; font-weight: 700; color: #1c1b1b; min-width: 0; transition: color .2s ease, background .2s ease, transform .18s ease; }
.sb-row:hover { color: var(--tint); background: color-mix(in srgb, var(--tint) 7%, transparent); }
.sb-row:active { transform: scale(.985); }
.sb-row.open { color: var(--tint); background: none; }
.sb-row .ni { color: var(--muted); transition: color .25s ease, transform .3s cubic-bezier(.3,1.5,.5,1); }
.sb-row:hover .ni, .sb-row.open .ni { color: var(--tint); }
.sb-row.open .ni { transform: scale(1.06); }
.sb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .26s ease; }

/* the rail: icons only, with the label as a tooltip that slides out */
.sb.rail .sb-row { justify-content: center; padding: 11px 0; gap: 0; }
.sb.rail .sb-label, .sb.rail .sb-caption, .sb.rail .sb-title .t, .sb.rail .sb-chev { opacity: 0; width: 0; padding: 0; margin: 0; overflow: hidden; }
.sb.rail .sb-title { padding: 12px 0 4px; justify-content: center; pointer-events: none; }
.sb.rail .sb-title::before { content: ''; width: 18px; height: 2px; border-radius: 2px; background: var(--line); }
.sb.rail .sb-row::after { content: attr(data-label); position: absolute; left: calc(100% + 10px); top: 50%; transform: translate(-6px, -50%) scale(.96);
  background: #0b1f17; color: #fff; font-size: 12.5px; font-weight: 700; padding: 7px 11px; border-radius: 9px; white-space: nowrap;
  opacity: 0; pointer-events: none; z-index: 40; box-shadow: 0 10px 28px -12px rgba(4,35,26,.6);
  transition: opacity .18s ease, transform .22s cubic-bezier(.3,1.5,.5,1); }
.sb.rail .sb-row:hover::after, .sb.rail .sb-row:focus-visible::after { opacity: 1; transform: translate(0, -50%) scale(1); }

.sb-foot { margin-top: auto; padding-top: 14px; }

@media (max-width: 860px) {
  .sb { --w: 76px; padding-left: 12px; padding-right: 12px; }
  .sb .sb-label, .sb .sb-caption, .sb .sb-title .t, .sb .sb-chev, .sb-fold { display: none; }
  .sb .sb-row { justify-content: center; padding: 11px 0; gap: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .sb, .sb *, .sb *::before, .sb *::after { transition: none !important; animation: none !important; }
}
`;
