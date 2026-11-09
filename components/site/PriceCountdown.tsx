'use client';

import { useState } from 'react';

import { STUDIO_PRICE_RISE_USD } from '@/lib/studio';
import { BrainDemo } from './BrainDemo';
import { Bell, Play } from './Icons';
import { usePriceSecondsLeft } from './priceClock';
import site from './site.module.css';
import styles from './pricing.module.css';

const LABELS = ['Days', 'Hours', 'Minutes', 'Seconds'];

export function PriceCountdown() {
  const [demoOpen, setDemoOpen] = useState(false);
  const left = usePriceSecondsLeft();
  const ended = left === undefined || (left !== null && left <= 0);

  const parts = left == null ? [] : [left / 86400, (left / 3600) % 24, (left / 60) % 60, left % 60];

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
        <div className={styles.countdownCopy}>
          <h3>
            {ended ? (
              'See how the Velocity Brain works'
            ) : (
              <>
                <em>{`Your price goes up $${STUDIO_PRICE_RISE_USD}`}</em> when this timer ends
              </>
            )}
          </h3>
          <button type="button" className={`${site.btn} ${site.btnLime} ${styles.demoBtn}`} onClick={() => setDemoOpen(true)}>
            <Play /> Watch the demo
          </button>
        </div>
        {ended ? null : (
          <div className={styles.timer} role="timer" aria-label="Time left before your price goes up">
            {LABELS.map((label, i) => {
              const value = left == null ? '--' : String(Math.floor(parts[i])).padStart(2, '0');
              return (
                <div key={label} className={styles.timerUnit}>
                  {/* Keyed by its value, so only the figure that changed plays the flip. */}
                  <b key={value}>{value}</b>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {demoOpen ? <BrainDemo onClose={() => setDemoOpen(false)} /> : null}
    </div>
  );
}
