'use client';

/**
 * How Velocity Studio works, as one story in five numbered steps.
 *
 * The steps scroll on the left; on the right a mock of the real Studio console
 * — same nav, same green-and-white theme — acts out the step in view, with the
 * matching film from the shop in the corner. Press "Watch with voice" and a
 * narrator reads each step and the page moves itself on when she finishes;
 * with sound on, each step also has small sounds timed to its animation
 * (drawn live with Web Audio, no files). Touching the page hands control back.
 *
 * The narration is `storyVoice.json`, rendered to `public/site/voice/{key}.mp3`
 * by `scripts/render-story-voice.py` — change a line, render it again. Nothing
 * downloads until sound is turned on. Reduced motion shows every scene at rest.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ArrowRight } from './Icons';
import { useReducedMotion } from './useReducedMotion';
import site from './site.module.css';
import s from './studioStory.module.css';
import VOICE from './storyVoice.json';
import { STUDIO_CREDIT_DAY_USD, STUDIO_TRIAL_HOURS } from '@/lib/studio';

type Cue = 'tick' | 'pop' | 'chime' | 'whoosh' | 'send';
type StepKey = 'content' | 'ads' | 'comments' | 'sales' | 'you';

interface Step {
  key: StepKey;
  nav: string;
  page: string;
  title: string;
  body: string;
  points: string[];
  film: string;
  filmLabel: string;
  /** Sounds, in seconds after the step comes into view — matched to the scene's animation delays. */
  cues: [number, Cue][];
}

const STEPS: Step[] = [
  {
    key: 'content',
    nav: '🎬 Content & calendar',
    page: 'Content & calendar',
    title: 'Your content, made and posted',
    body: 'Tell the team about your business. It reads your market, plans 30 days of reels, posts and carousels, and posts them at your time — every day.',
    points: [
      'Reels with voice-over and music',
      'Instagram and Facebook from one sign-in',
      'Change any day on the calendar',
    ],
    film: '/site/step2',
    filmLabel: 'The calendar fills',
    cues: [
      [0.3, 'chime'],
      [0.9, 'tick'],
      [1.1, 'tick'],
      [1.3, 'tick'],
      [1.5, 'tick'],
      [1.7, 'tick'],
      [2.6, 'pop'],
    ],
  },
  {
    key: 'ads',
    nav: '💸 Meta Ad Expert',
    page: 'Meta Ad Expert',
    title: 'The Meta Ad Expert runs your ads',
    body: 'It launches Facebook and Instagram ads inside the daily limit you set, reads cost and results every day, keeps the winners running and pauses the losers.',
    points: [
      'Your daily limit, enforced in code',
      'Judged on orders and leads, not likes',
      'Tired ads get a fresh creative',
    ],
    film: '/site/step4',
    filmLabel: 'Ads bring buyers in',
    cues: [
      [0.3, 'whoosh'],
      [1.6, 'chime'],
      [2.2, 'tick'],
      [2.9, 'pop'],
    ],
  },
  {
    key: 'comments',
    nav: '💬 Comments',
    page: 'Comments',
    title: 'Your comments, answered',
    body: 'Every couple of hours the team reads the comments on your posts and replies in your voice. Anything sensitive waits for you.',
    points: [
      'Replies in the language you post in',
      'A complaint gets a calm reply, never an argument',
      'Safety issues always wait for you',
    ],
    film: '/site/step3',
    filmLabel: 'People react to your post',
    cues: [
      [0.4, 'tick'],
      [1.2, 'pop'],
      [1.9, 'tick'],
      [2.7, 'pop'],
      [3.4, 'chime'],
    ],
  },
  {
    key: 'sales',
    nav: '🤝 Sales agent',
    page: 'Sales agent',
    title: 'Sales agents bring customers',
    body: 'They find businesses that could buy from you, write to each one from your own mailbox, follow up twice, and draft your answer when someone replies.',
    points: ['Sent from your own mailbox', 'Two follow-ups, never a third', 'A “no” closes the lead for good'],
    film: '/site/step5',
    filmLabel: 'The order is delivered',
    cues: [
      [0.4, 'send'],
      [1.0, 'tick'],
      [1.4, 'tick'],
      [2.2, 'chime'],
      [3.0, 'pop'],
    ],
  },
  {
    key: 'you',
    nav: '🏠 Dashboard',
    page: 'Dashboard',
    title: 'You watch it all, from one dashboard',
    body: `Your first ${STUDIO_TRIAL_HOURS} hours are free. Then pick a plan — and add credits, $${STUDIO_CREDIT_DAY_USD} a day, whenever you want more days.`,
    points: [
      'No card to start',
      'Pay by bank transfer, EasyPaisa or JazzCash',
      'Credits used only on days your plan does not cover',
    ],
    film: '/site/step1',
    filmLabel: 'You, back at the shop',
    cues: [
      [0.3, 'tick'],
      [0.6, 'tick'],
      [0.9, 'tick'],
      [1.2, 'tick'],
      [2.0, 'chime'],
    ],
  },
];

