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
import { PLATFORM_META } from '@/components/social/shared';
// NAV_ICON_CSS is injected once by the sidebar, which is in this page's layout.
import { NavIcon, type NavIconName } from '@/components/social/navIcons';
import { FX_CSS, Ring } from '@/components/social/fx';
import { InstagramConnect } from '@/components/social/instagramConnect';
import { GoogleAdsConnect } from '@/components/social/googleAdsConnect';
import { VideoConnect } from '@/components/social/videoConnect';
import { StoreConnect } from '@/components/social/storeConnect';
import { SkeletonRows } from '@/components/states';
import { AREA_CSS, Area } from '@/components/social/dashboard';
import { HowLink, SETUP_CSS, SetupGuide, type GuideKey } from '@/components/social/setupGuide';

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
      {/* FX_CSS was missing here, which is why this page's buttons and muted
          text were the only ones in the console drawn without it. */}
      <style>{FX_CSS + AREA_CSS + SETUP_CSS + ACC_CSS}</style>

      <header className="ac-top fx-rise">
        <span className="ac-orb" aria-hidden />
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="fx-eyebrow">Set up once</div>
          <h1>Connected accounts</h1>
          <p>
            Everything Vexa can plug into, and what each one gets you. Nothing goes out anywhere until the account it
            posts to is connected.
          </p>
          <button type="button" className="ac-guide" onClick={() => setGuide(null)}>
            <span aria-hidden>📖</span> Setting-up guide
          </button>
        </div>
        <div className="ac-prog">
          <Ring
            value={progress.all ? progress.done / progress.all : 0}
            size={104}
            stroke={9}
            color="#ccff00"
            track="rgba(255,255,255,.14)"
          >
            <span className="ac-prog-n">
              {progress.done}
              <i>/{progress.all}</i>
            </span>
          </Ring>
          <span className="ac-prog-k">connected</span>
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
          <div className="ac-grid">
            <Tool
              i={1}
              logo={<Logos of={['instagram', 'facebook']} />}
              brand="#c13584"
              title="Instagram & Facebook"
              status={state(accounts.instagram) === 'off' ? state(accounts.facebook) : state(accounts.instagram)}
              said={line(accounts.instagram ?? accounts.facebook)}
              says="One Facebook sign-in connects both. Reels, posts, stories and carousels go out here, and comments come back to your Comments page."
              onHow={() => setGuide('instagram')}
            >
              <InstagramConnect account={accounts.instagram} />
            </Tool>

            {includes('content') ? (
              <Tool
                i={2}
                logo={<Logos of={['youtube']} />}
                brand="#ff0000"
                title="YouTube"
                status={state(accounts.youtube)}
                said={line(accounts.youtube)}
                says="Every reel also goes up as a Short."
                onHow={() => setGuide('youtube')}
              >
                <VideoConnect provider="youtube" account={accounts.youtube} />
              </Tool>
            ) : null}

            {includes('content') ? (
              <Tool
                i={3}
                logo={<Logos of={['tiktok']} />}
                brand="#010101"
                title="TikTok"
                status={state(accounts.tiktok)}
                said={line(accounts.tiktok)}
                says="Reels go up as TikTok videos."
                onHow={() => setGuide('tiktok')}
              >
                <VideoConnect provider="tiktok" account={accounts.tiktok} />
              </Tool>
            ) : null}

            {!schema ? <SkeletonRows rows={3} /> : null}

            {tokenPlatforms.map((p, n) =>
              pasteHere ? (
                <AccountCard
                  key={p.platform}
                  i={4 + n}
                  meta={p}
                  account={accounts[p.platform]}
                  open={openFor === p.platform}
                  disabled={!schema?.vaultReady}
                  onHow={() => setGuide('token')}
                  onToggle={() => setOpenFor(openFor === p.platform ? null : p.platform)}
                />
              ) : (
                <WeDoIt key={p.platform} i={4 + n} platform={p.platform} label={p.label} account={accounts[p.platform]} />
              ),
            )}
          </div>
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
          <div className="ac-grid">
            <Linked
              i={1}
              icon="whatsapp"
              brand="#25d366"
              title="WhatsApp"
              says="Vexa answers your WhatsApp from your own number — price, booking, following up — and hands the chat to you the moment it should be a person."
              on={Boolean(wa?.connected)}
              onText={wa?.displayNumber ? `Connected · ${wa.displayNumber}` : 'Connected'}
              href="/dashboard/social/whatsapp"
              cta={wa?.connected ? 'Open WhatsApp sales' : 'Connect your number'}
              onHow={() => setGuide('whatsapp')}
            />
            <Linked
              i={2}
              icon="email"
              brand="#0058bb"
              title="Email"
              says="Vexa writes to customers from your own address and answers what comes back."
              on={Boolean(mail?.smtp)}
              onText={mail?.smtp ? `Connected · ${mail.smtp.from}` : 'Connected'}
              href="/dashboard/social/email"
              cta={mail?.smtp ? 'Open the email agent' : 'Connect your mailbox'}
              onHow={() => setGuide('email')}
            />
          </div>
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

          <div className="ac-grid">
            <Tool
              i={1}
              wide
              logo={<Logos of={['meta']} />}
              brand="#0081fb"
              title="Meta ads"
              status={ads?.adAccountId ? 'connected' : 'off'}
              said={ads?.adAccountId ? `Connected · ${ads.accountName ?? ads.adAccountId}` : 'Not connected'}
              says="Facebook and Instagram ads, run on your own ad account."
              onHow={() => setGuide('meta-ads')}
            >
              <AdsAccount cfg={ads} postingPageId={accounts.facebook?.externalId ?? null} pasteHere={pasteHere} />
            </Tool>
            <Tool
              i={2}
              logo={<Logos of={['google-ads']} />}
              brand="#4285f4"
              title="Google Ads"
              status={ads?.google?.customerId ? 'connected' : 'off'}
              said={ads?.google?.customerId ? 'Connected' : 'Not connected'}
              says="What your Google campaigns cost and brought in."
              onHow={() => setGuide('google-ads')}
            >
              <GoogleAdsConnect link={ads?.google} />
            </Tool>
            <Tool
              i={3}
              logo={<Logos of={['tiktok']} />}
              brand="#010101"
              title="TikTok Ads"
              status={ads?.tiktok?.advertiserId ? 'connected' : 'off'}
              said={ads?.tiktok?.advertiserId ? 'Connected' : 'Not connected'}
              says="The same reporting, for TikTok."
              onHow={() => setGuide('tiktok-ads')}
            >
              <VideoConnect provider="tiktok-ads" link={ads?.tiktok} />
            </Tool>
            <Tool
              i={4}
              logo={<NavIcon name="money" size={24} />}
              brand="#11794c"
              title="Your online shop (WooCommerce)"
              says="So the ads can be judged on orders instead of clicks. Totals only — no customer's name, phone or address is ever read in."
              onHow={() => setGuide('store')}
            >
              <StoreConnect />
            </Tool>
          </div>
        </Area>
      ) : null}

      {guide !== false ? (
        <SetupGuide which={guide} admin={pasteHere} onClose={() => setGuide(false)} onPick={(k) => setGuide(k ?? null)} />
      ) : null}
    </div>
  );
}

