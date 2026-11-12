'use client';

import { STUDIO_PRICE_WINDOW_MS } from '@/lib/studio';
import { DemoButton } from './DemoButton';
import { Bell, Play } from './Icons';
import { usePriceSecondsLeft } from './priceClock';
import site from './site.module.css';
import styles from './pricing.module.css';

const LABELS = ['Days', 'Hours', 'Minutes', 'Seconds'];

export function PriceCountdown() {
  const left = usePriceSecondsLeft();
  const ended = left !== null && left <= 0;
  // Counts down with the timer, so a returning visitor is never told a number the clock contradicts.
  const days = Math.ceil((left ?? STUDIO_PRICE_WINDOW_MS / 1000) / 86400);

  const parts = left === null ? [] : [left / 86400, (left / 3600) % 24, (left / 60) % 60, left % 60];

  return (
    <div className={styles.countdown}>
      {ended ? null : (
        <div className={styles.alertStrip} aria-hidden="true">
          <div className={styles.alertTrack}>
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i}>
                <Bell /> Price increase alert
              </span>
            ))}
          </div>
        </div>
      )}
      <div className={styles.countdownBody}>
        {ended ? null : (
          <>
            <h3 className={styles.countdownHead}>
              <em>Prices are increasing</em> {`in ${days} ${days === 1 ? 'day' : 'days'}`}
            </h3>
            <div className={styles.timer} role="timer" aria-label="Time left before prices increase">
              {LABELS.map((label, i) => {
                const value = left === null ? '--' : String(Math.floor(parts[i])).padStart(2, '0');
                return (
                  <div key={label} className={styles.timerUnit}>
                    {/* Keyed by its value, so only the figure that changed plays the flip. */}
                    <b key={value}>{value}</b>
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className={styles.demoRow}>
          <p>See how Vexa works</p>
          <DemoButton className={`${site.btn} ${site.btnLime} ${styles.demoBtn}`}>
            <Play /> Watch the demo
          </DemoButton>
        </div>
      </div>
    </div>
  );
}
