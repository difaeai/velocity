'use client';

/**
 * Google Ads on Connected accounts: "Continue with Google", pick the account,
 * and from then on the last 30 days of it — spend, clicks, conversions and the
 * biggest campaigns. Reading only: nothing here changes a campaign or spends.
 *
 * The handshake is InstagramConnect's: a popup to Google, /connect/google-ads
 * hands the code back by postMessage (or localStorage when the popup was
 * blocked and the whole tab went), and the backend spends it.
 *
 * Before the first connect an admin stores the app once: an OAuth client from
 * Google Cloud and the developer token from a Google Ads manager account. A
 * Studio customer never sees that form — the app is Velocity's.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';

import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import {
  GOOGLE_ADS_HANDOFF_KEY,
  GOOGLE_ADS_RETURN_KEY,
  googleAdsApi,
  type GoogleAdsChoice,
  type GoogleAdsHandoff,
  type GoogleAdsLink,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';

type Summary = Awaited<ReturnType<typeof googleAdsApi.summary>>;

const field: CSSProperties = {
  width: '100%',
  height: 38,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: '0 10px',
  font: 'inherit',
  fontSize: 13.5,
};

const money = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString('en-PK', { maximumFractionDigits: currency === 'PKR' ? 0 : 2 })}`;

export function GoogleAdsConnect({ link }: { link: GoogleAdsLink | null | undefined }) {
  const { isAdmin } = useAuth();
  const [app, setApp] = useState<Awaited<ReturnType<typeof googleAdsApi.state>> | null>(null);
  const [choices, setChoices] = useState<GoogleAdsChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    googleAdsApi
      .state({})
      .then(setApp)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the Google Ads set-up.'));
  }, []);

  const connected = Boolean(link?.customerId);
  useEffect(() => {
    if (!connected) return;
    googleAdsApi
      .summary({})
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read Google Ads.'));
  }, [connected, link?.customerId]);

  const choose = useCallback(async (state: string, customerId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await googleAdsApi.choose({ state, customerId });
      setChoices(null);
      pending.current = null;
      setNote(`Connected: ${res.name} (${res.customerId}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google Ads would not keep that account.');
    } finally {
      setBusy(false);
    }
  }, []);

  const exchange = useCallback(
    async (h: GoogleAdsHandoff) => {
      if (h.error || !h.code || !h.state) {
        setError(h.error ?? 'Google sent no authorization code.');
        return;
      }
      pending.current = h.state;
      setBusy(true);
      setError(null);
      try {
        const { choices: list } = await googleAdsApi.finish({ code: h.code, state: h.state });
        const usable = list.filter((c) => !c.manager && !c.note);
        if (usable.length === 1) await choose(h.state, usable[0].customerId);
        else setChoices(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Google would not complete the connection.');
      } finally {
        setBusy(false);
      }
    },
    [choose],
  );

  // The popup's way home, and the blocked-popup way home after the redirect.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as GoogleAdsHandoff | undefined;
      if (data?.kind === 'velocity:google-ads-connect') void exchange(data);
    }
    window.addEventListener('message', onMessage);
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(GOOGLE_ADS_HANDOFF_KEY);
      if (raw) window.localStorage.removeItem(GOOGLE_ADS_HANDOFF_KEY);
    } catch {
      // blocked storage: only the popup path works
    }
    if (raw) {
      try {
        const h = JSON.parse(raw) as GoogleAdsHandoff;
        if (Date.now() - h.atMs < 10 * 60_000) queueMicrotask(() => void exchange(h));
      } catch {
        // malformed — ignore
      }
    }
    return () => window.removeEventListener('message', onMessage);
  }, [exchange]);

  async function start() {
    setError(null);
    setNote(null);
    try {
      const { url } = await googleAdsApi.start({});
      try {
        window.localStorage.setItem(GOOGLE_ADS_RETURN_KEY, window.location.pathname);
      } catch {
        // the callback falls back to Connected accounts
      }
      if (!window.open(url, 'velocity-google-ads', 'width=520,height=700,menubar=no,toolbar=no')) window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the connection.');
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Ads? Its numbers leave the dashboard and blended ROAS until you connect again.')) return;
    setBusy(true);
    try {
      await googleAdsApi.disconnect({});
      setSummary(null);
      setNote('Disconnected. Velocity no longer holds any Google access.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="google-ads" style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 17, fontWeight: 900, margin: '0 0 4px' }}>Google Ads</h2>
      <p style={{ color: colors.muted, margin: '0 0 12px', fontSize: 13.5 }}>
        {connected
          ? `Connected to ${link!.name} (${dash(link!.customerId)})${link!.testAccount ? ', a test account' : ''}. The desk reads it — spend, clicks, conversions — and counts its spend in blended ROAS. It never changes a campaign.`
          : 'Connect the Google Ads account you run. The desk reads it and counts its spend in blended ROAS; it never changes a campaign or spends.'}
      </p>

      <Card>
        {connected ? (
          <>
            {link!.lastError ? (
              <p style={{ margin: '0 0 10px', color: colors.danger, fontSize: 13.5 }}>
                {link!.lastError}{' '}
                <Button variant="ghost" onClick={start} disabled={busy}>
                  Connect again
                </Button>
              </p>
            ) : null}
            {summary ? <Numbers s={summary} /> : !error ? <p style={{ color: colors.muted, margin: 0 }}>Reading the last 30 days…</p> : null}
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </div>
          </>
        ) : !app ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading…</p>
        ) : app.ready ? (
          choices ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>That sign-in reaches several accounts — which one runs your ads?</span>
              {choices.map((c) => (
                <Button
                  key={c.customerId}
                  variant="ghost"
                  disabled={busy || c.manager || Boolean(c.note)}
                  onClick={() => pending.current && void choose(pending.current, c.customerId)}
                >
                  {c.name} ({dash(c.customerId)}) · {c.currency}
                  {c.manager ? ' · manager account' : ''}
                  {c.testAccount ? ' · test' : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </Button>
              ))}
            </div>
          ) : (
            <Button onClick={start} disabled={busy}>
              {busy ? 'Finishing with Google…' : 'Continue with Google'}
            </Button>
          )
        ) : isAdmin ? (
          <AppSetup redirectUri={app.redirectUri} vaultReady={app.vaultReady} onSaved={() => googleAdsApi.state({}).then(setApp)} />
        ) : (
          <p style={{ color: colors.muted, margin: 0 }}>Google Ads is not available on this desk yet.</p>
        )}
        {note ? <p style={{ margin: '10px 0 0', fontSize: 13, color: colors.success }}>{note}</p> : null}
        {error ? <p style={{ margin: '10px 0 0', fontSize: 13, color: colors.danger }}>{error}</p> : null}
      </Card>
    </section>
  );
}

const dash = (id: string) => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;

function Numbers({ s }: { s: Summary }) {
  const t = s.totals;
  const tiles = [
    { label: 'Spent, last 30 days', value: money(t.spend, s.currency) },
    { label: 'Clicks', value: t.clicks.toLocaleString('en-PK') },
    { label: 'Conversions', value: t.conversions.toLocaleString('en-PK', { maximumFractionDigits: 1 }) },
    { label: 'Cost per conversion', value: t.conversions ? money(t.spend / t.conversions, s.currency) : '—' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {tiles.map((k) => (
          <div key={k.label}>
            <div style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{k.value}</div>
          </div>
        ))}
      </div>
      {s.campaigns.length ? (
        <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          {s.campaigns.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', borderTop: `1px solid ${colors.border}`, paddingTop: 6 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{c.name}</strong>{' '}
                <span style={{ color: colors.muted }}>
                  {c.status.toLowerCase()} · {c.channel.toLowerCase().replace(/_/g, ' ')}
                </span>
              </span>
              <span style={{ whiteSpace: 'nowrap', color: colors.muted }}>
                {money(c.spend, s.currency)} · {c.clicks} clicks · {c.conversions.toLocaleString('en-PK', { maximumFractionDigits: 1 })} conv.
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: colors.muted, margin: 0, fontSize: 13 }}>No campaigns spent anything in the last 30 days.</p>
      )}
    </div>
  );
}

/** The app, stored once by an admin: the OAuth client and the developer token. */
function AppSetup({ redirectUri, vaultReady, onSaved }: { redirectUri: string; vaultReady: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({ clientId: '', clientSecret: '', developerToken: '', loginCustomerId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await googleAdsApi.setApp({
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
        developerToken: form.developerToken.trim(),
        ...(form.loginCustomerId.trim() ? { loginCustomerId: form.loginCustomerId.trim() } : {}),
      });
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
        <li>
          Google Ads manager account → Tools → API Center → copy the <strong>developer token</strong>. Until Google grants Basic
          access it works only with test accounts.
        </li>
        <li>
          console.cloud.google.com → APIs &amp; Services → enable the <strong>Google Ads API</strong> → Credentials → Create OAuth
          client ID (Web application).
        </li>
        <li>
          Add this exact redirect URI: <code style={{ userSelect: 'all' }}>{redirectUri}</code>
        </li>
      </ol>
      {!vaultReady ? <p style={{ color: colors.danger, margin: 0 }}>SOCIAL_TOKEN_KEY is missing, so nothing can be stored.</p> : null}
      <input style={field} placeholder="Client ID (…apps.googleusercontent.com)" value={form.clientId} onChange={set('clientId')} aria-label="OAuth client ID" />
      <input style={field} placeholder="Client secret" value={form.clientSecret} onChange={set('clientSecret')} aria-label="OAuth client secret" type="password" />
      <input style={field} placeholder="Developer token" value={form.developerToken} onChange={set('developerToken')} aria-label="Developer token" type="password" />
      <input
        style={field}
        placeholder="Manager account ID, if your ads account sits under one (optional)"
        value={form.loginCustomerId}
        onChange={set('loginCustomerId')}
        aria-label="Manager account ID"
      />
      <div>
        <Button onClick={save} disabled={busy || !vaultReady || !form.clientId || !form.clientSecret || !form.developerToken}>
          {busy ? 'Checking with Google…' : 'Save'}
        </Button>
      </div>
      {error ? <p style={{ margin: 0, color: colors.danger }}>{error}</p> : null}
    </div>
  );
}