type Wired = 'connected' | 'error' | 'off';

/** The status of a posting account, in the one word the tile needs. */
const state = (a?: SocialAccountDoc): Wired =>
  a?.status === 'connected' ? 'connected' : a?.status === 'error' ? 'error' : 'off';

/** The line under a connector's name: who it is connected as, or that it is not. */
const line = (a?: SocialAccountDoc) =>
  a?.status === 'connected'
    ? `Connected${a.displayName ? ` · ${a.displayName}` : ''}${a.handle ? ` (${a.handle})` : ''}`
    : a?.status === 'error'
      ? 'Signed out — connect it again'
      : 'Not connected';

/**
 * The real logos, from `public/site/logos`. A brand is recognised before it is
 * read, which is the entire job of this page: somebody scanning for the thing
 * they already have an account with should find it without reading a word.
 * Two of them overlap where one sign-in covers both networks.
 */
function Logos({ of }: { of: string[] }) {
  return (
    <span className={`ac-logos${of.length > 1 ? ' pair' : ''}`} aria-hidden>
      {of.map((n) => (
        // eslint-disable-next-line @next/next/no-img-element -- a fixed local SVG; next/image would only add a request
        <img key={n} src={`/site/logos/${n}.svg`} alt="" />
      ))}
    </span>
  );
}

/**
 * One connector: its logo, its name, whether it is on, what it gets you, the
 * thing you press, and the instructions beside it.
 *
 * Every connector on this page is this tile — before, each of the four kinds
 * drew its own head, its own status and its own card, which is why the page
 * read as a pile rather than a catalogue (owner, 2026-11-15: "it is a mess").
 */
