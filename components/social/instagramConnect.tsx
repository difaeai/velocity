'use client';

/**
 * "Connect Instagram", as one button.
 *
 * The card below this one can still take a pasted Page token, and that path is
 * kept because it is the only way in for anyone who cannot be an admin of the
 * Meta app. But a paste asks an operator to know what a long-lived Page token
 * is and where an Instagram Business account id hides, and that is why nothing
 * was ever connected. This is the same connection made the way Meta intends:
 * sign in, tick the Velocity Rides Page, done.
 *
 * What is on screen is always the real state of the handshake, never a guess:
 * every step below corresponds to a call that has actually returned.
 *
 * The code comes back through `/connect/instagram` — by postMessage when the
 * popup survives, by localStorage when it was blocked and Facebook replaced
 * this whole tab instead. Both are handled, because a blocked popup is the
 * single most common way an OAuth flow fails for a real person.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { colors } from '@/lib/config';
import {
  META_HANDOFF_KEY,
  socialApi,
  type MetaConnectState,
  type MetaHandoff,
  type MetaPageChoice,
  type SocialAccountDoc,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge } from './shared';

type Step = 'idle' | 'waiting' | 'exchanging' | 'choosing' | 'saving' | 'done';

export function InstagramConnect({ account }: { account?: SocialAccountDoc }) {
  const [state, setState] = useState<MetaConnectState | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [pages, setPages] = useState<MetaPageChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);

  /** The `state` string of the handshake in flight, matched on the way back. */
  const pending = useRef<string | null>(null);
  const popup = useRef<Window | null>(null);

  const refresh = useCallback(() => {
    socialApi
      .metaState({})
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the Meta app settings.'));
  }, []);

  useEffect(refresh, [refresh]);

  /** Spend the code. Shared by both ways it can arrive. */
  const exchange = useCallback(async (handoff: MetaHandoff) => {
    if (handoff.error) {
      setStep('idle');
      setError(handoff.error);
      return;
    }
    if (!handoff.code || !handoff.state) return;
    if (pending.current && handoff.state !== pending.current) return;

    setStep('exchanging');
    setError(null);
    try {
      const res = await socialApi.finishMetaConnect({ code: handoff.code, state: handoff.state });
      pending.current = handoff.state;
      setPages(res.pages);
      setStep('choosing');
      if (res.pages.length === 0) {
        setError(
          'That account does not administer any Facebook Page. Instagram can only be connected through ' +
            'the Page its Business account is linked to.',
        );
        setStep('idle');
      }
    } catch (e) {
      setStep('idle');
      setError(e instanceof Error ? e.message : 'Facebook would not complete the connection.');
    }
  }, []);

  // The popup's way home.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as MetaHandoff | undefined;
      if (data?.kind !== 'velocity:meta-connect') return;
      void exchange(data);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [exchange]);

  // The blocked-popup way home: Facebook replaced the tab, the callback page
  // left the result behind, and we are now mounting fresh after the redirect.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(META_HANDOFF_KEY);
      if (raw) window.localStorage.removeItem(META_HANDOFF_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let handoff: MetaHandoff;
    try {
      handoff = JSON.parse(raw) as MetaHandoff;
    } catch {
      return; // malformed — nothing to do
    }
    // Minutes old at most. An hour-old code is spent or expired and only
    // produces a confusing error.
    if (Date.now() - handoff.atMs > 10 * 60_000) return;

    // Deferred by a tick for the same reason the postMessage path is deferred:
    // this runs during mount, and the first paint should be the card as it
    // normally looks rather than a state change racing hydration.
    queueMicrotask(() => void exchange(handoff));
  }, [exchange]);

  async function start() {
    setError(null);
    setNote(null);
    setStep('waiting');
    try {
      const { url, state: s } = await socialApi.startMetaConnect({});
      pending.current = s;
      popup.current = window.open(url, 'velocity-meta-connect', 'width=600,height=760,menubar=no,toolbar=no');
      if (!popup.current) {
        // Blocked. Go the whole-tab route rather than telling someone to find
        // their popup blocker.
        window.location.assign(url);
      }
    } catch (e) {
      setStep('idle');
      setError(e instanceof Error ? e.message : 'Could not start the connection.');
    }
  }

  async function choose(pageId: string) {
    if (!pending.current) return;
    setStep('saving');
    setError(null);
    try {
      const res = await socialApi.chooseMetaPage({ state: pending.current, pageId });
      setStep('done');
      setNote(res.note);
      pending.current = null;
      setPages([]);
    } catch (e) {
      setStep('choosing');
      setError(e instanceof Error ? e.message : 'That Page could not be stored.');
    }
  }

  const connected = account?.status === 'connected';
  const busy = step === 'waiting' || step === 'exchanging' || step === 'saving';

  return (
    <Card style={{ marginBottom: 16, borderColor: connected ? colors.border : '#d946ef55' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <PlatformBadge platform="instagram" size={44} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong style={{ fontSize: 16 }}>
            {connected ? 'Instagram is connected' : 'Connect Instagram in one step'}
          </strong>
          <p style={{ fontSize: 13.5, color: colors.muted, margin: '5px 0 0', lineHeight: 1.55 }}>
            {connected ? (
              <>
                Posting as <strong style={{ color: colors.text }}>{account?.handle ?? account?.displayName}</strong>
                {typeof account?.followers === 'number'
                  ? ` · ${account.followers.toLocaleString('en-PK')} followers`
                  : ''}
                . Connecting again replaces the stored token.
              </>
            ) : (
              <>
                Sign in with the Facebook account that manages the Velocity Rides Page and tick it. We read
                the Page back, find the Instagram Business account attached to it, and store a Page token
                that does not expire — no token pasting, no ids to look up.
              </>
            )}
          </p>
        </div>

        {state?.ready ? (
          <Button onClick={start} disabled={busy}>
            {step === 'waiting'
              ? 'Waiting for Facebook…'
              : step === 'exchanging'
                ? 'Reading your Pages…'
                : connected
                  ? 'Reconnect'
                  : 'Continue with Facebook'}
          </Button>
        ) : null}
      </div>

      {/* Live, honest progress: three steps, each lit only once its call returned. */}
      {busy || step === 'choosing' ? (
        <Steps
          step={step}
          labels={['Signing in with Facebook', 'Reading your Pages', 'Storing the connection']}
        />
      ) : null}

      {error ? (
        <p style={{ fontSize: 13, color: colors.danger, margin: '12px 0 0', lineHeight: 1.5 }}>{error}</p>
      ) : null}

      {step === 'done' ? (
        <p style={{ fontSize: 13.5, color: note ? colors.warn : colors.success, margin: '12px 0 0', lineHeight: 1.5 }}>
          {note ?? 'Connected. The Facebook Page and its Instagram account are both live.'}
        </p>
      ) : null}

      {step === 'choosing' && pages.length ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.muted }}>
            {pages.length === 1 ? 'This is the Page we found — confirm it:' : 'Which Page is Velocity Rides?'}
          </span>
          {pages.map((p) => (
            <button
              key={p.pageId}
              type="button"
              onClick={() => choose(p.pageId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.avatarUrl}
                  alt=""
                  width={36}
                  height={36}
                  style={{ borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <PlatformBadge platform="facebook" size={36} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{p.pageName}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: p.instagramId ? colors.muted : colors.warn }}>
                  {p.instagramId
                    ? `${p.instagramHandle ?? 'Instagram Business account'}${
                        typeof p.followers === 'number' ? ` · ${p.followers.toLocaleString('en-PK')} followers` : ''
                      }`
                    : 'No Instagram Business account linked — only the Page would connect'}
                </span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.secondary }}>Use this →</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Setup — only ever shown when the backend says something is missing. */}
      {state && !state.ready ? (
        <MetaAppSetup
          state={state}
          open={setup}
          onOpen={() => setSetup(true)}
          onSaved={() => {
            setSetup(false);
            refresh();
          }}
        />
      ) : null}

      {state?.ready && state.source === 'whatsapp' && !connected ? (
        <p style={{ fontSize: 12, color: colors.muted, margin: '12px 0 0', lineHeight: 1.5 }}>
          Using the Meta app already configured for WhatsApp. If Facebook refuses the sign-in, that app needs
          the <strong>Facebook Login</strong> product added, with <code>{state.redirectUri}</code> as a valid
          OAuth redirect URI.
        </p>
      ) : null}
    </Card>
  );
}

/** Three lights. Lit = this call returned; pulsing = it is in flight right now. */
function Steps({ step, labels }: { step: Step; labels: string[] }) {
  const reached =
    step === 'waiting' ? 0 : step === 'exchanging' ? 1 : step === 'choosing' ? 2 : step === 'saving' ? 2 : 3;

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
      {labels.map((label, i) => {
        const done = i < reached;
        const live = i === reached;
        return (
          <span
            key={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12.5,
              fontWeight: 700,
              color: done ? colors.success : live ? colors.text : colors.muted,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: done ? colors.success : live ? colors.primary : colors.border,
                animation: live ? 'velocity-pulse 1.1s ease-in-out infinite' : undefined,
              }}
            />
            {label}
          </span>
        );
      })}
      <style>{'@keyframes velocity-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }'}</style>
    </div>
  );
}

