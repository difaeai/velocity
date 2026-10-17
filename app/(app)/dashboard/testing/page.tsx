'use client';

/**
 * Testing — what the app got wrong today, written so it can be fixed.
 *
 * Two things feed this page, and both only ever write when something is WRONG:
 * the testing agent, which runs every fifteen minutes against production data
 * (backend/functions/src/qa/checks.ts), and the app itself, which reports a tap
 * that did not do the job the feature was built for.
 *
 * A green day here therefore means one of two things, and the difference
 * matters: nothing is broken, or nothing was looked at. That is why the agent's
 * own run is printed — how many checks ran, which passed, which could not run at
 * all. A page that cannot tell those apart is a page that quietly stops being
 * true.
 *
 * Every entry carries a ready-made brief in `prompt`. Copy, paste into Claude
 * Code, fix. That is the entire workflow this page exists to serve, which is why
 * Copy is the first button on every row and "Copy every open brief" sits at the
 * top of the day.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/config';
import { qaApi } from '@/lib/api';
import { Button, Card } from '@/components/ui';

type Severity = 'blocker' | 'broken' | 'degraded';
type Status = 'open' | 'fixed' | 'ignored';

interface Stamp {
  seconds: number;
}

interface DayRow {
  id: string;
  entryCount?: number;
  occurrences?: number;
  reopened?: number;
  droppedEntries?: number;
  severity?: Partial<Record<Severity, number>>;
  areas?: Record<string, number>;
  agent?: {
    lastRunAt?: Stamp;
    durationMs?: number;
    checksRun?: number;
    passed?: string[];
    failed?: string[];
    skipped?: string[];
  };
  lastFailureAt?: Stamp;
}

interface Entry {
  id: string;
  featureId: string;
  feature: string;
  area: string;
  designedTo: string;
  code?: string[];
  source: 'tap' | 'agent';
  checkId?: string | null;
  kind: string;
  severity: Severity;
  whatHappened: string;
  why: string;
  fix: string;
  causeMatched?: boolean;
  evidence?: {
    appVersion?: string | null;
    platform?: string | null;
    screen?: string | null;
    callable?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    tookMs?: number | null;
    budgetMs?: number | null;
    detail?: Record<string, string>;
    samples?: string[];
  };
  sampleOverflow?: number;
  prompt: string;
  count: number;
  status: Status;
  adminNote?: string | null;
  firstSeenAt?: Stamp;
  lastSeenAt?: Stamp;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: colors.danger,
  broken: colors.warn,
  degraded: colors.muted,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  broken: 'Broken',
  degraded: 'Degraded',
};

/** Pakistan clock, from a Firestore timestamp. The reader works in PKT. */
function pkt(stamp?: Stamp): string {
  if (!stamp?.seconds) return '—';
  return `${new Date(stamp.seconds * 1000 + 5 * 3_600_000).toISOString().slice(11, 16)} PKT`;
}

function dayLabel(id: string): string {
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  if (id === today) return `${id} · today`;
  if (id === yesterday) return `${id} · yesterday`;
  return id;
}

