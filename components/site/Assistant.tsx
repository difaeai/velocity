'use client';

/**
 * The Social Media Virtual Assistant, standing in a plan card's film. Tap him
 * (or his "Tap me" button) and he says what he does on that plan; the
 * whole-team card gets the full pitch, the same line the homepage hero reads.
 *
 * He speaks through the page's one voice (`siteSound`), so the header's mute
 * and the other parts' narration behave as they do everywhere else, and
 * StudioPlans hushes him when his card scrolls away.
 */

import type { MouseEvent } from 'react';

import { hush, say, toggleMute, useSiteSound } from './siteSound';
import styles from './assistant.module.css';
import type { StudioPlanId } from '@/lib/studio';

/** The voice's owner for a plan's card — also its line's file name in /site/voice (siteVoice.json). */
export const planVoice = (plan: StudioPlanId) => `plan-${plan}`;

export function PlanAssistant({ plan }: { plan: StudioPlanId }) {
  const owner = planVoice(plan);
  const sound = useSiteSound();
  const talking = sound.owner === owner && sound.speaking;

  const tap = (e: MouseEvent) => {
    if (talking) return hush(owner);
    say(owner, `/site/voice/${owner}.mp3`);
    // Tapping him is asking to hear him, so it turns the page's sound back on.
    if (sound.muted) toggleMute(e.timeStamp);
  };

  return (
    <>
      {/* The figure answers a tap too; the button is the control for keyboards and screen readers. */}
      <div className={`${styles.agent} ${talking ? styles.talking : ''}`} onClick={tap} aria-hidden>
        {/* An 71 KB cut-out with its own alpha: next/image would only re-encode it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/site/assistant.webp" alt="" width={806} height={1240} draggable={false} />
      </div>
      <button
        type="button"
        className={styles.ask}
        onClick={tap}
        aria-pressed={talking}
        aria-label={talking ? 'Stop the assistant' : 'Hear the Social Media Virtual Assistant explain this plan'}
      >
        {talking ? (
          <>
            <span className={styles.wave} aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
            Stop
          </>
        ) : (
          <>
            <span className={styles.play} aria-hidden />
            Tap me
          </>
        )}
      </button>
    </>
  );
}
