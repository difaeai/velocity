'use client';

/**
 * One half of the front door: the real site, live, in a frame of its own.
 *
 * The owner asked for velocityrides.app to open as two sections side by side —
 * the ride app on the left, Vexa on the right — each one the actual website,
 * with its own header, scrolling on its own, and a "Tap me to open" that takes
 * you inside. So each half is an iframe of the page itself rather than a
 * picture of it: the headers work, the films play, Vexa stands in her corner
 * and speaks, and nothing here has to be kept in step with the two sites.
 *
 * Anything the visitor follows inside the frame — a header link, a sign-up
 * button — leaves the door: the click is caught inside the frame's document
 * and the top window goes there, full screen. A link to a place on the same
 * page (#pricing) is left alone, so those still scroll the preview, which is
 * what they are for.
 */

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { ArrowRight } from './Icons';
import styles from './door.module.css';

export function DoorPane({
  href,
  name,
  line,
  children,
}: {
  href: string;
  name: string;
  line: string;
  children?: React.ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;

    /**
     * Anything the visitor follows inside the half opens full screen. Next's
     * own <Link> navigates without a page load, so it is the click that has to
     * be caught, in the capture phase before the router sees it.
     */
    const onClick = (e: Event) => {
      const win = el.contentWindow;
      const link = (e.target as Element | null)?.closest?.('a');
      if (!win || !link || (link.target && link.target !== '_self')) return;
      const to = new URL(link.href, win.location.href);
      // A link to a place on the same page is for scrolling this preview.
      if (to.origin === win.location.origin && to.pathname === win.location.pathname && to.hash) return;
      e.preventDefault();
      window.location.href = to.href;
    };

    const wire = () => {
      const win = el.contentWindow;
      // Same origin, so these reads are allowed; a redirect elsewhere would throw.
      try {
        if (!win) return;
        if (win.location.pathname !== href) {
          window.location.href = win.location.href;
          return;
        }
        // The same listener twice on the same document is one listener.
        win.document.addEventListener('click', onClick, true);
      } catch {
        /* not ours to follow */
      }
    };

    // The frame is server-rendered, so it can finish loading before React gets
    // here — in which case its load event is long gone and it is wired now.
    try {
      if (el.contentWindow?.document.readyState === 'complete') wire();
    } catch {
      /* not ours to follow */
    }
    el.addEventListener('load', wire);
    return () => el.removeEventListener('load', wire);
  }, [href]);

  return (
    <section className={styles.pane} aria-label={name}>
      <iframe ref={frame} src={href} title={`${name} — ${line}`} className={styles.frame} />
      {children}
      <Link href={href} className={styles.open}>
        <span className={styles.openName}>{name}</span>
        <span className={styles.openCta}>
          Tap me to open <ArrowRight />
        </span>
      </Link>
    </section>
  );
}
