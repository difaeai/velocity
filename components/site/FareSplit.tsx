'use client';

import { useState } from 'react';

import { Person, Users } from './Icons';
import styles from './site.module.css';

/**
 * The interactive fare splitter — the one place on the page where the reader
 * *operates* the product instead of reading about it.
 *
 * Pooling is the hardest thing to explain in a sentence and the easiest thing
 * to understand once you have watched the number fall, so it gets the
 * interaction budget. The percentages are the real ones the fare engine
 * applies, not illustrative figures: a solo rider pays the whole fare, two
 * riders pay 60% each, three pay 40%, four pay 35%.
 *
 * Accessibility: the buttons are a labelled group of toggles rather than a
 * slider, so they are reachable by Tab and operable by Space/Enter with no
 * custom key handling; the readout is a live region, so the new fare is
 * announced rather than silently repainted.
 */
const SOLO_FARE = 480;

/** Share of the solo fare each rider pays, indexed by rider count. */
const SHARE = [1, 0.6, 0.4, 0.35];

export function FareSplit() {
  const [riders, setRiders] = useState(1);

  const share = SHARE[riders - 1];
  const perPerson = Math.round(SOLO_FARE * share);
  const saving = Math.round((1 - share) * 100);

  return (
    <div className={styles.fare}>
      <div className={styles.fareCar}>
        {[0, 1, 2, 3].map((i) => {
          const taken = i < riders;
          return (
            <span
              key={i}
              className={`${styles.seat} ${taken ? styles.seatOn : ''}`}
              style={{ transitionDelay: `${i * 55}ms` }}
              aria-hidden="true"
            >
              <Person />
              {taken ? `Rs ${perPerson}` : 'Empty'}
            </span>
          );
        })}
      </div>

      <div className={styles.fareControls}>
        <div className={styles.riderPicker} role="group" aria-label="Number of riders sharing the car">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.riderBtn} ${n === riders ? styles.riderBtnOn : ''}`}
              aria-pressed={n === riders}
              onClick={() => setRiders(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className={styles.fareReadout} aria-live="polite">
          <span className={styles.fareNum}>Rs {perPerson}</span>
          {riders > 1 ? (
            <>
              <span className={styles.fareWas}>Rs {SOLO_FARE}</span>
              <span className={styles.fareSaving}>
                <Users />
                {saving}% less
              </span>
            </>
          ) : null}
        </div>

        <div
          className={styles.fareBar}
          role="img"
          aria-label={`Each rider pays ${Math.round(share * 100)} percent of the solo fare`}
        >
          <div className={styles.fareBarFill} style={{ width: `${share * 100}%` }} />
        </div>

        <p className={styles.fareNote}>
          {riders === 1
            ? 'On your own you pay the whole fare — Rs 480 for this trip. Add a rider and watch what happens.'
            : `${riders} people going the same way, one car, ${riders} fares of Rs ${perPerson}. The driver still earns the full trip; you each pay ${Math.round(share * 100)}% of it.`}
        </p>
      </div>
    </div>
  );
}
