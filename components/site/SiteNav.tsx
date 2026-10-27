'use client';

import { useEffect, useId, useState } from 'react';

import { AppleMark, Close, GooglePlay, Menu, Person } from './Icons';
import { VelocityMark } from '@/components/BrandMark';
import { APP_STORE_URL, PLAY_URL } from '@/lib/site';
import styles from './site.module.css';

export type NavLink = { href: string; label: string };

/**
 * The site's header.
 *
 * Both stores sit beside the logo, side by side — the user asked for an
 * Android and an iPhone "Get the app" there rather than one button guessing
 * the visitor's phone. On a narrow screen they shrink to their store icons.
 *
 * It takes its links: the homepage (Velocity Studio) and the ride app's page
 * each point at their own sections. `cta` is the button on the right — the
 * homepage's is the Velocity AI Studio log-in.
 */
export function SiteNav({ links, cta }: { links: NavLink[]; cta?: NavLink }) {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setScrolled(y > 8);
        setProgress(max > 0 ? Math.min(100, (y / max) * 100) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Close the sheet on Escape and whenever the layout grows back to desktop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const mq = window.matchMedia('(min-width: 1081px)');
    const onWide = () => mq.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    mq.addEventListener('change', onWide);
    return () => {
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <header className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
      <div className={styles.wrap}>
        <nav className={styles.navInner} aria-label="Main">
          <a className={styles.brand} href="#top">
            <span className={styles.brandMark}>
              <VelocityMark style={{ color: '#ccff00' }} />
            </span>
            <span className={styles.brandName}>Velocity Rides</span>
          </a>

          <div className={styles.navApps}>
            <a
              className={`${styles.btn} ${styles.btnLime} ${styles.navApp}`}
              href={PLAY_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Get the app on Google Play (Android)"
            >
              <GooglePlay />
              <span>Get the app</span>
            </a>
            <a
              className={`${styles.btn} ${styles.btnLime} ${styles.navApp}`}
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Get the app on the App Store (iPhone)"
            >
              <AppleMark />
              <span>Get the app</span>
            </a>
          </div>

          <div className={styles.navLinks}>
            {links.map((l) => (
              <a key={l.href} className={styles.navLink} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>

          {cta ? (
            <div className={styles.navCta}>
              <a className={`${styles.btn} ${styles.btnLime}`} href={cta.href}>
                <Person /> {cta.label}
              </a>
            </div>
          ) : null}

          <button
            type="button"
            className={styles.burger}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <Close /> : <Menu />}
          </button>
        </nav>

        {open ? (
          <div className={styles.mobileMenu} id={menuId}>
            {links.map((l) => (
              <a key={l.href} className={styles.navLink} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ))}
            {cta ? (
              <a className={`${styles.btn} ${styles.btnLime}`} href={cta.href} onClick={() => setOpen(false)}>
                <Person /> {cta.label}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.progressTrack} aria-hidden="true">
        <div className={styles.progressBar} style={{ ['--progress' as string]: `${progress}%` }} />
      </div>
    </header>
  );
}
