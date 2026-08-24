'use client';

/**
 * The office.
 *
 * The roster below this is a list of records; this is the same team as a room.
 * It exists because "who is on this, and what are they doing right now" is a
 * question you answer with your eyes in half a second and never by reading
 * eight cards. Everyone hired has a seat at the round table, and the seat says
 * three things without being read:
 *
 * - **Present.** Active staff breathe, their screens flicker, they talk to each
 *   other. Off duty is a pushed-back chair and a grey face — a gap visible from
 *   across the page, which is exactly what an unfilled job is.
 * - **Working, actually.** When a piece is running, the stage that is live right
 *   now belongs to a person, and that person lights up with the note they left.
 *   It is the same data the queue draws in `WorkLine`, seated.
 * - **Nobody here.** An empty ring of chairs is the truest possible rendering of
 *   an empty team.
 *
 * Everything moves in CSS, with no images and no library — and it all stops dead
 * under `prefers-reduced-motion`, where the composition still reads, because the
 * layout and not the motion carries the meaning.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { colors } from '@/lib/config';
import type { SocialEmployee, SocialPostDoc, SocialRole, SocialStage } from '@/lib/api';
import { Mascot, ROLE_META, STAGE_META } from './shared';

/** What one person is doing this second, when a piece is running. */
export interface OfficeLive {
  stage: SocialStage;
  note: string | null;
}

/** A piece is being made right now, rather than sitting in the queue. */
const IN_PROGRESS = new Set<SocialPostDoc['status']>([
  'planning',
  'researching',
  'drafting',
  'optimising',
  'designing',
  'rendering',
  'publishing',
]);

/**
 * Who is mid-job, read out of the recent posts. Lives here rather than in either
 * page so the office says the same thing wherever it is hung.
 */
export function officeLive(posts: SocialPostDoc[]): {
  live: Record<string, OfficeLive>;
  running: boolean;
} {
  const live: Record<string, OfficeLive> = {};
  posts.forEach((post) =>
    Object.values(post.work ?? {}).forEach((entry) => {
      if (entry?.state === 'working' && entry.employeeId) {
        live[entry.employeeId] = { stage: entry.stage, note: entry.note };
      }
    }),
  );
  return { live, running: posts.some((p) => IN_PROGRESS.has(p.status)) };
}

/** Overheard at the table. Flavour — never dressed up as status. */
const CHATTER: Record<SocialRole, string[]> = {
  'research-assistant': [
    'Three of the top five are driver stories.',
    'This hook shape is everywhere this week.',
    'Saving the link, not the claim.',
  ],
  'content-writer': [
    'First three seconds or nothing.',
    'Cutting the second line.',
    'No number nobody gave me.',
  ],
  'seo-expert': [
    'People search it in Roman Urdu.',
    'That phrase belongs in the caption.',
    'Alt text, properly this time.',
  ],
  'google-seo-expert': [
    'Title under sixty characters.',
    'One query, and we own it.',
    'Tags go in verbatim.',
  ],
  designer: ['Street light, not studio.', 'The lime sits bottom-left.', 'Reshooting frame two.'],
  'video-editor': [
    'Cut on the beat.',
    'Pattern interrupt at second four.',
    'Still watching at seven?',
  ],
  'youtube-ads-expert': [
    'Five hooks, one budget.',
    'Lahore first, then Faisalabad.',
    'I spend nothing — you do.',
  ],
  'social-manager': [
    'Different caption for Threads.',
    'Reply drafted, not sent.',
    'This one goes to support.',
  ],
};

// The ring the seats sit on, as a percentage of the room. Table, laptops and
// chairs are struck from the same centre, so the geometry holds at any size and
// any headcount.
const RX = 34;
const RY = 30.5;

const point = (angle: number, scale: number) => ({
  left: `${50 + RX * scale * Math.cos((angle * Math.PI) / 180)}%`,
  top: `${50 + RY * scale * Math.sin((angle * Math.PI) / 180)}%`,
});

/**
 * A bubble on somebody sitting at the edge of the ring would be cut off by the
 * wall of the room, so the ones out there hang inward from their own edge
 * instead of centring over their head.
 */
