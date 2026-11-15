'use client';

/**
 * Manage social → Connected accounts.
 *
 * This is the page that decides whether somebody who has just paid for Vexa
 * ever gets any value out of it, and it used to be a stack of ten cards in no
 * order with a token field under each. So it is now a catalogue: what can be
 * plugged in, grouped by what plugging it in gets you, and how far through you
 * are.
 *
 * **Two audiences, and they must not see the same page** (owner, 2026-11-15).
 *
 *  - A *customer* presses Connect, signs in to Facebook or Google, and is done.
 *    They never see a token, an app id or a secret, because there is nothing
 *    they could usefully do with one. Where a network has no sign-in button at
 *    all — Threads, X, LinkedIn — the honest thing is not a password box they
 *    cannot fill, it is a card that says we will connect it for you. Note that
 *    this narrows what a customer can do alone: before, the paste form was in
 *    front of everybody.
 *  - *Velocity's own desk* gets the paste forms, because somebody here does
 *    have the token and has to put it somewhere.
 *
 * The credential rules have not changed and are worth repeating: whatever is
 * pasted is spent on a real call to the network before anything is stored, so a
 * typo, a missing scope or an expired token fails here rather than quietly at
 * 10am tomorrow; and what is stored is encrypted and never readable from this
 * console again.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';

import Link from 'next/link';

import { useDraft } from '@/lib/draft';
import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { SUPPORT_EMAIL } from '@/lib/site';
import { colors } from '@/lib/config';
import {
  adsApi,
  socialApi,
  type AdsConfigDoc,
  type CloserConfigDoc,
  type ConnectSchema,
  type SalesSettingsDoc,
  type SocialAccountDoc,
  type SocialPlatform,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { PlatformBadge, PLATFORM_META, StatusPill } from '@/components/social/shared';
import { InstagramConnect } from '@/components/social/instagramConnect';
import { GoogleAdsConnect } from '@/components/social/googleAdsConnect';
import { VideoConnect } from '@/components/social/videoConnect';
import { StoreConnect } from '@/components/social/storeConnect';
import { SkeletonRows } from '@/components/states';
import { AREA_CSS, Area } from '@/components/social/dashboard';
import { HowLink, SetupGuide, type GuideKey } from '@/components/social/setupGuide';

export default function AccountsPage() {
  const { path, includes, house } = useWorkspace();
  const [schema, setSchema] = useState<ConnectSchema | null>(null);
  const [accounts, setAccounts] = useState<Record<string, SocialAccountDoc>>({});
  const [ads, setAds] = useState<AdsConfigDoc | null>(null);
  const [wa, setWa] = useState<CloserConfigDoc | null>(null);
  const [mail, setMail] = useState<SalesSettingsDoc | null>(null);
  const [openFor, setOpenFor] = useState<SocialPlatform | null>(null);
  const [guide, setGuide] = useState<GuideKey | null | false>(false);
  const [error, setError] = useState<string | null>(null);
  const showAds = includes('ads');
  const showSales = includes('sales');
  // A campaign handed to the Ad Expert before the ad account was connected waits for it (the Ads page keeps it).
  const [handed] = useDraft('ads.handedBrief');
  const showContent = includes(['content', 'research']);

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

  // The selling half is connected on its own pages; this page is the catalogue,
  // so it reads their state and points at them rather than repeating the forms.
  useEffect(() => {
    if (!showSales) return;
    const stopWa = onSnapshot(
      doc(db, path('system/whatsapp')),
      (snap) => setWa(snap.exists() ? (snap.data() as CloserConfigDoc) : null),
      () => setWa(null),
    );
    const stopMail = onSnapshot(
      doc(db, path('system/sales')),
      (snap) => setMail(snap.exists() ? (snap.data() as SalesSettingsDoc) : null),
      () => setMail(null),
    );
    return () => {
      stopWa();
      stopMail();
    };
  }, [path, showSales]);

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

  /** How far through they are — the one number that answers "am I set up?". */
  const progress = useMemo(() => {
    const on: boolean[] = [];
    if (showContent) on.push(accounts.instagram?.status === 'connected' || accounts.facebook?.status === 'connected');
    if (includes('content')) on.push(accounts.youtube?.status === 'connected', accounts.tiktok?.status === 'connected');
    if (showAds) on.push(Boolean(ads?.adAccountId), Boolean(ads?.google?.customerId));
    if (showSales) on.push(Boolean(wa?.connected), Boolean(mail?.smtp));
    return { done: on.filter(Boolean).length, all: on.length };
  }, [accounts, ads, wa, mail, showContent, showAds, showSales, includes]);

  const pasteHere = house;
  // Reporting-only and token-only networks. A customer cannot connect these
  // alone, so they are offered as something we do for them rather than as a
  // password box with no password behind it.
  const tokenPlatforms = (schema?.platforms ?? []).filter((p) => p.platform !== 'youtube' && p.platform !== 'tiktok');

  return (
    <div className="fx">
      <style>{AREA_CSS + ACC_CSS}</style>

      <header className="ac-top">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>Connected accounts</h1>
          <p>
            Everything Vexa can plug into, and what each one gets you. Nothing goes out anywhere until the account it
            posts to is connected.
          </p>
        </div>
        <div className="ac-prog">
          <span className="ac-prog-n">
            {progress.done}
            <i>/{progress.all}</i>
          </span>
          <span className="ac-prog-k">connected</span>
          <span className="ac-prog-bar" aria-hidden>
            <i style={{ width: `${progress.all ? (progress.done / progress.all) * 100 : 0}%` }} />
          </span>
          <button type="button" className="ac-guide" onClick={() => setGuide(null)}>
            Setting-up guide
          </button>
        </div>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}

      {schema && !schema.vaultReady ? (
        <Card style={{ marginBottom: 16, borderColor: '#fab219', background: '#fab2190f' }}>
          <strong style={{ fontSize: 14 }}>The token vault is not configured</strong>
          <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 0' }}>
            {pasteHere ? (
              <>
                Accounts cannot be connected until <code>SOCIAL_TOKEN_KEY</code> exists in the backend secrets — a page
                token is a password, and storing one in the clear is not an option. Generate a key with{' '}
                <code>openssl rand -base64 32</code>, add it as a GitHub Actions secret named{' '}
                <code>SOCIAL_TOKEN_KEY</code>, and redeploy the functions.
              </>
            ) : (
              <>Connecting is turned off at our end for a moment. Nothing you have done is lost — try again shortly.</>
            )}
          </p>
        </Card>
      ) : null}

      {showContent ? (
        <Area
          n={1}
          tour="accounts-list"
          tint="#0058bb"
          title="Where you post"
          says="The accounts Vexa posts your reels, pictures and stories to, and reads the comments on."
        >
          <Tool
            title="Instagram & Facebook"
            says="One Facebook sign-in connects both. Reels, posts, stories and carousels go out here, and comments come back to your Comments page."
            onHow={() => setGuide('instagram')}
          >
            <InstagramConnect account={accounts.instagram} />
          </Tool>

          {includes('content') ? (
            <Tool
              title="YouTube"
              says="Every reel also goes up as a Short."
              onHow={() => setGuide('youtube')}
            >
              <VideoConnect provider="youtube" account={accounts.youtube} />
            </Tool>
          ) : null}

          {includes('content') ? (
            <Tool title="TikTok" says="Reels go up as TikTok videos." onHow={() => setGuide('tiktok')}>
              <VideoConnect provider="tiktok" account={accounts.tiktok} />
            </Tool>
          ) : null}

          {!schema ? <SkeletonRows rows={3} /> : null}

          {tokenPlatforms.map((p) =>
            pasteHere ? (
              <AccountCard
                key={p.platform}
                meta={p}
                account={accounts[p.platform]}
                open={openFor === p.platform}
                disabled={!schema?.vaultReady}
                onHow={() => setGuide('token')}
                onToggle={() => setOpenFor(openFor === p.platform ? null : p.platform)}
              />
            ) : (
              <WeDoIt key={p.platform} platform={p.platform} label={p.label} account={accounts[p.platform]} />
            ),
          )}
        </Area>
      ) : null}

      {showSales ? (
        <Area
          n={showContent ? 2 : 1}
          tint="#11794c"
          tour="accounts-sales"
          title="Where you sell"
          says="The two places Vexa actually talks to customers and closes them."
        >
          <Linked
            title="WhatsApp"
            says="Vexa answers your WhatsApp from your own number — price, booking, following up — and hands the chat to you the moment it should be a person."
            on={Boolean(wa?.connected)}
            onText={wa?.displayNumber ? `Connected · ${wa.displayNumber}` : 'Connected'}
            href="/dashboard/social/whatsapp"
            cta={wa?.connected ? 'Open WhatsApp sales' : 'Connect your number'}
            onHow={() => setGuide('whatsapp')}
          />
          <Linked
            title="Email"
            says="Vexa writes to customers from your own address and answers what comes back."
            on={Boolean(mail?.smtp)}
            onText={mail?.smtp ? `Connected · ${mail.smtp.from}` : 'Connected'}
            href="/dashboard/social/email"
            cta={mail?.smtp ? 'Open the email agent' : 'Connect your mailbox'}
            onHow={() => setGuide('email')}
          />
        </Area>
      ) : null}

      {showAds ? (
        <Area
          n={(showContent ? 1 : 0) + (showSales ? 1 : 0) + 1}
          tint="#b45309"
          tour="accounts-ads"
          title="Your ads"
          says="The ad accounts the Meta & Google Ad Expert runs and reports on. It spends your money on your own accounts, never ours."
        >
          {handed ? (
            <Card style={{ marginBottom: 14, borderColor: colors.secondary }}>
              <strong style={{ fontSize: 14 }}>A campaign is waiting for the Ad Expert</strong>
              <p style={{ fontSize: 13, color: colors.muted, margin: '6px 0 0', lineHeight: 1.55 }}>
                It was handed over before the ad account was connected. Connect the account below, then open the{' '}
                <Link href="/dashboard/social/ads" style={{ color: colors.secondary, fontWeight: 800 }}>
                  Meta &amp; Google Ad Expert
                </Link>{' '}
                — it starts designing from that campaign on its own.
              </p>
            </Card>
          ) : null}

          <Tool
            title="Meta ads"
            says="Facebook and Instagram ads, run on your own ad account."
            onHow={() => setGuide('meta-ads')}
          >
            <AdsAccount cfg={ads} postingPageId={accounts.facebook?.externalId ?? null} pasteHere={pasteHere} />
          </Tool>
          <Tool title="Google Ads" says="What your Google campaigns cost and brought in." onHow={() => setGuide('google-ads')}>
            <GoogleAdsConnect link={ads?.google} />
          </Tool>
          <Tool title="TikTok Ads" says="The same reporting, for TikTok." onHow={() => setGuide('tiktok-ads')}>
            <VideoConnect provider="tiktok-ads" link={ads?.tiktok} />
          </Tool>
          <Tool
            title="Your online shop"
            says="So the ads can be judged on orders instead of clicks. Totals only — no customer's name, phone or address is ever read in."
            onHow={() => setGuide('store')}
          >
            <StoreConnect />
          </Tool>
        </Area>
      ) : null}

      {guide !== false ? (
        <SetupGuide which={guide} admin={pasteHere} onClose={() => setGuide(false)} onPick={(k) => setGuide(k ?? null)} />
      ) : null}
    </div>
  );
}

