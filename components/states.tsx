'use client';

/**
 * The states every console page can be in, drawn the same way everywhere:
 *
 *   loading   the shape of what is coming (Skeleton), never a bare spinner
 *   empty     why it is empty, and the one next step
 *   error     what went wrong, whose fault, how to fix — and Try again
 *   no match  the likely typo fixed, and a next search
 *   a field   the mistake at the field, with how to fix it
 *   success   confirmed, reassured, celebrated, and what happens next
 *   network   offline or slow, at the foot of the page — never over the content
 *
 * Mirrors apps/mobile/src/ui/states.tsx.
 */
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { colors } from '@/lib/config';
import { callsVersion, explainError, oldestCall, subscribeCalls } from '@/lib/connection';

export type StateAction = { label: string; onClick?: () => void; href?: string };

const box: React.CSSProperties = {
  textAlign: 'center',
  padding: '32px 20px',
  border: `1px dashed ${colors.border}`,
  borderRadius: 14,
  background: '#fff',
};

function ActionButton({ action, quiet }: { action: StateAction; quiet?: boolean }) {
  const style: React.CSSProperties = {
    display: 'inline-block',
    marginTop: 14,
    padding: '9px 16px',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 13,
    textDecoration: 'none',
    cursor: 'pointer',
    background: quiet ? 'transparent' : colors.primary,
    color: quiet ? colors.text : '#fff',
    border: quiet ? `1px solid ${colors.border}` : 'none',
  };
  return action.href ? (
    <Link href={action.href} style={style}>
      {action.label}
    </Link>
  ) : (
    <button type="button" onClick={action.onClick} style={style}>
      {action.label}
    </button>
  );
}

/** One block in the shape of what is coming. */
export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <div aria-hidden className="v-skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

/** A list or table that has not arrived yet: rows shaped like the rows that will. */
export function SkeletonRows({ rows = 5, h = 44, label = 'Loading' }: { rows?: number; h?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h} r={10} />
      ))}
    </div>
  );
}

/** Nothing here — why it is empty, and the one thing to do next. */
export function EmptyState({
  icon = '○',
  title,
  why,
  action,
}: {
  icon?: string;
  title: string;
  why: string;
  action?: StateAction;
}) {
  return (
    <div style={box}>
      <div aria-hidden style={{ fontSize: 30, marginBottom: 6 }}>
        {icon}
      </div>
      <div style={{ fontWeight: 800, color: colors.text }}>{title}</div>
      <div style={{ color: colors.muted, fontSize: 13, marginTop: 4, maxWidth: 460, marginInline: 'auto' }}>{why}</div>
      {action ? <ActionButton action={action} /> : null}
    </div>
  );
}

/** What went wrong, whose fault it is, how to fix it — and a way to try again. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ ...box, borderStyle: 'solid', borderColor: '#f3c7c7', background: '#fff8f8' }}>
      <div aria-hidden style={{ fontSize: 26, marginBottom: 6 }}>
        ⚠
      </div>
      <div style={{ fontWeight: 800, color: colors.text }}>This did not load</div>
      <div style={{ color: colors.muted, fontSize: 13, marginTop: 4, maxWidth: 480, marginInline: 'auto' }}>
        {typeof error === 'string' ? error : explainError(error)}
      </div>
      {onRetry ? <ActionButton action={{ label: 'Try again', onClick: onRetry }} /> : null}
    </div>
  );
}

/** A search that found nothing: the likely typo fixed, and what to search next. */
export function NoResults({
  query,
  suggestion,
  onSuggestion,
  next,
}: {
  query: string;
  suggestion?: string | null;
  onSuggestion?: (s: string) => void;
  next: string;
}) {
  return (
    <div style={box} role="status">
      <div style={{ fontWeight: 800, color: colors.text }}>Nothing matches “{query}”</div>
      {suggestion && onSuggestion ? (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          Did you mean{' '}
          <button
            type="button"
            onClick={() => onSuggestion(suggestion)}
            style={{ border: 'none', background: 'none', padding: 0, color: colors.primary, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', fontSize: 14 }}
          >
            {suggestion}
          </button>
          ?
        </div>
      ) : null}
      <div style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>{next}</div>
    </div>
  );
}

/** The mistake, at the field, with how to fix it. Give the input `aria-describedby={id}`. */
export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <div id={id} role="alert" style={{ color: colors.danger, fontSize: 12, fontWeight: 600, marginTop: 5 }}>
      ⚠ {message}
    </div>
  );
}

/** Done: confirm it, reassure, celebrate it, then show what happens next. */
export function SuccessState({
  title,
  reassurance,
  next,
  action,
}: {
  title: string;
  reassurance: string;
  next: string;
  action?: StateAction;
}) {
  return (
    <div role="status" style={{ ...box, borderStyle: 'solid', borderColor: '#bfe3cf', background: '#f3fbf6' }}>
      <div aria-hidden className="v-pop" style={{ fontSize: 34, marginBottom: 4 }}>
        🎉
      </div>
      <div style={{ fontWeight: 800, color: colors.text, fontSize: 16 }}>{title}</div>
      <div style={{ color: colors.text, fontSize: 13, marginTop: 6 }}>{reassurance}</div>
      <div style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
        <b>What happens next:</b> {next}
      </div>
      {action ? <ActionButton action={action} /> : null}
    </div>
  );
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Shown after a call has waited this long; before that a pause is just a pause. */
const SLOW_MS = 4000;

/**
 * Offline or slow, at the foot of every console page. Offline keeps what is on
 * screen and says what still works; slow shows the real seconds against the
 * call's own limit, so a long wait reads as progress rather than a hang.
 */
export function NetworkNotice() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  useSyncExternalStore(subscribeCalls, callsVersion, callsVersion);
  const call = oldestCall();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!call) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call]);

  const waited = call ? now - call.startedMs : 0;
  if (online && (!call || waited < SLOW_MS)) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    width: 'min(560px, calc(100vw - 32px))',
    background: online ? '#1c1b1b' : '#7a2e00',
    color: '#fff',
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 13,
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  };

  if (!online) {
    return (
      <div role="status" aria-live="polite" style={style}>
        <b>You are offline.</b> Everything on screen stays as it was, and you can keep reading it. Saving and loading
        new data wait until you are back — this reconnects by itself.
      </div>
    );
  }

  const secs = Math.round(waited / 1000);
  const limit = Math.round(call!.limitMs / 1000);
  return (
    <div role="status" aria-live="polite" style={style}>
      <div>
        <b>Still working — {secs}s</b> {limit < 600 ? `of up to ${limit}s. ` : '. '}The connection or our server is
        slow; keep this tab open.
      </div>
      <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.2)', marginTop: 8 }}>
        <div style={{ height: 4, borderRadius: 4, background: '#a8e6c1', width: `${Math.min(100, (waited / call!.limitMs) * 100)}%` }} />
      </div>
    </div>
  );
}