const NAV = [
  '🏠 Dashboard',
  '🎬 Content & calendar',
  '💸 Meta Ad Expert',
  '💬 Comments',
  '🤝 Sales agent',
  '📊 Usage & credits',
];
const LAST = STEPS.length - 1;
/** Where the layout stacks, and how far below the top the console is pinned there — both as in the CSS. */
const NARROW = '(max-width: 900px)';
const NAV_PX = 76;
const LINES = Object.fromEntries((VOICE as { key: StepKey; text: string }[]).map((v) => [v.key, v.text])) as Record<
  StepKey,
  string
>;

const never = () => () => {};
const savingData = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export function StudioStory() {
  const reduced = useReducedMotion();
  const saveData = useSyncExternalStore(never, savingData, () => false);
  const [active, setActive] = useState(0);
  const [sound, setSound] = useState(false);
  const [tour, setTour] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const section = useRef<HTMLElement>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const stageCol = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  // Read inside the narration's `ended` handler, which outlives the render it was made in.
  const live = useRef<{
    active: number;
    tour: boolean;
    next: (i: number) => void;
  }>({ active, tour, next: () => {} });

  // The step crossing the middle of the screen is the one in view — on a phone, the band just under the pinned console.
  useEffect(() => {
    // Every row in the band, not just the latest: a row that stays in while its neighbour leaves reports nothing.
    const inBand = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) inBand.set(i, e.intersectionRect.height);
          else inBand.delete(i);
        }
        const top = [...inBand].sort((a, b) => b[1] - a[1])[0];
        if (top) setActive(top[0]);
      },
      { rootMargin: window.matchMedia(NARROW).matches ? '-58% 0px -34% 0px' : '-48% 0px -42% 0px' },
    );
    rows.current.forEach((row) => row && io.observe(row));
    return () => io.disconnect();
  }, []);

  const jump = useCallback(
    (i: number, smooth = true) => {
      const row = rows.current[i];
      if (!row) return;
      const y = row.getBoundingClientRect().top + window.scrollY;
      // A phone reads the step right under the console pinned at the top; a wide screen, in the middle.
      const top = window.matchMedia(NARROW).matches
        ? y - (stageCol.current?.offsetHeight ?? 0) - NAV_PX
        : y - window.innerHeight / 2 + row.offsetHeight / 2;
      window.scrollTo({
        top,
        behavior: smooth && !reduced ? 'smooth' : 'auto',
      });
    },
    [reduced],
  );
  useEffect(() => {
    live.current = { active, tour, next: jump };
  }, [active, tour, jump]);

  // The narrator: one element, reused, so the first tap unlocks every line after it.
  const voice = (): HTMLAudioElement => {
    if (!audio.current) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('play', () => setSpeaking(true));
      el.addEventListener('pause', () => setSpeaking(false));
      el.addEventListener('ended', () => {
        setSpeaking(false);
        const { active: at, tour: touring, next } = live.current;
        if (!touring) return;
        if (at < LAST) setTimeout(() => next(at + 1), 700);
        else setTour(false);
      });
      audio.current = el;
    }
    return audio.current;
  };

  /** Read step `i` from the top. */
  function say(i: number) {
    const el = voice();
    el.src = `/site/voice/${STEPS[i].key}.mp3`;
    void el.play().catch(() => setSpeaking(false));
  }

  // With sound on, each step in view is read out, and its sounds play with its animation.
  useEffect(() => {
    const el = audio.current;
    if (!sound || !el) return;
    el.src = `/site/voice/${STEPS[active].key}.mp3`;
    void el.play().catch(() => setSpeaking(false));
    const timers = reduced
      ? []
      : STEPS[active].cues.map(([at, cue]) => setTimeout(() => ctx.current && play(ctx.current, cue), at * 1000));
    return () => {
      el.pause();
      timers.forEach(clearTimeout);
    };
  }, [active, sound, reduced]);

  // Any hand on the page ends the tour; leaving the section silences it.
  useEffect(() => {
    if (!tour) return;
    const stop = (e: Event) => {
      if (
        e instanceof KeyboardEvent &&
        !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)
      )
        return;
      setTour(false);
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [tour]);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) return;
      audio.current?.pause();
      setTour(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /** Sound needs a tap before a browser allows it; every control that turns it on is one. */
  function unlock() {
    voice();
    if (!ctx.current) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = AC ? new AC() : null;
    }
    void ctx.current?.resume();
  }

  // A new step or sound switching on starts its line through the effect; only a replay of the same step needs `say`.
  function watch() {
    unlock();
    setTour(true);
    if (active !== 0) jump(0, false);
    else if (sound) say(0);
    setSound(true);
  }

  function pause() {
    setTour(false);
    audio.current?.pause();
  }

  function hear(i: number) {
    unlock();
    if (i !== active) jump(i);
    else if (sound) say(i);
    setSound(true);
  }

  function toggleSound() {
    if (sound) {
      setSound(false);
      setTour(false);
      audio.current?.pause();
    } else {
      unlock();
      setSound(true);
    }
  }

  const step = STEPS[active];
  const films = !reduced && !saveData;

  return (
    <section
      ref={section}
      id="how-it-works"
      className={`${site.section} ${site.deep} ${s.story}`}
      aria-labelledby="story-heading"
    >
      <div className={site.wrap}>
        <header className={s.head}>
          <span className={site.eyebrow}>How Velocity Studio works</span>
          <h2 id="story-heading" className={site.h2}>
            Five steps. Your team runs them <span className={site.accent}>on its own.</span>
          </h2>
          <p className={site.lead}>
            Scroll through the story, or press play and let the narrator walk you through it — each step happens in the
            same dashboard you get.
          </p>
          <div className={s.controls}>
            <button type="button" className={`${site.btn} ${site.btnLime}`} onClick={tour ? pause : watch}>
              {tour ? <PauseIcon /> : <PlayIcon />}
              {tour ? 'Pause the story' : 'Watch with voice'}
            </button>
            <button type="button" className={`${site.btn} ${site.btnGhost}`} onClick={toggleSound} aria-pressed={sound}>
              {sound ? <SoundOn /> : <SoundOff />}
              {sound ? 'Sound on' : 'Sound off'}
            </button>
          </div>
        </header>

        <div className={s.grid}>
          <ol className={s.steps}>
            {STEPS.map((st, i) => (
              <li
                key={st.key}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                data-i={i}
                className={`${s.step} ${i === active ? s.on : ''}`}
                aria-current={i === active ? 'step' : undefined}
              >
                <span className={s.badge}>
                  Step {i + 1}
                  <span aria-hidden> / {STEPS.length}</span>
                </span>
                <h3 className={s.stepTitle}>{st.title}</h3>
                <p className={s.stepBody}>{st.body}</p>
                <ul className={s.points}>
                  {st.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <button type="button" className={s.hear} onClick={() => hear(i)}>
                  {speaking && i === active ? <Bars /> : <PlayIcon />}
                  {speaking && i === active ? 'Playing…' : 'Hear this step'}
                </button>
                {i === LAST ? (
                  <div className={s.cta}>
                    <Link href="/studio/signup" className={`${site.btn} ${site.btnLime}`}>
                      Start free for {STUDIO_TRIAL_HOURS} hours <ArrowRight />
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          <div ref={stageCol} className={s.stageCol}>
            <div className={s.stage}>
              <div className={s.frame}>
                <div className={s.window} aria-hidden>
                  <div className={s.bar}>
                    <span className={s.dots}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className={s.url}>velocityrides.app/dashboard</span>
                    <span className={s.progress}>
                      {STEPS.map((x, i) => (
                        <i key={x.key} className={i <= active ? s.lit : ''} />
                      ))}
                    </span>
                  </div>
                  <div className={s.app}>
                    <nav className={s.side}>
                      <span className={s.logo}>
                        <b>V</b> Velocity Studio
                      </span>
                      {NAV.map((n) => (
                        <span key={n} className={`${s.navItem} ${n === step.nav ? s.navOn : ''}`}>
                          {n}
                        </span>
                      ))}
                      <span className={s.me}>
                        <b>B</b> Bake House
                        <small>Free trial</small>
                      </span>
                    </nav>
                    <div className={s.main}>
                      <div className={s.pageHead}>
                        <span className={s.stepTag}>Step {active + 1}</span>
                        <strong>{step.page}</strong>
                      </div>
                      <div key={step.key} className={`${s.scene} ${reduced ? s.rest : ''}`}>
                        <Scene k={step.key} />
                      </div>
                    </div>
                  </div>
                </div>

                {films ? (
                  <figure className={s.pip}>
                    <video
                      key={step.film}
                      src={`${step.film}.mp4`}
                      poster={`${step.film}.jpg`}
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                    />
                    <figcaption>{step.filmLabel}</figcaption>
                  </figure>
                ) : null}
              </div>

              <p className={`${s.caption} ${speaking ? s.captionOn : ''}`} aria-live="polite">
                {speaking ? <Bars /> : null}
                {LINES[step.key]}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The console acting out one step. Every delay here matches a sound cue above. */
function Scene({ k }: { k: StepKey }) {
  const d = (sec: number) => ({ ['--d' as string]: `${sec}s` });
  switch (k) {
    case 'content':
      return (
        <>
          <div className={`${s.card} ${s.row} ${s.a}`} style={d(0.2)}>
            <span className={s.ok}>✓</span>
            <span>
              <b>Market read</b>
              <small>Bake House · Lahore — buyers, competitors and an audience test</small>
            </span>
          </div>
          <div className={s.cal}>
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className={`${s.cell} ${s.a}`} style={d(0.6 + i * 0.1)}>
                <small>{i + 1}</small>
                <i className={s[`f${i % 4}`]}>{['Reel', 'Post', 'Carousel', 'Story'][i % 4]}</i>
              </span>
            ))}
          </div>
          <div className={`${s.card} ${s.post} ${s.a}`} style={d(2.4)}>
            <span className={s.thumb}>🥐</span>
            <span>
              <b>Fresh from the oven at 7</b>
              <small>Reel · voice-over and music</small>
              <span className={s.posted}>✓ Posted 9:00 AM · Instagram · Facebook</span>
            </span>
            <span className={s.hearts}>
              <i>♥</i>
              <i>♥</i>
              <i>♥</i>
            </span>
          </div>
        </>
      );
    case 'ads':
      return (
        <>
          <div className={`${s.card} ${s.a}`} style={d(0.2)}>
            <div className={s.row}>
              <span>
                <b>Weekend cake orders</b>
                <small>Facebook + Instagram</small>
              </span>
              <span className={s.pill}>Active</span>
            </div>
            <div className={s.limit}>🔒 Your daily limit · Rs 1,500 — never crossed</div>
          </div>
          <div className={`${s.card} ${s.a}`} style={d(0.5)}>
            <small>Orders from ads, this week</small>
            <svg viewBox="0 0 300 70" className={s.chart} preserveAspectRatio="none">
              <path d="M0 60 L40 55 L80 58 L120 44 L160 40 L200 28 L240 22 L300 8" />
            </svg>
          </div>
          <div className={`${s.card} ${s.row} ${s.a}`} style={d(1.5)}>
            <span>
              <b>Ad A · video</b>
              <small>Most orders for the money</small>
            </span>
            <span className={s.win}>Winner — kept running</span>
          </div>
          <div className={`${s.card} ${s.row} ${s.a}`} style={d(2.1)}>
            <span>
              <b>Ad B · photo</b>
              <small>Costly, few orders</small>
            </span>
            <span className={s.lose}>Paused</span>
          </div>
          <div className={`${s.chipLime} ${s.a}`} style={d(2.8)}>
            ✨ Fresh creative made for next week
          </div>
        </>
      );
    case 'comments':
      return (
        <>
          {[
            {
              who: 'Ayesha',
              said: 'Do you deliver to DHA?',
              reply: 'Yes! We deliver across Lahore — order on WhatsApp and it reaches you the same day 🎂',
              at: 0.3,
            },
            {
              who: 'Bilal',
              said: 'Price for a 2-pound cake?',
              reply: 'Thanks for asking, Bilal! The full price list is in our bio link 🙌',
              at: 1.8,
            },
          ].map((c) => (
            <div key={c.who} className={s.thread}>
              <div className={`${s.comment} ${s.a}`} style={d(c.at)}>
                <span className={s.avatar}>{c.who[0]}</span>
                <span>
                  <b>{c.who}</b> {c.said}
                </span>
              </div>
              <div className={`${s.reply} ${s.a}`} style={d(c.at + 0.9)}>
                <span>{c.reply}</span>
                <small>✓ Answered automatically</small>
              </div>
            </div>
          ))}
          <div className={`${s.comment} ${s.waiting} ${s.a}`} style={d(3.3)}>
            <span className={s.avatar}>S</span>
            <span>
              <b>Sana</b> The delivery bike nearly hit my son outside your shop
              <small>⏳ Safety — waiting for you, never answered automatically</small>
            </span>
          </div>
        </>
      );
    case 'sales':
      return (
        <>
          <span className={`${s.plane} ${s.a}`} style={d(0.3)}>
            ✉️
          </span>
          {[
            { name: 'Green Valley School', state: 'Email sent ✓', at: 0.5 },
            { name: 'Noor Events', state: 'Followed up', at: 0.9 },
            { name: 'Star Offices', state: 'Replied 💬', at: 1.3, hot: true },
          ].map((l) => (
            <div key={l.name} className={`${s.card} ${s.row} ${s.a} ${l.hot ? s.hot : ''}`} style={d(l.at)}>
              <span>
                <b>{l.name}</b>
                <small>Could order cakes for events</small>
              </span>
              <span className={l.hot ? s.win : s.pill}>{l.state}</span>
            </div>
          ))}
          <div className={`${s.card} ${s.a}`} style={d(2.1)}>
            <small>Star Offices wrote back</small>
            <p className={s.quote}>“Interested — can you send prices for 50 boxes every Friday?”</p>
            <div className={`${s.draft} ${s.a}`} style={d(2.8)}>
              <span>Your answer is drafted</span>
              <span className={s.send}>Send</span>
            </div>
          </div>
        </>
      );
    case 'you':
      return (
        <>
          <div className={s.kpis}>
            {[
              ['🎬', 'Content', 'On schedule'],
              ['💸', 'Ads', 'Inside your limit'],
              ['💬', 'Comments', 'Answered'],
              ['🤝', 'Leads', '1 reply to send'],
            ].map(([icon, label, state], i) => (
              <div key={label} className={`${s.card} ${s.kpi} ${s.a}`} style={d(0.2 + i * 0.3)}>
                <span>{icon}</span>
                <b>{label}</b>
                <small>{state}</small>
              </div>
            ))}
          </div>
          <div className={`${s.card} ${s.a}`} style={d(1.6)}>
            <small>How you pay</small>
            <div className={s.flow}>
              <span>Free {STUDIO_TRIAL_HOURS} hours</span>
              <i>→</i>
              <span>Pick a plan</span>
              <i>→</i>
              <span className={s.flowLime}>+ Credits · ${STUDIO_CREDIT_DAY_USD} a day</span>
            </div>
          </div>
        </>
      );
  }
}

/** The page's few sounds, drawn on the spot: quiet, short, under the voice. */
function play(ac: AudioContext, cue: Cue) {
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = 0.09;
  out.connect(ac.destination);
  const tone = (from: number, to: number, start: number, dur: number, type: OscillatorType = 'sine') => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t + start);
    o.frequency.exponentialRampToValueAtTime(to, t + start + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(1, t + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g).connect(out);
    o.start(t + start);
    o.stop(t + start + dur + 0.05);
  };
  const noise = (dur: number, f0: number, f1: number) => {
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const src = ac.createBufferSource();
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.buffer = buf;
    src.connect(bp).connect(out);
    src.start(t);
  };
  switch (cue) {
    case 'tick':
      tone(1900, 1700, 0, 0.05, 'triangle');
      break;
    case 'pop':
      tone(620, 1240, 0, 0.14);
      break;
    case 'chime':
      tone(784, 784, 0, 0.55);
      tone(1175, 1175, 0.09, 0.7);
      break;
    case 'whoosh':
      noise(0.45, 380, 2600);
      break;
    case 'send':
      noise(0.35, 900, 3800);
      tone(500, 1500, 0.05, 0.3);
      break;
  }
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function SoundOn() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}
function SoundOff() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" />
      <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
    </svg>
  );
}
function Bars() {
  return (
    <span className={s.bars} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
