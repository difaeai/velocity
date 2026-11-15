'use client';

/**
 * The guided tour, and the help button that never leaves the screen.
 *
 * Vexa is not one screen, it is a business with five departments, and nobody
 * learns a business by being shown a dashboard. So this walks the owner through
 * it: one thing lit up at a time, the rest of the screen dimmed and blurred out
 * of the way, a line of plain English on a card — and the same line read aloud,
 * because the person paying for this is often not reading English comfortably
 * and a voice is a far lower wall than a paragraph.
 *
 * How the pieces work, since each is a deliberate choice:
 *
 *  • **The hole is four panels, not a mask.** Four blurred panels tile around
 *    the lit element. `mask-composite` would be one element instead of four,
 *    but masks animate badly and are the first thing to break on an older
 *    Android browser — which is most of this audience. Four rectangles that
 *    share one easing stay perfectly tiled while they move.
 *  • **The voice is the browser's own.** `speechSynthesis` ships in every
 *    browser, costs nothing per word and needs no key, so the tour works on the
 *    free plan and offline. It is started by the button press that starts the
 *    tour, which is what browsers require. Muting is remembered.
 *  • **The tour crosses pages.** A step can carry `goto`, and "now here is
 *    where your ads live" actually takes you there and carries on. Nothing has
 *    to be saved to survive that: this is mounted by the console's layout, and
 *    a Next.js layout is not remounted when you move between its own pages.
 *  • **A missing target is skipped, not fatal — but patiently.** Pages differ
 *    by plan: a customer without the sales plan has no WhatsApp row to light
 *    up. Such a step is passed over silently, after two and a half seconds of
 *    looking: long enough for the page a `goto` just opened, a cold callable
 *    and a closed box, so that a slow page is never mistaken for a missing one.
 *    Nothing is said out loud until the target has actually been found.
 *
 * To put a step on something, give it `data-tour="<id>"`. Nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useDraft } from '@/lib/draft';

export interface TourStep {
  /** The `data-tour` value to light up. Omitted: a card in the middle of the screen. */
  target?: string;
  title: string;
  /** Shown on the card and read aloud. Plain sentences — it is being spoken. */
  say: string;
  /** Pressing Next goes here first, and the tour carries on there. */
  goto?: string;
}

const SEEN = 'vexa.tour.seen';
const MUTED = 'vexa.tour.muted';

/** Where the card can sit relative to the lit element. */
interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Said out loud, in the browser's own voice. Returns a stop function. */
function say(text: string): () => void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return () => undefined;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.97;
  u.pitch = 1;
  // An English voice if there is one; otherwise whatever the machine has, which
  // still reads English words recognisably.
  const voice = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang));
  if (voice) u.voice = voice;
  // Chrome will not speak before its voice list has loaded on a cold page.
  if (!synth.getVoices().length) {
    const once = () => {
      synth.removeEventListener('voiceschanged', once);
      synth.speak(u);
    };
    synth.addEventListener('voiceschanged', once);
  } else {
    synth.speak(u);
  }
  return () => synth.cancel();
}