export default function TestingPage() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState<DayRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('open');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The days, newest first. Document ids ARE the dates, so ordering by name is
  // ordering by day without a field to keep in step.
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'qaLogs'), orderBy('__name__', 'desc'), limit(60)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DayRow, 'id'>) }));
        setDays(rows);
        setSelected((cur) => cur ?? rows[0]?.id ?? null);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    // No day chosen yet means the day list has not arrived, and the entry list is
    // still empty — so there is nothing to clear, and clearing it here would be
    // a setState in an effect body for no gain.
    if (!selected) return;
    return onSnapshot(
      query(collection(db, 'qaLogs', selected, 'entries'), orderBy('lastSeenAt', 'desc'), limit(400)),
      (snap) => setEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Entry, 'id'>) }))),
      (e) => setError(e.message),
    );
  }, [selected]);

  const day = days.find((d) => d.id === selected);

  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          (statusFilter === 'all' || e.status === statusFilter) &&
          (areaFilter === 'all' || e.area === areaFilter),
      ),
    [entries, statusFilter, areaFilter],
  );

  const areas = useMemo(
    () => Array.from(new Set(entries.map((e) => e.area))).sort(),
    [entries],
  );

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied.`);
      setTimeout(() => setNote(null), 2500);
    } catch {
      setError('This browser would not let the page write to the clipboard.');
    }
  }, []);

  async function setStatus(entry: Entry, status: Status) {
    if (!isAdmin || !selected) return;
    try {
      await updateDoc(doc(db, 'qaLogs', selected, 'entries', entry.id), {
        status,
        triagedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const res = await qaApi.runChecksNow({});
      const failed = res.failed.length;
      setNote(
        failed === 0
          ? `Checked ${res.ran} things — all fine.`
          : `Checked ${res.ran} things — ${failed} ${failed === 1 ? 'problem' : 'problems'} logged under ${res.day}.`,
      );
      setSelected(res.day);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The agent could not run.');
    } finally {
      setRunning(false);
      setTimeout(() => setNote(null), 6000);
    }
  }

  const openBriefs = entries.filter((e) => e.status === 'open');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Testing</h1>
          <p style={{ color: colors.muted, marginBottom: 20, maxWidth: 760 }}>
            Every feature in Velocity was built to do one particular thing. The testing agent asks,
            all day, whether they still do — and the app itself speaks up when a tap does not do its
            job. Only failures are written here, so an empty day means nothing broke. Each entry is
            already a brief: copy it, paste it into Claude Code, fix it.
          </p>
        </div>
        <Button onClick={runNow} disabled={running || !isAdmin}>
          {running ? 'Checking…' : 'Run every check now'}
        </Button>
      </div>

      {note && (
        <div
          style={{
            background: '#ecfdf5',
            border: `1px solid ${colors.success}`,
            color: colors.success,
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 16,
            fontWeight: 600,
          }}
        >
          {note}
        </div>
      )}
      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading the log…</p>
      ) : days.length === 0 ? (
        <Card>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>Nothing logged yet.</p>
          <p style={{ color: colors.muted, margin: 0 }}>
            Either nothing has gone wrong since the agent was deployed, or it has not run yet. Press
            “Run every check now” to find out which — the agent writes a record of its run even when
            it finds nothing at all.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── The days ── */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <h2 style={{ fontSize: 13, fontWeight: 800, color: colors.muted, marginBottom: 8 }}>
              BY DATE
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {days.map((d) => {
                const blockers = d.severity?.blocker ?? 0;
                const total = d.entryCount ?? 0;
                const active = d.id === selected;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelected(d.id)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 11px',
                      borderRadius: 9,
                      cursor: 'pointer',
                      border: `1px solid ${active ? colors.primary : colors.border}`,
                      background: active ? colors.primary : colors.surface,
                      color: active ? '#fff' : colors.text,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{dayLabel(d.id)}</div>
                    <div style={{ opacity: 0.85, fontSize: 12, marginTop: 2 }}>
                      {total === 0
                        ? 'nothing logged'
                        : `${total} ${total === 1 ? 'problem' : 'problems'}${
                            blockers > 0 ? ` · ${blockers} blocker${blockers === 1 ? '' : 's'}` : ''
                          }`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── The selected day ── */}
          <div style={{ flex: 1, minWidth: 420 }}>
            {day && (
              <Card style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{dayLabel(day.id)}</div>
                    <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                      {(day.entryCount ?? 0) === 0
                        ? 'No feature failed today.'
                        : `${day.entryCount} distinct ${
                            day.entryCount === 1 ? 'problem' : 'problems'
                          } · ${day.occurrences ?? 0} occurrence${
                            (day.occurrences ?? 0) === 1 ? '' : 's'
                          }${day.reopened ? ` · ${day.reopened} came back after being marked fixed` : ''}`}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {(['blocker', 'broken', 'degraded'] as Severity[]).map((s) => (
                        <span
                          key={s}
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            padding: '3px 9px',
                            borderRadius: 999,
                            color: '#fff',
                            background: SEVERITY_COLOR[s],
                            opacity: (day.severity?.[s] ?? 0) > 0 ? 1 : 0.25,
                          }}
                        >
                          {day.severity?.[s] ?? 0} {SEVERITY_LABEL[s].toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginLeft: 'auto', minWidth: 260 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: colors.muted }}>
                      THE AGENT
                    </div>
                    {day.agent?.lastRunAt ? (
                      <>
                        <div style={{ fontSize: 13, marginTop: 4 }}>
                          Last ran {pkt(day.agent.lastRunAt)} · checked {day.agent.checksRun ?? 0}
                          {typeof day.agent.durationMs === 'number'
                            ? ` in ${Math.round(day.agent.durationMs / 100) / 10}s`
                            : ''}
                        </div>
                        <div style={{ fontSize: 13, color: colors.success, marginTop: 2 }}>
                          {day.agent.passed?.length ?? 0} fine
                        </div>
                        {(day.agent.failed?.length ?? 0) > 0 && (
                          <div style={{ fontSize: 13, color: colors.danger, marginTop: 2 }}>
                            {day.agent.failed!.length} found a problem: {day.agent.failed!.join(', ')}
                          </div>
                        )}
                        {(day.agent.skipped?.length ?? 0) > 0 && (
                          <div style={{ fontSize: 13, color: colors.warn, marginTop: 2 }}>
                            {day.agent.skipped!.length} could not run at all:{' '}
                            {day.agent.skipped!.join(', ')} — nothing is known about those.
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: colors.warn, marginTop: 4 }}>
                        The agent has not recorded a run on this day. An empty day may simply mean
                        nothing was tested.
                      </div>
                    )}
                    {day.droppedEntries ? (
                      <div style={{ fontSize: 12, color: colors.warn, marginTop: 6 }}>
                        {day.droppedEntries} further distinct problems were not recorded — the day hit
                        its ceiling.
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            )}

            {/* ── Filters ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              {(['open', 'fixed', 'ignored', 'all'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: `1px solid ${statusFilter === s ? colors.primary : colors.border}`,
                    background: statusFilter === s ? colors.primary : colors.surface,
                    color: statusFilter === s ? '#fff' : colors.text,
                  }}
                >
                  {s === 'all' ? 'Everything' : s[0]!.toUpperCase() + s.slice(1)}
                </button>
              ))}
              {areas.length > 1 && (
                <select
                  value={areaFilter}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    fontSize: 13,
                  }}
                >
                  <option value="all">Every area</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              {openBriefs.length > 0 && (
                <button
                  onClick={() =>
                    copy(
                      openBriefs.map((e) => e.prompt).join('\n\n────────────────────────\n\n'),
                      `${openBriefs.length} open ${openBriefs.length === 1 ? 'brief' : 'briefs'}`,
                    )
                  }
                  style={{
                    marginLeft: 'auto',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: `1px solid ${colors.primary}`,
                    background: colors.surface,
                    color: colors.primary,
                  }}
                >
                  Copy every open brief ({openBriefs.length})
                </button>
              )}
            </div>

            {/* ── The entries ── */}
            {shown.length === 0 ? (
              <Card>
                <p style={{ margin: 0, color: colors.muted }}>
                  {entries.length === 0
                    ? 'Nothing was logged on this day. Every feature that was used did what it was built to do.'
                    : 'Nothing matches that filter.'}
                </p>
              </Card>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {shown.map((e) => {
                  const open = expanded[e.id] === true;
                  const ev = e.evidence ?? {};
                  return (
                    <Card key={e.id}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 900,
                            padding: '3px 8px',
                            borderRadius: 999,
                            color: '#fff',
                            background: SEVERITY_COLOR[e.severity] ?? colors.muted,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {(SEVERITY_LABEL[e.severity] ?? e.severity).toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 15 }}>
                            {e.area} · {e.feature}
                          </div>
                          <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                            {e.source === 'agent'
                              ? `found by the agent${e.checkId ? ` · ${e.checkId}` : ''}`
                              : 'reported from the app'}{' '}
                            · {e.kind.replace('_', ' ')} · {e.count}×{' '}
                            {e.count > 1 ? `· last ${pkt(e.lastSeenAt)}` : `· ${pkt(e.lastSeenAt)}`}
                            {e.status !== 'open' ? ` · ${e.status}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => copy(e.prompt, 'Brief')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: `1px solid ${colors.primary}`,
                            background: colors.primary,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Copy brief
                        </button>
                      </div>

                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <Field label="DESIGNED TO" text={e.designedTo} />
                        <Field label="WHAT HAPPENED INSTEAD" text={e.whatHappened} />
                        <Field
                          label={e.causeMatched ? 'WHY (seen before)' : 'WHY (nothing matched)'}
                          text={e.why}
                        />
                        <Field label="WHAT TO TRY" text={e.fix} />
                      </div>

                      <button
                        onClick={() => setExpanded((x) => ({ ...x, [e.id]: !open }))}
                        style={{
                          marginTop: 12,
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: colors.secondary,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {open ? 'Hide the evidence' : 'Show the evidence'}
                      </button>

                      {open && (
                        <div
                          style={{
                            marginTop: 10,
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 10,
                            padding: 12,
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          {[ev.appVersion, ev.platform, ev.screen].filter(Boolean).length > 0 && (
                            <div>{[ev.appVersion, ev.platform, ev.screen].filter(Boolean).join(' · ')}</div>
                          )}
                          {ev.callable && (
                            <div>
                              callable <strong>{ev.callable}</strong>
                              {ev.errorCode ? ` → ${ev.errorCode}` : ''}
                              {ev.errorMessage ? ` “${ev.errorMessage}”` : ''}
                            </div>
                          )}
                          {!ev.callable && (ev.errorCode || ev.errorMessage) && (
                            <div>
                              {ev.errorCode ?? 'error'}
                              {ev.errorMessage ? ` “${ev.errorMessage}”` : ''}
                            </div>
                          )}
                          {typeof ev.tookMs === 'number' && (
                            <div>
                              took {Math.round(ev.tookMs / 100) / 10}s
                              {typeof ev.budgetMs === 'number'
                                ? ` (a user gives it ${Math.round(ev.budgetMs / 100) / 10}s)`
                                : ''}
                            </div>
                          )}
                          {Object.entries(ev.detail ?? {}).map(([k, v]) => (
                            <div key={k}>
                              {k}: {v}
                            </div>
                          ))}
                          {(ev.samples?.length ?? 0) > 0 && (
                            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}>
                              {ev.samples!.join('  ')}
                              {e.sampleOverflow ? `  (+${e.sampleOverflow} more)` : ''}
                            </div>
                          )}
                          {(e.code?.length ?? 0) > 0 && (
                            <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}>
                              {e.code!.join('  ')}
                            </div>
                          )}
                          <div style={{ marginTop: 8, color: colors.muted, fontSize: 12 }}>
                            first seen {pkt(e.firstSeenAt)} · feature id {e.featureId}
                          </div>
                        </div>
                      )}

                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          {e.status !== 'fixed' && (
                            <SmallButton label="Mark fixed" onClick={() => setStatus(e, 'fixed')} />
                          )}
                          {e.status !== 'ignored' && (
                            <SmallButton label="Not a bug" onClick={() => setStatus(e, 'ignored')} />
                          )}
                          {e.status !== 'open' && (
                            <SmallButton label="Reopen" onClick={() => setStatus(e, 'open')} />
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, color: colors.muted, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 2 }}>{text}</div>
    </div>
  );
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        color: colors.text,
      }}
    >
      {label}
    </button>
  );
}
