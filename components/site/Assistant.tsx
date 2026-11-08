'use client';

/**
 * Vexa, the Social Media Virtual Assistant, explaining the plans: tap a plan
 * card, or its "Hear Vexa" button, and she says what she does on that plan;
 * the whole-team card gets her full pitch.
 *
 * She speaks through the page's one voice (`siteSound`), so the header's mute
 * and the other parts' narration behave as they do everywhere else, and
 * StudioPlans hushes her when a card scrolls away.
 */

import { hush, say, toggleMute, useSiteSound } from './siteSound';
import styles from './assistant.module.css';
import type { StudioPlanId } from '@/lib/studio';

/** The voice's owner for a plan's card — also its line's file name in /site/voice (siteVoice.json). */
export const planVoice = (plan: StudioPlanId) => `plan-${plan}`;

/** Vexa's voice: which of her plan lines is playing, and a tap that starts or stops one. */
export function useVexa() {
  const sound = useSiteSound();
  const line = sound.speaking && sound.owner?.startsWith('plan-') ? sound.owner : null;
  const speak = (owner: string, e: { timeStamp: number }) => {
    if (line === owner) return hush(owner);
    say(owner, `/site/voice/${owner}.mp3`);
    // A tap is asking to hear her, so it turns the page's sound back on.
    if (sound.muted) toggleMute(e.timeStamp);
  };
  return { line, speak };
}

/** A plan card's "Hear Vexa" button, in the corner of its film. */
export function PlanAsk({ plan }: { plan: StudioPlanId }) {
  const owner = planVoice(plan);
  const { line, speak } = useVexa();
  const talking = line === owner;
  return (
    <button
      type="button"
      className={styles.ask}
      onClick={(e) => speak(owner, e)}
      aria-pressed={talking}
      aria-label={talking ? 'Stop Vexa' : 'Hear Vexa explain this plan'}
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
          Hear Vexa
        </>
      )}
    </button>
  );
}
