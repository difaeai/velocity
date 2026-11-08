'use client';

/**
 * Where YouTube, TikTok and TikTok Ads land after "Continue with…". The sibling
 * of /connect/google-ads, and public for the same reason: a code is worthless
 * without the app secret, which only Cloud Functions holds, and it is bound to a
 * state the backend minted for this person.
 *
 * TikTok Ads calls its code `auth_code`; the other two call it `code`.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { colors } from '@/lib/config';
import { VIDEO_CONNECT_HANDOFF_KEY, VIDEO_CONNECT_RETURN_KEY, type VideoConnectHandoff } from '@/lib/api';

export default function VideoConnectCallback() {
  return (
    <Suspense fallback={<Shell message="Finishing up…" />}>
      <Handoff />
    </Suspense>
  );
}

function Handoff() {
  const params = useSearchParams();
  const result = useMemo(
    () => ({
      code: params.get('auth_code') ?? params.get('code'),
      state: params.get('state'),
      error: params.get('error_description') ?? params.get('error'),
    }),
    [params],
  );
  const message = result.error
    ? result.error === 'access_denied'
      ? 'You cancelled the sign-in.'
      : result.error
    : !result.code
      ? 'We came back without an authorization code.'
      : 'Signed in. Finishing the connection in the console…';

  useEffect(() => {
    const handoff: VideoConnectHandoff = { kind: 'velocity:video-connect', ...result, atMs: Date.now() };
    if (window.opener) {
      window.opener.postMessage(handoff, window.location.origin);
      // A failed sign-in stays open, so its reason can be read.
      if (result.error || !result.code) return;
      const t = setTimeout(() => window.close(), 600);
      return () => clearTimeout(t);
    }
    let back = '/dashboard/social/accounts';
    try {
      const from = window.localStorage.getItem(VIDEO_CONNECT_RETURN_KEY);
      if (from && /^\/dashboard\/social(\/[\w-]+)*$/.test(from)) back = from;
      window.localStorage.setItem(VIDEO_CONNECT_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // Blocked storage: the walk back still happens; the card shows "Continue" again.
    }
    const t = setTimeout(() => window.location.replace(back), 900);
    return () => clearTimeout(t);
  }, [result]);

  return <Shell message={message} />;
}

function Shell({ message }: { message: string }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: colors.bg, color: colors.text, padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Connecting your account</h1>
        <p style={{ fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.5 }}>{message}</p>
      </div>
    </main>
  );
}