export function Tour({
  steps,
  open,
  onClose,
  onStart,
  /** True the very first time this console is opened, so the tour offers itself. */
  autoOffer,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  autoOffer?: boolean;
}) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  /** The step whose target has been found and measured; nothing is said before it. */
  const [found, setFound] = useState(-1);
  const [turnedDown, setTurnedDown] = useState(false);
  const stopSaying = useRef<() => void>(() => undefined);
  // Both of these are this browser's, and both have to outlive a reload.
  const [mutedRaw, setMuted] = useDraft(MUTED);
  const [seen, setSeen] = useDraft(SEEN);
  const muted = mutedRaw === '1';
  const offer = Boolean(autoOffer) && !seen && !turnedDown && !open;

  const step: TourStep | undefined = steps[i];
  /** This step is on screen: a target that has been measured, or no target at all. */
  const ready = !step?.target || found === i;
  /** What the veil cuts a hole for. A step with no target dims the whole screen. */
  const hole = step?.target ? spot : null;

  /** The element this step lights up, if it is on this page. */
  const find = useCallback(() => {
    if (!step?.target) return null;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    // The dashboard's boxes open and close, and three of the four start closed.
    // A step pointing inside one opens it, because a spotlight on a box that is
    // shut is a spotlight on nothing.
    el?.closest('details:not([open])')?.setAttribute('open', '');
    return el;
  }, [step]);

  // A step can live on another page. This runs for the step the tour *opens*
  // on as well, which is the whole point: pressing Next used to be the only
  // thing that honoured `goto`, so a tour started anywhere but the home page
  // spent its first steps looking for things that were on a page it had not
  // gone to — and skipped every one of them.
  useEffect(() => {
    if (!open || !step?.goto) return;
    if (window.location.pathname !== step.goto) router.push(step.goto);
  }, [open, step, router]);

  // The voice follows the step — but only once the step is actually on screen.
  // Speaking before that is how a skipped step still got read aloud, so a run
  // of missing steps sounded like the tour talking over itself.
  useEffect(() => {
    stopSaying.current();
    if (!open || !step || muted || !ready) return;
    stopSaying.current = say(`${step.title}. ${step.say}`);
    return () => stopSaying.current();
  }, [open, step, muted, ready]);

  const finish = useCallback(() => {
    stopSaying.current();
    setSeen('1');
    setI(0);
    setFound(-1);
    setTurnedDown(true);
    onClose();
  }, [onClose, setSeen]);

  const go = useCallback(
    (to: number) => {
      if (to >= steps.length || to < 0) return finish();
      setI(to);
    },
    [steps.length, finish],
  );

  // Measure the lit element, and keep measuring while the page settles: a card
  // that rises in, a box that opens, an image that loads and a scroll all move
  // it. `ready` is true from the moment it has been found, and the card and the
  // voice both wait for it.
  useEffect(() => {
    if (!open || !step?.target) return;
    let raf = 0;
    let tracking = true;
    const measure = () => {
      const el = find();
      const r = el?.getBoundingClientRect();
      // Zero-sized: in a box that has been told to open but has not laid out yet.
      if (!r || (!r.width && !r.height)) return false;
      const next = { top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 };
      // Same rectangle, same object: tracking runs every frame and React must
      // not re-render for a spotlight that has not moved.
      setSpot((was) =>
        was && was.top === next.top && was.left === next.left && was.width === next.width && was.height === next.height
          ? was
          : next,
      );
      setFound(i);
      return true;
    };
    const tick = () => {
      if (!tracking) return;
      measure();
      raf = requestAnimationFrame(tick);
    };
    find()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    raf = requestAnimationFrame(tick);
    // A second and a half of tracking covers the navigation, the scroll, the
    // box opening and the rise-in; then it stops, because a permanent rAF loop
    // behind a modal is a battery bug. Scroll and resize keep it in place after.
    const stop = setTimeout(() => {
      tracking = false;
      cancelAnimationFrame(raf);
    }, 1500);
    // Only now is the step genuinely not here: a plan that does not include it,
    // or a card that draws only once there is data. Pass over it rather than
    // talk about something nobody can see. This used to be 600ms, which is less
    // than a page navigation, a cold callable or a card's own animation — so a
    // single Next could run the whole tour out in a few seconds.
    const giveUp = setTimeout(() => !measure() && go(i + 1), 2600);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      tracking = false;
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      clearTimeout(giveUp);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step, i, find, go]);

  // Esc closes; the arrows walk it.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, i, go, finish]);

  const toggleMute = () => {
    if (!muted) stopSaying.current();
    setMuted(muted ? '' : '1');
  };

  // Where the card goes: under the lit element if it fits, over it if not,
  // middle of the screen when there is nothing lit.
  const card = useMemo(() => {
    if (typeof window === 'undefined') return { top: 0, left: 0, centred: true };
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.min(380, W - 32);
    const h = 230;
    const spot = hole;
    if (!spot) return { top: Math.max(24, H / 2 - 150), left: (W - w) / 2, centred: true, w };

    // A tall target — the whole sidebar, a long list — has no room above or
    // below it, and a card laid over the thing being pointed at is the one
    // placement that defeats the purpose. Go beside it instead.
    const side = spot.height > H * 0.55;
    if (side) {
      const right = spot.left + spot.width + 14;
      const left = right + w + 16 < W ? right : Math.max(16, spot.left - w - 14);
      return { top: Math.min(Math.max(16, spot.top + 24), H - h - 16), left, centred: false, w };
    }

    const below = spot.top + spot.height + 14;
    const fits = below + h < H;
    return {
      top: fits ? below : Math.max(16, spot.top - h - 14),
      left: Math.min(Math.max(16, spot.left + spot.width / 2 - w / 2), W - w - 16),
      centred: false,
      w,
    };
  }, [hole]);

  if (offer) {
    return (
      <>
        <style>{TOUR_CSS}</style>
        <div className="tr-offer" role="dialog" aria-label="Show me around">
          <span className="tr-offer-ico" aria-hidden>
            👋
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>First time here?</strong>
            <p>Two minutes, and I will show you what each part of Vexa does — out loud, if you like.</p>
          </div>
          <button
            type="button"
            className="tr-btn lime"
            onClick={() => {
              setTurnedDown(true);
              onStart();
            }}
          >
            Show me
          </button>
          <button type="button" className="tr-x" onClick={finish} aria-label="No thanks">
            ✕
          </button>
        </div>
      </>
    );
  }

  if (!open || !step) return null;

  return (
    <div className="tr" role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of ${steps.length}`}>
      <style>{TOUR_CSS}</style>

      {/* four blurred panels tiling around the lit element — the hole */}
      {hole ? (
        <>
          <span className="tr-veil" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <span className="tr-veil" style={{ top: Math.max(0, hole.top), left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <span className="tr-veil" style={{ top: Math.max(0, hole.top), left: hole.left + hole.width, right: 0, height: hole.height }} />
          <span className="tr-veil" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <span
            className="tr-ring"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            aria-hidden
          />
        </>
      ) : (
        <span className="tr-veil" style={{ inset: 0 }} />
      )}

      <div
        className={`tr-card${card.centred ? ' mid' : ''}`}
        style={{ top: card.top, left: card.left, width: card.w }}
      >
        <div className="tr-top">
          <span className="tr-count">
            {i + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="tr-mute"
            onClick={toggleMute}
            aria-pressed={muted}
            title={muted ? 'Turn the voice on' : 'Turn the voice off'}
          >
            {muted ? '🔇' : '🔊'}
            <span>{muted ? 'Voice off' : 'Voice on'}</span>
          </button>
          <button type="button" className="tr-x" onClick={finish} aria-label="Close the tour">
            ✕
          </button>
        </div>

        {/* keyed, so each step's words fade in rather than swapping in place */}
        <div className="tr-body" key={i}>
          <h3>{step.title}</h3>
          <p>{step.say}</p>
        </div>

        <div className="tr-bar" aria-hidden>
          <i style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="tr-row">
          <button type="button" className="tr-skip" onClick={finish}>
            Skip the tour
          </button>
          {i > 0 ? (
            <button type="button" className="tr-btn ghost" onClick={() => go(i - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="tr-btn lime" onClick={() => go(i + 1)}>
            {i === steps.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The help button, bottom-right of every console page: the tour, and the
 * setting-up instructions. On screen always, because the moment somebody needs
 * it is the moment they are too lost to go looking for it.
 */
export function HelpLauncher({
  onTour,
  onSetup,
}: {
  onTour: () => void;
  onSetup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="tr-help" ref={box} data-tour="help">
      <style>{TOUR_CSS}</style>
      {open ? (
        <div className="tr-menu" role="menu">
          <button
            type="button"
            id="vexa-help-tour"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onTour();
            }}
          >
            <span aria-hidden>🧭</span>
            <span>
              <strong>Show me around</strong>
              <em>A guided tour, with a voice</em>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSetup();
            }}
          >
            <span aria-hidden>🔌</span>
            <span>
              <strong>How do I connect it?</strong>
              <em>Step by step, for each account</em>
            </span>
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={`tr-fab${open ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Help"
      >
        <span className="tr-fab-ring" aria-hidden />
        <span aria-hidden>{open ? '✕' : '?'}</span>
        <b>Help</b>
      </button>
    </div>
  );
}

