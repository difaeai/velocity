'use client';

/**
 * The page a rider's family opens — "where is she right now".
 *
 * ── WHO THIS IS FOR, AND WHY THAT DECIDES EVERYTHING ────────────────────────
 *
 * Not a user of the app. Somebody's mother, with a WhatsApp message, on a cheap
 * Android phone, possibly worried. So:
 *
 *   · no sign-in, no app, no install prompt. The token in the URL is the whole
 *     credential, resolved server-side by `getTripWatch`.
 *   · no app-store bounce. `/link/*` exists to push people into the app; doing
 *     that here would be answering "where is my daughter" with "download this".
 *   · the plate and the driver's phone number are the two largest things on the
 *     screen after the status, because they are what a frightened person needs
 *     to read out loud to somebody.
 *   · the police number is always visible. Not behind a tab.
 *
 * ── WHY IT POLLS INSTEAD OF STREAMING ───────────────────────────────────────
 *
 * The trip document is not publicly readable and must never be: a trip holds
 * both uids, both phone numbers and the whole fare breakdown. A Firestore
 * listener would mean a public read rule on `trips`. So this calls the callable
 * on a timer and gets back a redacted view that cannot widen when somebody adds
 * a field to a trip. Ten seconds is well inside the driver's own beacon
 * interval, so it is never the thing making the dot stale.
 *
 * Polling stops the moment the ride is over — there is nothing left to watch,
 * and a dead tab left open on somebody's phone should not keep calling a
 * function all night.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import { VelocityMark } from '@/components/BrandMark';

/** How often the position refreshes while the ride is live. */
const POLL_MS = 10_000;

interface TripWatchView {
  status: string;
  live: boolean;
  rider: string | null;
  pickup: { address: string | null; lat: number | null; lng: number | null };
  dropoff: { address: string | null; lat: number | null; lng: number | null };
  driver: {
    name: string | null;
    phone: string | null;
    vehicleLabel: string | null;
    plate: string | null;
    rating: number | null;
  } | null;
  location: { lat: number; lng: number; ageSec: number } | null;
  fare: number | null;
  pool: boolean;
  riders: string[];
  startedAt: number | null;
  completedAt: number | null;
  safetyAlert: boolean;
  updatedAt: number;
}

const STATUS_TEXT: Record<string, { title: string; body: string }> = {
  requested: { title: 'Looking for a driver', body: 'No driver has been assigned yet.' },
  matched: { title: 'Driver confirmed', body: 'The driver is on the way to the pickup point.' },
  arriving: { title: 'Driver on the way', body: 'The car is heading to the pickup point now.' },
  arrived: { title: 'Driver has arrived', body: 'The car is waiting at the pickup point.' },
  in_progress: { title: 'On the way', body: 'The trip is in progress.' },
  completed: { title: 'Arrived safely', body: 'The trip finished. This link will stop working shortly.' },
  cancelled: { title: 'Trip cancelled', body: 'This trip was cancelled.' },
  merged: { title: 'Moved to a shared ride', body: 'This rider joined a shared car.' },
};

function freshness(ageSec: number): { text: string; stale: boolean } {
  if (ageSec < 0) return { text: 'position time unknown', stale: true };
  if (ageSec < 45) return { text: 'updated just now', stale: false };
  if (ageSec < 180) return { text: `updated ${Math.round(ageSec / 60)} min ago`, stale: false };
  if (ageSec < 3600) return { text: `last seen ${Math.round(ageSec / 60)} min ago`, stale: true };
  return { text: `last seen ${Math.round(ageSec / 3600)} h ago`, stale: true };
}