function Tool({
  i,
  logo,
  brand,
  title,
  says,
  status = 'off',
  said,
  wide,
  onHow,
  children,
}: {
  /** The stagger: tiles rise in one after another. */
  i: number;
  logo: React.ReactNode;
  brand: string;
  title: string;
  says: string;
  status?: Wired;
  /** The line under the name. Omitted for a connector with no state of its own. */
  said?: string;
  /** Takes the whole row — the ad account, which carries a form. */
  wide?: boolean;
  /** Omitted where there is nothing to instruct. */
  onHow?: () => void;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`ac-card fx-rise ${status}${wide ? ' wide' : ''}`}
      style={{ ['--i' as string]: i, ['--brand' as string]: brand } as React.CSSProperties}
    >
      <div className="ac-card-top">
        <span className="ac-logo">{logo}</span>
        <div style={{ minWidth: 0 }}>
          <strong>{title}</strong>
          {said ? <em>{said}</em> : null}
        </div>
        {status === 'connected' ? (
          <svg className="ac-tick" viewBox="0 0 24 24" aria-label="Connected" role="img">
            <path d="M5 13l4.5 4.5L19 7" />
          </svg>
        ) : null}
      </div>
      <p className="ac-says">{says}</p>
      <div className="ac-do">{children}</div>
      {onHow ? <HowLink onClick={onHow} /> : null}
    </article>
  );
}

/** A connector that lives on its own page: its state here, the work there. */
function Linked({
  i,
  icon,
  brand,
  title,
  says,
  on,
  onText,
  href,
  cta,
  onHow,
}: {
  i: number;
  icon: NavIconName;
  brand: string;
  title: string;
  says: string;
  on: boolean;
  onText: string;
  href: string;
  cta: string;
  onHow: () => void;
}) {
  return (
    <Tool
      i={i}
      logo={<NavIcon name={icon} size={24} />}
      brand={brand}
      title={title}
      says={says}
      status={on ? 'connected' : 'off'}
      said={on ? onText : 'Not connected'}
      onHow={onHow}
    >
      <Link href={href} className={`fx-btn small${on ? ' ghost' : ''}`}>
        {cta}
      </Link>
    </Tool>
  );
}

/**
 * A network with no sign-in button — Threads, X, LinkedIn. A customer cannot
 * connect one alone, so they are not shown a form they cannot fill.
 */
