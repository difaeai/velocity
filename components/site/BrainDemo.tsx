'use client';

/**
 * The Demo button's dialog: how the Velocity Brain works, as slides. A native
 * <dialog>, so focus, Esc and sitting above the nav and Vexa come free. What the
 * slides claim is what components/social/brain.tsx and docs/SOCIAL.md do.
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { BRAIN_ART_CSS, BrainArt } from '@/components/social/brainArt';
import { Check, ChevronLeft, ChevronRight, Close, Sparkle } from './Icons';
import site from './site.module.css';
import s from './brainDemo.module.css';

const AGENTS = [
  ['Content team', 'content-team'],
  ['Meta Ad Expert', 'meta'],
  ['New campaign', 'new-campaign'],
  ['Email agent', 'gmail'],
];
const CHANNELS = [
  ['Instagram', 'instagram'],
  ['Facebook', 'facebook'],
  ['YouTube', 'youtube'],
  ['TikTok', 'tiktok'],
  ['Gmail', 'gmail'],
  ['Meta Ads', 'meta'],
  ['Google Ads', 'google-ads'],
];
// Sentences the brain's own word rules (readIntent) send to these agents.
const ROUTES = [
  ['A reel for our new cake', 'Content team'],
  ['Email every customer: Eid sale, 20% off', 'Email agent'],
  ['Run an ad in Lahore, Rs 1,500 a day', 'New campaign'],
  ['Ask the expert to plan a campaign', 'Meta Ad Expert'],
];
const LOOP = [
  ['It goes out', 'On the accounts you connected.'],
  ['The results come back', 'From each network’s own numbers.'],
  ['They meet your normal', 'Each post is measured against your account’s usual numbers.'],
  ['The next plan uses it', 'What to do more of, what to stop. Winning ads keep running, losers are paused.'],
];

const order = (i: number) => ({ '--i': i }) as CSSProperties;
const agentY = (i: number) => 20 + 20 * i;
const channelY = (i: number) => 8 + 14 * i;

function Badge({ file }: { file: string }) {
  return (
    <span className={s.badge}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed SVG, nothing for next/image to do */}
      <img src={`/site/logos/${file}.svg`} alt="" width={20} height={20} draggable={false} />
    </span>
  );
}