export default function WatchTripPage() {
  const params = useParams<{ token?: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [trip, setTrip] = useState<TripWatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Held in a ref so the poll loop does not need to be torn down and rebuilt
  // every time the status changes.
  const liveRef = useRef(true);

  const load = useCallback(async () => {
    if (!token) {
      setError('This link is incomplete. Ask them to share it again from the app.');
      setLoading(false);
      return;
    }
    try {
      const fn = httpsCallable<{ token: string }, { ok: boolean; trip: TripWatchView }>(
        functions,
        'getTripWatch',
      );
      const res = await fn({ token });
      setTrip(res.data.trip);
      liveRef.current = res.data.trip.live;
      setError(null);
    } catch {
      // One message for unknown, revoked and expired — see trips/watch.ts. A
      // more specific error would confirm a guessed token to a stranger.
      setError('This tracking link is no longer active.');
      liveRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [token]);

  // The first load runs on the timer's leading edge rather than in the effect
  // body: `load` sets state, and calling it synchronously here would be a
  // cascading render on mount. A microtask is enough to get it out of the
  // render pass and is invisible to the person waiting.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled && liveRef.current) void load();
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const status = trip ? STATUS_TEXT[trip.status] ?? { title: trip.status, body: '' } : null;
  const fix = trip?.location ? freshness(trip.location.ageSec) : null;
  const mapsUrl = trip?.location
    ? `https://www.google.com/maps/search/?api=1&query=${trip.location.lat},${trip.location.lng}`
    : null;

  return (
    <main style={st.page}>
      <div style={st.card}>
        <div style={st.logoRow}>
          <VelocityMark size={26} style={{ color: '#ccff00' }} />
          <span style={st.brand}>Velocity Rides</span>
        </div>

        {loading && !trip ? (
          <p style={st.sub}>Loading the ride…</p>
        ) : error ? (
          <>
            <h1 style={st.title}>Link not active</h1>
            <p style={st.sub}>{error}</p>
            <p style={st.sub}>
              A tracking link works while the ride is running and for a short time after it
              ends. Ask them to share a new one from the app.
            </p>
          </>
        ) : trip && status ? (
          <>
            {trip.safetyAlert && (
              <div style={st.alertBox}>
                ⚠️ A safety alert was raised on this ride. Velocity Rides&apos; safety team has
                been notified. If anyone is in danger, call <strong>15</strong>.
              </div>
            )}

            <h1 style={st.title}>
              {trip.rider ? `${trip.rider}'s ride` : 'Live ride'}
            </h1>
            <div style={trip.live ? st.statusLive : st.statusDone}>
              <div style={st.statusTitle}>{status.title}</div>
              <div style={st.statusBody}>{status.body}</div>
            </div>

            {/* ── Where the car is ── */}
            {trip.location ? (
              <div style={st.block}>
                <div style={st.blockLabel}>CAR POSITION</div>
                <div style={{ ...st.fresh, color: fix?.stale ? '#f0a020' : '#9ae600' }}>
                  ● {fix?.text}
                </div>
                <a style={st.mapBtn} href={mapsUrl ?? '#'} target="_blank" rel="noreferrer">
                  Open the car&apos;s position in Google Maps
                </a>
                <div style={st.coords}>
                  {trip.location.lat.toFixed(5)}, {trip.location.lng.toFixed(5)}
                </div>
              </div>
            ) : (
              <div style={st.block}>
                <div style={st.blockLabel}>CAR POSITION</div>
                <div style={st.sub}>
                  {trip.live
                    ? 'No position reported yet. It appears once the driver starts moving.'
                    : 'The ride has finished.'}
                </div>
              </div>
            )}

            {/* ── The car and the driver ── the two things worth reading out ── */}
            {trip.driver ? (
              <div style={st.block}>
                <div style={st.blockLabel}>DRIVER &amp; CAR</div>
                <div style={st.plate}>{trip.driver.plate || '—'}</div>
                <div style={st.driverLine}>
                  {trip.driver.name ?? 'Driver'}
                  {trip.driver.vehicleLabel ? ` · ${trip.driver.vehicleLabel}` : ''}
                  {trip.driver.rating ? ` · ${trip.driver.rating}★` : ''}
                </div>
                {trip.driver.phone && (
                  <a style={st.callBtn} href={`tel:${trip.driver.phone}`}>
                    📞 Call the driver — {trip.driver.phone}
                  </a>
                )}
              </div>
            ) : null}

            {/* ── The journey ── */}
            <div style={st.block}>
              <div style={st.blockLabel}>JOURNEY</div>
              <div style={st.routeRow}>
                <span style={st.dotFrom} />
                <span style={st.routeTxt}>{trip.pickup.address ?? 'Pickup point'}</span>
              </div>
              <div style={st.routeRow}>
                <span style={st.dotTo} />
                <span style={st.routeTxt}>{trip.dropoff.address ?? 'Destination'}</span>
              </div>
              {trip.pool && (
                <div style={st.poolNote}>
                  🔀 Shared ride
                  {trip.riders.length > 0 ? ` · also aboard: ${trip.riders.join(', ')}` : ''}
                </div>
              )}
            </div>

            {/* ── Emergency ── always visible, never behind anything ── */}
            <div style={st.emergency}>
              <div style={st.blockLabel}>IN AN EMERGENCY</div>
              <div style={st.emergencyRow}>
                <a style={st.police} href="tel:15">
                  🚨 Police 15
                </a>
                <a style={st.rescue} href="tel:1122">
                  🚑 Rescue 1122
                </a>
              </div>
              <div style={st.emergencyNote}>
                Read the number plate above to the operator. For an online scam, report it to
                Pakistan&apos;s cybercrime agency NCCIA on 1799.
              </div>
            </div>

            <p style={st.footer}>
              This link was shared by the rider and shows only this ride. It stops working
              when the trip ends.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    background: '#0d0f0a',
    padding: 16,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: '#161910',
    border: '1px solid #2a2f1e',
    borderRadius: 20,
    padding: 22,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    marginTop: 20,
    marginBottom: 20,
  },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brand: { fontSize: 19, fontWeight: 900, color: '#ccff00', letterSpacing: 0.4 },
  title: { fontSize: 21, fontWeight: 800, color: '#f2f4ec', margin: 0, textAlign: 'center' },
  sub: { fontSize: 13.5, color: '#9aa08a', margin: 0, lineHeight: 1.6, textAlign: 'center' },

  alertBox: {
    background: '#3a1414',
    border: '1px solid #ef4444',
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: '#fecaca',
    lineHeight: 1.6,
  },

  statusLive: {
    background: '#1d2214',
    border: '1px solid #4d5a2a',
    borderRadius: 14,
    padding: 14,
    textAlign: 'center',
  },
  statusDone: {
    background: '#1a1c18',
    border: '1px solid #2a2f1e',
    borderRadius: 14,
    padding: 14,
    textAlign: 'center',
  },
  statusTitle: { fontSize: 17, fontWeight: 900, color: '#ccff00' },
  statusBody: { fontSize: 13, color: '#9aa08a', marginTop: 4, lineHeight: 1.5 },

  block: {
    background: '#1a1c18',
    border: '1px solid #2a2f1e',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  blockLabel: { fontSize: 10, fontWeight: 900, color: '#6f7a5e', letterSpacing: 1.3 },
  fresh: { fontSize: 12.5, fontWeight: 800 },
  mapBtn: {
    display: 'block',
    padding: '12px 14px',
    borderRadius: 11,
    background: '#ccff00',
    color: '#111400',
    fontSize: 14,
    fontWeight: 800,
    textDecoration: 'none',
    textAlign: 'center',
  },
  coords: { fontSize: 11, color: '#6f7a5e', fontFamily: 'ui-monospace, monospace', textAlign: 'center' },

  plate: {
    fontSize: 28,
    fontWeight: 900,
    color: '#f2f4ec',
    letterSpacing: 2.5,
    textAlign: 'center',
    background: '#0f110c',
    border: '1px solid #3a4028',
    borderRadius: 10,
    padding: '9px 0',
  },
  driverLine: { fontSize: 14, color: '#e6e9dd', textAlign: 'center', fontWeight: 600 },
  callBtn: {
    display: 'block',
    padding: '12px 14px',
    borderRadius: 11,
    border: '1px solid #3a4028',
    background: 'transparent',
    color: '#e6e9dd',
    fontSize: 14,
    fontWeight: 700,
    textDecoration: 'none',
    textAlign: 'center',
  },

  routeRow: { display: 'flex', alignItems: 'flex-start', gap: 9 },
  dotFrom: {
    width: 9,
    height: 9,
    borderRadius: 5,
    background: '#ccff00',
    marginTop: 5,
    flexShrink: 0,
  },
  dotTo: {
    width: 9,
    height: 9,
    borderRadius: 2,
    background: '#9aa08a',
    marginTop: 5,
    flexShrink: 0,
  },
  routeTxt: { fontSize: 13.5, color: '#e6e9dd', lineHeight: 1.5 },
  poolNote: { fontSize: 12, color: '#9aa08a', marginTop: 2 },

  emergency: {
    background: '#2a1212',
    border: '1px solid #5a2323',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
  },
  emergencyRow: { display: 'flex', gap: 8 },
  police: {
    flex: 1,
    padding: '13px 10px',
    borderRadius: 11,
    background: '#ef4444',
    color: '#fff',
    fontSize: 14.5,
    fontWeight: 900,
    textDecoration: 'none',
    textAlign: 'center',
  },
  rescue: {
    flex: 1,
    padding: '13px 10px',
    borderRadius: 11,
    border: '1px solid #5a2323',
    color: '#fecaca',
    fontSize: 14.5,
    fontWeight: 800,
    textDecoration: 'none',
    textAlign: 'center',
  },
  emergencyNote: { fontSize: 11.5, color: '#c09090', lineHeight: 1.6 },

  footer: { fontSize: 11, color: '#6f7a5e', textAlign: 'center', lineHeight: 1.6, margin: 0 },
};
