'use client';

/**
 * The Locations desk — Velocity's own map.
 *
 * WHAT THIS COLLECTION IS, AND WHY IT IS NOT A CACHE
 * The app's address lookups are cached (cheaply, and legally) for 30 days, because
 * that is all the Google Maps licence allows: coordinates from their APIs are
 * rented, and the terms require us to delete them. Renting forever is still
 * renting, so a cache can never make Google optional.
 *
 * This is the part we own. Every row here has a coordinate that came from OUR OWN
 * devices — the driver's GPS fix at the moment a trip actually ended. That is a
 * measurement we took, not content we borrowed, so it never expires and a lookup
 * that hits it is free permanently.
 *
 * The tempting shortcut is worth naming, because it does not work: taking Google's
 * coordinate, giving it a Velocity id, and calling the result ours. The 30-day
 * obligation attaches to the coordinate itself, not to the key it is filed under.
 * What Google DOES permit indefinitely is the place ID, which is why `placeId` sits
 * on these rows as the permanent join between their identity for a place and ours.
 *
 * WHAT AN OPERATOR ACTUALLY DOES HERE
 * The registry fills itself. What it cannot do is judgement, and there are exactly
 * four calls to make:
 *
 *   Verify   a pending row whose name and pin look right. Only verified rows are
 *            ever served to the app, so this is the switch that takes a place off
 *            Google's meter for good.
 *   Reject   a row whose name is junk. Rejection is permanent — the promoter will
 *            not resurrect it on the next trip that uses that spelling.
 *   Alias    teach a row another spelling. "Jinnah Super" should land on F-7 Markaz.
 *   Merge    fold a duplicate into the row it should have been.
 *
 * A row's confidence is its confirmation count: how many separate completed trips
 * agree. Three is enough for the backend to verify it automatically; below that
 * the app keeps asking Google, so a bad pin can never misdirect anyone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { adminApi, type VelocityLocationRow } from '@/lib/api';
import { colors } from '@/lib/config';
import { Badge, Button, Card, StatCard } from '@/components/ui';

type StatusFilter = 'pending' | 'verified' | 'rejected' | 'all';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Needs review' },
  { key: 'verified', label: 'On our map' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'Everything' },
];

function statusColor(status: VelocityLocationRow['status']): string {
  if (status === 'verified') return colors.success;
  if (status === 'rejected') return colors.danger;
  return colors.warn;
}

function ago(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function LocationsPage() {
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<VelocityLocationRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, verified: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The row selected as the merge target, if a merge is in progress. */
  const [mergeKeepId, setMergeKeepId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listLocations({
        status,
        search: search.trim() || undefined,
        limit: 150,
      });
      setRows(res.locations);
      setCounts(res.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load locations.');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    // Debounced so typing in the search box is one query, not one per keystroke.
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const mergeKeep = useMemo(
    () => rows.find((r) => r.id === mergeKeepId) ?? null,
    [rows, mergeKeepId],
  );

  async function act(id: string, run: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  }

  function review(row: VelocityLocationRow, next: 'verified' | 'rejected' | 'pending') {
    void act(row.id, () => adminApi.reviewLocation({ id: row.id, status: next }));
  }

  function rename(row: VelocityLocationRow) {
    const name = window.prompt('Name for this place', row.name);
    if (!name || name.trim() === row.name) return;
    void act(row.id, () => adminApi.reviewLocation({ id: row.id, name: name.trim() }));
  }

  function addAlias(row: VelocityLocationRow) {
    const alias = window.prompt(`Another spelling that should resolve to "${row.name}"`);
    if (!alias?.trim()) return;
    void act(row.id, () => adminApi.aliasLocation({ id: row.id, alias: alias.trim() }));
  }

  function removeAlias(row: VelocityLocationRow, alias: string) {
    void act(row.id, () => adminApi.aliasLocation({ id: row.id, alias, action: 'remove' }));
  }

  function completeMerge(row: VelocityLocationRow) {
    if (!mergeKeepId || mergeKeepId === row.id) return;
    void act(row.id, async () => {
      await adminApi.mergeLocations({ keepId: mergeKeepId, mergeId: row.id });
      setMergeKeepId(null);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: colors.text }}>
          Locations
        </h1>
        <p style={{ margin: '6px 0 0', color: colors.muted, fontSize: 14, maxWidth: '62ch' }}>
          Velocity&apos;s own map. Every pin here came from a driver&apos;s phone at the end of a
          real trip, so unlike our Google cache it never expires — and a verified place is one
          the app resolves for free, permanently.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="On our map" value={String(counts.verified)} />
        <StatCard label="Needs review" value={String(counts.pending)} />
        <StatCard label="Rejected" value={String(counts.rejected)} />
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.key}
              variant={status === tab.key ? 'primary' : 'ghost'}
              onClick={() => setStatus(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
          <input
            id="locations-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a place name…"
            style={{
              flex: '1 1 220px',
              minWidth: 0,
              padding: '9px 12px',
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              fontSize: 13,
              color: colors.text,
              background: '#fff',
            }}
          />
        </div>

        {mergeKeep && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 14px',
              borderRadius: 10,
              background: `${colors.warn}14`,
              border: `1px solid ${colors.warn}44`,
              fontSize: 13,
              color: colors.text,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <strong>Merging into “{mergeKeep.name}”.</strong>
            <span style={{ color: colors.muted }}>
              Pick the duplicate below — its name becomes an alias of this one, so nothing stops
              resolving.
            </span>
            <Button variant="ghost" onClick={() => setMergeKeepId(null)}>
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <p style={{ color: colors.danger, fontSize: 13, marginTop: 14, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </Card>

      {loading && rows.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Loading the map…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>
            {status === 'pending'
              ? 'Nothing waiting. New places appear here within about fifteen minutes of a trip ending at one.'
              : 'No locations match that.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => {
            const busy = busyId === row.id;
            const isMergeTarget = mergeKeepId === row.id;
            return (
              <Card
                key={row.id}
                style={isMergeTarget ? { outline: `2px solid ${colors.warn}` } : undefined}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 800, color: colors.text }}>
                        {row.name}
                      </span>
                      <Badge label={row.status} color={statusColor(row.status)} />
                      {row.coordSource === 'admin_pin' && (
                        <Badge label="admin pin" color={colors.muted} />
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 6,
                        color: colors.muted,
                        fontSize: 12.5,
                        display: 'flex',
                        gap: 14,
                        flexWrap: 'wrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: colors.text }}>{row.velocityId}</span>
                      <span>{row.city ?? 'Outside the cities'}</span>
                      <span>
                        {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
                      </span>
                      <span>
                        {row.confirmations} {row.confirmations === 1 ? 'trip' : 'trips'}
                      </span>
                      <span>{ago(row.lastConfirmedAt)}</span>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 12.5, color: colors.muted }}>
                      {row.placeId ? (
                        // Worth showing: this is the join key we are allowed to keep
                        // forever, and it is what makes a re-lookup cheap.
                        <span>
                          Google id <code style={{ fontSize: 11.5 }}>{row.placeId}</code>
                        </span>
                      ) : (
                        <span>No Google id on file.</span>
                      )}
                    </div>

                    {row.aliases.length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 11.5, color: colors.muted, fontWeight: 700 }}>
                          Also called
                        </span>
                        {row.aliases.map((alias) => (
                          <button
                            key={alias}
                            onClick={() => removeAlias(row, alias)}
                            disabled={busy}
                            title="Remove this alias"
                            style={{
                              background: colors.bg,
                              border: `1px solid ${colors.border}`,
                              borderRadius: 999,
                              padding: '2px 9px',
                              fontSize: 11.5,
                              color: colors.text,
                              cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {alias} ✕
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                    }}
                  >
                    {mergeKeepId && !isMergeTarget ? (
                      <Button variant="danger" disabled={busy} onClick={() => completeMerge(row)}>
                        Fold into “{mergeKeep?.name}”
                      </Button>
                    ) : (
                      <>
                        {row.status !== 'verified' && (
                          <Button disabled={busy} onClick={() => review(row, 'verified')}>
                            Verify
                          </Button>
                        )}
                        {row.status === 'verified' && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => review(row, 'pending')}
                          >
                            Unverify
                          </Button>
                        )}
                        <Button variant="ghost" disabled={busy} onClick={() => rename(row)}>
                          Rename
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => addAlias(row)}>
                          Add alias
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setMergeKeepId(row.id)}
                        >
                          Merge…
                        </Button>
                        {row.status !== 'rejected' && (
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => review(row, 'rejected')}
                          >
                            Reject
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