function Network() {
  const ends = [...AGENTS.map((_, i) => [26, agentY(i)]), ...CHANNELS.map((_, i) => [76, channelY(i)])];
  return (
    <div className={s.stage}>
      <svg className={s.wires} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ends.map(([x, y], i) => {
          const d = `M50 50 C${(50 + x) / 2} 50, ${(50 + x) / 2} ${y}, ${x} ${y}`;
          return (
            <g key={d}>
              <path d={d} className={s.wire} style={order(i)} vectorEffect="non-scaling-stroke" />
              <path d={d} pathLength={100} className={s.comet} style={order(i)} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
      <div className={s.brain}>
        <BrainArt />
      </div>
      <ul className={s.agents} aria-label="Agents">
        {AGENTS.map(([name, file], i) => (
          <li key={name} style={{ top: `${agentY(i)}%`, ...order(i) }}>
            <Badge file={file} />
            {name}
          </li>
        ))}
      </ul>
      <ul className={s.channels} aria-label="Connected accounts">
        {CHANNELS.map(([name, file], i) => (
          <li key={name} style={{ top: `${channelY(i)}%`, ...order(i + 2) }}>
            <Badge file={file} />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Listen() {
  return (
    <div className={s.listen}>
      <div className={s.miniBrain}>
        <BrainArt />
      </div>
      <span className={s.status}>
        <i /> Listening · Content team
      </span>
      <div className={s.prompt}>
        <Sparkle />
        <p>A reel for our new chocolate cake, ready for Friday</p>
      </div>
    </div>
  );
}

function Routes() {
  return (
    <ul className={s.routes}>
      {ROUTES.map(([said, agent], i) => (
        <li key={agent} className={s.lit} style={order(i)}>
          <q>{said}</q>
          <ChevronRight />
          <b>{agent}</b>
        </li>
      ))}
    </ul>
  );
}

function Approval() {
  return (
    <div>
      <div className={s.choices}>
        <div data-on="true" style={order(0)}>
          <b>Ask me first</b>
          <p>Every piece waits for your Approve.</p>
        </div>
        <div style={order(1)}>
          <b>Post on its own</b>
          <p>Finished pieces go out at the time you pick.</p>
        </div>
      </div>
      <ul className={s.gates}>
        <li style={order(2)}>
          <Check /> A new ad campaign waits for your Approve, or launches straight away. You choose.
        </li>
        <li style={order(3)}>
          <Check /> Each email waits for your Approve, or goes out within your daily limit. You choose.
        </li>
        <li style={order(4)}>
          <Check /> With the Meta Ad Expert, nothing is spent until you press Create.
        </li>
      </ul>
    </div>
  );
}

function Loop() {
  return (
    <ol className={s.loop}>
      {LOOP.map(([title, line], i) => (
        <li key={title} className={s.lit} style={order(i)}>
          <span>{i + 1}</span>
          <b>{title}</b>
          <p>{line}</p>
        </li>
      ))}
    </ol>
  );
}

const SLIDES: { title: string; text: string; art: ReactNode }[] = [
  {
    title: 'One brain. Everything connected.',
    text: 'The Velocity Brain sits in the middle, with your agents on one side and your accounts on the other, so one sentence can reach all of them. Which agents you get depends on your plan.',
    art: <Network />,
  },
  {
    title: 'Say it once, in your own words.',
    text: 'Type what you want, the way you would tell a person. The brain reads your sentence and shows you who it is going to before anything runs.',
    art: <Listen />,
  },
  {
    title: 'The right agent gets the work.',
    text: 'Posts and reels go to the Content team. Email goes to the Email agent. An ad starts a new campaign, and asking for a plan opens the Meta Ad Expert. If it picks wrong, tap another agent.',
    art: <Routes />,
  },
  {
    title: 'You decide how it goes out.',
    text: 'You choose once, on day one: everything waits for your Approve, or finished work goes out on its own. You can change that any time.',
    art: <Approval />,
  },
  {
    title: 'The results shape what comes next.',
    text: 'Before the team plans your next pieces, it reads how your own posts did. Your ads are read every day too.',
    art: <Loop />,
  },
];

export function BrainDemo({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(0);
  const last = SLIDES.length - 1;

  // No close() in a cleanup: Strict Mode's re-run would fire `close` and shut it at once.
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, []);

  const close = () => ref.current?.close();

  function arrows(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') setAt((i) => Math.min(last, i + 1));
    if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
  }

  return (
    <dialog
      ref={ref}
      className={s.demo}
      aria-label="How the Velocity Brain works"
      onClose={onClose}
      onKeyDown={arrows}
      // The frame fills the dialog, so a click landing on the dialog itself is on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <style>{BRAIN_ART_CSS}</style>
      <div className={s.frame}>
        <header className={s.top}>
          <span className={s.label}>
            Velocity Brain <span>{`${at + 1} / ${SLIDES.length}`}</span>
          </span>
          <button type="button" className={s.closeBtn} onClick={close}>
            <Close /> Close
          </button>
        </header>
        <div className={s.body}>
          {/* Every slide stays mounted on one strip that shifts, so Next and Back both move the real neighbour in. */}
          <div className={s.track} style={{ transform: `translateX(${at * -100}%)` }}>
            {SLIDES.map((slide, i) => (
              <div key={slide.title} className={s.slide} data-active={i === at ? '' : undefined} inert={i !== at}>
                <div className={s.copy}>
                  <h3>{slide.title}</h3>
                  <p>{slide.text}</p>
                </div>
                <div className={s.visual}>{slide.art}</div>
              </div>
            ))}
          </div>
        </div>
        <p className={s.announce} aria-live="polite">{`Slide ${at + 1} of ${SLIDES.length}: ${SLIDES[at].title}`}</p>
        <footer className={s.foot}>
          <div className={s.dots}>
            {SLIDES.map((slide, i) => (
              <button
                key={slide.title}
                type="button"
                aria-label={`Slide ${i + 1}: ${slide.title}`}
                aria-current={i === at ? 'true' : undefined}
                onClick={() => setAt(i)}
              />
            ))}
          </div>
          <div className={s.moves}>
            <button type="button" className={s.closeBtn} disabled={at === 0} onClick={() => setAt(at - 1)}>
              <ChevronLeft /> Back
            </button>
            {at === last ? (
              <button type="button" className={`${site.btn} ${site.btnLime}`} onClick={close}>
                Close
              </button>
            ) : (
              <button type="button" className={`${site.btn} ${site.btnLime}`} onClick={() => setAt(at + 1)}>
                Next <ChevronRight />
              </button>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