export const TOUR_CSS = `
.tr { position: fixed; inset: 0; z-index: 9000; }
.tr-veil { position: fixed; background: rgba(3,22,15,.52); backdrop-filter: blur(5px) saturate(.8); -webkit-backdrop-filter: blur(5px) saturate(.8);
  transition: all .42s cubic-bezier(.3,1,.35,1); }
.tr-ring { position: fixed; border-radius: 16px; pointer-events: none; z-index: 1;
  box-shadow: 0 0 0 2px #ccff00, 0 0 0 7px rgba(204,255,0,.22), 0 24px 60px -20px rgba(0,0,0,.55);
  animation: tr-breathe 2.4s ease-in-out infinite; transition: all .42s cubic-bezier(.3,1,.35,1); }
@keyframes tr-breathe { 0%,100% { box-shadow: 0 0 0 2px #ccff00, 0 0 0 7px rgba(204,255,0,.22), 0 24px 60px -20px rgba(0,0,0,.55); }
  50% { box-shadow: 0 0 0 2px #ccff00, 0 0 0 12px rgba(204,255,0,.1), 0 24px 60px -20px rgba(0,0,0,.55); } }

.tr-card { position: fixed; z-index: 2; background: #fff; border-radius: 18px; padding: 16px 16px 14px;
  box-shadow: 0 30px 70px -20px rgba(3,22,15,.5), 0 0 0 1px rgba(255,255,255,.6);
  transition: top .42s cubic-bezier(.3,1,.35,1), left .42s cubic-bezier(.3,1,.35,1);
  animation: tr-in .34s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes tr-in { from { opacity: 0; transform: translateY(8px) scale(.97); } }
.tr-card.mid { animation-name: tr-mid; }
@keyframes tr-mid { from { opacity: 0; transform: scale(.95); } }
.tr-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tr-count { font-size: 11px; font-weight: 900; letter-spacing: .08em; color: #6f7a72; background: #f1f5f3; border-radius: 999px; padding: 3px 9px; }
.tr-mute { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #e2e8e4; background: #fff; border-radius: 999px;
  padding: 4px 10px; font: inherit; font-size: 11.5px; font-weight: 800; color: #6f7a72; cursor: pointer; transition: all .2s ease; }
.tr-mute:hover { border-color: #a8d5bd; color: #004c31; }
.tr-x { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border: 0; background: #f1f5f3; border-radius: 8px;
  font-size: 12px; color: #6f7a72; cursor: pointer; transition: all .2s ease; }
.tr-x:hover { background: #e4ebe7; color: #0b1f17; }
.tr-body { animation: tr-fade .4s ease both; }
@keyframes tr-fade { from { opacity: 0; transform: translateX(6px); } }
.tr-body h3 { margin: 0 0 6px; font-size: 16.5px; font-weight: 900; letter-spacing: -.01em; color: #0b1f17; }
.tr-body p { margin: 0; font-size: 13.5px; line-height: 1.6; color: #4a564f; }
.tr-bar { height: 3px; border-radius: 999px; background: #eef2ef; margin: 14px 0 12px; overflow: hidden; }
.tr-bar > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#19c37d,#ccff00);
  transition: width .42s cubic-bezier(.3,1,.35,1); }
.tr-row { display: flex; align-items: center; gap: 8px; }
.tr-skip { margin-right: auto; border: 0; background: none; font: inherit; font-size: 12.5px; font-weight: 700; color: #6f7a72;
  cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.tr-skip:hover { color: #0b1f17; }
.tr-btn { border: 0; border-radius: 10px; padding: 9px 16px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer;
  background: #004c31; color: #fff; transition: transform .15s ease, box-shadow .2s ease; }
.tr-btn:hover { transform: translateY(-1px); }
.tr-btn.lime { background: #ccff00; color: #0b1f17; box-shadow: 0 8px 20px -10px rgba(170,214,0,.9); }
.tr-btn.ghost { background: #fff; color: #004c31; box-shadow: inset 0 0 0 1px #e2e8e4; }

/* the offer, first visit only */
.tr-offer { position: fixed; right: 22px; bottom: 92px; z-index: 8000; width: min(400px, calc(100vw - 44px));
  display: flex; align-items: center; gap: 12px; padding: 14px 14px 14px 16px; border-radius: 18px; background: #fff;
  box-shadow: 0 26px 60px -22px rgba(3,22,15,.5), 0 0 0 1px rgba(226,232,228,.9);
  animation: tr-pop .5s cubic-bezier(.2,1.4,.4,1) both .8s; }
@keyframes tr-pop { from { opacity: 0; transform: translateY(14px) scale(.95); } }
.tr-offer-ico { font-size: 26px; flex: none; animation: tr-wave 2.6s ease-in-out infinite; transform-origin: 70% 70%; }
@keyframes tr-wave { 0%,60%,100% { transform: rotate(0); } 10%,30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } }
.tr-offer strong { display: block; font-size: 14px; }
.tr-offer p { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; color: #6f7a72; }

/* the help button */
.tr-help { position: fixed; right: 22px; bottom: 22px; z-index: 8500; }
.tr-fab { position: relative; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 12px 18px 12px 15px;
  font: inherit; font-size: 14px; font-weight: 900; color: #0b1f17; background: #ccff00; cursor: pointer;
  box-shadow: 0 14px 34px -14px rgba(120,160,0,.9), 0 0 0 1px rgba(255,255,255,.5);
  transition: transform .2s cubic-bezier(.3,1.5,.5,1), box-shadow .25s ease; }
.tr-fab:hover { transform: translateY(-2px) scale(1.03); }
.tr-fab.on { background: #0b1f17; color: #fff; }
.tr-fab > span[aria-hidden] { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  background: rgba(11,31,23,.12); font-size: 13px; font-weight: 900; }
.tr-fab.on > span[aria-hidden] { background: rgba(255,255,255,.16); }
.tr-fab-ring { position: absolute; inset: 0; border-radius: inherit; border: 2px solid #ccff00; animation: tr-ping 2.8s ease-out infinite; pointer-events: none; }
.tr-fab.on .tr-fab-ring { display: none; }
@keyframes tr-ping { 0% { opacity: .7; transform: scale(1); } 70%,100% { opacity: 0; transform: scale(1.28); } }
.tr-menu { position: absolute; right: 0; bottom: calc(100% + 10px); width: 272px; background: #fff; border-radius: 16px; padding: 6px;
  box-shadow: 0 26px 60px -22px rgba(3,22,15,.5), 0 0 0 1px rgba(226,232,228,.9);
  animation: tr-pop .28s cubic-bezier(.2,1.4,.4,1) both; }
.tr-menu button { display: flex; gap: 11px; align-items: flex-start; width: 100%; padding: 11px; border: 0; background: none; border-radius: 11px;
  font: inherit; text-align: left; cursor: pointer; transition: background .2s ease; }
.tr-menu button:hover { background: #f4f8f6; }
.tr-menu button > span[aria-hidden] { font-size: 19px; line-height: 1.2; }
.tr-menu strong { display: block; font-size: 13.5px; color: #0b1f17; }
.tr-menu em { display: block; font-style: normal; font-size: 12px; color: #6f7a72; margin-top: 2px; }

@media (max-width: 560px) {
  .tr-fab b { display: none; }
  .tr-fab { padding: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .tr *, .tr-help *, .tr-offer { animation: none !important; transition: none !important; }
}
`;
