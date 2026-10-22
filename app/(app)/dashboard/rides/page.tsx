'use client';

/**
 * The ride record.
 *
 * Every other desk in this console looks at a slice of a ride: live-ops at the
 * ones moving, settlements at the money, safety at the ones that went wrong.
 * None of them could answer the question that actually arrives by phone — what
 * happened on this ride, and who was in the car.
 *
 * So this page is built around that call. The ledger exists to FIND the ride
 * (by driver, by rider, by date, by state), and the file exists to answer every
 * question that follows once it is found: both parties by name and number, the
 * route, the clock, the money, and anything filed against it. It is the page an
 * operator reads from when the person on the other end of the line is the
 * police.
 *
 * One thing worth knowing while reading the code: names and plates in the
 * ledger are the ones recorded ON THE RIDE, not the ones on the account today.
 * A driver can be renamed, change cars or be suspended afterwards — the
 * document-expiry sweep can suspend one overnight — and history that quietly
 * updated itself to match would be no use in a dispute. The file shows both,
 * side by side and labelled.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  adminApi,
  type RideDetail,
  type RideHistoryRow,
  type RideParty,
} from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

const STATUSES = [
  'requested',
  'matched',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'merged',
] as const;

const STATUS_COLOR: Record<string, string> = {
  completed: colors.success,
  cancelled: colors.danger,
  in_progress: colors.secondary,
  merged: colors.muted,
};

/** Shortcuts for the date range, because "last 7 days" is most of the job. */
const RANGES = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: '7 days', days: 6 },
  { key: 'month', label: '30 days', days: 29 },
  { key: 'all', label: 'All time', days: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

function startOfRange(key: RangeKey): number | undefined {
  const r = RANGES.find((x) => x.key === key);
  if (!r || r.days === null) return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - r.days * 86_400_000;
}

function dateTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function duration(fromMs?: number | null, toMs?: number | null): string {
  if (!fromMs || !toMs || toMs < fromMs) return '—';
  const mins = Math.round((toMs - fromMs) / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function money(n?: number | null): string {
  return typeof n === 'number' ? `${n.toLocaleString()} PKR` : '—';
}

export default function RidesPage() {
  const [rows, setRows] = useState<RideHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextBeforeMs, setNextBeforeMs] = useState<number | null>(null);
  const [filteredInCode, setFilteredInCode] = useState<string[]>([]);
  const [pageable, setPageable] = useState(true);

  const [range, setRange] = useState<RangeKey>('week');
  const [status, setStatus] = useState<string>('');
  const [pool, setPool] = useState<'' | 'shared' | 'solo'>('');
  const [party, setParty] = useState<RideParty | null>(null);
  const [partyRole, setPartyRole] = useState<'driver' | 'rider'>('driver');

  const [term, setTerm] = useState('');
  const [people, setPeople] = useState<RideParty[]>([]);
  const [searching, setSearching] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const filters = useMemo(
    () => ({
      status: status || undefined,
      pool: pool === '' ? undefined : pool === 'shared',
      fromMs: startOfRange(range),
      driverId: party && partyRole === 'driver' ? party.uid : undefined,
      // A rider filter is the roster one — it catches the people who JOINED a
      // shared ride, not just whoever booked it. `passengerId` alone would miss
      // every co-rider, which is exactly who a complaint is usually about.
      riderId: party && partyRole === 'rider' ? party.uid : undefined,
      limit: 50,
    }),
    [status, pool, range, party, partyRole],
  );

  /**
   * The first page, refetched whenever the filters change.
   *
   * State is only ever set from the promise callbacks, never synchronously in
   * the effect body — same shape as every other desk in this console, and what
   * the react-hooks lint rule is asking for. `reloadNonce` is what the Refresh
   * button turns to run this again without changing a filter.
   */
  useEffect(() => {
    let alive = true;
    void adminApi
      .adminListRides(filters)
      .then((res) => {
        if (!alive) return;
        setRows(res.rides);
        setNextBeforeMs(res.nextBeforeMs);
        setFilteredInCode(res.filteredInCode);
        setPageable(res.pageable);
        setError('');
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load rides.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters, reloadNonce]);

  /** The next page, appended. A button handler, so setState here is fine. */
  const loadMore = useCallback(async () => {
    if (!nextBeforeMs) return;
    setLoading(true);
    try {
      const res = await adminApi.adminListRides({ ...filters, beforeMs: nextBeforeMs });
      setRows((cur) => [...cur, ...res.rides]);
      setNextBeforeMs(res.nextBeforeMs);
      setFilteredInCode(res.filteredInCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more rides.');
    } finally {
      setLoading(false);
    }
  }, [filters, nextBeforeMs]);

  async function search() {
    if (term.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await adminApi.adminSearchRideParties({ term: term.trim() });
      setPeople(res.people);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: colors.text, margin: 0 }}>
          Ride record
        </h1>
        <p style={{ color: colors.muted, fontSize: 13.5, margin: '6px 0 0' }}>
          Every ride Velocity Rides has run. Open one for the full file — both parties by name and
          number, the route, the clock, the money, and anything filed against it.
        </p>
      </header>

      {/* ── Who ── A uid is not something anybody has in their hand; a phone
          number or a name is what arrives with the complaint. */}
      <Card>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search();
              }}
              placeholder="Find a driver or rider — name, or phone (0300… or +92300…)"
              style={{ ...inputStyle, maxWidth: 420 }}
            />
            <Button onClick={() => void search()} disabled={searching || term.trim().length < 2}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
            {party ? (
              <>
                <span style={pillStyle}>
                  {partyRole === 'driver' ? 'Driver' : 'Rider'}: {party.name ?? party.uid}
                  {party.phone ? ` · ${party.phone}` : ''}
                </span>
                <Button variant="ghost" onClick={() => setParty(null)}>
                  Clear
                </Button>
              </>
            ) : null}
          </div>

          {people.length > 0 && !party ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {people.map((p) => (
                <div key={p.uid} style={personRowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5 }}>{p.name ?? '(no name)'}</strong>
                    <span style={{ color: colors.muted, fontSize: 12.5 }}>
                      {' '}
                      · {p.phone ?? 'no phone'} · {p.role}
                      {p.banned ? ' · BANNED' : ''}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setParty(p);
                      setPartyRole('driver');
                      setPeople([]);
                    }}
                  >
                    Rides driven
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setParty(p);
                      setPartyRole('rider');
                      setPeople([]);
                    }}
                  >
                    Rides taken
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {/* ── When, what state, what kind ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  style={{
                    ...chipStyle,
                    background: range === r.key ? `${colors.primary}1A` : colors.surface,
                    color: range === r.key ? colors.primary : colors.muted,
                    borderColor: range === r.key ? colors.primary : colors.border,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ ...inputStyle, width: 170 }}
            >
              <option value="">Any state</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
            <select
              value={pool}
              onChange={(e) => setPool(e.target.value as '' | 'shared' | 'solo')}
              style={{ ...inputStyle, width: 170 }}
            >
              <option value="">Shared and solo</option>
              <option value="shared">Ride sharing only</option>
              <option value="solo">Solo only</option>
            </select>
            <Button variant="ghost" onClick={() => setReloadNonce((n) => n + 1)}>
              Refresh
            </Button>
          </div>

          {/* A rider's history is two queries merged (rides they booked plus
              rides they joined), so it cannot be cursor-paged. Saying so beats
              letting a capped list read as a complete one. */}
          {!pageable ? (
            <p style={{ color: colors.muted, fontSize: 12, margin: 0 }}>
              Showing this rider&apos;s most recent rides — the ones they booked and the ones
              they joined, merged. Narrow the dates if you need to look further back.
            </p>
          ) : null}

          {/* Honest about the index discipline in the backend: a page can come
              back short because these filters are applied over it, not by it. */}
          {filteredInCode.length > 0 ? (
            <p style={{ color: colors.warn, fontSize: 12, margin: 0 }}>
              {filteredInCode.join(', ')} {filteredInCode.length === 1 ? 'was' : 'were'} applied
              after fetching rather than by the index, so a page may be shorter than 50. Load more
              to keep going.
            </p>
          ) : null}
        </div>
      </Card>

      {error ? <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p> : null}

      {/* ── The ledger ── */}
      <Card>
        {loading && rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>Loading rides…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13 }}>
            No rides match those filters.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['When', 'Driver', 'Riders', 'Route', 'Fare', 'State', ''].map((h) => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={tdStyle}>
                      {dateTime(r.createdAtMs)}
                      {r.hasSafetyEvent ? (
                        <span style={{ color: colors.danger, fontWeight: 800 }}> · SOS</span>
                      ) : null}
                      {r.disputed ? (
                        <span style={{ color: colors.warn, fontWeight: 800 }}> · disputed</span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>
                      {r.driverName ?? (r.driverId ? '(unnamed)' : 'No driver')}
                      {r.plate ? (
                        <span style={{ color: colors.muted }}> · {r.plate}</span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>
                      {r.pool ? `${r.riders} sharing` : (r.passengerName ?? '1')}
                      {r.pool && r.riderNames.length ? (
                        <span style={{ color: colors.muted }}> · {r.riderNames.join(', ')}</span>
                      ) : null}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 300 }}>
                      <span style={{ color: colors.muted }}>{r.pickupAddress ?? '—'}</span>
                      {' → '}
                      {r.dropoffAddress ?? '—'}
                    </td>
                    <td style={tdStyle}>{money(r.grossFare ?? r.fare)}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          color: STATUS_COLOR[r.status ?? ''] ?? colors.text,
                          fontWeight: 700,
                        }}
                      >
                        {(r.status ?? '—').replace('_', ' ')}
                      </span>
                      {r.cancelledByRole ? (
                        <span style={{ color: colors.muted }}> by {r.cancelledByRole}</span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>
                      <Button variant="ghost" onClick={() => setOpenId(r.id)}>
                        Open file
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextBeforeMs ? (
          <div style={{ marginTop: 14 }}>
            <Button variant="secondary" onClick={() => void loadMore()} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </Card>

      {openId ? <RideFile tripId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

/**
 * One ride, in full.
 *
 * Laid out in the order the questions get asked on the phone: what ride is
 * this, who drove it, who was in it, when did everything happen, what did it
 * cost, and what has been filed against it.
 */
function RideFile({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RideDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    adminApi
      .adminGetRideDetail({ tripId })
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load that ride.');
      });
    return () => {
      alive = false;
    };
  }, [tripId]);

  const d = detail;

  // A live ride its driver can no longer end (phone died) locks the rider out
  // of booking. Ending it here frees them; no fee, no commission.
  async function forceEnd() {
    const reason = prompt('Why is this ride being ended? (shown in the audit log)');
    if (!reason || reason.trim().length < 3) return;
    try {
      await adminApi.adminForceEndTrip({ tripId, reason: reason.trim() });
      setDetail(await adminApi.adminGetRideDetail({ tripId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end that ride.');
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <Card style={{ maxWidth: 760, width: '94%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div onClick={(e) => e.stopPropagation()}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 900, color: colors.text, margin: 0 }}>
              Ride file
            </h2>
            <button onClick={onClose} style={closeStyle}>
              ✕
            </button>
          </div>

          {error ? <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p> : null}
          {!d && !error ? <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p> : null}

          {d ? (
            <div style={{ display: 'grid', gap: 18 }}>
              <Section title="The ride">
                <Row label="Ride ID" value={d.ride.id} mono />
                <Row
                  label="Kind"
                  value={`${d.ride.rideType ?? '—'} · ${d.ride.pool ? 'ride sharing' : 'solo'}${
                    d.ride.poolVisibility ? ` (${d.ride.poolVisibility})` : ''
                  }`}
                />
                <Row label="State" value={(d.ride.status ?? '—').replace('_', ' ')} />
                {['requested', 'matched', 'arriving', 'arrived', 'in_progress'].includes(
                  d.ride.status ?? '',
                ) ? (
                  <Button variant="ghost" onClick={() => void forceEnd()}>
                    Force-end this ride
                  </Button>
                ) : null}
                <Row
                  label="Picked up at"
                  value={`${d.ride.pickup?.address ?? '—'}${
                    d.ride.pickup?.lat ? ` (${d.ride.pickup.lat}, ${d.ride.pickup.lng})` : ''
                  }`}
                />
                <Row
                  label="Dropped at"
                  value={`${d.ride.dropoff?.address ?? '—'}${
                    d.ride.dropoff?.lat ? ` (${d.ride.dropoff.lat}, ${d.ride.dropoff.lng})` : ''
                  }`}
                />
                {d.ride.lastDriverLocation ? (
                  <Row
                    label="Last GPS fix"
                    value={`${d.ride.lastDriverLocation.lat}, ${d.ride.lastDriverLocation.lng} · ${dateTime(
                      d.ride.lastDriverLocationMs,
                    )}`}
                  />
                ) : null}
                {d.ride.mergedIntoTripId ? (
                  <Row label="Merged into" value={d.ride.mergedIntoTripId} mono />
                ) : null}
              </Section>

              <Section title="Who drove">
                {d.driver ? (
                  <>
                    <Row label="On the ride" value={d.driver.nameAtRide ?? '—'} />
                    <Row label="Phone then" value={d.driver.phoneAtRide ?? '—'} />
                    <Row
                      label="Car then"
                      value={`${d.driver.vehicleAtRide ?? '—'} · ${d.driver.plateAtRide ?? '—'}`}
                    />
                    <Divider />
                    {/* Labelled as today's values on purpose — see the file header. */}
                    <Row label="Account now" value={d.driver.nameNow ?? '—'} />
                    <Row label="Phone now" value={d.driver.phoneNow ?? '—'} />
                    <Row label="CNIC" value={d.driver.cnic ?? '—'} />
                    <Row label="Licence" value={d.driver.licenseNumber ?? '—'} />
                    <Row
                      label="Car now"
                      value={`${d.driver.vehicleNow ?? '—'} · ${d.driver.plateNow ?? '—'}`}
                    />
                    <Row
                      label="Standing now"
                      value={`${d.driver.verificationStatusNow ?? '—'}${
                        d.driver.ratingNow
                          ? ` · ${d.driver.ratingNow} ★ from ${d.driver.ratingCountNow}`
                          : ''
                      }`}
                    />
                    <Row label="Driver UID" value={d.driver.uid} mono />
                  </>
                ) : (
                  <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                    No driver was ever assigned to this ride.
                  </p>
                )}
              </Section>

              <Section title={`Who was in the car (${d.riders.length})`}>
                {d.riders.length === 0 ? (
                  <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                    No rider roster was recorded.
                  </p>
                ) : (
                  d.riders.map((r, i) => (
                    <div
                      key={r.uid}
                      style={{
                        paddingTop: i === 0 ? 0 : 10,
                        marginTop: i === 0 ? 0 : 10,
                        borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`,
                      }}
                    >
                      <Row
                        label={i === 0 ? 'Booked the ride' : `Rider ${i + 1}`}
                        value={`${r.name ?? '(no name)'}${r.banned ? ' · BANNED' : ''}`}
                      />
                      <Row label="Phone" value={r.phone ?? '—'} />
                      <Row label="CNIC" value={r.cnic ?? '—'} />
                      <Row label="Gender" value={r.gender ?? '—'} />
                      <Row label="Paid" value={money(r.fareOnThisRide)} />
                      <Row
                        label="Ratings"
                        value={`drivers ${
                          r.driverGivenRating ?? '—'
                        } (${r.driverGivenRatingCount}) · co-riders ${
                          r.coRiderRating ?? '—'
                        } (${r.coRiderRatingCount})`}
                      />
                      <Row label="UID" value={r.uid} mono />
                    </div>
                  ))
                )}
              </Section>

              <Section title="When">
                <Row label="Requested" value={dateTime(d.timeline.requestedMs)} />
                <Row label="Driver arrived" value={dateTime(d.timeline.arrivedMs)} />
                <Row label="Journey started" value={dateTime(d.timeline.startedMs)} />
                <Row label="Completed" value={dateTime(d.timeline.completedMs)} />
                {d.timeline.cancelledMs ? (
                  <Row label="Cancelled" value={dateTime(d.timeline.cancelledMs)} />
                ) : null}
                <Row
                  label="Time in the car"
                  value={duration(
                    d.timeline.startedMs ?? d.timeline.arrivedMs,
                    d.timeline.completedMs,
                  )}
                />
              </Section>

              <Section title="Money">
                <Row label="Rider offered" value={money(d.money.offeredFare)} />
                <Row label="Agreed fare" value={money(d.money.fare)} />
                <Row
                  label="Paid by"
                  value={
                    d.money.paymentMethod ?? ((d.money.paymentMethods ?? []).join(', ') || '—')
                  }
                />
                {d.money.settlement ? (
                  <>
                    <Row label="Fare collected" value={money(d.money.settlement.grossFare)} />
                    <Row label="Commission" value={money(d.money.settlement.commission)} />
                    <Row label="Paid to driver" value={money(d.money.settlement.driverPayout)} />
                  </>
                ) : null}
                {d.money.perSeatFare ? (
                  <Row label="Per seat" value={money(d.money.perSeatFare)} />
                ) : null}
                {d.money.cancelReason || d.money.cancelledByRole ? (
                  <Row
                    label="Cancelled"
                    value={`by ${d.money.cancelledByRole ?? '—'}${
                      d.money.cancelReason ? ` · ${d.money.cancelReason}` : ''
                    }${
                      d.money.cancellationFee
                        ? ` · fee ${money(d.money.cancellationFee.amount)}`
                        : ''
                    }`}
                  />
                ) : null}
              </Section>

              {d.safetyEvents.length > 0 ? (
                <Section title={`Safety events (${d.safetyEvents.length})`}>
                  {d.safetyEvents.map((e) => (
                    <Row
                      key={e.id}
                      label={`${e.critical ? '🆘 ' : ''}${e.kind ?? 'event'}`}
                      value={`${e.status ?? '—'} · reported by the ${
                        e.reportedByRole ?? '—'
                      } · ${dateTime(e.createdAtMs)}${e.note ? ` · "${e.note}"` : ''}${
                        e.location ? ` · ${e.location.lat}, ${e.location.lng}` : ''
                      }`}
                    />
                  ))}
                </Section>
              ) : null}

              {d.disputes.length > 0 ? (
                <Section title={`Disputes (${d.disputes.length})`}>
                  {d.disputes.map((x) => (
                    <Row
                      key={x.id}
                      label={x.status ?? 'dispute'}
                      value={`${x.reason ?? '—'} · raised by ${x.raisedBy ?? '—'} · ${dateTime(
                        x.createdAtMs,
                      )}${x.resolution ? ` · ${x.resolution}` : ''}`}
                    />
                  ))}
                </Section>
              ) : null}

              {d.ratings.length > 0 ? (
                <Section title={`Ratings (${d.ratings.length})`}>
                  {/* Co-rider ratings are anonymous to the person rated. This is
                      the only place that is lifted, because the reason to lift it
                      is the complaint being investigated right now. */}
                  {d.ratings.map((r) => (
                    <Row
                      key={r.id}
                      label={`${r.stars ?? '—'} ★ · ${
                        r.targetRole === 'coRider' ? 'rider → rider' : `→ ${r.targetRole ?? '—'}`
                      }`}
                      value={`${r.raterId ?? '—'} → ${r.targetUid ?? '—'}${
                        r.comment ? ` · "${r.comment}"` : ''
                      }`}
                    />
                  ))}
                </Section>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <div style={{ display: 'grid', gap: 5 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
      <span style={{ color: colors.muted, fontSize: 12.5, minWidth: 130, flex: 'none' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: colors.text,
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: colors.border, margin: '6px 0' }} />;
}

const inputStyle: React.CSSProperties = {
  padding: '9px 13px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bg,
  color: colors.text,
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};

const chipStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  fontSize: 12.5,
  fontWeight: 800,
  cursor: 'pointer',
};

const pillStyle: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  background: `${colors.primary}14`,
  color: colors.primary,
  fontSize: 12.5,
  fontWeight: 800,
};

const personRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '8px 10px',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  background: colors.bg,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: colors.muted,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px',
  verticalAlign: 'top',
  color: colors.text,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: colors.muted,
  margin: '0 0 8px',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: '#00000099',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  padding: 16,
};

const closeStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 20,
  color: colors.muted,
  lineHeight: 1,
};
