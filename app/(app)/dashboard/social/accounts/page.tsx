'use client';

/**
 * Manage social → Connected accounts.
 *
 * Connecting is a paste, not a redirect. Each network needs a token (and
 * sometimes an id or an OAuth client); the backend spends it on a read call
 * before storing anything, so a card only ever says "connected as
 * @velocity.rides_" once that credential has genuinely worked. A typo, a
 * missing scope or an expired token fails here, at the desk, with the
 * network's own error text — not silently at 10am tomorrow.
 *
 * The fields each network asks for come from the backend rather than being
 * duplicated here, so the form can never drift from what the adapter needs.
 *
 * The Meta Ad Expert's ad account is connected here too (the Ads page sends
 * you here when it is not). It has no Disconnect, and a System User token —
 * the only kind Meta lets live forever — is never swapped for a 60-day one.
 * A plan without ads sees no ads card; a plan without content sees only it.
 */

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  adsApi,
  socialApi,
  type AdsConfigDoc,
  type ConnectSchema,
  type SocialAccountDoc,
  type SocialPlatform,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge, PLATFORM_META, StatusPill } from '@/components/social/shared';
import { InstagramConnect } from '@/components/social/instagramConnect';

export default function AccountsPage() {
  const { path, includes } = useWorkspace();
  const [schema, setSchema] = useState<ConnectSchema | null>(null);
  const [accounts, setAccounts] = useState<Record<string, SocialAccountDoc>>({});
  const [ads, setAds] = useState<AdsConfigDoc | null>(null);
  const [openFor, setOpenFor] = useState<SocialPlatform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showAds = includes('ads');
  const showContent = includes('content');

  useEffect(() => {
    socialApi
      .connectSchema({})
      .then(setSchema)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the connect form.'));
  }, []);

  useEffect(() => {
    if (!showAds) return;
    return onSnapshot(
      doc(db, path('system/socialAds')),
      (snap) => setAds(snap.exists() ? (snap.data() as AdsConfigDoc) : null),
      () => setAds(null),
    );
  }, [path, showAds]);

  useEffect(
    () =>
      onSnapshot(
        collection(db, path('socialAccounts')),
        (snap) => {
          const next: Record<string, SocialAccountDoc> = {};
          snap.docs.forEach((d) => {
            next[d.id] = { ...(d.data() as SocialAccountDoc), platform: d.id as SocialPlatform };
          });
          setAccounts(next);
        },
        (e) => setError(e.message),
      ),
    [path],
  );

  return (
    <div>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Connected accounts</h1>
        <p style={{ color: colors.muted, margin: 0, maxWidth: 720 }}>
          Every network Velocity Rides posts to. A credential is proved against the live API before it is
          stored, and stored encrypted — the token itself is never readable from this console again.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

      {showAds ? <AdsAccount cfg={ads} postingPageId={accounts.facebook?.externalId ?? null} /> : null}

      {schema && !schema.vaultReady ? (
        <Card style={{ marginBottom: 16, borderColor: '#fab219', background: '#fab2190f' }}>
          <strong style={{ fontSize: 14 }}>The token vault is not configured</strong>
          <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 0' }}>
            Accounts cannot be connected until <code>SOCIAL_TOKEN_KEY</code> exists in the backend
            secrets — a page token is a password, and storing one in the clear is not an option.
            Generate a key with <code>openssl rand -base64 32</code>, add it as a GitHub Actions
            secret named <code>SOCIAL_TOKEN_KEY</code>, and redeploy the functions.
          </p>
        </Card>
      ) : null}

      {/* The one connection that matters first, and the only one that does not
          need a token pasted into it. Everything below is still the manual
          route, which stays for the networks Meta does not own. */}
      {showContent ? <InstagramConnect account={accounts.instagram} /> : null}

      {showContent ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {schema?.platforms.map((p) => (
            <AccountCard
              key={p.platform}
              meta={p}
              account={accounts[p.platform]}
              open={openFor === p.platform}
              disabled={!schema.vaultReady}
              onToggle={() => setOpenFor(openFor === p.platform ? null : p.platform)}
            />
          ))}
          {!schema ? <p style={{ color: colors.muted }}>Loading…</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Meta Ad Expert's ad account: the Facebook sign-in (about 60 days), or a
 * System User token (never expires). No Disconnect on purpose.
 */
function AdsAccount({ cfg, postingPageId }: { cfg: AdsConfigDoc | null; postingPageId: string | null }) {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [choices, setChoices] = useState<{ id: string; name: string; active: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = Boolean(cfg?.adAccountId);
  const permanent = Boolean(cfg?.permanent);
  const daysLeft = cfg?.tokenExpiresAtMs && nowMs ? Math.floor((cfg.tokenExpiresAtMs - nowMs) / 86_400_000) : null;
  const expired = Boolean(cfg?.lastSyncStatus?.includes('expired')) || (daysLeft !== null && daysLeft < 0);

  async function send(adAccountId?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await adsApi.connectToken({ token: token.trim(), ...(adAccountId ? { adAccountId } : {}) });
      if (!res.ok) {
        setChoices(res.choose);
        return;
      }
      setToken('');
      setChoices(null);
      setOpen(false);
      setMessage({
        ok: true,
        text: `${res.permanent ? 'Connected for good' : 'Connected'}: ${res.accountName}.${
          res.permanent ? ' Meta confirms this token never expires.' : ' Meta did not confirm it never expires — make it again with expiry "Never".'
        }${res.pageId ? '' : ' Also give the system user your Facebook Page, so the ads can run as it.'}`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="meta-ads" style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 17, fontWeight: 900, margin: '0 0 4px' }}>Meta Ad Expert</h2>
      <p style={{ color: colors.muted, margin: '0 0 12px', fontSize: 13.5 }}>
        {!connected
          ? 'Connect the ad account the Meta Ad Expert runs. Once connected it stays connected — there is no Disconnect.'
          : permanent
            ? `Connected for good to ${cfg?.accountName} (${cfg?.adAccountId}). The token never expires.`
            : expired
              ? `The Facebook sign-in for ${cfg?.accountName} has expired. Sign in again, or paste a token that never expires below.`
              : `Connected to ${cfg?.accountName} (${cfg?.adAccountId}) with a Facebook sign-in${
                  daysLeft !== null ? `, good for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}` : ''
                }. Paste a System User token below and it never expires.`}
      </p>

      {permanent ? null : (
        <InstagramConnect
          ads={{
            connectedName: expired ? null : (cfg?.accountName ?? null),
            adAccountId: cfg?.adAccountId ?? null,
            pageId: cfg?.pageId ?? postingPageId,
          }}
        />
      )}

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14.5, flex: 1, minWidth: 220 }}>
            {permanent ? 'Use a different ad account' : 'Never expires: a System User token'}
          </strong>
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : permanent ? 'Paste another token' : 'Paste the token'}
          </Button>
        </div>
        {open ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 10, fontSize: 13.5 }}>
            <ol style={{ margin: 0, paddingLeft: 18, color: colors.muted, lineHeight: 1.6 }}>
              <li>business.facebook.com → Business settings → Users → System users → Add (Admin).</li>
              <li>Add assets: your ad account (Manage) and your Facebook Page.</li>
              <li>Generate new token: pick this app, expiry Never, tick ads_management, ads_read, pages_show_list and pages_read_engagement.</li>
              <li>Paste it here. Meta shows it once, so copy it before closing.</li>
            </ol>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="System User token"
              rows={3}
              spellCheck={false}
              style={{ ...inputStyle, height: 'auto', padding: 10 }}
            />
            {choices ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontWeight: 700 }}>This token sees several ad accounts — which one?</span>
                {choices.map((c) => (
                  <Button key={c.id} variant="ghost" onClick={() => send(c.id)} disabled={busy}>
                    {c.name} ({c.id}){c.active ? '' : ' · not active'}
                  </Button>
                ))}
              </div>
            ) : (
              <div>
                <Button onClick={() => send()} disabled={busy || token.trim().length < 20}>
                  {busy ? 'Checking with Meta…' : 'Verify and connect'}
                </Button>
              </div>
            )}
          </div>
        ) : null}
        {message ? (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: message.ok ? colors.success : colors.danger }}>{message.text}</p>
        ) : null}
      </Card>
    </section>
  );
}

