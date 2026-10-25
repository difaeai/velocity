'use client';

/**
 * The brain: one box you talk to, and it sends the work to whoever does it.
 *
 * Say what you want in your own words. The brain reads it (`readIntent`, plain
 * word rules, shown before anything runs) and lights the agent it will send it
 * to — the AI team for posts and reels, the Meta Ad Expert to plan a campaign
 * with you, or a new campaign made at once. Tap another agent to overrule it.
 * Its wires run on into the Approval box, which decides how the work goes out.
 *
 * The drawing is inline SVG built once from fixed numbers (the same on the
 * server and in the browser), animated with CSS only; it stops under
 * `prefers-reduced-motion` with the rest of `.fx`.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ref, uploadBytes } from 'firebase/storage';

import { storage } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { adsApi, socialApi, type AdsConfigDoc, type SocialFormat, type SocialSettings } from '@/lib/api';
import { FORMAT_META } from './shared';
import { adMoney } from './ads';

export type Agent = 'team' | 'expert' | 'campaign';

const AGENTS: Record<Agent, { icon: string; name: string; does: string }> = {
  team: { icon: '🎬', name: 'AI team', does: 'Reels, posts, stories, carousels' },
  expert: { icon: '📣', name: 'Meta Ad Expert', does: 'Plans a campaign with you' },
  campaign: { icon: '🚀', name: 'New campaign', does: 'Makes the ad at Meta now' },
};
const ORDER: Agent[] = ['team', 'expert', 'campaign'];
/** Where each agent sits on the 760×380 stage. */
const AGENT_Y = [70, 190, 310];

const FORMATS: SocialFormat[] = ['reel', 'post', 'story', 'carousel'];

const EXAMPLES = [
  'a reel for riders in Lahore: you name your own fare, no surge at night',
  'run an ad for new drivers in Karachi, Rs 1,500 a day for a week',
  'ask the Meta Ad Expert to plan a campaign for students in Islamabad',
  'five carousel slides on how a shared ride splits the fare per seat',
  'a story telling drivers the weekend is the busiest time',
];

// ── what the brain hears ────────────────────────────────────────────────────

const AD = /\b(ads?|adverts?|advertis\w*|campaigns?|boost\w*|sponsor\w*|ishtihar)\b|\b(rs\.?|pkr|rupees?)\s*[\d,]+|[\d,]+\s*(rs|pkr|rupees?)\b|per day|a day for/;
const PLAN = /\b(plan\w*|strateg\w*|advi[cs]e|suggest\w*|expert|ideas?|review|analy[sz]\w*|discuss|mashwar\w*|how much)\b/;
const FORMAT_WORDS: [SocialFormat, RegExp][] = [
  ['carousel', /\b(carousels?|slides?|swipe)\b/],
  ['story', /\bstor(y|ies)\b/],
  ['reel', /\b(reels?|videos?|shorts?|clips?)\b/],
  ['post', /\b(posts?|photos?|images?|pictures?|graphics?)\b/],
];

/**
 * Who a sentence is for. Ad words go to the ads desk — to the expert when it
 * also asks for a plan or advice, straight to a new campaign otherwise; the
 * rest is the AI team's, with the kind of piece if the sentence names one.
 */
export function readIntent(text: string): { agent: Agent; format: SocialFormat | null } {
  const t = text.toLowerCase();
  const format = FORMAT_WORDS.find(([, re]) => re.test(t))?.[0] ?? null;
  if (/\bexpert\b/.test(t) || (AD.test(t) && PLAN.test(t))) return { agent: 'expert', format };
  if (AD.test(t)) return { agent: 'campaign', format };
  return { agent: 'team', format };
}

// ── the drawing ─────────────────────────────────────────────────────────────

type P = [number, number];
const CX = 160;
const CY = 140;
const RX = 132;
const RY = 118;
const GAP = 4;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through the points (Catmull-Rom as cubic Béziers). */
function smooth(pts: P[], closed = false): string {
  const n = pts.length;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d +=
      ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
}