/** One connector, with its name, what it gets you, and the instructions beside it. */
function Tool({
  title,
  says,
  onHow,
  children,
}: {
  title: string;
  says: string;
  onHow: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="ac-tool">
      <div className="ac-tool-head">
        <strong>{title}</strong>
        <HowLink onClick={onHow} />
      </div>
      <p className="ac-says">{says}</p>
      {children}
    </div>
  );
}

/** A connector that lives on its own page: its state here, the work there. */
function Linked({
  title,
  says,
  on,
  onText,
  href,
  cta,
  onHow,
}: {
  title: string;
  says: string;
  on: boolean;
  onText: string;
  href: string;
  cta: string;
  onHow: () => void;
}) {
  return (
    <div className="ac-tool">
      <div className="ac-tool-head">
        <strong>{title}</strong>
        <StatusPill status={on ? 'connected' : 'disconnected'} />
        <HowLink onClick={onHow} />
      </div>
      <p className="ac-says">{says}</p>
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, fontWeight: on ? 700 : 400, color: on ? colors.text : colors.muted }}>
            {on ? onText : 'Not connected yet.'}
          </span>
          <Link href={href} className="fx-btn small">
            {cta}
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * A network with no sign-in button — Threads, X, LinkedIn. A customer cannot
 * connect one alone, so they are not shown a form they cannot fill.
 */