function bubbleSide(angle: number): string {
  const x = Math.cos((angle * Math.PI) / 180);
  if (x > 0.55) return ' vo-bubble-r';
  if (x < -0.55) return ' vo-bubble-l';
  return '';
}

export function Office({
  staff,
  live,
  running,
}: {
  staff: SocialEmployee[];
  live?: Record<string, OfficeLive>;
  running?: boolean;
}) {
  const seats = staff.length;
  const active = useMemo(() => staff.filter((e) => e.status === 'active'), [staff]);
  const workingNow = active.filter((e) => live?.[e.id]).length;

  const still = useReducedMotion();
  const chatter = useChatter(active, still || workingNow > 0);
  const clock = useClock();

  // Eight is the designed headcount. Past that everyone shrinks, rather than the
  // ring bulging out of the room.
  const avatar = seats <= 8 ? 54 : seats <= 12 ? 44 : 36;

  return (
    <div
      className="vo-room"
      style={{ ['--vo-avatar' as string]: `${avatar}px` }}
      role="img"
      aria-label={
        seats === 0
          ? 'An empty office: nobody has been hired yet.'
          : `${active.length} of ${seats} employees at the table${
              workingNow ? `, ${workingNow} working right now` : ''
            }.`
      }
    >
      <style>{CSS}</style>

      {/* the wall behind them */}
      <div className="vo-wall">
        <span className="vo-plaque">
          <span className="vo-plaque-dot" />
          VELOCITY · SOCIAL DESK
        </span>
        <span className="vo-clock" aria-hidden>
          <span
            className="vo-hand vo-hand-h"
            style={{ transform: `translateX(-50%) rotate(${clock.hour}deg)` }}
          />
          <span
            className="vo-hand vo-hand-m"
            style={{ transform: `translateX(-50%) rotate(${clock.minute}deg)` }}
          />
          <span className="vo-pin" />
        </span>
      </div>

      {/* the table */}
      <div className="vo-table" aria-hidden>
        <div className="vo-table-top" />
        <div className={`vo-centre${running ? ' vo-centre-live' : ''}`}>
          <span className="vo-centre-dot" />
          <span className="vo-centre-label">
            {seats === 0
              ? 'Empty'
              : running
                ? 'On a piece'
                : workingNow
                  ? `${workingNow} working`
                  : 'Standup'}
          </span>
        </div>
        <span className="vo-mug vo-mug-a">
          <span className="vo-steam" />
        </span>
        <span className="vo-mug vo-mug-b">
          <span className="vo-steam" style={{ animationDelay: '1.4s' }} />
        </span>
        <span className="vo-paper vo-paper-a" />
        <span className="vo-paper vo-paper-b" />
      </div>

      {/* an empty ring, when nobody has been hired */}
      {seats === 0
        ? Array.from({ length: 8 }, (_, i) => {
            const angle = -90 + i * 45;
            return (
              <span
                key={i}
                className="vo-chair vo-chair-empty"
                aria-hidden
                style={{
                  ...point(angle, 1.2),
                  transform: `translate(-50%, -50%) rotate(${angle + 90}deg)`,
                }}
              />
            );
          })
        : null}

      {staff.map((employee, i) => {
        const angle = -90 + (360 / seats) * i;
        const off = employee.status !== 'active';
        const doing = off ? undefined : live?.[employee.id];
        const bubble = doing
          ? doing.note || STAGE_META[doing.stage].label
          : chatter?.id === employee.id
            ? chatter.text
            : null;

        return (
          <div key={employee.id}>
            {/* their laptop, on the table in front of them */}
            <span
              className={`vo-desk${off ? ' vo-desk-off' : ''}${doing ? ' vo-desk-live' : ''}`}
              aria-hidden
              style={{
                ...point(angle, 0.6),
                transform: `translate(-50%, -50%) rotate(${angle + 90}deg)`,
                animationDelay: `${(i % 5) * 0.9}s`,
              }}
            >
              <span className="vo-screen" style={{ background: ROLE_META[employee.role].colour }} />
            </span>

            {/* The person. Off duty they step back from the table — the seat is
                still theirs, they are just not in it. */}
            <div
              className={`vo-seat${off ? ' vo-seat-off' : ''}`}
              style={{ ...point(angle, off ? 1.11 : 1), zIndex: bubble ? 4 : 2 }}
            >
              {bubble ? (
                <span
                  className={`vo-bubble${doing ? ' vo-bubble-live' : ''}${bubbleSide(angle)}`}
                >
                  {doing ? <span className="vo-bubble-stage">{STAGE_META[doing.stage].label}</span> : null}
                  {bubble}
                </span>
              ) : null}

              <span
                className={`vo-body${doing ? ' vo-body-live' : ''}`}
                style={{ animationDelay: `${(i % 4) * 0.55}s` }}
              >
                <span className="vo-pad" aria-hidden />
                <Mascot role={employee.role} size={avatar} />
                {doing ? (
                  <span className="vo-typing" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
              </span>

              <span className="vo-name">{employee.name}</span>
              <span className={`vo-job${off ? ' vo-job-off' : ''}`}>
                {off ? 'Off duty' : ROLE_META[employee.role].short}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── the small hooks that make it feel inhabited ─────────────────────────────

/**
 * Somebody says something every few seconds — but never while real work is on,
 * because a made-up line next to a real one devalues both.
 *
 * The roster is passed in as a flat `id:role` string rather than the array, so
 * a fresh Firestore snapshot carrying the same people does not restart the
 * conversation mid-sentence.
 */
function useChatter(active: SocialEmployee[], silent: boolean) {
  const [chatter, setChatter] = useState<{ id: string; text: string } | null>(null);
  const roster = silent ? '' : active.map((e) => `${e.id}:${e.role}`).join(',');

  useEffect(() => {
    if (!roster) return;

    const people = roster.split(',').map((pair) => {
      const cut = pair.lastIndexOf(':');
      return { id: pair.slice(0, cut), role: pair.slice(cut + 1) as SocialRole };
    });
    let hide: ReturnType<typeof setTimeout> | null = null;

    const speak = () => {
      const person = people[Math.floor(Math.random() * people.length)];
      const lines = CHATTER[person.role];
      if (!lines) return;
      setChatter({ id: person.id, text: lines[Math.floor(Math.random() * lines.length)] });
      hide = setTimeout(() => setChatter(null), 2800);
    };

    const first = setTimeout(speak, 1200);
    const every = setInterval(speak, 4600);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      if (hide) clearTimeout(hide);
      setChatter(null);
    };
  }, [roster]);

  return roster ? chatter : null;
}

/** The wall clock tells the real time. A wrong clock is worse than no clock. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(iv);
  }, []);
  return {
    hour: ((now.getHours() % 12) + now.getMinutes() / 60) * 30,
    minute: now.getMinutes() * 6,
  };
}

const REDUCED = '(prefers-reduced-motion: reduce)';

const watchMotion = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};

/**
 * The chatter is the one thing here JavaScript drives, so it is the one thing
 * that has to ask. Everything else is CSS and is silenced by the media query at
 * the bottom of this file.
 */
function useReducedMotion() {
  return useSyncExternalStore(
    watchMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

// ── the room, in CSS ────────────────────────────────────────────────────────

const CSS = `
.vo-room {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 400px;
  max-height: 560px;
  border-radius: 16px;
  overflow: hidden;
  background:
    radial-gradient(60% 46% at 50% 54%, rgba(204,255,0,0.16), transparent 70%),
    linear-gradient(180deg, #f2f6f3 0%, #e9efeb 100%);
  border: 1px solid ${colors.border};
}

.vo-wall {
  position: absolute; inset: 0 0 auto 0; height: 15%;
  background: linear-gradient(180deg, #e4ebe6, #eef2ef);
  border-bottom: 1px solid rgba(0,0,0,0.05);
  display: flex; align-items: center; justify-content: center;
}
.vo-plaque {
  display: inline-flex; align-items: center; gap: 7px;
  background: ${colors.primary}; color: #fff;
  font-size: 10px; font-weight: 900; letter-spacing: 1.2px;
  padding: 5px 11px; border-radius: 999px; white-space: nowrap;
}
.vo-plaque-dot {
  width: 6px; height: 6px; border-radius: 999px; background: #ccff00;
  animation: vo-blink 2.6s ease-in-out infinite;
}
.vo-clock {
  position: absolute; right: 4%; top: 50%; margin-top: -13px;
  width: 26px; height: 26px; border-radius: 999px;
  background: #fff; border: 2px solid ${colors.primary};
}
.vo-hand {
  position: absolute; left: 50%; bottom: 50%;
  transform-origin: 50% 100%; background: ${colors.text}; border-radius: 2px;
}
.vo-hand-h { width: 2px; height: 6px; margin-left: -1px; }
.vo-hand-m { width: 2px; height: 9px; margin-left: -1px; opacity: 0.7; }
.vo-pin {
  position: absolute; left: 50%; top: 50%; width: 3px; height: 3px;
  margin: -1.5px 0 0 -1.5px; border-radius: 999px; background: ${colors.primary};
}

.vo-table {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 60%; height: 46%; border-radius: 50%;
  background: linear-gradient(180deg, #d9e2db, #c7d2c9);
  box-shadow: 0 14px 26px rgba(20,32,24,0.13);
}
.vo-table-top {
  position: absolute; inset: 6px; border-radius: 50%;
  background: radial-gradient(70% 70% at 50% 32%, #ffffff, #eef2ee 70%, #e3e9e4 100%);
}
.vo-centre {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: inline-flex; align-items: center; gap: 7px;
  background: #fff; border: 1px solid ${colors.border}; border-radius: 999px;
  padding: 5px 12px; box-shadow: 0 2px 8px rgba(20,32,24,0.08);
  font-size: 11px; font-weight: 800; color: ${colors.muted}; white-space: nowrap;
}
.vo-centre-live { border-color: ${colors.primary}; color: ${colors.primary}; }
.vo-centre-dot {
  width: 7px; height: 7px; border-radius: 999px; background: ${colors.primary};
  animation: vo-pulse 1.8s ease-in-out infinite;
}
.vo-centre-label { line-height: 1; }

.vo-mug {
  position: absolute; width: 11px; height: 9px; border-radius: 0 0 5px 5px;
  background: #fff; border: 1.5px solid #c2ccc5;
}
.vo-mug-a { left: 26%; top: 62%; }
.vo-mug-b { right: 24%; top: 30%; }
.vo-steam {
  position: absolute; left: 50%; bottom: 100%; width: 2px; height: 9px; margin-left: -1px;
  background: linear-gradient(180deg, rgba(120,140,128,0), rgba(120,140,128,0.45));
  border-radius: 999px; animation: vo-steam 3.2s ease-in-out infinite;
}
.vo-paper {
  position: absolute; width: 16px; height: 11px; border-radius: 2px;
  background: #fff; border: 1px solid #d7e0d9;
}
.vo-paper-a { left: 30%; top: 26%; transform: rotate(-11deg); }
.vo-paper-b { right: 27%; bottom: 24%; transform: rotate(8deg); }

/* Only ever drawn for an empty office: eight chairs and nobody in them. */
.vo-chair {
  position: absolute; width: calc(var(--vo-avatar) * 0.9); height: 10px;
  border-radius: 6px; background: #cbd5ce;
}

.vo-desk {
  position: absolute; width: calc(var(--vo-avatar) * 0.62); height: 11px;
  border-radius: 3px; background: #aebbb2;
  display: grid; place-items: center;
  animation: vo-flicker 4.6s ease-in-out infinite;
}
.vo-desk-off { animation: none; opacity: 0.45; }
.vo-desk-live { animation-duration: 1.5s; }
.vo-screen { width: 72%; height: 4px; border-radius: 2px; opacity: 0.9; }

.vo-seat {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center;
  width: calc(var(--vo-avatar) * 2);
  text-align: center;
  transition: left 500ms ease, top 500ms ease;
}
.vo-body {
  position: relative; display: block; border-radius: 30%;
  animation: vo-bob 3.6s ease-in-out infinite;
}
/* The mascot is handed a size in pixels, but the room may shrink everyone on a
   narrow screen. One variable has to win, and it is this one — otherwise the
   faces stay big while the seats around them close in. */
.vo-body > svg { width: var(--vo-avatar); height: var(--vo-avatar); }
/* the seat they are in: a soft cushion under the person */
.vo-pad {
  position: absolute; left: 50%; top: 56%;
  width: calc(var(--vo-avatar) * 1.5); height: calc(var(--vo-avatar) * 1.5);
  transform: translate(-50%, -50%); border-radius: 50%;
  background: radial-gradient(closest-side, rgba(120,140,128,0.26), rgba(120,140,128,0));
}
.vo-body-live {
  animation-duration: 1.9s;
  box-shadow: 0 0 0 3px rgba(4,120,87,0.18);
}
.vo-seat-off { opacity: 0.5; }
.vo-seat-off .vo-body { animation: none; filter: grayscale(1); }
.vo-name {
  font-size: 12px; font-weight: 800; color: ${colors.text}; margin-top: 5px;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vo-job { font-size: 10px; font-weight: 700; color: ${colors.muted}; letter-spacing: 0.2px; }

.vo-typing {
  position: absolute; left: 50%; bottom: -7px; transform: translateX(-50%);
  display: flex; gap: 3px; background: #fff; border-radius: 999px; padding: 3px 5px;
  border: 1px solid ${colors.border};
}
.vo-typing i {
  width: 3px; height: 3px; border-radius: 999px; background: ${colors.primary};
  animation: vo-type 1.1s ease-in-out infinite;
}
.vo-typing i:nth-child(2) { animation-delay: 0.16s; }
.vo-typing i:nth-child(3) { animation-delay: 0.32s; }

.vo-bubble {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: #fff; border: 1px solid ${colors.border}; border-radius: 10px;
  padding: 6px 9px; font-size: 11px; line-height: 1.3; font-weight: 600; color: ${colors.text};
  width: max-content; max-width: 148px; text-align: left;
  box-shadow: 0 4px 12px rgba(20,32,24,0.12);
  animation: vo-say 260ms ease-out both;
}
.vo-bubble::after {
  content: ''; position: absolute; top: 100%; left: 50%; margin-left: -4px;
  border: 4px solid transparent; border-top-color: #fff;
}
.vo-bubble-r, .vo-bubble-l { animation-name: vo-say-edge; }
.vo-bubble-r { left: auto; right: 0; transform: none; }
.vo-bubble-r::after { left: auto; right: calc(var(--vo-avatar) * 0.5); margin: 0 -4px 0 0; }
.vo-bubble-l { left: 0; transform: none; }
.vo-bubble-l::after { left: calc(var(--vo-avatar) * 0.5); }
.vo-bubble-live { border-color: ${colors.primary}; }
.vo-bubble-stage {
  display: block; font-size: 9.5px; font-weight: 900; letter-spacing: 0.4px;
  text-transform: uppercase; color: ${colors.primary}; margin-bottom: 2px;
}

@keyframes vo-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes vo-type { 0%, 100% { transform: translateY(0); opacity: 0.4; } 50% { transform: translateY(-3px); opacity: 1; } }
@keyframes vo-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.55; } }
@keyframes vo-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes vo-flicker { 0%, 92%, 100% { opacity: 1; } 95% { opacity: 0.5; } }
@keyframes vo-steam {
  0% { opacity: 0; transform: translateY(4px) scaleY(0.6); }
  45% { opacity: 0.8; }
  100% { opacity: 0; transform: translateY(-6px) scaleY(1.15); }
}
@keyframes vo-say { from { opacity: 0; transform: translate(-50%, 5px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes vo-say-edge { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 640px) {
  .vo-room { --vo-avatar: 38px !important; aspect-ratio: 1 / 1; min-height: 340px; }
  .vo-clock { display: none; }
  .vo-plaque { font-size: 9px; padding: 4px 9px; }
  /* "Off duty" is the one label that still has to survive: it is a gap in the
     team, not decoration. The role is already in the mascot. */
  .vo-job { display: none; }
  .vo-job-off { display: block; }
  .vo-name { font-size: 10.5px; }
  .vo-bubble { max-width: 112px; font-size: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .vo-body, .vo-desk, .vo-steam, .vo-centre-dot, .vo-plaque-dot, .vo-typing i, .vo-bubble {
    animation: none !important;
  }
}
`;
