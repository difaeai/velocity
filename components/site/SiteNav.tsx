'use client';

import { useEffect, useId, useState } from 'react';

import { Bolt, Close, GooglePlay, Menu } from './Icons';
import styles from './site.module.css';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#services', label: 'Services' },
  { href: '#app', label: 'The app' },
  { href: '#earn', label: 'Earn' },
  { href: '#safety', label: 'Safety' },
];

export function SiteNav({ playUrl }: { playUrl: string }) {
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
    const mq = window.matchMedia('(min-width: 941px)');
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
              <Bolt style={{ color: '#ccff00' }} />
            </span>
            <span className={styles.brandName}>Velocity</span>
          </a>

          <div className={styles.navLinks}>
            {LINKS.map((l) => (
              <a key={l.href} className={styles.navLink} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>

          <div className={styles.navCta}>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={playUrl} target="_blank" rel="noreferrer">
              <GooglePlay />
              Get the app
            </a>
          </div>

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
            {LINKS.map((l) => (
              <a key={l.href} className={styles.navLink} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ))}
            <a
              className={`${styles.btn} ${styles.btnPrimary}`}
              href={playUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              <GooglePlay />
              Get the app
            </a>
          </div>
        ) : null}
      </div>

      <div className={styles.progressTrack} aria-hidden="true">
        <div className={styles.progressBar} style={{ ['--progress' as string]: `${progress}%` }} />
      </div>
    </header>
  );
}
