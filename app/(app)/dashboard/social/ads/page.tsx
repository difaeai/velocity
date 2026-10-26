'use client';

/**
 * Manage social → Ads.
 *
 * Meta ads, run by the social media manager. You say what an ad should do; the
 * desk decides the objective, the audience and the budget, makes the picture or
 * the reel, creates the campaign at Meta, and every three hours reads how it is
 * doing against what a click should cost in Pakistan — pausing what wastes
 * money and putting more behind what works, if you let it.
 *
 * The ad account is connected on Connected accounts, and this page sends you
 * there until it is. Then it walks the rest in order: set the daily limit and
 * whether it may spend without asking, then ask for an ad. After that the page
 * is the account: this week's numbers, the expert's note, and every campaign
 * with the buttons that steer it.
 *
 * Every number on this page comes from Meta through the backend
 * (backend/functions/src/social/ads.ts); every judgement comes from
 * adsExpert.ts, which is pure arithmetic. Nothing here writes Firestore.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  adsApi,
  type AdCampaignDoc,
  type AdPlan,
  type AdForecast,
  type AdsConfigDoc,
  type SocialEmployee,
  type SocialPostDoc,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { ChartCard, Stat, TimeSeries, SERIES } from '@/components/charts';
import { GRADE_META, adMoney, campaignState, tone } from '@/components/social/ads';
import { LaunchSequence } from '@/components/social/launch';
import { CampaignDesigner, DESIGNER_CSS } from '@/components/social/designer';
import { FX_CSS } from '@/components/social/fx';

const DAY_MS = 86_400_000;

export default function AdsPage() {
  const { path, house, ws, includes } = useWorkspace();
  const [cfg, setCfg] = useState<AdsConfigDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [campaigns, setCampaigns] = useState<AdCampaignDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, path('system/socialAds')),
        (snap) => {
          setCfg(snap.exists() ? (snap.data() as AdsConfigDoc) : null);
          setLoaded(true);
        },
        (e) => setError(e.message),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, path('socialAds')),
        (snap) => setCampaigns(snap.docs.map((d) => ({ ...(d.data() as AdCampaignDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('socialPosts')), orderBy('date', 'desc'), limit(30)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        () => undefined,
      ),
    [path],
  );

  // The ad account is connected on Connected accounts; with none, that is where this page sends you.
  const router = useRouter();
  useEffect(() => {
    if (loaded && !cfg?.adAccountId) router.replace('/dashboard/social/accounts#meta-ads');
  }, [loaded, cfg, router]);

  useEffect(
    () =>
      onSnapshot(collection(db, path('socialEmployees')), (snap) => {
        const people = snap.docs.map((d) => d.data() as SocialEmployee).filter((e) => e.status === 'active');
        setManager(
          (people.find((e) => e.role === 'social-manager') ?? people.find((e) => e.role === 'youtube-ads-expert'))
            ?.name ?? null,
        );
      }),
    [path],
  );

  // The clock, subscribed to rather than read in render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const read = () => setNowMs(Date.now());
    const first = setTimeout(read, 0);
    const every = setInterval(read, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const connected = Boolean(cfg?.adAccountId);
  const setUp = connected && cfg!.mode != null && cfg!.dailyCap > 0;
  const daysLeft =
    cfg?.tokenExpiresAtMs && nowMs ? Math.floor((cfg.tokenExpiresAtMs - nowMs) / DAY_MS) : null;
  const expired = Boolean(cfg?.lastSyncStatus?.includes('expired')) || (daysLeft !== null && daysLeft < 0);

  /** Pending first, then running, then the rest — newest first within each. */
  const ordered = useMemo(() => {
    const rank = (c: AdCampaignDoc) =>
      c.approval === 'pending' && c.status !== 'ACTIVE' ? 0 : c.status === 'ACTIVE' ? 1 : c.status === 'PAUSED' ? 2 : 3;
    return [...campaigns].sort(
      (a, b) => rank(a) - rank(b) || (b.createdAtMs ?? b.syncedAtMs ?? 0) - (a.createdAtMs ?? a.syncedAtMs ?? 0),
    );
  }, [campaigns]);

  async function refresh() {
    setSyncing(true);
    setError(null);
    try {
      const res = await adsApi.sync({});
      setNotice(`Read from Meta: ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the account.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="fx">
      <style>{FX_CSS + DESIGNER_CSS}</style>
      <header className="fx-hero fx-rise" style={{ padding: '22px 26px' }}>
        <span className="fx-orb a" />
        <span className="fx-orb b" />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="fx-eyebrow">Facebook + Instagram ads</div>
            <h1 style={{ fontSize: 26 }}>Meta Ad Expert</h1>
            <p style={{ maxWidth: 680 }}>
              {manager ? `${manager} plans` : 'Your expert plans'} {house ? 'Velocity Rides’' : `${ws?.name ?? 'your'}’s`} ads,
              launches them and watches every rupee: winners keep running, losers are paused.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="fx-hero-chip">
              <span className={connected && !expired ? 'fx-live lime' : 'fx-live off'} />
              {connected ? (expired ? 'Sign-in expired' : `Connected · ${cfg?.accountName ?? ''}`) : 'Not connected'}
            </span>
            {setUp ? (
              <span className="fx-hero-chip">
                {adMoney(cfg!.dailyCap, cfg!.currency)}/day · {cfg!.mode === 'direct' ? 'launches itself' : 'asks first'}
              </span>
            ) : null}
            {connected ? (
              <button type="button" className="fx-btn lime small" onClick={refresh} disabled={syncing}>
                {syncing ? 'Reading Meta…' : '↻ Refresh numbers'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <p style={{ color: colors.danger, marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>{notice}</p> : null}

      {/* An ads-only workspace lands here, so its launch sequence lives here too. */}
      {!house && !includes('content') ? <LaunchSequence settings={null} /> : null}

      {/* 1 — the ad account lives on Connected accounts; only a sign-in running out is said here */}
      {connected && !cfg?.permanent && (expired || (daysLeft !== null && daysLeft <= 7)) ? (
        <p style={{ color: colors.warn, fontSize: 13.5, margin: '0 0 14px', fontWeight: 700 }}>
          {expired
            ? 'The Facebook sign-in for ads has expired.'
            : `The Facebook sign-in for ads runs out in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`}{' '}
          <Link href="/dashboard/social/accounts#meta-ads" style={{ color: colors.secondary }}>
            Renew it, or paste a token that never expires, on Connected accounts →
          </Link>
        </p>
      ) : null}

      {/* 2 — the two answers before it spends anything */}
      {connected && !setUp ? <Limits cfg={cfg!} first onSaved={setNotice} onError={setError} /> : null}

      {/* 3 — the campaign, designed in conversation; works before connecting, creates only once set up */}
      <CampaignDesigner
        cfg={cfg}
        ready={setUp}
        blocked={
          !connected
            ? 'Connect the ad account on Connected accounts to create it.'
            : !setUp
              ? 'Answer the two questions above — the daily limit and ask-or-launch — to create it.'
              : null
        }
        posts={posts}
        manager={manager}
        house={house}
        onDone={setNotice}
        onError={setError}
      />

      {/* 4 — the account at a glance, and what each of its numbers means */}
      {connected && cfg?.account ? <Account cfg={cfg} /> : null}
      <NumbersGuide />

      {/* 5 — campaigns */}
      {connected ? (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <h2 style={{ ...h2, marginBottom: 0, flex: 1 }}>Campaigns</h2>
            <span style={{ fontSize: 12, color: colors.muted }}>
              {cfg?.lastSyncAtMs
                ? `Read ${new Date(cfg.lastSyncAtMs).toLocaleString('en-PK')} — ${cfg.lastSyncStatus ?? ''}`
                : 'Not read yet — press Refresh numbers.'}
            </span>
          </div>
          {ordered.length === 0 ? (
            <p style={{ margin: 0, color: colors.muted, fontSize: 13.5 }}>
              No campaigns yet. Describe the first one above.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {ordered.map((c) => (
                <CampaignRow key={c.id} c={c} cfg={cfg!} nowMs={nowMs} onDone={setNotice} onError={setError} />
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* 6 — the limits, editable any time */}
      {setUp ? <Limits cfg={cfg!} onSaved={setNotice} onError={setError} /> : null}
    </div>
  );
}

/**
 * The owner's two answers: how much may it spend a day, and may it spend
 * without asking. Shown as the setup step until answered, then as the small
 * card at the bottom of the page.
 */
function Limits({
  cfg,
  first = false,
  onSaved,
  onError,
}: {
  cfg: AdsConfigDoc;
  first?: boolean;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const suggested = cfg.currency === 'USD' ? 10 : 3000;
  const [cap, setCap] = useState(String(cfg.dailyCap || suggested));
  const [days, setDays] = useState(String(cfg.maxDays || 14));
  const [link, setLink] = useState(cfg.link);
  const [worth, setWorth] = useState(cfg.valuePerConversion ? String(cfg.valuePerConversion) : '');
  const [busy, setBusy] = useState(false);

  async function save(mode: 'ask' | 'direct' | undefined) {
    setBusy(true);
    try {
      const capN = Number(cap);
      if (!(capN > 0)) throw new Error('Set a daily limit above zero.');
      await adsApi.settings({
        dailyCap: capN,
        maxDays: Math.min(30, Math.max(1, Math.round(Number(days) || 14))),
        valuePerConversion: Math.max(0, Number(worth) || 0),
        ...(link.trim() && link.trim() !== cfg.link ? { link: link.trim() } : {}),
        ...(mode ? { mode } : {}),
      });
      onSaved(
        mode === 'direct'
          ? `Saved. The desk launches ads and steers them on its own, never past ${adMoney(capN, cfg.currency)} a day.`
          : mode === 'ask'
            ? `Saved. Every new ad and every change waits for your Approve, and nothing passes ${adMoney(capN, cfg.currency)} a day.`
            : 'Saved.',
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save the limits.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16, ...(first ? { borderColor: `${colors.primary}66` } : {}) }}>
      <h2 style={h2}>{first ? 'Two answers before the desk spends anything' : 'Limits'}</h2>
      {first ? (
        <p style={{ fontSize: 13.5, color: colors.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
          The limit is for all the desk&apos;s campaigns together, every day. Each campaign also ends on its own after
          at most the number of days below, so the most it can ever spend is the limit times the days.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={label}>
          Daily limit ({cfg.currency})
          <input
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))}
            style={input}
          />
        </label>
        <label style={label}>
          Longest campaign (days)
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} style={input} />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 240 }}>
          Ads send people to
          <input value={link} onChange={(e) => setLink(e.target.value)} style={{ ...input, width: '100%' }} />
        </label>
        <label style={label} title="Lets the expert work out ROAS for leads and chats, which Meta counts but cannot price.">
          One sale or lead is worth ({cfg.currency})
          <input
            inputMode="numeric"
            value={worth}
            onChange={(e) => setWorth(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="e.g. 1200"
            style={input}
          />
        </label>
      </div>

      {first || cfg.mode == null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <Choice
            title="Ask me before spending"
            detail="New ads are made and wait, paused, for your Approve. Pauses and budget changes the expert recommends wait for Apply."
            onClick={() => save('ask')}
            disabled={busy}
          />
          <Choice
            title="Launch directly within my limit"
            detail="New ads go live at once. The expert pauses what wastes money and adds 20% to winners on its own — never past the limit."
            onClick={() => save('direct')}
            disabled={busy}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => save(undefined)} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => save(cfg.mode === 'direct' ? 'ask' : 'direct')} disabled={busy}>
            {cfg.mode === 'direct' ? 'Ask me before spending instead' : 'Launch directly instead'}
          </Button>
          <span style={{ fontSize: 12.5, color: colors.muted }}>
            Now: {cfg.mode === 'direct' ? 'launches and steers on its own' : 'asks before spending'}
          </span>
        </div>
      )}
    </Card>
  );
}

/** The expert's plan, said back in full: what, who, how much, and what it should buy. */
function PlanCard({
  plan,
  forecast,
  currency,
  note,
}: {
  plan: AdPlan;
  forecast: AdForecast | null | undefined;
  currency: string;
  note?: string | null;
}) {
  const who = [
    plan.audience.cities.length ? plan.audience.cities.join(', ') : 'all of Pakistan',
    `${plan.audience.ageMin}–${plan.audience.ageMax}`,
    plan.audience.genders === 'all' ? 'everyone' : plan.audience.genders,
    plan.audience.interests.length ? `interested in ${plan.audience.interests.join(', ')}` : 'broad',
  ].join(' · ');
  return (
    <div style={{ marginTop: 14, background: colors.bg, borderRadius: 12, padding: 14, display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ fontWeight: 900, fontSize: 14.5 }}>{plan.name}</div>
      <div>
        <span style={{ color: colors.muted }}>Goal:</span> {plan.objective} ·{' '}
        <span style={{ color: colors.muted }}>Budget:</span> {adMoney(plan.dailyBudget, currency)} a day for {plan.days} days
        {note ? <span style={{ color: colors.warn }}> — {note}</span> : null}
      </div>
      <div>
        <span style={{ color: colors.muted }}>Who:</span> {who}
      </div>
      {forecast ? (
        <div>
          <span style={{ color: colors.muted }}>Should buy:</span> {forecast.results[0].toLocaleString('en-PK')}–
          {forecast.results[1].toLocaleString('en-PK')} {forecast.label} for {adMoney(forecast.spend, currency)} — normal is{' '}
          {adMoney(forecast.costPerResult.low, currency)}–{adMoney(forecast.costPerResult.high, currency)}
          {plan.objective === 'awareness' ? ' per thousand people' : ' each'}.
        </div>
      ) : null}
      <div>
        <span style={{ color: colors.muted }}>The ad:</span> <strong>{plan.headline}</strong> — {plan.primaryText}
      </div>
      {plan.why ? <div style={{ color: colors.muted, lineHeight: 1.55 }}>{plan.why}</div> : null}
    </div>
  );
}

/** This week across the account, against what things cost here. */
function Account({ cfg }: { cfg: AdsConfigDoc }) {
  const { house } = useWorkspace();
  const a = cfg.account!;
  const w = a.week;
  const b = a.bench ?? undefined;
  const bl = a.blended;
  const cur = cfg.currency;
  const normal = (band?: { low: number; high: number }, pct = false) =>
    band ? `normal ${pct ? `${band.low}–${band.high}%` : `${adMoney(band.low, cur)}–${adMoney(band.high, cur)}`}` : undefined;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat
          label="Spent, last 7 days"
          value={adMoney(w.spend, cur)}
          hint={`${adMoney(a.committed, cur)} a day running of ${adMoney(cfg.dailyCap, cur)}`}
          trend={a.daily.map((d) => d.spend)}
        />
        <Stat label="Link clicks" value={w.linkClicks.toLocaleString('en-PK')} trend={a.daily.map((d) => d.linkClicks)} />
        <Tile label="CPM · per 1,000 views" value={w.cpm ? adMoney(w.cpm, cur) : '—'} hint={normal(b?.cpm)} colour={tone(w.cpm, b?.cpm)} />
        <Tile
          label="CTR · click-through rate"
          value={w.impressions ? `${w.ctr.toFixed(2)}%` : '—'}
          hint={normal(b?.ctr, true)}
          colour={tone(w.ctr, b?.ctr, true)}
        />
        <Tile label="CPC · cost per click" value={w.cpc ? adMoney(w.cpc, cur) : '—'} hint={normal(b?.cpc)} colour={tone(w.cpc, b?.cpc)} />
        <Tile
          label="Frequency · seen per person"
          value={w.reach ? w.frequency.toFixed(1) : '—'}
          hint="above 3.5 they stop noticing"
          colour={w.frequency > 3.5 ? colors.danger : colors.text}
        />
        {/* A customer's own sales, leads and chats, as Meta saw them. */}
        {!house ? (
          <>
            <Tile
              label="Conversions · sales, leads, chats"
              value={w.conversions ? w.conversions.toLocaleString('en-PK') : '—'}
              hint={w.conversions ? `${adMoney(w.costPerConversion ?? 0, cur)} each` : 'needs a pixel, a lead form or click-to-chat ads'}
              colour={colors.text}
            />
            <Tile
              label="ROAS · return on ad spend"
              value={w.roas != null ? `${w.roas.toFixed(2)}×` : '—'}
              hint={w.roas != null ? 'worth ÷ spend · 1.0 = break-even' : 'set what one sale is worth under Limits'}
              colour={w.roas == null ? colors.text : w.roas >= 1 ? colors.success : colors.danger}
            />
          </>
        ) : null}
        {/* Velocity's rides only: a Studio customer's orders happen where we cannot see them. */}
        {house ? (
          <>
            <Tile
              label="Cost per order"
              value={bl?.orders && w.spend ? adMoney(bl.costPerOrder, cur) : '—'}
              hint={bl ? `${bl.orders.toLocaleString('en-PK')} completed rides, all riders` : 'rides not read yet'}
              colour={colors.text}
            />
            <Tile
              label="ROAS · return on ad spend"
              value={bl?.roas != null ? `${bl.roas.toFixed(2)}×` : '—'}
              hint={bl ? `${adMoney(bl.commission, 'PKR')} commission ÷ spend · 1.0 = break-even` : 'rides not read yet'}
              colour={bl?.roas == null ? colors.text : bl.roas >= 1 ? colors.success : colors.danger}
            />
          </>
        ) : null}
      </div>

      {cfg.review ? (
        <Card style={{ marginBottom: 16 }}>
          <h2 style={h2}>The expert&apos;s note</h2>
          <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6 }}>{cfg.review.summary}</p>
          {cfg.review.moves.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {cfg.review.moves.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: colors.muted }}>
            {new Date(cfg.review.atMs).toLocaleString('en-PK')} ·{' '}
            {b?.source === 'own' ? 'judged against this account’s own normal' : 'judged against typical Pakistan costs until this account has its own'}
          </p>
        </Card>
      ) : null}

      {a.daily.length >= 2 ? (
        <div style={{ marginBottom: 16 }}>
          <ChartCard
            title="Spend per day"
            subtitle="Last 14 days, the whole ad account"
            rows={a.daily.map((d) => ({ label: d.date, values: [adMoney(d.spend, cur), d.linkClicks] }))}
          >
            <TimeSeries
              points={a.daily.map((d) => ({ label: d.date.slice(5), values: [d.spend] }))}
              series={[{ key: 'spend', label: 'Spend', color: SERIES[0] }]}
              valueFormat={(n) => adMoney(n, cur)}
            />
          </ChartCard>
        </div>
      ) : null}
    </>
  );
}

/** One campaign: where it stands, how it is doing, what the expert would do, and the buttons. */
function CampaignRow({
  c,
  cfg,
  nowMs,
  onDone,
  onError,
}: {
  c: AdCampaignDoc;
  cfg: AdsConfigDoc;
  nowMs: number;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [open, setOpen] = useState(false);
  const state = campaignState(c, nowMs);
  const grade = c.verdict ? GRADE_META[c.verdict.grade] : null;
  const m = c.week && c.week.impressions ? c.week : c.lifetime;
  const cur = cfg.currency;
  const pending = c.approval === 'pending' && c.status !== 'ACTIVE';
  const next = c.verdict?.action;

  async function act(action: 'launch' | 'pause' | 'resume' | 'budget' | 'apply' | 'end', dailyBudget?: number) {
    if (action === 'end' && !confirm(`End "${c.name}"? It stops for good; its numbers stay here.`)) return;
    setBusy(action);
    try {
      const res = await adsApi.action({ campaignId: c.id, action, dailyBudget });
      onDone(`${c.name}: ${res.message}`);
      setBudget('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Meta refused that.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {c.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.previewUrl} alt="" width={64} height={80} style={{ borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 14.5 }}>{c.name}</strong>
            <Pill text={state.label} colour={state.colour} />
            {grade && c.verdict?.grade !== 'idle' ? <Pill text={grade.label} colour={grade.colour} /> : null}
            {c.managed ? <Pill text={`by ${c.plannedBy ?? 'the desk'}`} colour={colors.secondary} /> : null}
          </div>
          <div style={{ fontSize: 12.5, color: colors.muted }}>
            {c.objectiveKind} ·{' '}
            {c.dailyBudget ? `${adMoney(c.dailyBudget, cur)} a day` : 'budget set in the ad set'}
            {c.endMs ? ` · ends ${new Date(c.endMs).toLocaleDateString('en-PK')}` : ''}
          </div>
          {c.verdict ? (
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {c.verdict.headline}
              {c.verdict.reasons.length ? (
                <span style={{ color: colors.muted }}> {c.verdict.reasons.join(' ')}</span>
              ) : null}
            </div>
          ) : null}
          {c.review?.startsWith('Rejected') ? (
            <div style={{ fontSize: 12.5, color: colors.danger, marginTop: 4 }}>{c.review}</div>
          ) : null}
        </div>

        {m && m.impressions ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '2px 14px', fontSize: 12 }}>
            <Num label="Spent" value={adMoney(m.spend, cur)} />
            <Num label="Results" value={m.results.toLocaleString('en-PK')} />
            <Num
              label={c.objectiveKind === 'awareness' ? 'Per 1,000 reached' : 'Per result'}
              value={m.costPerResult ? adMoney(m.costPerResult, cur) : '—'}
            />
            <Num label="CPM" value={m.cpm ? adMoney(m.cpm, cur) : '—'} />
            <Num label="CTR" value={`${m.ctr.toFixed(2)}%`} />
            <Num label="CPC" value={m.cpc ? adMoney(m.cpc, cur) : '—'} />
            {m.conversions ? (
              <>
                <Num label="Conversions" value={m.conversions.toLocaleString('en-PK')} />
                <Num label="Per conversion" value={adMoney(m.costPerConversion ?? 0, cur)} />
                <Num label="ROAS" value={m.roas != null ? `${m.roas.toFixed(2)}×` : '—'} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        {pending ? (
          <Button onClick={() => act('launch')} disabled={!!busy}>
            {busy === 'launch' ? 'Launching…' : 'Approve & launch'}
          </Button>
        ) : c.status === 'ACTIVE' ? (
          <Button variant="ghost" onClick={() => act('pause')} disabled={!!busy}>
            {busy === 'pause' ? 'Pausing…' : 'Pause'}
          </Button>
        ) : c.status === 'PAUSED' ? (
          <Button variant="secondary" onClick={() => act('resume')} disabled={!!busy}>
            {busy === 'resume' ? 'Starting…' : 'Resume'}
          </Button>
        ) : null}

        {next && (next.kind === 'pause' || next.kind === 'scale' || (next.kind === 'refresh' && c.managed)) && c.status === 'ACTIVE' ? (
          <Button onClick={() => act('apply')} disabled={!!busy}>
            {busy === 'apply'
              ? next.kind === 'refresh'
                ? 'Making the new creative…'
                : 'Applying…'
              : next.kind === 'pause'
                ? 'Apply: pause it'
                : next.kind === 'refresh'
                  ? 'Apply: make a fresh creative'
                  : `Apply: raise to ${adMoney(next.to, cur)}/day`}
          </Button>
        ) : null}

        {c.dailyBudget && c.status !== 'ARCHIVED' ? (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={`${c.dailyBudget}/day`}
              aria-label="New daily budget"
              style={{ ...input, width: 110 }}
            />
            <Button variant="ghost" onClick={() => act('budget', Number(budget))} disabled={!!busy || !(Number(budget) > 0)}>
              Set budget
            </Button>
          </span>
        ) : null}

        <span style={{ flex: 1 }} />
        {c.plan ? (
          <button type="button" onClick={() => setOpen(!open)} style={linkButton}>
            {open ? 'Hide the plan' : 'The plan'}
          </button>
        ) : null}
        {c.status !== 'ARCHIVED' ? (
          <Button variant="ghost" onClick={() => act('end')} disabled={!!busy}>
            End
          </Button>
        ) : null}
      </div>

      {next?.kind === 'refresh' ? (
        <p style={{ fontSize: 12.5, color: colors.warn, margin: '8px 0 0' }}>
          {next.why}
          {c.managed && cfg.mode === 'direct' ? ' The expert does this on its own at the next reading.' : ''}
        </p>
      ) : null}
      {c.retireAdId ? (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '6px 0 0' }}>
          A fresh creative is in Meta review; the old one steps aside once it is approved.
        </p>
      ) : null}
      {open && c.plan ? <PlanCard plan={c.plan} forecast={c.forecast} currency={cur} note={c.budgetNote} /> : null}
      {(c.autoActions ?? []).length ? (
        <p style={{ fontSize: 11.5, color: colors.muted, margin: '8px 0 0' }}>
          The desk on its own:{' '}
          {(c.autoActions ?? [])
            .slice(-3)
            .map((x) => `${new Date(x.atMs).toLocaleDateString('en-PK')} ${x.kind} (${x.detail})`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

/** Each number, how it is worked out, and what it says — the same definitions the expert gets (playbook.ts AD_NUMBERS). */
const NUMBERS: [name: string, formula: string, meaning: string][] = [
  ['CPM — cost per 1,000 views', 'spend ÷ impressions × 1,000', 'The price of attention. The audience, the city and the season set it more than the ad does.'],
  ['CTR — click-through rate', 'link clicks ÷ impressions × 100', 'The ad’s own score: how many who saw it tapped. Low means change the picture or the first line.'],
  ['CPC — cost per click', 'spend ÷ link clicks = CPM ÷ (CTR × 10)', 'What one visitor costs. It falls when the auction gets cheaper or the ad gets better.'],
  ['Frequency — seen per person', 'impressions ÷ reach', 'Above about 3.5 the same people stop noticing — change the picture before adding money.'],
  ['Cost per result', 'spend ÷ the campaign’s own result', 'Per click for traffic, per engagement for engagement, per 1,000 people reached for awareness.'],
  ['Cost per order', 'spend ÷ orders', 'What the ads cost for each order (for Velocity, each completed ride).'],
  [
    'Conversions',
    'sales, leads or chats Meta saw',
    'What the money was for. Meta sees them through a pixel on your site, a lead form, or a click-to-WhatsApp ad; the expert judges on these first.',
  ],
  [
    'ROAS — return on ad spend',
    'revenue kept ÷ spend',
    'What the business keeps, not the price paid — for Velocity, its commission, not the fare. 1.0 means the ads paid for themselves; under 1 they cost more than the orders earned.',
  ],
];

function NumbersGuide() {
  return (
    <Card style={{ marginBottom: 16 }}>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 15 }}>
          What CPM, CTR, CPC, cost per order and ROAS mean — and how each is worked out
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 14 }}>
          {NUMBERS.map(([name, formula, meaning]) => (
            <div key={name} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 800 }}>{name}</div>
              <code style={{ fontSize: 12.5 }}>{formula}</code>
              <div style={{ color: colors.muted }}>{meaning}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: colors.muted, lineHeight: 1.55 }}>
          Cost per order and ROAS are <strong>blended</strong>: Meta can&apos;t see an order made outside it (for Velocity, a
          ride booked in the app), so they set every order in the last 7 days, customers who came on their own included,
          against the same 7 days of ad spend. Watch them for the trend over weeks. They can&apos;t tell you which campaign
          brought an order.
        </p>
      </details>
    </Card>
  );
}

function Tile({ label, value, hint, colour }: { label: string; value: string; hint?: string; colour: string }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 18,
        flex: '1 1 160px',
        minWidth: 150,
      }}
    >
      <div style={{ color: colors.muted, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15, marginTop: 6, color: colour }}>{value}</div>
      {hint ? <div style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>{hint}</div> : null}
    </div>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: colors.muted, fontSize: 10.5, fontWeight: 800 }}>{label.toUpperCase()}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Pill({ text, colour }: { text: string; colour: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 800,
        padding: '2px 8px',
        borderRadius: 999,
        color: colour,
        background: `${colour}14`,
        textTransform: 'capitalize',
      }}
    >
      {text}
    </span>
  );
}

function Choice({
  title,
  detail,
  onClick,
  disabled,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        cursor: disabled ? 'wait' : 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>{title}</span>
      <span style={{ display: 'block', fontSize: 12.5, color: colors.muted, lineHeight: 1.5 }}>{detail}</span>
    </button>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };
const label: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 11.5, fontWeight: 800, color: colors.muted };
const input: React.CSSProperties = {
  width: 160,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
  background: colors.surface,
  color: colors.text,
};
const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: colors.secondary,
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
};
