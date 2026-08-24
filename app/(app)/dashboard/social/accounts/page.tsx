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
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import {
  socialApi,
  type ConnectSchema,
  type SocialAccountDoc,
  type SocialPlatform,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge, PLATFORM_META, StatusPill } from '@/components/social/shared';

export default function AccountsPage() {
  const [schema, setSchema] = useState<ConnectSchema | null>(null);
  const [accounts, setAccounts] = useState<Record<string, SocialAccountDoc>>({});
  const [openFor, setOpenFor] = useState<SocialPlatform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    socialApi
      .connectSchema({})
      .then(setSchema)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the connect form.'));
  }, []);

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'socialAccounts'),
        (snap) => {
          const next: Record<string, SocialAccountDoc> = {};
          snap.docs.forEach((d) => {
            next[d.id] = { ...(d.data() as SocialAccountDoc), platform: d.id as SocialPlatform };
          });
          setAccounts(next);
        },
        (e) => setError(e.message),
      ),
    [],
  );

  return (
    <div>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Connected accounts</h1>
        <p style={{ color: colors.muted, margin: 0, maxWidth: 720 }}>
          Every network Velocity posts to. A credential is proved against the live API before it is
          stored, and stored encrypted — the token itself is never readable from this console again.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

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
    </div>
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
          {connected ? (
            <>
              <Button variant="ghost" onClick={() => run('verify')} disabled={busy !== null}>
                {busy === 'verify' ? 'Checking…' : 'Check'}
              </Button>
              <Button variant="danger" onClick={() => run('disconnect')} disabled={busy !== null}>
                Disconnect
              </Button>
            </>
          ) : null}
          <Button variant={connected ? 'ghost' : 'primary'} onClick={onToggle} disabled={disabled}>
            {open ? 'Cancel' : connected ? 'Replace token' : 'Connect'}
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
