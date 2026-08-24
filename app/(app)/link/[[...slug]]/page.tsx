'use client';

/**
 * Public app-link interstitial.
 *
 * Share messages from the mobile app carry links like
 *   https://<this-host>/link/passenger/travel-mate/group-invite/<id>
 * WhatsApp/SMS render https links as tappable (custom velocity:// URIs are
 * not). This page bounces the visitor into the installed app via the
 * velocity:// scheme — or to the Play Store when the app isn't installed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { VelocityMark } from '@/components/BrandMark';

const ANDROID_PACKAGE = 'com.velocityridzpk.app';
const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export default function AppLinkPage() {
  const params = useParams<{ slug?: string[] }>();
  const [copied, setCopied] = useState(false);

  const path = useMemo(() => {
    const parts = Array.isArray(params?.slug) ? params.slug : [];
    return parts.map(decodeURIComponent).join('/');
  }, [params]);

  const schemeUrl = `velocity:///${path}`;
  // intent:// lets Android Chrome open the app when installed and fall back
  // to the Play Store when it isn't.
  const intentUrl =
    `intent://${path}#Intent;scheme=velocity;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_URL)};end`;

  // Invite links end in a code the user can also paste manually in the app.
  const isPoolInvite = path.includes('pool-join/');
  const inviteCode =
    path.includes('group-invite/') || isPoolInvite ? path.split('/').pop() ?? null : null;

  function openApp() {
    const isAndroid = /android/i.test(navigator.userAgent);
    window.location.href = isAndroid ? intentUrl : schemeUrl;
  }

  // Try the app straight away — most visitors arrive from a share message.
  useEffect(() => {
    if (!path) return;
    const t = setTimeout(openApp, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  async function copyCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — user can select the text */ }
  }

  return (
    <main style={st.page}>
      <div style={st.card}>
        <div style={st.logoRow}>
          <VelocityMark size={28} style={{ color: '#ccff00' }} />
          <span style={st.brand}>Velocity</span>
        </div>

        <h1 style={st.title}>
          {path ? 'Opening in the Velocity app…' : 'Velocity ride-sharing'}
        </h1>
        <p style={st.sub}>
          {path
            ? 'If nothing happens, use the buttons below.'
            : 'This link is incomplete. Ask your friend to share it again from the app.'}
        </p>

        {path && (
          <button style={st.primaryBtn} onClick={openApp}>
            Open in the app
          </button>
        )}
        <a style={st.secondaryBtn} href={PLAY_URL}>
          Get the app on Google Play
        </a>

        {inviteCode && (
          <div style={st.codeBox}>
            <div style={st.codeLabel}>{isPoolInvite ? 'POOL INVITE CODE' : 'GROUP INVITE CODE'}</div>
            <div style={st.codeValue}>{inviteCode}</div>
            <button style={st.copyBtn} onClick={copyCode}>
              {copied ? 'Copied ✓' : 'Copy code'}
            </button>
            <div style={st.codeHint}>
              {isPoolInvite
                ? 'In the app: Book a ride → Pool → “Have an invite code?” → paste this code.'
                : 'In the app: Travel Partner → “Join a group” → paste this code.'}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0d0f0a',
    padding: 20,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#161910',
    border: '1px solid #2a2f1e',
    borderRadius: 20,
    padding: 28,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    textAlign: 'center',
  },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brand: { fontSize: 22, fontWeight: 900, color: '#ccff00', letterSpacing: 0.5 },
  title: { fontSize: 20, fontWeight: 800, color: '#f2f4ec', margin: 0 },
  sub: { fontSize: 14, color: '#9aa08a', margin: 0, lineHeight: 1.5 },
  primaryBtn: {
    display: 'block',
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    border: 'none',
    background: '#ccff00',
    color: '#111400',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'block',
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    border: '1px solid #3a4028',
    background: 'transparent',
    color: '#e6e9dd',
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    boxSizing: 'border-box',
  },
  codeBox: {
    marginTop: 6,
    padding: 14,
    borderRadius: 12,
    background: '#1d2214',
    border: '1px solid #3a4028',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  codeLabel: { fontSize: 10, fontWeight: 900, color: '#ccff00', letterSpacing: 1.2 },
  codeValue: {
    fontSize: 15,
    fontWeight: 700,
    color: '#f2f4ec',
    fontFamily: 'ui-monospace, monospace',
    wordBreak: 'break-all',
    userSelect: 'all',
  },
  copyBtn: {
    padding: '9px 12px',
    borderRadius: 9,
    border: '1px solid #3a4028',
    background: 'transparent',
    color: '#ccff00',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  codeHint: { fontSize: 12, color: '#9aa08a', lineHeight: 1.4 },
};
