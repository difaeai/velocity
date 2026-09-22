'use client';

import { useSyncExternalStore } from 'react';

import { AppleMark, GooglePlay } from './Icons';
import styles from './site.module.css';
import { APP_STORE_URL, PLAY_URL } from '@/lib/site';

type Platform = 'ios' | 'android';

/** The user agent never changes under us, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};

function readPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so the touch-point check is what
  // separates an iPad from a desktop Safari.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  return isIOS ? 'ios' : 'android';
}

/**
 * Which store this visitor can actually install from.
 *
 * The user agent is an external store that the server cannot see, which is
 * exactly what useSyncExternalStore's server snapshot is for: the HTML ships as
 * Android — the overwhelming majority of Pakistani handsets, and the honest
 * default for a crawler — and React swaps in the real answer on the client
 * without a hydration mismatch. Reading `navigator` during render instead would
 * make the server and the browser produce different trees.
 *
 * Deliberately not a redirect page or a "choose your platform" modal: a person
 * who taps Install on their phone wants their own store, in one tap.
 */
function usePlatform(): Platform {
  return useSyncExternalStore<Platform>(noopSubscribe, readPlatform, () => 'android');
}

/**
 * The install call to action, in the nav and the sticky mobile bar.
 *
 * `label` is the button text; the icon and destination follow the platform.
 */
export function InstallButton({
  label = 'Get the app',
  className,
  onClick,
}: {
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  const platform = usePlatform();
  const ios = platform === 'ios';

  return (
    <a
      className={className ?? `${styles.btn} ${styles.btnLime}`}
      href={ios ? APP_STORE_URL : PLAY_URL}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
    >
      {ios ? <AppleMark /> : <GooglePlay />}
      {label}
    </a>
  );
}

/** The sticky bar's subtitle, so it names the store the button will open. */
export function InstallBarSubtitle() {
  const platform = usePlatform();
  return <span>{platform === 'ios' ? 'Free on the App Store' : 'Free on Google Play'}</span>;
}
