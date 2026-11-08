'use client';

/**
 * YouTube, TikTok and TikTok Ads on Connected accounts: one card, three networks,
 * "Continue with…" instead of a pasted token.
 *
 * The handshake is GoogleAdsConnect's: a popup to the network, /connect/video
 * hands the code back by postMessage (or localStorage when the popup was blocked
 * and the whole tab went), and the backend spends it. All three cards listen to
 * the same page, so each takes only a state carrying its own mark.
 *
 * An admin stores the TikTok apps once. YouTube uses the Google client saved in
 * the Google Ads card. A Studio customer never sees those forms.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import {
  VIDEO_CONNECT_HANDOFF_KEY,
  VIDEO_CONNECT_RETURN_KEY,
  socialApi,
  videoConnectApi,
  type SocialAccountDoc,
  type TikTokAdsLink,
  type TikTokAdvertiserChoice,
  type VideoConnectHandoff,
  type VideoProvider,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { SkeletonRows } from '@/components/states';

const COPY: Record<VideoProvider, { mark: string; id: string; title: string; button: string; off: string; on: string }> = {
  youtube: {
    mark: 'yt',
    id: 'youtube',
    title: 'YouTube',
    button: 'Continue with Google',
    off: 'Connect your channel. Every reel the team makes goes up as a Short, and comments come to your Inbox. YouTube ads also need Google Ads connected.',
    on: 'Every reel the team makes goes up here as a Short.',
  },
  tiktok: {
    mark: 'tt',
    id: 'tiktok',
    title: 'TikTok',
    button: 'Continue with TikTok',
    off: 'Connect your account and every reel the team makes goes up on TikTok. Until TikTok has audited this app, it can only post as "Only me" to a private account.',
    on: 'Every reel the team makes goes up here. Until TikTok has audited this app, it posts as "Only me" to a private account.',
  },
  'tiktok-ads': {
    mark: 'ta',
    id: 'tiktok-ads',
    title: 'TikTok Ads',
    button: 'Continue with TikTok for Business',
    off: 'Connect the ad account the New campaign agent runs on TikTok, inside your daily limit.',
    on: 'The New campaign agent runs ads here, inside your daily limit.',
  },
};

const field: CSSProperties = { width: '100%', height: 38, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 10px', font: 'inherit', fontSize: 13.5 };

export function VideoConnect({
  provider,
  account,
  link,
}: {
  provider: VideoProvider;
  account?: SocialAccountDoc;
  link?: TikTokAdsLink | null;
}) {
  const { isAdmin } = useAuth();
  const copy = COPY[provider];
  const [app, setApp] = useState<Awaited<ReturnType<typeof videoConnectApi.state>> | null>(null);
  const [choices, setChoices] = useState<{ state: string; list: TikTokAdvertiserChoice[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    videoConnectApi
      .state(provider)
      .then(setApp)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the set-up.'));
  }, [provider]);
  useEffect(load, [load]);

  const name = provider === 'tiktok-ads' ? (link?.name ?? null) : account?.status === 'connected' ? account.displayName : null;
  const connected = Boolean(name);
  const problem = provider === 'tiktok-ads' ? (link?.lastError ?? null) : account?.status === 'error' ? account.lastError : null;

  const exchange = useCallback(
    async (h: VideoConnectHandoff) => {
      if (h.error || !h.code || !h.state) {
        setError(h.error ?? 'The sign-in came back without a code.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await videoConnectApi.finish(h.code, h.state);
        if (res.connected) setNote(`Connected: ${res.connected}.`);
        else setChoices({ state: h.state, list: res.choices });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The connection could not be finished.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const mine = (h: VideoConnectHandoff | undefined) => Boolean(h?.state?.startsWith(`${copy.mark}.`));
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as VideoConnectHandoff | undefined;
      if (data?.kind === 'velocity:video-connect' && mine(data)) void exchange(data);
    }
    window.addEventListener('message', onMessage);
    try {
      const raw = window.localStorage.getItem(VIDEO_CONNECT_HANDOFF_KEY);
      const h = raw ? (JSON.parse(raw) as VideoConnectHandoff) : undefined;
      if (h && mine(h)) {
        window.localStorage.removeItem(VIDEO_CONNECT_HANDOFF_KEY);
        if (Date.now() - h.atMs < 10 * 60_000) queueMicrotask(() => void exchange(h));
      }
    } catch {
      // blocked storage or a malformed note: only the popup path works
    }
    return () => window.removeEventListener('message', onMessage);
  }, [copy.mark, exchange]);

  async function start() {
    setError(null);
    setNote(null);
    try {
      const { url } = await videoConnectApi.start(provider);
      try {
        window.localStorage.setItem(VIDEO_CONNECT_RETURN_KEY, window.location.pathname);
      } catch {
        // the callback falls back to Connected accounts
      }
      if (!window.open(url, 'velocity-video-connect', 'width=520,height=720,menubar=no,toolbar=no')) window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the connection.');
    }
  }

  async function choose(advertiserId: string) {
    if (!choices) return;
    setBusy(true);
    setError(null);
    try {
      const res = await videoConnectApi.choose(choices.state, advertiserId);
      setChoices(null);
      setNote(`Connected: ${res.connected}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TikTok would not keep that ad account.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${copy.title}? Nothing will post or run there until you connect again.`)) return;
    setBusy(true);
    setError(null);
    try {
      if (provider === 'tiktok-ads') await videoConnectApi.disconnect();
      else await socialApi.disconnect({ platform: provider });
      setNote('Disconnected. The stored access has been deleted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id={copy.id} style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 17, fontWeight: 900, margin: '0 0 4px' }}>{copy.title}</h2>
      <p style={{ color: colors.muted, margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5 }}>
        {connected ? `Connected to ${name}${account?.handle ? ` (${account.handle})` : ''}. ${copy.on}` : copy.off}
      </p>
      <Card>
        {problem ? <p style={{ margin: '0 0 10px', color: colors.danger, fontSize: 13.5 }}>{problem}</p> : null}
        {!app ? (
          error ? null : (
            <SkeletonRows rows={1} />
          )
        ) : choices ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>That sign-in reaches several ad accounts. Which one should run your ads?</span>
            {choices.list.map((c) => (
              <Button key={c.advertiserId} variant="ghost" disabled={busy} onClick={() => void choose(c.advertiserId)}>
                {c.name} · {c.currency}
              </Button>
            ))}
          </div>
        ) : connected ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={start} disabled={busy}>
              Connect a different account
            </Button>
            <Button variant="danger" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          </div>
        ) : app.ready ? (
          <Button onClick={start} disabled={busy}>
            {busy ? 'Finishing…' : copy.button}
          </Button>
        ) : provider === 'youtube' ? (
          <p style={{ color: colors.muted, margin: 0, fontSize: 13.5 }}>
            {isAdmin ? 'Save the Google OAuth client in the Google Ads card first. YouTube signs in with the same one.' : 'YouTube is not available on this desk yet.'}
          </p>
        ) : isAdmin ? (
          <AppSetup provider={provider} redirectUri={app.redirectUri} vaultReady={app.vaultReady} onSaved={load} />
        ) : (
          <p style={{ color: colors.muted, margin: 0, fontSize: 13.5 }}>{copy.title} is not available on this desk yet.</p>
        )}
        {isAdmin && app && !connected ? (
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: colors.muted }}>
            Redirect address for this app: <code style={{ userSelect: 'all' }}>{app.redirectUri}</code>
          </p>
        ) : null}
        {note ? <p style={{ margin: '10px 0 0', fontSize: 13, color: colors.success }}>{note}</p> : null}
        {error ? <p style={{ margin: '10px 0 0', fontSize: 13, color: colors.danger }}>{error}</p> : null}
      </Card>
    </section>
  );
}

/** A TikTok app, stored once by an admin. */
function AppSetup({ provider, redirectUri, vaultReady, onSaved }: { provider: 'tiktok' | 'tiktok-ads'; redirectUri: string; vaultReady: boolean; onSaved: () => void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const posting = provider === 'tiktok';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await videoConnectApi.setApp({ provider, id: id.trim(), secret: secret.trim() });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the app.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13.5 }}>
      <strong>One-time set-up (admins only)</strong>
      <ol style={{ margin: 0, paddingLeft: 18, color: colors.muted, lineHeight: 1.6 }}>
        {posting ? (
          <>
            <li>developers.tiktok.com → Manage apps → create an app with Login Kit and the Content Posting API (Direct Post on).</li>
            <li>Under Login Kit add this redirect address: <code style={{ userSelect: 'all' }}>{redirectUri}</code></li>
            <li>Paste the app&apos;s Client key and Client secret below.</li>
          </>
        ) : (
          <>
            <li>business-api.tiktok.com → My Apps → create a Marketing API app, and have it approved.</li>
            <li>Set the app&apos;s Advertiser redirect URL to: <code style={{ userSelect: 'all' }}>{redirectUri}</code></li>
            <li>Paste the App ID and Secret below.</li>
          </>
        )}
      </ol>
      {!vaultReady ? <p style={{ color: colors.danger, margin: 0 }}>SOCIAL_TOKEN_KEY is missing, so nothing can be stored.</p> : null}
      <input style={field} placeholder={posting ? 'Client key' : 'App ID'} value={id} onChange={(e) => setId(e.target.value)} aria-label={posting ? 'Client key' : 'App ID'} />
      <input style={field} placeholder={posting ? 'Client secret' : 'Secret'} value={secret} onChange={(e) => setSecret(e.target.value)} aria-label={posting ? 'Client secret' : 'Secret'} type="password" />
      <div>
        <Button onClick={save} disabled={busy || !vaultReady || id.trim().length < 3 || secret.trim().length < 8}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error ? <p style={{ margin: 0, color: colors.danger }}>{error}</p> : null}
    </div>
  );
}
