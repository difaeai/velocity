'use client';

/**
 * Where Google lands after "Continue with Google" for Google Ads. The sibling of
 * /connect/instagram, and public for the same reason: a code is worthless
 * without the OAuth client secret, which only Cloud Functions holds, and it is
 * bound to a state the backend minted for this admin.
 *
 * A popup posts the result to its opener and closes; a blocked popup (the
 * whole tab went to Google) leaves it in localStorage and walks back.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { colors } from '@/lib/config';
import { GOOGLE_ADS_HANDOFF_KEY, GOOGLE_ADS_RETURN_KEY, type GoogleAdsHandoff } from '@/lib/api';

export default function GoogleAdsConnectCallback() {
  return (
    <Suspense fallback={<Shell message="Finishing up…" />}>
      <Handoff />
    </Suspense>
  );
}

function Handoff() {
  const params = useSearchParams();
  const result = useMemo(
    () => ({ code: params.get('code'), state: params.get('state'), error: params.get('error_description') ?? params.get('error') }),
    [params],
  );
  const message = result.error
    ? result.error === 'access_denied'
      ? 'You cancelled the Google sign-in.'
      : result.error
    : !result.code
      ? 'Google sent us back without an authorization code.'
      : 'Signed in with Google. Finishing the connection in the console…';

  useEffect(() => {
    const handoff: GoogleAdsHandoff = { kind: 'velocity:google-ads-connect', ...result, atMs: Date.now() };
    if (window.opener) {
      window.opener.postMessage(handoff, window.location.origin);
      const t = setTimeout(() => window.close(), 600);
      return () => clearTimeout(t);
    }
    let back = '/dashboard/social/accounts';
    try {
      const from = window.localStorage.getItem(GOOGLE_ADS_RETURN_KEY);
      if (from && /^\/dashboard\/social(\/[\w-]+)*$/.test(from)) back = from;
      window.localStorage.setItem(GOOGLE_ADS_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // Blocked storage: the walk back still happens; the card shows "Connect" again.
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
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Google Ads</h1>
        <p style={{ fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.5 }}>{message}</p>
      </div>
    </main>
  );
}
