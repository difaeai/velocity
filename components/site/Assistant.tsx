'use client';

/**
 * Vexa, the Social Media Virtual Assistant: she stands at the bottom right of
 * every page of the site, scrolls with it, and is the voice of all of it —
 * whenever the page's narration plays (the hero, the scroll film, the five
 * steps, a plan card), her mouth moves with it and its subtitles run beside
 * her. Tap her and
 * she gives her full pitch (the line the homepage hero reads); tap a plan
 * card, or its "Hear Vexa" button, and she says what she does on that plan.
 *
 * She speaks through the page's one voice (`siteSound`), so the header's mute
 * and the other parts' narration behave as they do everywhere else.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { captionAt } from './captions';
import MOUTH from './voiceMouth.json';
import { hush, say, toggleMute, useSiteSound, voiceNow } from './siteSound';
import styles from './assistant.module.css';
import type { StudioPlanId } from '@/lib/studio';

/** The voice's owner for a plan's card — also its line's file name in /site/voice (siteVoice.json). */
export const planVoice = (plan: StudioPlanId) => `plan-${plan}`;
/** Her own line, the full pitch — also the hero's. */
const VEXA = 'vexa';
/** The arc over her head, left to right: the file in /site/logos and where it sits (degrees, -180 = her left, 0 = her right). */
const PLATFORMS = [
  ['facebook', -165],
  ['instagram', -135],
  ['meta', -105],
  ['google', -75],
  ['google-ads', -45],
  ['youtube', -15],
] as const;

/** A plan line: which one is playing, and a tap that starts or stops one. */
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

/** The subtitle for whatever the voice is reading, while it reads. */
function useCaption(talking: boolean): string | null {
  const [caption, setCaption] = useState<string | null>(null);
  useEffect(() => {
    if (!talking) return;
    let timer = 0;
    const tick = () => {
      const v = voiceNow();
      setCaption(captionAt(v.src, v.at, v.length));
      timer = window.setTimeout(tick, 150);
    };
    timer = window.setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [talking]);
  return talking ? caption : null;
}

/**
 * Moves her mouth with the voice: voiceMouth.json has how open it is every 50 ms of each line, and the
 * frame is written straight to the element so a 60-a-second update never re-renders React.
 * shortcut: the mouth follows loudness, not the shapes of the words; real visemes need a paid lip-sync render.
 */
function useLipSync(talking: boolean, mouth: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = mouth.current;
    if (!talking || !el) return;
    let frame = 0;
    const tick = () => {
      const v = voiceNow();
      const line = (MOUTH as Record<string, string>)[v.src.slice(v.src.lastIndexOf('/') + 1)];
      el.dataset.l = line?.[Math.floor(v.at * 20)] ?? '0';
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.dataset.l = '0';
    };
  }, [talking, mouth]);
}

/** Vexa herself, at the bottom right of every page; `aboveBar` on a page with a fixed bar at the foot (rides). */
export function Vexa({ aboveBar = false }: { aboveBar?: boolean }) {
  const sound = useSiteSound();
  const talking = sound.speaking;
  const caption = useCaption(talking);
  const mouth = useRef<HTMLSpanElement>(null);
  useLipSync(talking, mouth);

  const tap = (e: React.MouseEvent) => {
    if (talking && sound.owner) return hush(sound.owner);
    say(VEXA, `/site/voice/${VEXA}.mp3`);
    if (sound.muted) toggleMute(e.timeStamp);
  };

  return (
    <div className={`${styles.guide} ${aboveBar ? styles.aboveBar : ''} ${talking ? styles.talking : ''}`}>
      <div className={styles.arc} role="img" aria-label="Vexa manages Facebook, Instagram, Meta, Google, Google Ads and YouTube">
        {PLATFORMS.map(([file, angle], i) => (
          <span key={file} className={styles.mark} style={{ ['--a' as string]: `${angle}deg`, ['--i' as string]: i }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/site/logos/${file}.svg`} alt="" width={40} height={40} draggable={false} />
          </span>
        ))}
      </div>
      {/* The voice already says it; the words are for the eye. */}
      <p className={styles.caption} aria-hidden>
        {caption ?? (
          <>
            <span className={styles.long}>
              Hi! I’m <b>Vexa</b>. Tap me.
            </span>
            <span className={styles.short}>Tap me</span>
          </>
        )}
      </p>
      <button
        type="button"
        className={styles.vexa}
        onClick={tap}
        aria-pressed={talking}
        aria-label={talking ? 'Stop Vexa' : 'Hear Vexa, your Social Media Virtual Assistant'}
      >
        <span className={styles.fig}>
          {/* A 110 KB cut-out with its own alpha: next/image would only re-encode it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/site/vexa.webp" alt="" width={854} height={853} draggable={false} />
          {/* Her mouth, a little more open in each: patches laid over her face, one shown at a time. */}
          <span ref={mouth} className={styles.mouth} data-l="0">
            {[1, 2, 3].map((n) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={n} src={`/site/vexa-mouth-${n}.webp`} alt="" width={142} height={170} draggable={false} />
            ))}
          </span>
        </span>
      </button>
    </div>
  );
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