/** One half of the brain seen from above: a bumpy outer edge, then back up the middle. */
function lobe(s: 1 | -1): P[] {
  const pts: P[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = -Math.PI / 2 + (Math.PI * k) / 40;
    const bump = 1 + 0.035 * Math.sin(t * 13 + (s > 0 ? 1.3 : 0));
    pts.push([CX + s * (GAP + RX * Math.cos(t) * bump * (1 + 0.08 * Math.sin(t))), CY + RY * Math.sin(t) * bump]);
  }
  for (let k = 1; k < 8; k++) pts.push([CX + s * (GAP + 3 * Math.sin(k * 1.7)), CY + RY - (2 * RY * k) / 8]);
  return pts;
}

function buildArt() {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lobes: string[] = [];
  const folds: string[] = [];
  const nodes: P[] = [];
  for (const s of [-1, 1] as const) {
    lobes.push(smooth(lobe(s), true));
    const hx = CX + s * (GAP + RX * 0.5);
    const hy = CY + 4;
    // The folds: lines meandering front to back, clipped to the half they sit in.
    for (let i = 0; i < 7; i++) {
      const x0 = CX + s * (GAP + 12 + i * 18);
      const p1 = rand() * 6;
      const p2 = rand() * 6;
      const pts: P[] = [];
      for (let y = CY - RY - 4; y <= CY + RY + 4; y += 6) {
        pts.push([x0 + 6.5 * Math.sin(y * 0.085 + p1) + 3 * Math.sin(y * 0.21 + p2), y]);
      }
      folds.push(smooth(pts));
    }
    for (let n = 0; n < 15; ) {
      const x = rand() * 2 - 1;
      const y = rand() * 2 - 1;
      if (x * x + y * y > 1) continue;
      nodes.push([r1(hx + x * RX * 0.42), r1(hy + y * RY * 0.78)]);
      n++;
    }
  }
  // The bridges across the middle.
  const bridges = [-34, 0, 34].map((dy) =>
    smooth([[CX - 34, CY + dy + 6], [CX, CY + dy - 4], [CX + 34, CY + dy + 6]]),
  );
  // Each node to its two nearest.
  const edges: [P, P][] = [];
  const seen = new Set<string>();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2] as const)
      .filter(([j]) => j !== i)
      .sort((p, q) => p[1] - q[1])
      .slice(0, 2)
      .forEach(([j]) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([a, nodes[j]]);
        }
      });
  });
  return { lobes, folds, bridges, nodes, edges };
}

const ART = buildArt();
const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

function BrainArt() {
  return (
    <svg viewBox="0 0 320 280" className="bn-art" aria-hidden>
      <defs>
        <radialGradient id="bn-halo">
          <stop offset="0" stopColor="#ccff00" stopOpacity=".34" />
          <stop offset=".55" stopColor="#19c37d" stopOpacity=".1" />
          <stop offset="1" stopColor="#19c37d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bn-skin" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#19c37d" stopOpacity=".2" />
          <stop offset="1" stopColor="#0b3d27" stopOpacity=".08" />
        </linearGradient>
        <filter id="bn-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={CX} cy={CY} r="156" fill="url(#bn-halo)" className="bn-halo" />
      <g transform={`translate(${CX} ${CY}) rotate(-16) scale(1 .3)`}>
        <g className="bn-orbit">
          <circle r="154" className="bn-ring" />
          <circle cx="154" r="6" className="bn-spark" />
          <circle cx="-154" r="4" className="bn-spark" />
        </g>
      </g>
      <g className="bn-body">
        {ART.lobes.map((d) => (
          <path key={d} d={d} fill="url(#bn-skin)" className="bn-lobe" />
        ))}
        {ART.edges.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="bn-edge" />
        ))}
        <clipPath id="bn-clip">
          {ART.lobes.map((d) => (
            <path key={d} d={d} />
          ))}
        </clipPath>
        {[ART.folds, ART.bridges].map((paths, g) => (
          <g key={g} filter="url(#bn-glow)" clipPath={g ? undefined : 'url(#bn-clip)'}>
            {paths.map((d) => (
              <path key={d} d={d} className="bn-fold" />
            ))}
            {paths.map((d, i) => (
              <path
                key={`f${d}`}
                d={d}
                pathLength={100}
                className="bn-flow"
                style={vars({ '--d': `${2 + (i % 5) * 0.5}s`, animationDelay: `${-i * 0.43}s` })}
              />
            ))}
          </g>
        ))}
        {ART.nodes.map(([x, y], i) => (
          <circle
            key={`${x},${y}`}
            cx={x}
            cy={y}
            r={i % 4 ? 1.7 : 2.8}
            className="bn-node"
            style={{ animationDelay: `${-((i * 0.29) % 2.6)}s` }}
          />
        ))}
      </g>
      <circle cx={CX} cy={CY} r="44" className="bn-ping" />
      <circle cx={CX} cy={CY} r="44" className="bn-ping late" />
    </svg>
  );
}

