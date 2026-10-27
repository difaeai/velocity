'use client';

/**
 * How Velocity Studio works, as one story in five numbered steps.
 *
 * The steps scroll by; beside each a mock of the real Studio console — same
 * nav, same green-and-white theme — acts out the step in view, with the
 * matching film from the shop in the corner. On wide screens the steps zig-zag
 * and the console glides to whichever lane the text is not in. A narrator reads each step the
 * moment it scrolls in, with small sounds timed to its animation (drawn live
 * with Web Audio, no files). The voice, the first-touch rule and the mute are
 * the whole page's, in `siteSound.tsx`.
 *
 * The narration is `siteVoice.json`, rendered to `public/site/voice/{key}.mp3`
 * by `scripts/render-site-voice.py` — change a line, render it again. A line
 * downloads only when its step scrolls in. Reduced motion shows every scene at rest.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ArrowRight } from './Icons';
import { effects, hush, say, useSiteSound } from './siteSound';
import { useReducedMotion } from './useReducedMotion';
import site from './site.module.css';
import s from './studioStory.module.css';
import VOICE from './siteVoice.json';
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
/** Seconds the wipe covers the console before the next step's scene starts (matches `wipe` in the CSS). */
const WIPE_LAG = 0.65;
/** Where the layout stacks, as in the CSS. */
const NARROW = '(max-width: 900px)';
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
  // The step being read: -1 while none is in the band (above the first step, past the last).
  const [active, setActive] = useState(-1);
  // The step on the console: the last one read, so it never jumps back to the first.
  const [shown, setShown] = useState(0);
  // The voice is the page's (siteSound): this only says which line, and when.
  const sound = useSiteSound();
  const speaking = sound.speaking && sound.owner === 'story';
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  // Each move to another step: which way, and a count so the wipe replays. Read by the sound effect too.
  const [turn, setTurn] = useState({ n: 0, dir: 1 });
  const shownRef = useRef(0);

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
        setActive(top ? top[0] : -1);
        if (top && top[0] !== shownRef.current) {
          const dir = top[0] > shownRef.current ? 1 : -1;
          shownRef.current = top[0];
          setTurn((t) => ({ n: t.n + 1, dir }));
          setShown(top[0]);
        }
      },
      { rootMargin: window.matchMedia(NARROW).matches ? '-58% 0px -34% 0px' : '-48% 0px -42% 0px' },
    );
    rows.current.forEach((row) => row && io.observe(row));
    return () => io.disconnect();
  }, []);

  // Each step that scrolls in is read aloud at once, with its sounds timed to its animation — after the wipe
  // that announces it (and its whoosh), when it was reached from another step.
  const lag = turn.n > 0 && !reduced ? WIPE_LAG : 0;
  useEffect(() => {
    if (active < 0) return;
    say('story', `/site/voice/${STEPS[active].key}.mp3`);
    const cues: [number, Cue][] = lag
      ? [[0, 'whoosh'], ...STEPS[active].cues.map(([at, c]): [number, Cue] => [at + lag, c])]
      : STEPS[active].cues;
    const timers = reduced
      ? []
      : cues.map(([at, cue]) =>
          setTimeout(() => {
            const ac = effects();
            if (ac) play(ac, cue);
          }, at * 1000),
        );
    return () => {
      hush('story');
      timers.forEach(clearTimeout);
    };
  }, [active, reduced, lag]);

  const step = STEPS[shown];
  const films = !reduced && !saveData;

  return (
    <section id="how-it-works" className={`${site.section} ${site.deep} ${s.story}`} aria-labelledby="story-heading">
      <div className={`${site.wrap} ${s.wide}`}>
        <header className={s.head}>
          <span className={site.eyebrow}>How Velocity Studio works</span>
          <h2 id="story-heading" className={site.h2}>
            Five steps. Your team runs them <span className={site.accent}>on its own.</span>
          </h2>
          <p className={site.lead}>
            Keep scrolling — a narrator reads each step as it comes up, in the same dashboard you get.
          </p>
        </header>

        <div className={s.grid}>
          <ol className={s.steps} style={{ ['--fill' as string]: (shown + 1) / STEPS.length }}>
            {STEPS.map((st, i) => (
              <li
                key={st.key}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                id={`step-${i + 1}`}
                data-i={i}
                className={`${s.step} ${i === shown ? s.on : ''}`}
                aria-current={i === shown ? 'step' : undefined}
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
                {i < LAST ? (
                  <a className={s.next} href={`#step-${i + 2}`}>
                    Next · Step {i + 2}: {STEPS[i + 1].title}
                    <DownArrow />
                  </a>
                ) : null}
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

          <div className={s.stageCol}>
            {/* On wide screens the steps zig-zag: odd steps' text left and the console right, even steps the other way. */}
            <div className={`${s.stage} ${shown % 2 ? s.stageLeft : ''}`}>
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
                        <i key={x.key} className={i <= shown ? s.lit : ''} />
                      ))}
                    </span>
                  </div>
                  <span className={s.meter} style={{ ['--p' as string]: (shown + 1) / STEPS.length }} />
                  {turn.n > 0 && !reduced ? (
                    <div key={turn.n} className={`${s.wipe} ${turn.dir < 0 ? s.wipeBack : ''}`}>
                      <span className={s.wipeKicker}>{turn.dir > 0 ? 'Next step' : 'Back a step'}</span>
                      <span className={s.wipeNum}>
                        Step {shown + 1} <small>of {STEPS.length}</small>
                      </span>
                      <strong className={s.wipeTitle}>{step.title}</strong>
                    </div>
                  ) : null}
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
                        <span className={s.stepTag}>Step {shown + 1}</span>
                        <strong>{step.page}</strong>
                      </div>
                      <div
                        key={step.key}
                        className={`${s.scene} ${reduced ? s.rest : turn.dir < 0 ? s.fromLeft : ''}`}
                        style={{ ['--lag' as string]: `${lag}s` }}
                      >
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

function DownArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M6 13l6 6 6-6" />
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
