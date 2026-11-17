'use client';

/**
 * Vexa → SEO.
 *
 * The owner's brief (2026-11-17): this agent does the website's SEO and tells
 * the web developer where to add what, so the site ranks.
 *
 * So the page is a work order, not a report card. There is no score, because a
 * score is something you read and then do nothing about. There is a list, in
 * the order it should be done, and each item carries the exact lines to paste
 * and a Copy button — so the customer forwards this to whoever built their site
 * and that person can work straight down it.
 *
 * Critical first, and critical means "nothing on this site can rank while this
 * is true" — a noindex tag, a robots.txt that blocks everything, no mobile
 * viewport, plain http. Those are the four that make everything else pointless.
 */

import { useCallback, useEffect, useState } from 'react';

import { socialApi, type SeoFinding, type SeoReport } from '@/lib/api';
import { Button, Card, StatCard } from '@/components/ui';
import { colors } from '@/lib/config';

const TONE: Record<SeoFinding['severity'], { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#ff5c5c' },
  important: { label: 'Important', color: '#ffb020' },
  polish: { label: 'Polish', color: colors.primary },
};

export default function SeoPage() {
  const [report, setReport] = useState<SeoReport | null>(null);
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await socialApi.getSeoReport({});
      setReport(r);
      setSite((s) => s || r.url || '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the SEO report.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    const url = site.trim();
    if (!url) {
      setError('Add your website address first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Stored before the run, so the address survives a site that is down.
      await socialApi.setSeoSite({ url });
      const r = await socialApi.runSeoAudit({ url });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that website.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(f: SeoFinding) {
    try {
      await navigator.clipboard.writeText(f.fix);
      setCopied(f.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // A browser that refuses the clipboard is not worth an error dialog —
      // the snippet is on screen and can be selected by hand.
    }
  }

  const findings = report?.findings ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SEO</h1>
        <p className="text-sm text-muted">
          Vexa reads your website and tells your developer exactly what to add, and where.
        </p>
      </div>

      <Card>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Your website</span>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              placeholder="https://yourbusiness.com"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
              }}
            />
            <Button disabled={busy} onClick={run}>
              {busy ? 'Reading your site…' : report?.ranAtMs ? 'Check again' : 'Check my site'}
            </Button>
          </div>
        </label>
        {report?.ranAtMs ? (
          <p className="mt-2 text-xs text-muted">
            Last checked {new Date(report.ranAtMs).toLocaleString()}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </Card>

      {report?.ranAtMs ? (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Critical" value={String(report.counts.critical)} />
          <StatCard label="Important" value={String(report.counts.important)} />
          <StatCard label="Polish" value={String(report.counts.polish)} />
        </div>
      ) : null}

      {report?.ranAtMs && findings.length === 0 ? (
        <Card>
          <p className="font-semibold">Nothing to fix.</p>
          <p className="mt-1 text-sm text-muted">
            Every technical signal we check is already in place on {report.url}. Rankings now come
            from content and links rather than from markup — which is what the rest of Vexa is for.
          </p>
        </Card>
      ) : null}

      {findings.length > 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Work down this list in order. Send it to whoever built your site — every item says
            where it goes.
          </p>
          {findings.map((f, i) => {
            const tone = TONE[f.severity];
            return (
              <Card key={f.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 text-sm text-muted">{i + 1}.</span>
                    <div>
                      <p className="font-semibold">{f.title}</p>
                      <p className="mt-1 max-w-2xl text-sm text-muted">{f.why}</p>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-extrabold uppercase"
                    style={{ background: `${tone.color}1A`, color: tone.color }}
                  >
                    {tone.label}
                  </span>
                </div>

                <p className="mt-3 text-xs uppercase tracking-wide text-muted">Where</p>
                <p className="text-sm">{f.where}</p>

                {f.fix ? (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wide text-muted">Add this</p>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => copy(f)}
                      >
                        {copied === f.id ? 'Copied ✓' : 'Copy'}
                      </button>
                    </div>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
                      <code>{f.fix}</code>
                    </pre>
                  </>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
