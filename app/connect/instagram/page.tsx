'use client';

/**
 * Where Facebook lands after the admin ticks the Velocity Rides Page.
 *
 * This page does exactly one thing: hand the authorization code back to the
 * console window that opened it, and get out of the way. It deliberately lives
 * outside the `(app)` route group and needs no sign-in, because a redirect
 * target that first bounces through an auth check is a redirect target that
 * races the session and fails for the one person it was built for.
 *
 * Letting it be public is safe for one specific reason: an authorization code
 * cannot be spent without the Meta app secret, which only Cloud Functions has.
 * The code is also single-use, short-lived, and bound to a `state` that the
 * backend minted for this admin — so the worst a stolen one does is nothing.
 *
 * Two ways home, because popups get blocked:
 * - A popup posts the result to its opener and closes itself.
 * - A full-page redirect leaves the result in `localStorage` and walks back to
 *   the accounts page, which picks it up on mount.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { colors } from '@/lib/config';
import { META_HANDOFF_KEY, type MetaHandoff } from '@/lib/api';

export default function InstagramConnectCallback() {
  return (
    <Suspense fallback={<Shell message="Finishing up…" />}>
      <Handoff />
    </Suspense>
  );
}

function Handoff() {
  const params = useSearchParams();

  // Read during render, not in an effect: the query string is the whole input
  // to this page, so the message below is derived from it rather than being a
  // second copy of it kept in state.
  const result = useMemo(
    () => ({
      code: params.get('code'),
      state: params.get('state'),
      // Facebook sends `error_description` on a decline; it is the sentence
      // worth showing, not the machine-readable `error` beside it.
      error: params.get('error_description') ?? params.get('error'),
    }),
    [params],
  );

  const message = result.error
    ? result.error
    : !result.code
      ? 'Facebook sent us back without an authorization code.'
      : 'Connected. Returning to the console…';

  // The effect only talks to other windows and to storage — the two external
  // systems this page exists to reach. The clock is read here rather than in
  // render for the same reason: it is an external system too.
  useEffect(() => {
    const handoff: MetaHandoff = { kind: 'velocity:meta-connect', ...result, atMs: Date.now() };

    if (window.opener) {
      window.opener.postMessage(handoff, window.location.origin);
      // A beat, so a human sees that something happened rather than a flash.
      const t = setTimeout(() => window.close(), 600);
      return () => clearTimeout(t);
    }

    try {
      window.localStorage.setItem(META_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // Private window, blocked storage. The redirect below still happens and
      // the accounts page simply shows its normal "press Connect" state.
    }
    const t = setTimeout(() => {
      window.location.replace('/dashboard/social/accounts');
    }, 900);
    return () => clearTimeout(t);
  }, [result]);

  return <Shell message={message} />;
}

function Shell({ message }: { message: string }) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: colors.bg,
        color: colors.text,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div
          aria-hidden
          style={{
            width: 46,
            height: 46,
            margin: '0 auto 18px',
            borderRadius: '50%',
            border: `3px solid ${colors.border}`,
            borderTopColor: colors.primary,
            animation: 'velocity-spin 900ms linear infinite',
          }}
        />
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Instagram</h1>
        <p style={{ fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.5 }}>{message}</p>
        <style>{'@keyframes velocity-spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    </main>
  );
}