/**
 * The one-time setup, shown only while it is genuinely missing.
 *
 * It asks for the App ID and App Secret rather than inventing a Velocity-wide
 * Meta app, because the Page belongs to the business and the app that posts to
 * it has to belong to the same business — anything else is a review rejection
 * waiting to happen.
 */
function MetaAppSetup({
  state,
  open,
  onOpen,
  onSaved,
}: {
  state: MetaConnectState;
  open: boolean;
  onOpen: () => void;
  onSaved: () => void;
}) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!state.vaultReady) {
    return (
      <p style={{ fontSize: 13, color: colors.warn, margin: '14px 0 0', lineHeight: 1.55 }}>
        <code>SOCIAL_TOKEN_KEY</code> is missing from the backend secrets, so no credential can be stored.
        That has to be fixed before anything can be connected, by any route.
      </p>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await socialApi.setMetaApp({ appId: appId.trim(), appSecret: appSecret.trim() });
      setAppId('');
      setAppSecret('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Facebook rejected that pair.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
      {!open ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: colors.muted }}>
            One-time setup first: this console needs the Meta app that owns the Page.
          </span>
          <Button variant="ghost" onClick={onOpen}>
            Set it up
          </Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <ol style={{ fontSize: 13, color: colors.muted, lineHeight: 1.65, margin: 0, paddingLeft: 18 }}>
            <li>
              Open <strong>developers.facebook.com</strong> → your app (or create a Business app) →{' '}
              <strong>Add product → Facebook Login</strong>.
            </li>
            <li>
              Under Facebook Login → Settings, paste this into <strong>Valid OAuth Redirect URIs</strong>:
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <code
                  style={{
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: '5px 9px',
                    fontSize: 12.5,
                    color: colors.text,
                  }}
                >
                  {state.redirectUri}
                </code>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(state.redirectUri);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </span>
            </li>
            <li>
              Copy the <strong>App ID</strong> and <strong>App Secret</strong> from Settings → Basic, and paste
              them here. The secret is proved against Facebook and then stored encrypted; it is never readable
              from this console again.
            </li>
          </ol>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>App ID</span>
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={setupInput}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>App Secret</span>
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={setupInput}
            />
          </label>

          {error ? <p style={{ fontSize: 13, color: colors.danger, margin: 0 }}>{error}</p> : null}

          <div>
            <Button onClick={save} disabled={busy || !appId.trim() || !appSecret.trim()}>
              {busy ? 'Checking with Facebook…' : 'Save and verify'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const setupInput: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 12px',
  fontSize: 14,
  fontFamily: 'inherit',
};