function WeDoIt({
  i,
  platform,
  label,
  account,
}: {
  i: number;
  platform: SocialPlatform;
  label: string;
  account?: SocialAccountDoc;
}) {
  const connected = account?.status === 'connected';
  return (
    <Tool
      i={i}
      logo={<span className="ac-glyph">{PLATFORM_META[platform].glyph}</span>}
      brand={PLATFORM_META[platform].brand}
      title={label}
      status={state(account)}
      said={line(account)}
      says={`${PLATFORM_META[platform].note} This one has no sign-in button of its own, so we connect it for you — ask and we will.`}
    >
      {connected ? (
        <span className="ac-quiet">Nothing more to do here.</span>
      ) : (
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Please connect my ${label}`)}`}
          className="fx-btn small ghost"
        >
          Ask us to connect it
        </a>
      )}
    </Tool>
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
  i,
  meta,
  account,
  open,
  disabled,
  onToggle,
  onHow,
}: {
  i: number;
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
    <Tool
      i={i}
      logo={<span className="ac-glyph">{PLATFORM_META[meta.platform].glyph}</span>}
      brand={PLATFORM_META[meta.platform].brand}
      title={meta.label}
      status={state(account)}
      said={
        connected && account?.displayName
          ? `Connected · ${account.displayName}${
              typeof account.followers === 'number' ? ` · ${account.followers.toLocaleString('en-PK')} followers` : ''
            }${account.tokenHint ? ` · token ${account.tokenHint}` : ''}`
          : line(account)
      }
      says={`${PLATFORM_META[meta.platform].note}${meta.canPublishVideo ? '' : ' Reporting only.'}`}
      onHow={onHow}
    >
      {account?.lastError ? <p className="ac-bad">{account.lastError}</p> : null}

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

      {message ? <p className={message.kind === 'ok' ? 'ac-good' : 'ac-bad'}>{message.text}</p> : null}

      {open ? (
        <div className="ac-form">
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
    </Tool>
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
/* the band on top: the one number that answers "am I set up?" */
.ac-top { position: relative; overflow: hidden; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; margin-bottom: 20px;
  border-radius: 26px; padding: 24px 26px; color: #eaf5ee;
  background: radial-gradient(120% 140% at 0% 0%, #0f5a3c 0%, #06301f 48%, #04150e 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2); }
.ac-orb { position: absolute; right: -60px; top: -80px; width: 260px; height: 260px; border-radius: 50%; background: #ccff00;
  filter: blur(70px); opacity: .16; animation: ac-drift 14s ease-in-out infinite alternate; pointer-events: none; }
@keyframes ac-drift { to { transform: translate(-40px, 30px) scale(1.2); } }
.ac-top h1 { font-size: 25px; font-weight: 900; letter-spacing: -.02em; margin: 6px 0 6px; }
.ac-top p { margin: 0; font-size: 13.5px; line-height: 1.6; color: #b9d6c6; max-width: 620px; }
.ac-guide { margin-top: 14px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,.18);
  background: rgba(255,255,255,.07); border-radius: 11px; padding: 9px 14px; font: inherit; font-size: 13px; font-weight: 800;
  color: #eaf5ee; cursor: pointer; transition: transform .2s ease, background .2s ease, border-color .2s ease; }
.ac-guide:hover { background: rgba(204,255,0,.14); border-color: rgba(204,255,0,.45); transform: translateY(-1px); }
.ac-prog { flex: none; display: grid; justify-items: center; gap: 7px; }
.ac-prog-n { font-size: 25px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; color: #fff; }
.ac-prog-n i { font-style: normal; font-size: 14px; color: #8fb3a0; }
.ac-prog-k { font-size: 10.5px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; color: #8fb3a0; }

/* the catalogue: one tile per connector, two across */
.ac-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; align-items: start; }
.ac-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 10px; background: #fff;
  border: 1px solid var(--line); border-radius: 20px; padding: 18px;
  transition: transform .25s cubic-bezier(.3,1,.35,1), box-shadow .25s ease, border-color .25s ease; }
.ac-card.wide { grid-column: 1 / -1; }
/* a thread of the brand's own colour down the left edge, lit when it is on */
.ac-card::before { content: ''; position: absolute; left: 0; top: 18px; bottom: 18px; width: 3px; border-radius: 0 3px 3px 0;
  background: var(--brand); opacity: .18; transition: opacity .3s ease, top .3s ease, bottom .3s ease; }
.ac-card.connected::before { opacity: 1; }
.ac-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
  box-shadow: 0 2px 4px rgba(16,40,28,.05), 0 22px 44px -22px color-mix(in srgb, var(--brand) 45%, transparent); }
.ac-card:hover::before { top: 8px; bottom: 8px; opacity: 1; }
.ac-card.error { border-color: #f3c6c6; }

.ac-card-top { display: flex; align-items: center; gap: 12px; }
.ac-logo { flex: none; width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; position: relative;
  background: color-mix(in srgb, var(--brand) 10%, #fff); color: var(--brand);
  transition: transform .3s cubic-bezier(.3,1.5,.5,1), background .25s ease; }
.ac-card:hover .ac-logo { transform: scale(1.06) rotate(-4deg); background: color-mix(in srgb, var(--brand) 18%, #fff); }
.ac-logo img { width: 26px; height: 26px; object-fit: contain; }
.ac-logos { display: grid; place-items: center; }
/* one sign-in, two networks: the logos overlap to say so */
.ac-logos.pair { display: flex; }
.ac-logos.pair img { width: 22px; height: 22px; }
.ac-logos.pair img:last-child { margin-left: -7px; }
.ac-glyph { font-size: 19px; font-weight: 900; line-height: 1; }
.ac-card-top strong { display: block; font-size: 15px; font-weight: 900; letter-spacing: -.01em; }
.ac-card-top em { display: block; font-style: normal; font-size: 12px; color: var(--muted); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-card.connected .ac-card-top em { color: #047857; font-weight: 700; }
.ac-card.error .ac-card-top em { color: #ba1a1a; font-weight: 700; }
/* the tick draws itself the first time the tile paints connected */
.ac-tick { flex: none; margin-left: auto; width: 22px; height: 22px; fill: none; stroke: #19c37d; stroke-width: 2.6;
  stroke-linecap: round; stroke-linejoin: round; }
.ac-tick path { stroke-dasharray: 24; animation: ac-tick .5s cubic-bezier(.3,1,.35,1) both .25s; }
@keyframes ac-tick { from { stroke-dashoffset: 24; } }

.ac-says { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
.ac-do { display: grid; gap: 10px; }
.ac-quiet { font-size: 12.5px; color: var(--muted); }
.ac-good { margin: 0; font-size: 13px; color: #047857; }
.ac-bad { margin: 0; font-size: 12.5px; color: #ba1a1a; }
/* the paste form, opening under the buttons */
.ac-card .sg-how { align-self: flex-start; margin-top: auto; }
/* Each connector draws its own name. Inside a tile the name is already on the
   tile, so the second one is hidden — here only, where the tile provides it. */
.ac-do h2 { display: none; }
.ac-form { display: grid; gap: 12px; padding-top: 14px; border-top: 1px solid var(--line);
  animation: ac-open .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ac-open { from { opacity: 0; transform: translateY(-8px); } }

@media (prefers-reduced-motion: reduce) { .ac-top *, .ac-card, .ac-card *, .ac-form { animation: none !important; transition: none !important; } }
`;
