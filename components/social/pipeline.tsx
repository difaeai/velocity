'use client';

/**
 * The desk as a line, not as a dashboard.
 *
 * The old overview answered "what exists" — a roster, a settings block, a list
 * of accounts, a list of posts. It never answered the question somebody opening
 * this page actually has, which is **where does a post come from, where is one
 * right now, and what is it waiting for**. This is that, in five steps, read
 * top to bottom once and then glanced at forever after.
 *
 * The rule the whole file is built on: **nothing here moves unless something
 * is really happening.** Every count is read off Firestore documents, every lit
 * step is a document in that state this second, and the one piece of motion —
 * a dot travelling into the live step — appears only while a piece is genuinely
 * mid-production and stops the moment it isn't. A page that animates when the
 * desk is idle is a page that teaches you to ignore it.
 *
 * `readPipeline` is pure and separate from the drawing on purpose: what the
 * line claims is then testable without a browser.
 */

import Link from 'next/link';

import { colors } from '@/lib/config';
import {
  FORMAT_STAGES,
  type SocialAccountDoc,
  type SocialPostDoc,
  type SocialPostStatus,
  type SocialSettings,
  type SocialStage,
  type SocialWorkEntry,
} from '@/lib/api';
import { FORMAT_META, STAGE_META } from './shared';

/** The five things that happen to a piece, in the order they happen. */
export type StepKey = 'brief' | 'make' | 'approve' | 'publish' | 'learn';

/** Which step a post is sitting in. The single source of that mapping. */
const STEP_OF: Record<SocialPostStatus, StepKey | null> = {
  planning: 'make',
  researching: 'make',
  drafting: 'make',
  optimising: 'make',
  designing: 'make',
  rendering: 'make',
  awaiting_approval: 'approve',
  changes_requested: 'approve',
  ready: 'publish',
  publishing: 'publish',
  published: 'learn',
  partial: 'learn',
  failed: null,
  rejected: null,
};

export interface PipelineStep {
  key: StepKey;
  label: string;
  /**
   * One line explaining what this step is, for somebody who has never used it.
   * Shown until the desk has been round the loop once, then dropped — see the
   * `teach` prop. An explanation that never goes away stops being read.
   */
  what: string;
  /** How many pieces are sitting in this step right now. */
  count: number;
  /** The real state of this step, read off the documents. */
  state: 'idle' | 'live' | 'waiting' | 'blocked';
  /** What the number means, in words. */
  caption: string;
  href: string;
}

export interface PipelineState {
  steps: PipelineStep[];
  /** The piece being made this second, if there is one. */
  live: {
    post: SocialPostDoc;
    stages: { stage: SocialStage; entry: SocialWorkEntry | null }[];
    current: SocialWorkEntry | null;
  } | null;
  /** True when at least one document is in a machine-working state. */
  running: boolean;
}

/**
 * Read the line off the documents. No clocks, no guesses, no defaults that
 * invent a state nothing is in.
 */
