'use client';

/**
 * Manage social → Research Assistant.
 *
 * The research plan's home, and the whole team's first desk. It reads the
 * market and the competitors (the launch's market box, shown here when this
 * is the plan's home), the owner's own page (Analytics), and runs campaigns as
 * dummies: planned like a real one, shown to a simulated audience and priced,
 * with nothing made at Meta and nothing spent (backend `dummyCampaign`).
 *
 * What it finds goes to the Social Media Manager: the manager reads the latest
 * dummies before planning any campaign, every real campaign is run as a dummy
 * first (those runs are listed here too), and "Hand to the Social Media
 * Manager" opens the Ad Expert with the tested campaign as its brief.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import { STUDIO_PLANS } from '@/lib/studio';
import { researchApi, type DummyCampaignDoc } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { FX_CSS } from '@/components/social/fx';
import { adMoney } from '@/components/social/ads';
import { AudienceTest, LAUNCH_CSS, LaunchSequence } from '@/components/social/launch';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/states';

const GOAL: Record<string, string> = {
  traffic: 'Visits to your link',
  awareness: 'Reach',
  engagement: 'Engagement',
};

export default function ResearchPage() {
  const { path, house, includes } = useWorkspace();
  const [tests, setTests] = useState<DummyCampaignDoc[] | null>(null);
  const [brief, setBrief] = useState('');
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('7');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('researchTests')), orderBy('atMs', 'desc'), limit(20)),
        (snap) => setTests(snap.docs.map((d) => ({ ...(d.data() as DummyCampaignDoc), id: d.id }))),
        (e) => setError(e.message),
      ),
    [path],
  );

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const daily = Number(budget);
      const n = Number(days);
      await researchApi.dummyCampaign({
        brief: brief.trim(),
        ...(budget.trim() && daily > 0 ? { dailyBudget: daily } : {}),
        ...(Number.isInteger(n) && n >= 1 && n <= 30 ? { days: n } : {}),
      });
      setBrief('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The dummy campaign did not run.');
    } finally {
      setRunning(false);
    }
  }

  const owner = tests?.filter((t) => t.by === 'owner').length ?? 0;
  const beforeLaunch = tests?.filter((t) => t.by === 'manager').length ?? 0;

  return (
    <div className="fx" style={{ display: 'grid', gap: 16 }}>
      <style>{FX_CSS}</style>
      <style>{LAUNCH_CSS}</style>
      <section className="fx-hero fx-rise" style={{ padding: '22px 26px', marginBottom: 0 }}>
        <span className="fx-orb a" />
        <span className="fx-orb b" />
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="fx-eyebrow">Analyse · test for free · hand over</div>
            <h1 style={{ fontSize: 26 }}>Research Assistant</h1>
            <p style={{ maxWidth: 680 }}>
              Reads your market, your competitors and your own page — and runs every campaign as a dummy first: a simulated
              audience reacts and nothing is spent. What it finds goes to your Social Media Manager.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="fx-hero-chip">🧪 {owner} dummy campaign{owner === 1 ? '' : 's'}</span>
            {beforeLaunch ? <span className="fx-hero-chip">🛡️ {beforeLaunch} tested before launch</span> : null}
            <Link href="/dashboard/social/performance" className="fx-hero-chip">
              📈 Your page, analysed →
            </Link>
          </div>
        </div>
      </section>

      {/* A research-only workspace lands here, so its market read lives here too. */}
      {!house && !includes('content') && !includes('ads') ? <LaunchSequence settings={null} /> : null}

      <Card>
        <h2 style={{ fontSize: 17, fontWeight: 900, margin: '0 0 4px' }}>Run a dummy campaign — free</h2>
        <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 12px', lineHeight: 1.55 }}>
          Say what you want to promote and to whom. The assistant plans the campaign the way the Ad Expert would, shows the ad
          to ten simulated people from that audience, rewrites it once if they are not convinced, and works out what the money
          would buy. Nothing goes to Meta and nothing is spent. It takes about a minute.
        </p>
        <label htmlFor="dummy-brief" style={label}>
          The campaign
        </label>
        <textarea
          id="dummy-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Eid sale on women’s lawn suits, 20% off, for women 22–40 in Lahore and Faisalabad"
          style={{ ...field, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div>
            <label htmlFor="dummy-budget" style={label}>
              A day (Rs, optional)
            </label>
            <input
              id="dummy-budget"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="the expert decides"
              style={{ ...field, width: 170 }}
            />
          </div>
          <div>
            <label htmlFor="dummy-days" style={label}>
              Days
            </label>
            <input
              id="dummy-days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))}
              style={{ ...field, width: 80 }}
            />
          </div>
          <Button onClick={run} disabled={running || brief.trim().length < 10}>
            {running ? 'Planning and testing…' : 'Run the dummy campaign'}
          </Button>
        </div>
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: '10px 0 0' }}>
            {error}
          </p>
        ) : null}
      </Card>

      {tests === null ? (
        error ? (
          <ErrorState error={error} onRetry={() => window.location.reload()} />
        ) : (
          <SkeletonRows rows={3} h={120} />
        )
      ) : tests.length === 0 ? (
        <EmptyState
          icon="🧪"
          title="No dummy campaigns yet"
          why="Run one above. Every campaign the Social Media Manager makes is also tested here before Meta sees it."
        />
      ) : (
        tests.map((t) => <DummyCard key={t.id} test={t} canHandOver={includes('ads')} />)
      )}
    </div>
  );
}