function AccountCard({
  meta,
  account,
  open,
  disabled,
  onToggle,
}: {
  meta: ConnectSchema['platforms'][number];
  account?: SocialAccountDoc;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'connect' | 'verify' | 'disconnect'>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  const status = account?.status ?? 'disconnected';
  const connected = status === 'connected';
  // An account in error still has its token stored: Check can bring it straight back.
  const stored = connected || status === 'error';

  async function run(kind: 'connect' | 'verify' | 'disconnect') {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'connect') {
        await socialApi.connect({
          platform: meta.platform,
          accessToken: values.accessToken ?? '',
          externalId: values.externalId || undefined,
          clientId: values.clientId || undefined,
          clientSecret: values.clientSecret || undefined,
        });
        setValues({});
        setMessage({ kind: 'ok', text: 'Connected.' });
        onToggle();
      } else if (kind === 'verify') {
        await socialApi.verify({ platform: meta.platform });
        setMessage({ kind: 'ok', text: 'Still working.' });
      } else {
        await socialApi.disconnect({ platform: meta.platform });
        setMessage({ kind: 'ok', text: 'Disconnected. The stored token has been deleted.' });
      }
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <PlatformBadge platform={meta.platform} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{meta.label}</strong>
            <StatusPill status={status} />
            {!meta.canPublishVideo ? (
              <span style={{ fontSize: 11, color: colors.muted, fontWeight: 700 }}>REPORTING ONLY</span>
            ) : null}
          </div>
          <p style={{ fontSize: 13, color: colors.muted, margin: '4px 0 0' }}>
            {connected && account?.displayName ? (
              <>
                Connected as <strong style={{ color: colors.text }}>{account.displayName}</strong>
                {account.handle ? ` (${account.handle})` : ''}
                {typeof account.followers === 'number'
                  ? ` · ${account.followers.toLocaleString('en-PK')} followers`
                  : ''}
                {account.tokenHint ? ` · token ${account.tokenHint}` : ''}
              </>
            ) : (
              PLATFORM_META[meta.platform].note
            )}
          </p>
          {account?.lastError ? (
            <p style={{ fontSize: 12.5, color: colors.danger, margin: '6px 0 0' }}>{account.lastError}</p>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {stored ? (
            <>
              <Button variant="ghost" onClick={() => run('verify')} disabled={busy !== null}>
                {busy === 'verify' ? 'Checking…' : 'Check'}
              </Button>
              <Button variant="danger" onClick={() => run('disconnect')} disabled={busy !== null}>
                Disconnect
              </Button>
            </>
          ) : null}
          <Button variant={stored ? 'ghost' : 'primary'} onClick={onToggle} disabled={disabled}>
            {open ? 'Cancel' : stored ? 'Replace token' : 'Connect'}
          </Button>
        </div>
      </div>

      {message ? (
        <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0, color: message.kind === 'ok' ? colors.success : colors.danger }}>
          {message.text}
        </p>
      ) : null}

      {open ? (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}`, display: 'grid', gap: 12 }}>
          {meta.fields.map((f) => (
            <label key={f.key} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{f.label}</span>
              <span style={{ fontSize: 12, color: colors.muted }}>{f.hint}</span>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                style={inputStyle}
              />
            </label>
          ))}
          <div>
            <Button onClick={() => run('connect')} disabled={busy !== null || !(values.accessToken ?? '').trim()}>
              {busy === 'connect' ? 'Checking with the network…' : 'Verify and connect'}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  padding: '0 12px',
  fontSize: 14,
  fontFamily: 'inherit',
};