// ── the box ─────────────────────────────────────────────────────────────────

/**
 * The brain, with the Approval box (`children`) wired in beside it.
 *
 * A post, reel, story or carousel goes to the team with your words as the
 * brief, posted or queued by the "this one" switch (which starts on whatever
 * the Approval box says). A new campaign goes to the ads desk with the same
 * words, held to the daily limit set on the Ads page. The expert opens the Ads
 * page's designer with your words as its first message.
 */
export function Brain({
  settings,
  ads,
  want,
  onWant,
  brief,
  onBrief,
  refLink,
  onRefLink,
  disabled,
  onDone,
  onError,
  children,
}: {
  settings: SocialSettings;
  ads: AdsConfigDoc | null;
  want: SocialFormat;
  onWant: (w: SocialFormat) => void;
  brief: string;
  onBrief: (b: string) => void;
  refLink: string;
  onRefLink: (l: string) => void;
  disabled: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  children: React.ReactNode;
}) {
  const { path } = useWorkspace();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent>('team');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refAsked, setRefAsked] = useState(false);
  const [direct, setDirect] = useState<boolean | null>(null);
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [example, setExample] = useState(0);

  // The empty box keeps suggesting what it can do.
  useEffect(() => {
    if (brief) return;
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3800);
    return () => clearInterval(t);
  }, [brief]);

  const postDirect = direct ?? settings.autoPublish;
  const adsReady = Boolean(ads?.adAccountId) && (ads?.dailyCap ?? 0) > 0 && ads?.mode != null;
  // Folded away until wanted: most pieces need only the kind and a sentence.
  const showRef = refAsked || Boolean(refLink.trim()) || Boolean(refFile);
  const said = brief.trim();

  /** Typing re-reads the sentence; a pick of yours holds until the words point somewhere else. */
  function hear(text: string) {
    const was = readIntent(brief);
    const now = readIntent(text);
    onBrief(text);
    if (now.agent !== was.agent) setAgent(now.agent);
    if (now.format && now.format !== was.format) onWant(now.format);
  }

  async function go() {
    if (agent === 'expert') {
      router.push(`/dashboard/social/ads?brief=${encodeURIComponent(said)}#design`);
      return;
    }
    setBusy(true);
    try {
      if (agent === 'campaign') {
        const res = await adsApi.create({
          brief: said,
          dailyBudget: Number(budget) > 0 ? Number(budget) : undefined,
          days: Number(days) > 0 ? Math.round(Number(days)) : undefined,
        });
        onDone(
          `${res.launched ? 'Launched' : 'Made and waiting for your Approve on the Ads page'}: "${res.plan.name}", ` +
            `${adMoney(res.budget, ads?.currency ?? 'PKR')} a day for ${res.plan.days} days.${res.note ? ` ${res.note}` : ''}`,
        );
      } else {
        // "Make it like this": the file goes to Storage first and the backend reads it from there.
        let reference: { youtube: string } | { storagePath: string } | undefined;
        if (refFile) {
          // storage.rules refuses anything bigger, with an error nobody could read.
          if (refFile.size > 200 * 1024 * 1024) throw new Error('That video is over 200 MB. Trim it to the part that matters.');
          const upload = path(`socialUploads/ref-${Date.now()}-${refFile.name.replace(/[^\w.-]/g, '')}`);
          await uploadBytes(ref(storage, upload), refFile, { contentType: refFile.type || 'video/mp4' });
          reference = { storagePath: upload };
        } else if (refLink.trim()) {
          reference = { youtube: refLink.trim() };
        }
        const res = await socialApi.generate({
          replace: true,
          format: want,
          ...(said.length >= 3 ? { brief: said } : {}),
          publishWhenDone: postDirect,
          ...(reference ? { reference } : {}),
        });
        setRefFile(null);
        onRefLink('');
        setRefAsked(false);
        onDone(
          postDirect
            ? `The team made the ${FORMAT_META[res.format].label.toLowerCase()} and is posting it — see it on Content & calendar.`
            : `The team made the ${FORMAT_META[res.format].label.toLowerCase()}. Approve it on Content & calendar.`,
        );
      }
      onBrief('');
      setSent(true);
      setTimeout(() => setSent(false), 2600);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const blocked =
    agent === 'expert'
      ? said.length < 3
      : agent === 'campaign'
        ? disabled || !adsReady || said.length < 5
        : disabled;
  const status = busy ? 'Thinking…' : sent ? 'Sent ✓' : said ? `Listening · ${AGENTS[agent].name}` : 'Ready';
  // The team's pieces show their own approve switch below; the ads desk keeps its own.
  const gate =
    agent === 'campaign'
      ? ads?.mode === 'direct'
        ? '⚡ Launches straight away'
        : '🛡️ Waits for your Approve on the Ads page'
      : '💬 Nothing is spent until you press Create';

  return (
    <section
      className={`bn fx-rise${busy ? ' thinking' : said ? ' listening' : ''}${sent ? ' sent' : ''}`}
      style={vars({ '--i': 1 })}
      aria-labelledby="brain-h"
    >
      <div className="bn-head">
        <div style={{ minWidth: 0 }}>
          <div className="fx-eyebrow">Velocity Brain</div>
          <h2 id="brain-h">Tell it what you want. It sends the work to the right agent.</h2>
        </div>
        <span className="bn-status" aria-live="polite">
          <span className={busy || said ? 'fx-live lime' : 'fx-live'} /> {status}
        </span>
      </div>

      <div className="bn-grid">
        <div className="bn-stage">
          <svg className="bn-wires" viewBox="0 0 760 380" aria-hidden>
            {ORDER.map((a, i) => {
              const y = AGENT_Y[i];
              const from = 190 + (y - 190) * 0.3;
              const into = `M330 ${from} C400 ${from}, 400 ${y}, 466 ${y}`;
              const out = `M698 ${y} C732 ${y}, 728 190, 760 190`;
              const on = a === agent;
              return (
                <g key={a} className={on ? 'on' : undefined}>
                  <path d={into} className="bn-wire" />
                  <path d={out} className="bn-wire bn-out" />
                  {on ? (
                    <>
                      <path d={into} pathLength={100} className="bn-comet" />
                      <path d={out} pathLength={100} className="bn-comet late bn-out" />
                    </>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="bn-brainbox">
            <BrainArt />
          </div>
          <div className="bn-agents" role="radiogroup" aria-label="Who does it">
            {ORDER.map((a, i) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={a === agent}
                className="bn-agent"
                style={vars({ '--y': `${(AGENT_Y[i] / 380) * 100}%` })}
                onClick={() => setAgent(a)}
              >
                <span className="ico" aria-hidden>
                  {AGENTS[a].icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong>{AGENTS[a].name}</strong>
                  <span className="does">{AGENTS[a].does}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="bn-approval">{children}</div>
      </div>

      <div className="bn-prompt">
        <span className="bn-spark-ico" aria-hidden>
          ✦
        </span>
        <textarea
          value={brief}
          onChange={(e) => hear(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !blocked && !busy) void go();
          }}
          id="make-brief"
          rows={2}
          aria-label="Tell the brain what you want"
          placeholder={`e.g. ${EXAMPLES[example]}`}
        />
        <button type="button" className="bn-go" onClick={go} disabled={busy || blocked}>
          {busy ? (
            <span className="fx-typing" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span aria-hidden>⚡</span>
          )}
          {busy
            ? agent === 'campaign'
              ? 'The expert is building it…'
              : refFile || refLink.trim()
                ? 'The team is watching the video…'
                : 'The team is working…'
            : agent === 'expert'
              ? 'Plan it with the expert'
              : agent === 'campaign'
                ? 'Make the campaign'
                : 'Make it'}
        </button>
      </div>

      <div className="bn-route">
        <span className="bn-to">
          → <strong>{AGENTS[agent].name}</strong>
          {agent === 'team' ? ` · ${FORMAT_META[want].label}` : <span className="bn-gate">{gate}</span>}
        </span>

        {agent === 'team' ? (
          <>
            <div className="bn-chips" role="radiogroup" aria-label="What to make">
              {FORMATS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={f === want} onClick={() => onWant(f)}>
                  <span aria-hidden>{FORMAT_META[f].glyph}</span>
                  {FORMAT_META[f].label}
                </button>
              ))}
            </div>
            <div className="bn-chips" role="radiogroup" aria-label="This one">
              <button type="button" role="radio" aria-checked={!postDirect} onClick={() => setDirect(false)}>
                🛡️ Wait for my Approve
              </button>
              <button type="button" role="radio" aria-checked={postDirect} onClick={() => setDirect(true)}>
                ⚡ Post at once
              </button>
            </div>
            {!showRef ? (
              <button type="button" className="bn-textbtn" onClick={() => setRefAsked(true)}>
                🎞️ + Make it like a video I like
              </button>
            ) : null}
          </>
        ) : null}
        {busy ? <span className="bn-hint">Takes a few minutes. You can leave this page — it carries on.</span> : null}
      </div>

      {agent === 'team' && showRef ? (
        <div className="bn-panel">
          <p className="bn-hint" style={{ margin: '0 0 8px' }}>
            The team watches it and copies the hook, pacing and structure — never the footage, faces or words. From
            Instagram or TikTok? Download it and upload the file.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="bn-pick" style={{ opacity: refLink.trim() ? 0.5 : 1 }}>
              {refFile ? `📎 ${refFile.name}` : 'Upload a video'}
              <input
                type="file"
                accept="video/*"
                disabled={Boolean(refLink.trim())}
                style={{ display: 'none' }}
                onChange={(e) => {
                  setRefFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </label>
            {refFile ? (
              <button type="button" onClick={() => setRefFile(null)} className="bn-pick" aria-label="Remove the video">
                ✕
              </button>
            ) : (
              <>
                <span className="bn-hint">or</span>
                <input
                  value={refLink}
                  onChange={(e) => onRefLink(e.target.value)}
                  placeholder="paste a YouTube or Shorts link"
                  aria-label="YouTube link"
                  className="bn-small"
                  style={{ flex: 1, minWidth: 200 }}
                />
              </>
            )}
          </div>
        </div>
      ) : null}

      {agent === 'campaign' ? (
        adsReady ? (
          <div className="bn-panel" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="bn-label">
              Per day ({ads!.currency})
              <input
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="the expert decides"
                className="bn-small"
              />
            </label>
            <label className="bn-label">
              Days
              <input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
                placeholder={`up to ${ads!.maxDays}`}
                className="bn-small"
              />
            </label>
            <span className="bn-hint">Limit {adMoney(ads!.dailyCap, ads!.currency)} a day</span>
          </div>
        ) : (
          <p className="bn-panel bn-warn">
            The ads desk needs the ad account connected and a daily limit first.{' '}
            <Link href="/dashboard/social/ads">Set it up</Link> — or tap <strong>Meta Ad Expert</strong> and plan the
            campaign first.
          </p>
        )
      ) : null}
    </section>
  );
}

export const BRAIN_CSS = `
.bn { --speed: 1; position: relative; overflow: hidden; isolation: isolate; border-radius: 28px; padding: 22px 22px 18px; margin-bottom: 18px;
  color: #eaf5ee; border: 1px solid #16301f;
  background: radial-gradient(70% 90% at 24% 36%, #0f3322 0%, #06120c 55%, #020504 100%); }
.bn::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image: linear-gradient(rgba(204,255,0,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(204,255,0,.045) 1px, transparent 1px);
  background-size: 32px 32px; -webkit-mask-image: radial-gradient(70% 80% at 30% 40%, #000 20%, transparent 75%);
  mask-image: radial-gradient(70% 80% at 30% 40%, #000 20%, transparent 75%); }
.bn.listening { --speed: .6; }
.bn.thinking { --speed: .3; }

.bn-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.bn-head h2 { font-size: 22px; font-weight: 900; letter-spacing: -.02em; line-height: 1.2; margin: 6px 0 0; color: #fff; }
.bn-status { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 7px 13px; font-size: 12.5px; font-weight: 800;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); white-space: nowrap; }
.bn.sent .bn-status { background: var(--lime); color: var(--ink); border-color: var(--lime); }

.bn-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(290px, 1fr); gap: 22px; align-items: center; margin: 4px 0 14px; }
.bn-stage { position: relative; aspect-ratio: 760 / 380; min-width: 0; }
.bn-wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.bn-wire { fill: none; stroke: rgba(255,255,255,.1); stroke-width: 1.5; transition: stroke .3s ease; }
.on > .bn-wire { stroke: rgba(204,255,0,.32); }
.bn-comet { fill: none; stroke: var(--lime); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 12 88;
  filter: drop-shadow(0 0 4px rgba(204,255,0,.9)); animation: bn-dash calc(1.8s * var(--speed)) linear infinite; }
.bn-comet.late { animation-delay: calc(-.9s * var(--speed)); }
@keyframes bn-dash { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }

.bn-brainbox { position: absolute; left: 0; top: 0; width: 47%; height: 100%; display: grid; place-items: center; }
.bn-art { width: 100%; height: 100%; overflow: visible; }
.bn-halo { transform-box: fill-box; transform-origin: center; animation: bn-halo calc(4s * var(--speed)) ease-in-out infinite; }
@keyframes bn-halo { 0%, 100% { opacity: .65; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }
.bn.thinking .bn-halo { opacity: 1; }
.bn-ring { fill: none; stroke: rgba(204,255,0,.28); stroke-width: 3; stroke-dasharray: 2 14; }
.bn-spark { fill: var(--lime); }
.bn-orbit { animation: bn-spin calc(16s * var(--speed)) linear infinite; }
@keyframes bn-spin { to { transform: rotate(360deg); } }
.bn-body { transform-box: fill-box; transform-origin: center; animation: bn-breathe calc(5s * var(--speed)) ease-in-out infinite; }
@keyframes bn-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.bn-lobe { stroke: rgba(204,255,0,.6); stroke-width: 1.6; }
.bn-edge { stroke: rgba(234,245,238,.13); stroke-width: .8; }
.bn-fold { fill: none; stroke: rgba(25,195,125,.6); stroke-width: 1.5; stroke-linecap: round; }
.bn-flow { fill: none; stroke: var(--lime); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 8 92;
  animation: bn-dash calc(var(--d) * var(--speed)) linear infinite; }
.bn-node { fill: #eaffb0; transform-box: fill-box; transform-origin: center; animation: bn-twinkle calc(2.6s * var(--speed)) ease-in-out infinite; }
@keyframes bn-twinkle { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.25); } }
.bn-ping { fill: none; stroke: var(--lime); stroke-width: 2; opacity: 0; transform-box: fill-box; transform-origin: center; }
.bn.thinking .bn-ping { animation: bn-ping 1.6s ease-out infinite; }
.bn.thinking .bn-ping.late { animation-delay: .8s; }
@keyframes bn-ping { from { opacity: .8; transform: scale(.4); } to { opacity: 0; transform: scale(3.4); } }

.bn-agents { position: absolute; inset: 0; pointer-events: none; }
.bn-agent { pointer-events: auto; position: absolute; left: 61.3%; width: 30.6%; top: var(--y); transform: translateY(-50%);
  display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; align-items: center; text-align: left; padding: 9px 11px;
  border-radius: 16px; background: rgba(10,22,16,.86); border: 1px solid rgba(255,255,255,.12); color: #eaf5ee; font: inherit; cursor: pointer;
  backdrop-filter: blur(8px); transition: border-color .25s ease, box-shadow .25s ease, transform .25s ease, background .25s ease; }
.bn-agent:hover { border-color: rgba(204,255,0,.45); transform: translateY(-50%) translateX(2px); }
.bn-agent strong { display: block; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-agent .does { display: block; font-size: 11.5px; color: #8fb3a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-agent .ico { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 18px; background: rgba(255,255,255,.07);
  transition: background .25s ease, transform .3s ease; }
.bn-agent[aria-checked='true'] { border-color: var(--lime); background: rgba(24,42,10,.92);
  box-shadow: 0 0 0 1px rgba(204,255,0,.35), 0 0 34px -6px rgba(204,255,0,.55); }
.bn-agent[aria-checked='true'] .ico { background: var(--lime); transform: rotate(-6deg) scale(1.05); }

.bn-approval { position: relative; min-width: 0; }
.bn-approval::before { content: ''; position: absolute; right: 100%; top: 50%; width: 22px; height: 2px; margin-top: -1px;
  background: linear-gradient(90deg, rgba(204,255,0,.35), var(--lime)); box-shadow: 0 0 10px rgba(204,255,0,.7); }
.bn-approval::after { content: ''; position: absolute; left: -6px; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%;
  background: var(--lime); box-shadow: 0 0 0 4px rgba(204,255,0,.18); animation: fx-ping 1.8s ease-out infinite; }
.bn.sent .bn-approval .fx-card { border-color: var(--lime); box-shadow: 0 0 40px -6px rgba(204,255,0,.6); }
.bn .fx-card { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.1); color: #eaf5ee; box-shadow: none; backdrop-filter: blur(10px); }
.bn .fx-h2 { color: #fff; }
.bn .fx-sub, .bn .fx-muted { color: #8fb3a0; }
.bn .fx-ico { background: rgba(204,255,0,.12) !important; }
.bn .fx-opt { background: rgba(255,255,255,.03); border-color: rgba(255,255,255,.12); }
.bn .fx-opt:hover { border-color: rgba(204,255,0,.4); }
.bn .fx-opt[aria-checked='true'] { border-color: var(--lime); background: linear-gradient(135deg, rgba(204,255,0,.13), rgba(25,195,125,.07));
  box-shadow: 0 0 34px -10px rgba(204,255,0,.5); }
.bn .fx-opt .ico { background: rgba(255,255,255,.07); }
.bn .fx-opt[aria-checked='true'] .ico { background: var(--lime); }
.bn .fx-opt .tick { border-color: rgba(255,255,255,.25); }
.bn .fx-waiting { background: rgba(252,211,77,.1); border-color: rgba(252,211,77,.3); color: #fcd34d; }
.bn .fx-runrow { background: rgba(255,255,255,.05); }
.bn .fx-switch:not([aria-checked='true']) { background: rgba(255,255,255,.2); }
.bn .fx-link { color: var(--lime); }
.bn .fx-card p[style] { color: #fcd34d !important; }

.bn-prompt { position: relative; display: flex; gap: 10px; align-items: center; padding: 8px 8px 8px 16px; border-radius: 20px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); transition: border-color .25s ease, box-shadow .25s ease; }
.bn-prompt:focus-within { border-color: rgba(204,255,0,.7); box-shadow: 0 0 0 4px rgba(204,255,0,.12), 0 0 40px -12px rgba(204,255,0,.6); }
.bn-spark-ico { color: var(--lime); font-size: 18px; animation: bn-spin 6s linear infinite; display: inline-block; }
.bn-prompt textarea { flex: 1; min-width: 0; border: 0; outline: none; resize: none; background: transparent; color: #fff; font: inherit;
  font-size: 15px; line-height: 1.5; padding: 6px 0; }
.bn-prompt textarea::placeholder { color: #6f8f7e; }
.bn-go { position: relative; overflow: hidden; flex: none; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 14px;
  padding: 13px 20px; font: inherit; font-size: 14px; font-weight: 900; color: var(--ink); background: var(--lime); cursor: pointer;
  box-shadow: 0 0 30px -6px rgba(204,255,0,.75); transition: transform .15s ease, box-shadow .2s ease, opacity .2s ease; }
.bn-go:hover { transform: translateY(-1px); box-shadow: 0 0 40px -4px rgba(204,255,0,.9); }
.bn-go::after { content: ''; position: absolute; inset: 0; transform: translateX(-120%);
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.6) 50%, transparent 70%); animation: bn-shine 3.2s ease-in-out infinite; }
@keyframes bn-shine { 0%, 55% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.bn-go:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
.bn-go:disabled::after { display: none; }

.bn-route { display: flex; gap: 10px 14px; align-items: center; flex-wrap: wrap; margin-top: 12px; font-size: 13px; }
.bn-to { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; color: #b9d6c6; }
.bn-to strong { color: var(--lime); }
.bn-gate { margin-left: 4px; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 800; background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1); color: #eaf5ee; }
.bn-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.bn-chips button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04);
  color: #eaf5ee; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; transition: all .2s ease; }
.bn-chips button:hover { border-color: rgba(204,255,0,.45); }
.bn-chips button[aria-checked='true'] { background: var(--lime); border-color: var(--lime); color: var(--ink); }
.bn-textbtn { border: 0; background: none; padding: 0; color: var(--lime); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.bn-hint { font-size: 12px; color: #8fb3a0; line-height: 1.5; }
.bn-panel { margin: 12px 0 0; border: 1px dashed rgba(255,255,255,.16); border-radius: 14px; padding: 12px; background: rgba(0,0,0,.2); font-size: 13px; }
.bn-warn { color: #fcd34d; line-height: 1.55; }
.bn-warn a { color: var(--lime); font-weight: 800; }
.bn-label { display: grid; gap: 4px; font-size: 11.5px; font-weight: 800; color: #8fb3a0; }
.bn-small { width: 150px; padding: 8px 10px; font: inherit; font-size: 13px; border-radius: 10px; border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.05); color: #fff; }
.bn-small:focus { outline: none; border-color: rgba(204,255,0,.7); }
.bn-pick { border: 1px solid rgba(204,255,0,.55); color: var(--lime); background: transparent; border-radius: 10px; padding: 7px 12px; font: inherit;
  font-size: 13px; font-weight: 800; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1180px) {
  .bn-grid { grid-template-columns: minmax(0, 1fr); }
  .bn-out { display: none; }
  .bn-approval::before { right: auto; left: 50%; top: auto; bottom: 100%; width: 2px; height: 22px; margin: 0 0 0 -1px;
    background: linear-gradient(180deg, rgba(204,255,0,.35), var(--lime)); }
  .bn-approval::after { left: 50%; top: -6px; margin: 0 0 0 -5px; }
}
@media (max-width: 640px) {
  .bn { padding: 18px 14px 14px; }
  .bn-head h2 { font-size: 18px; }
  .bn-stage { aspect-ratio: auto; }
  .bn-wires { display: none; }
  .bn-brainbox { position: relative; width: 100%; height: 230px; }
  .bn-agents { position: static; display: grid; gap: 8px; pointer-events: auto; }
  .bn-agent { position: static; width: 100%; transform: none; }
  .bn-agent:hover { transform: none; }
  .bn-prompt { flex-wrap: wrap; padding: 10px; }
  .bn-prompt textarea { flex-basis: calc(100% - 30px); }
  .bn-go { width: 100%; justify-content: center; }
}
`;