export function readPipeline(
  posts: SocialPostDoc[],
  accounts: SocialAccountDoc[],
  settings: SocialSettings | null,
  staffed: number,
): PipelineState {
  const by = (key: StepKey) => posts.filter((p) => STEP_OF[p.status] === key);

  const making = by('make');
  const approving = by('approve');
  const publishing = by('publish');
  // `ready` sits in this step too, but only one approved since the sweep
  // existed is actually on its way; an older one waits for a person.
  const sending = publishing.filter((p) => p.status === 'publishing' || p.publishQueuedAtMs);
  const parked = publishing.length - sending.length;
  const published = by('learn');
  const connected = accounts.filter((a) => a.status === 'connected');

  const livePost = making[0] ?? null;
  const entries = livePost
    ? (Object.values(livePost.work ?? {}).filter(Boolean) as SocialWorkEntry[])
    : [];
  const current = entries.find((e) => e.state === 'working') ?? null;

  const stages = livePost
    ? (FORMAT_STAGES[livePost.format ?? 'post'] ?? []).map((stage) => ({
        stage,
        entry: (livePost.work ?? {})[stage] ?? null,
      }))
    : [];

  const steps: PipelineStep[] = [
    {
      key: 'brief',
      label: 'The brief',
      what: 'What to make, and when. Either the daily run picks it, or you press the button.',
      count: 0,
      state: staffed === 0 ? 'blocked' : 'idle',
      caption:
        staffed === 0
          ? 'Nobody is hired yet, so there is nobody to brief.'
          : settings?.enabled
            ? `Automatic, ${String(settings.runHour).padStart(2, '0')}:00 PKT daily`
            : 'Manual — only when you ask',
      href: '/dashboard/social/automation',
    },
    {
      key: 'make',
      label: 'The team makes it',
      what: 'Research, search brief, script, pictures, cut — each one a named person on the desk.',
      count: making.length,
      state: making.length ? 'live' : 'idle',
      caption: making.length
        ? current
          ? `${current.name} — ${STAGE_META[current.stage].label.toLowerCase()}`
          : `${making.length} in production`
        : 'Nothing in production',
      href: '/dashboard/social/queue',
    },
    {
      key: 'approve',
      label: settings?.autoPublish ? 'It checks itself' : 'You approve it',
      what: settings?.autoPublish
        ? 'Set to post directly: a finished piece goes straight out. Anything that could not, waits here for you.'
        : 'Every piece stops here until you say yes — then it goes out on its own.',
      count: approving.length,
      state: approving.length ? 'waiting' : 'idle',
      caption: approving.length
        ? `${approving.length} waiting on you`
        : 'Nothing waiting on you',
      href: '/dashboard/social/queue',
    },
    {
      key: 'publish',
      label: 'It posts',
      what: 'Approved pieces go out within minutes to every connected account that takes that format.',
      count: publishing.length,
      state: connected.length === 0 ? 'blocked' : sending.length ? 'live' : parked ? 'waiting' : 'idle',
      caption:
        connected.length === 0
          ? 'No account connected — nowhere to post'
          : sending.length
            ? `${sending.length} going out now`
            : parked
              ? `${parked} approved but not sent — open the queue`
              : `${connected.length} account${connected.length === 1 ? '' : 's'} ready`,
      href: parked && !sending.length ? '/dashboard/social/queue' : '/dashboard/social/accounts',
    },
    {
      key: 'learn',
      label: 'It learns',
      what: 'The desk reads its own page afterwards and ranks what it made against its own median.',
      count: published.length,
      state: 'idle',
      caption: published.length
        ? `${published.length} live piece${published.length === 1 ? '' : 's'} being measured`
        : 'Nothing published yet',
      href: '/dashboard/social/performance',
    },
  ];

  return {
    steps,
    live: livePost ? { post: livePost, stages, current } : null,
    running: making.length > 0,
  };
}

const STATE_COLOUR: Record<PipelineStep['state'], string> = {
  idle: colors.border,
  live: colors.primary,
  waiting: '#b45309',
  blocked: colors.danger,
};

/**
 * The line itself.
 *
 * Laid out as a grid that becomes a column on a narrow screen rather than
 * scrolling sideways — a workflow you have to drag to read is not a workflow
 * anybody reads.
 */