function WeDoIt({
  platform,
  label,
  account,
}: {
  platform: SocialPlatform;
  label: string;
  account?: SocialAccountDoc;
}) {
  const connected = account?.status === 'connected';
  return (
    <div className="ac-tool">
      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <PlatformBadge platform={platform} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>{label}</strong>
              <StatusPill status={account?.status ?? 'disconnected'} />
            </div>
            <p style={{ fontSize: 13, color: colors.muted, margin: '4px 0 0', lineHeight: 1.5 }}>
              {connected && account?.displayName
                ? `Connected as ${account.displayName}${account.handle ? ` (${account.handle})` : ''}.`
                : `${PLATFORM_META[platform].note} This one has no sign-in button of its own, so we connect it for you — ask and we will.`}
            </p>
          </div>
          {connected ? null : (
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Please connect my ${label}`)}`} className="fx-btn small ghost">
              Ask us to connect it
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * The Meta Ad Expert's ad account: the Facebook sign-in (about 60 days), or a
 * System User token (never expires). No Disconnect on purpose.
 */
function AdsAccount({
  cfg,
  postingPageId,
  pasteHere,
}: {
  cfg: AdsConfigDoc | null;
  postingPageId: string | null;
  pasteHere: boolean;
}) {
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
    <section id="meta-ads">
      <p style={{ color: colors.muted, margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.55 }}>
        {!connected
          ? 'Connect the ad account the Meta Ad Expert runs. Once connected it stays connected — there is no Disconnect.'
          : permanent
            ? `Connected for good to ${cfg?.accountName} (${cfg?.adAccountId}). The token never expires.`
            : expired
              ? `The Facebook sign-in for ${cfg?.accountName} has expired. Sign in again${pasteHere ? ', or paste a token that never expires below' : ''}.`
              : `Connected to ${cfg?.accountName} (${cfg?.adAccountId}) with a Facebook sign-in${
                  daysLeft !== null ? `, good for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}` : ''
                }.${pasteHere ? ' Paste a System User token below and it never expires.' : ''}`}
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

      {/* The never-expiring token is Velocity's own tool: a customer has no
          business pasting a System User token and no way to make one. */}
      {pasteHere ? (
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
      ) : null}
    </section>
  );
}

function AccountCard({
  meta,
  account,
  open,
  disabled,
  onToggle,
  onHow,
}: {
  meta: ConnectSchema['platforms'][number];
  account?: SocialAccountDoc;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onHow: () => void;
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
    <div className="ac-tool">
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
              <HowLink onClick={onHow} />
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
    </div>
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

const ACC_CSS = `
.ac-top { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 22px; }
.ac-top h1 { font-size: 24px; font-weight: 900; letter-spacing: -.02em; margin: 0 0 5px; }
.ac-top p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--muted); max-width: 640px; }
.ac-prog { flex: none; width: 190px; padding: 13px 14px; border-radius: 16px; background: var(--glass-sheen, #fff); border: 1px solid var(--glass-edge, #e2e8e4); }
.ac-prog-n { font-size: 26px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.ac-prog-n i { font-style: normal; font-size: 15px; color: var(--muted); }
.ac-prog-k { display: block; font-size: 11px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }
.ac-prog-bar { display: block; height: 6px; border-radius: 999px; background: #eef2ef; overflow: hidden; margin: 9px 0 10px; }
.ac-prog-bar > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#19c37d,#ccff00);
  transition: width .6s cubic-bezier(.3,1,.35,1); }
.ac-guide { width: 100%; border: 1px solid var(--line, #e2e8e4); background: #fff; border-radius: 10px; padding: 7px 10px;
  font: inherit; font-size: 12.5px; font-weight: 800; color: #004c31; cursor: pointer; transition: all .2s ease; }
.ac-guide:hover { border-color: #a8d5bd; transform: translateY(-1px); }

.ac-tool { margin-bottom: 18px; }
.ac-tool-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 3px; }
.ac-tool-head strong { font-size: 15px; font-weight: 900; }
.ac-says { margin: 0 0 10px; font-size: 13px; line-height: 1.55; color: var(--muted); max-width: 680px; }
`;