/** The tested campaign, as a brief the Ad Expert's designer starts from. */
function handOverBrief(t: DummyCampaignDoc): string {
  const p = t.plan;
  const who = [
    p.audience.cities.join(', ') || 'the whole market',
    `ages ${p.audience.ageMin}–${p.audience.ageMax}`,
    p.audience.genders === 'all' ? '' : p.audience.genders,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    `Run the campaign the Research Assistant tested as a dummy: "${p.name}" — ${GOAL[p.objective] ?? p.objective} for ${who}, about ${adMoney(p.dailyBudget, t.currency)} a day for ${p.days} days.`,
    `The ad that tested best: "${p.lines.join(' / ')}" — ${p.primaryText} Headline: ${p.headline}.`,
    t.pretest
      ? `The simulated panel: ${Math.round(t.pretest.score * 100)}% (${t.pretest.verdict.replace('_', ' ')}).${
          t.pretest.objections.length ? ` Answer these doubts: ${t.pretest.objections.join('; ')}.` : ''
        }`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1900);
}

function DummyCard({ test: t, canHandOver }: { test: DummyCampaignDoc; canHandOver: boolean }) {
  const p = t.plan;
  const f = t.forecast;
  // A yardstick with a zero in it prices a result at nothing, and the range comes out infinite: say nothing then.
  const finite = f !== null && f.results.every(Number.isFinite);
  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: colors.muted }}>
          {t.by === 'manager' ? 'Tested before launch · for the Social Media Manager' : 'Your dummy campaign'}
        </span>
        <span style={{ fontSize: 12, color: colors.muted }}>{new Date(t.atMs).toLocaleString()}</span>
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 900, margin: '0 0 10px' }}>{p.name}</h3>

      {t.pretest ? (
        <AudienceTest
          label="Dummy campaign"
          test={{
            verdict: t.pretest.verdict,
            score: t.pretest.score,
            offer: p.headline,
            panel: t.pretest.panel ?? [],
            objections: t.pretest.objections,
            bestHook: p.lines[0] ?? '',
            changes: t.pretest.rewritten && t.pretest.firstScore !== null
              ? [
                  `Rewrote the ad against the biggest doubt: ${Math.round(t.pretest.firstScore * 100)}% → ${Math.round(t.pretest.score * 100)}%. The rewrite is the version below.`,
                ]
              : [],
          }}
        />
      ) : (
        <p style={{ fontSize: 13, color: colors.muted }}>The simulated audience could not run this time — the plan below is untested.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 14 }}>
        <div>
          <div style={label}>The ad</div>
          <div style={{ fontWeight: 900, fontSize: 14 }}>{p.lines.join(' / ')}</div>
          <p style={{ fontSize: 13, margin: '4px 0', lineHeight: 1.5 }}>{p.primaryText}</p>
          <div style={{ fontSize: 12.5, color: colors.muted }}>
            Headline: {p.headline} · Button: {p.cta.replace(/_/g, ' ').toLowerCase()}
          </div>
        </div>
        <div>
          <div style={label}>Who and how much</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {GOAL[p.objective] ?? p.objective} · {p.audience.cities.join(', ') || 'the whole market'} · ages {p.audience.ageMin}–
            {p.audience.ageMax}
            {p.audience.genders === 'all' ? '' : ` · ${p.audience.genders}`}
            <br />
            {adMoney(p.dailyBudget, t.currency)} a day × {p.days} days
            {f && finite ? (
              <>
                {' '}
                → about {f.results[0].toLocaleString('en-PK')}–{f.results[1].toLocaleString('en-PK')} {f.label}, at{' '}
                {adMoney(f.costPerResult.low, t.currency)}–{adMoney(f.costPerResult.high, t.currency)} each
                <span style={{ color: colors.muted }}> (an estimate from what ads cost here)</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {p.why ? <p style={{ fontSize: 12.5, color: colors.muted, margin: '12px 0 0', lineHeight: 1.55 }}>{p.why}</p> : null}

      <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {t.campaignId ? (
          <Link href="/dashboard/social/ads" style={{ color: colors.secondary, fontWeight: 800, fontSize: 13.5 }}>
            The Social Media Manager ran it — see it on the Ads page →
          </Link>
        ) : canHandOver ? (
          <Link
            href={`/dashboard/social/ads?brief=${encodeURIComponent(handOverBrief(t))}`}
            style={{ color: colors.secondary, fontWeight: 800, fontSize: 13.5 }}
          >
            Hand to the Social Media Manager →
          </Link>
        ) : (
          <span style={{ fontSize: 13, color: colors.muted }}>
            The Social Media Manager runs it for real on the {STUDIO_PLANS.all.name} plan.{' '}
            <Link href="/dashboard/social/upgrade" style={{ color: colors.secondary, fontWeight: 800 }}>
              See the plans →
            </Link>
          </span>
        )}
      </div>
    </Card>
  );
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 800,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  marginBottom: 4,
};

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  background: colors.surface,
  color: colors.text,
};