export function Pipeline({ state, teach = true }: { state: PipelineState; teach?: boolean }) {
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${teach ? 170 : 140}px, 1fr))`,
          gap: 0,
          alignItems: 'stretch',
        }}
      >
        {state.steps.map((step, i) => (
          <StepCell
            key={step.key}
            step={step}
            index={i}
            last={i === state.steps.length - 1}
            teach={teach}
          />
        ))}
      </div>

      {state.live ? <LiveStrip live={state.live} /> : <IdleStrip steps={state.steps} />}

      <style>
        {`
        @keyframes velocity-rail { from { left: -18% } to { left: 100% } }
        @keyframes velocity-breathe { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.25); opacity: .55 } }
        @media (prefers-reduced-motion: reduce) {
          .velocity-rail-dot, .velocity-breathe { animation: none !important }
        }
      `}
      </style>
    </div>
  );
}

function StepCell({
  step,
  index,
  last,
  teach,
}: {
  step: PipelineStep;
  index: number;
  last: boolean;
  /** Explain what the step *is*. Dropped once the desk has been round once. */
  teach: boolean;
}) {
  const colour = STATE_COLOUR[step.state];
  const lit = step.state !== 'idle';

  return (
    <Link
      href={step.href}
      style={{
        display: 'block',
        padding: teach ? '14px 14px 16px' : '12px 14px 13px',
        borderRight: last ? 'none' : `1px solid ${colors.border}`,
        color: 'inherit',
        minWidth: 0,
      }}
    >
      {/* the rail: a dot only travels it while this step is really working */}
      <div
        style={{
          position: 'relative',
          height: 4,
          borderRadius: 3,
          background: lit ? `${colour}2e` : colors.border,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        {step.state === 'live' ? (
          <span
            className="velocity-rail-dot"
            style={{
              position: 'absolute',
              top: 0,
              width: '18%',
              height: '100%',
              borderRadius: 3,
              background: colour,
              animation: 'velocity-rail 1.9s linear infinite',
            }}
          />
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
            fontWeight: 900,
            flex: 'none',
            background: lit ? colour : colors.border,
            color: lit ? '#fff' : colors.muted,
          }}
        >
          {index + 1}
        </span>
        <strong style={{ fontSize: 13.5, fontWeight: 800 }}>{step.label}</strong>
        {step.count > 0 ? (
          <span
            className={step.state === 'waiting' ? 'velocity-breathe' : undefined}
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 900,
              color: colour,
              animation: step.state === 'waiting' ? 'velocity-breathe 2.2s ease-in-out infinite' : undefined,
            }}
          >
            {step.count}
          </span>
        ) : null}
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: lit ? colour : colors.text, margin: teach ? '0 0 4px' : 0 }}>
        {step.caption}
      </p>
      {teach ? (
        <p style={{ fontSize: 11.5, color: colors.muted, margin: 0, lineHeight: 1.45 }}>{step.what}</p>
      ) : null}
    </Link>
  );
}

/** What is being made this second, stage by stage. Entirely from `post.work`. */
function LiveStrip({ live }: { live: NonNullable<PipelineState['live']> }) {
  const { post, stages, current } = live;

  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderRadius: 12,
        background: `${colors.primary}0a`,
        border: `1px solid ${colors.primary}26`,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span
          className="velocity-breathe"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: colors.primary,
            animation: 'velocity-breathe 1.4s ease-in-out infinite',
          }}
        />
        <strong style={{ fontSize: 13 }}>
          Making a {FORMAT_META[post.format ?? 'post'].label.toLowerCase()} right now
        </strong>
        <span style={{ fontSize: 12.5, color: colors.muted, minWidth: 0 }}>{post.angle}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {stages.map(({ stage, entry }) => {
          const done = entry?.state === 'done';
          const working = entry?.state === 'working';
          const failed = entry?.state === 'failed';
          const skipped = entry?.state === 'skipped';
          return (
            <span
              key={stage}
              title={entry?.note ?? undefined}
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                padding: '4px 9px',
                borderRadius: 999,
                border: `1px solid ${failed ? colors.danger : working ? colors.primary : colors.border}`,
                background: working ? colors.primary : done ? `${colors.success}14` : 'transparent',
                color: working ? '#fff' : failed ? colors.danger : done ? colors.success : colors.muted,
                opacity: skipped ? 0.45 : 1,
                textDecoration: skipped ? 'line-through' : 'none',
              }}
            >
              {STAGE_META[stage].label}
            </span>
          );
        })}
      </div>

      {current?.note ? (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '10px 0 0', lineHeight: 1.5 }}>
          <strong style={{ color: colors.text }}>{current.name}:</strong> {current.note}
        </p>
      ) : null}
    </div>
  );
}

/** The honest version of "nothing is happening". */
function IdleStrip({ steps }: { steps: PipelineStep[] }) {
  const waiting = steps.find((s) => s.key === 'approve')?.count ?? 0;
  const blocked = steps.find((s) => s.state === 'blocked');

  return (
    <p
      style={{
        padding: '11px 14px',
        borderRadius: 12,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        fontSize: 13,
        color: colors.muted,
        margin: '14px 0 0',
        lineHeight: 1.5,
      }}
    >
      {blocked ? (
        <>Nothing is being made — {blocked.caption.toLowerCase()}.</>
      ) : waiting ? (
        <>
          Nothing is being made right now.{' '}
          <Link href="/dashboard/social/queue" style={{ color: colors.secondary, fontWeight: 700 }}>
            {waiting} piece{waiting === 1 ? '' : 's'} waiting on your approval →
          </Link>
        </>
      ) : (
        <>Nothing is being made right now. Press “Make one now” to start a piece.</>
      )}
    </p>
  );
}

// ── what is stopping it ─────────────────────────────────────────────────────

export interface Blocker {
  label: string;
  why: string;
  href: string;
  cta: string;
  /** A hard stop, versus something that only limits what can be done. */
  hard: boolean;
}

/**
 * The things that would make the next run fail, in the order they would fail.
 *
 * Deliberately not the old checklist: a checklist with five green ticks and one
 * amber one reads as "mostly fine", and the desk is not mostly fine — it either
 * runs or it does not. Only genuine problems appear here, and when there are
 * none the strip is replaced by a single green line.
 */
export function readBlockers(
  readiness: { writer: boolean; engine?: 'claude' | 'gemini' | 'free' | 'local'; tokenVault: boolean } | null,
  staffed: number,
  connectedCount: number,
  brokenCount: number,
): Blocker[] {
  if (!readiness) return [];
  const out: Blocker[] = [];

  // This used to be the hard stop: with no key, nobody could research, write,
  // brief or reply, and a run died on the spot. The local engine ended that, so
  // it is no longer a blocker — but it is not nothing either. The piece still
  // gets written, scored and queued; it is composed from the brand material
  // rather than thought up, and it reads that way. Worth saying once, in warn
  // rather than danger, instead of letting somebody wonder why the voice
  // changed.
  if (readiness.engine === 'local') {
    out.push({
      label: 'Writing without a model',
      why: 'No model key is set, so the desk is using its local engine: it composes from the brand material, scores every candidate against the same checks and picks the best. Reliable and free, and plainer than a model. There is no live market read while it is on, and nothing auto-publishes.',
      href: '/dashboard/social/automation',
      cta: 'What this changes',
      hard: false,
    });
  }
  // Not a problem — it is a real model and it is free — but two things about
  // it are decisions rather than details, and neither is visible in the
  // writing itself. Said once, in warn, where the rest of the state is said.
  if (readiness.engine === 'free') {
    out.push({
      label: 'Writing with a free model',
      why: 'A free model is doing the thinking — the standup, the writing, the SEO, the briefs, the replies, and change requests read properly again. The one thing it cannot do is search the web, so there is still no live market read: the desk says so rather than inventing one.',
      href: '/dashboard/social/automation',
      cta: 'What this changes',
      hard: false,
    });
  }
  if (staffed === 0) {
    out.push({
      label: 'Nobody is hired',
      why: 'An empty desk makes nothing. A content writer alone is enough to see a piece written end to end.',
      href: '/dashboard/social/employees',
      cta: 'Hire someone',
      hard: true,
    });
  }
  if (!readiness.tokenVault) {
    out.push({
      label: 'Credentials cannot be stored',
      why: 'SOCIAL_TOKEN_KEY is missing, so no account can be connected — a page token is a password and storing one in the clear is not an option.',
      href: '/dashboard/social/accounts',
      cta: 'Details',
      hard: true,
    });
  } else if (connectedCount === 0) {
    out.push({
      label: 'Nowhere to post',
      why: 'No account is connected yet. The team can still write and you can still approve, but nothing can go out.',
      href: '/dashboard/social/accounts',
      cta: 'Connect Instagram',
      hard: false,
    });
  }
  if (brokenCount > 0) {
    out.push({
      label: `${brokenCount} account${brokenCount === 1 ? '' : 's'} stopped working`,
      why: 'Most often an expired token. Until it is reconnected, posts to it fail at publish time rather than at approval.',
      href: '/dashboard/social/accounts',
      cta: 'Reconnect',
      hard: false,
    });
  }

  return out;
}

export function Blockers({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) {
    return (
      <p
        style={{
          display: 'flex',
          gap: 9,
          alignItems: 'center',
          fontSize: 13.5,
          fontWeight: 700,
          color: colors.success,
          margin: '0 0 16px',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.success }} />
        Everything this desk needs is in place.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
      {blockers.map((b) => (
        <div
          key={b.label}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${b.hard ? `${colors.danger}3d` : `${colors.warn}3d`}`,
            background: b.hard ? `${colors.danger}0a` : `${colors.warn}0a`,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              marginTop: 6,
              flex: 'none',
              background: b.hard ? colors.danger : colors.warn,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13.5, display: 'block' }}>{b.label}</strong>
            <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>{b.why}</span>
          </div>
          <Link
            href={b.href}
            style={{ fontSize: 12.5, fontWeight: 800, color: colors.secondary, flex: 'none', paddingTop: 2 }}
          >
            {b.cta} →
          </Link>
        </div>
      ))}
    </div>
  );
}
