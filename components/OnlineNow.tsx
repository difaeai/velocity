'use client';

/**
 * ONLINE — the first box on Overview (owner, 2026-11-16).
 *
 * Everything else on this page is history: what happened over thirty days. This
 * one is the present tense, and it exists because supply and demand failing to
 * find each other is invisible in a monthly chart. A driver parked in Blue Area
 * and three people on the home screen a kilometre away is the most expensive
 * thing that can happen to a ride-hailing company, and it looks like nothing at
 * all until somebody can see both halves on one screen.
 *
 * So: one row per area with both sides counted, then the two lists themselves,
 * and a button that tells either side the other is there. The same message goes
 * out by itself every half hour where the two sides overlap — this box is where
 * that gets switched off, and the only place it can be.
 *
 * Areas come from our own map (velocityLocations); until a city has pins in it
 * every row there says the city's name. Nothing here shows a coordinate: the
 * desk gets an area, which is enough to dispatch and not enough to follow
 * somebody home.
 */

import { useCallback, useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { glass } from '@/components/ui';
import { onlineApi, type OnlineNowPayload, type OnlineRow } from '@/lib/api';

/** Live means live: the lists go stale within a couple of minutes. */
const POLL_MS = 60_000;

type Audience = 'passengers' | 'drivers' | 'both';

interface Composing {
  /** null = everybody online, wherever they are. */
  area: string | null;
  to: Audience;
  title: string;
  body: string;
}

const ago = (ms: number) => {
  if (!ms) return '—';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return mins < 1 ? 'just now' : `${mins}m ago`;
};

export function OnlineNow() {
  const [data, setData] = useState<OnlineNowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const [sending, setSending] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);

  const load = useCallback(() => {
    onlineApi
      .now({})
      .then((p) => {
        setData(p);
        setError(null);
        setAuto((a) => a ?? p.autoAlerts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read who is online.'));
  }, []);

  // A dashboard left open on a second monitor must not poll all night: a tab
  // nobody is looking at is skipped, and reads once when it comes back.
  useEffect(() => {
    load();
    const every = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const back = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(every);
      document.removeEventListener('visibilitychange', back);
    };
  }, [load]);

  /** The switch is the one kill for the automatic half, so it writes straight through. */
  async function toggleAuto(on: boolean) {
    setAuto(on);
    try {
      await setDoc(doc(db, 'adminConfig', 'areaAlerts'), { enabled: on }, { merge: true });
      setNote(
        on
          ? 'Back on — every half hour, people and drivers in the same area are told about each other.'
          : 'Off. Nothing goes out on its own; the Tell them buttons still work.',
      );
    } catch (e) {
      setAuto(!on);
      setError(e instanceof Error ? e.message : 'Could not save that.');
    }
  }

  async function send() {
    if (!composing) return;
    setSending(true);
    setError(null);
    try {
      const { sent } = await onlineApi.notify(composing);
      setNote(
        sent === 0
          ? 'Nobody was still online by the time it went — nothing was sent.'
          : `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`,
      );
      setComposing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  }

  const open = (area: string | null, to: Audience, drivers: number, passengers: number) =>
    setComposing({
      area,
      to,
      title: to === 'drivers' ? 'Riders are out near you' : 'Cars are on the road near you',
      body:
        to === 'drivers'
          ? `${passengers} ${passengers === 1 ? 'person is' : 'people are'} using the app in ${area ?? 'your area'} right now. Stay online — a request is likely.`
          : `${drivers} ${drivers === 1 ? 'driver is' : 'drivers are'} online in ${area ?? 'your area'} right now. Book a ride and one of them will take it.`,
    });

  const totals = data?.totals;

  return (
    <section style={{ ...glass, borderRadius: 16, padding: 18, marginBottom: 18 }} aria-labelledby="online-h">
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 id="online-h" style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.08em', margin: 0 }}>
          ONLINE
        </h2>
        <span style={dot(totals ? totals.drivers + totals.passengers > 0 : false)} aria-hidden />
        <span style={{ color: colors.muted, fontSize: 12.5 }}>
          {data ? `Updated ${ago(data.generatedAt)}` : 'Reading…'}
        </span>

        <label
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            fontWeight: 700,
            color: auto === false ? colors.muted : colors.primary,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={auto !== false}
            onChange={(e) => toggleAuto(e.target.checked)}
            style={{ accentColor: colors.primary, width: 16, height: 16 }}
          />
          Tell them automatically
        </label>
      </header>

      <p style={{ color: colors.muted, fontSize: 13, margin: '0 0 14px' }}>
        {totals
          ? `${totals.drivers} ${totals.drivers === 1 ? 'driver' : 'drivers'} and ${totals.passengers} ${
              totals.passengers === 1 ? 'passenger' : 'passengers'
            } are online across ${data!.areas.length} ${data!.areas.length === 1 ? 'area' : 'areas'}` +
            (data!.matched > 0
              ? ` — ${data!.matched} where both are, and each side can be told.`
              : '. No area has both sides in it yet.')
          : 'Who has the app open right now, and where.'}
      </p>

      {error ? <p style={{ color: colors.danger, fontSize: 13, marginTop: 0 }}>{error}</p> : null}
      {note ? <p style={{ color: colors.success, fontSize: 13, fontWeight: 700, marginTop: 0 }}>{note}</p> : null}

      {data && data.areas.length === 0 ? (
        <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
          Nobody is online this minute. Drivers appear here while their shift is on, passengers while the app is open
          in front of them.
        </p>
      ) : null}

      {data && data.areas.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ color: colors.muted, fontSize: 11.5, textAlign: 'left', letterSpacing: '.04em' }}>
              <th style={th}>AREA</th>
              <th style={{ ...th, textAlign: 'right' }}>DRIVERS</th>
              <th style={{ ...th, textAlign: 'right' }}>PASSENGERS</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {data.areas.map((a) => {
              const both = a.drivers > 0 && a.passengers > 0;
              return (
                <tr key={a.area} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {a.area}
                    {both ? (
                      <span style={{ ...pill, background: '#e3f4ea', color: colors.success }}>both sides here</span>
                    ) : null}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.drivers}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.passengers}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.passengers > 0 ? (
                      <button style={linkBtn} onClick={() => open(a.area, 'passengers', a.drivers, a.passengers)}>
                        Tell the passengers
                      </button>
                    ) : null}
                    {a.drivers > 0 ? (
                      <button style={linkBtn} onClick={() => open(a.area, 'drivers', a.drivers, a.passengers)}>
                        Tell the drivers
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {/* The two lists, separately, each person with the area they are in. */}
      {data && (data.drivers.length > 0 || data.passengers.length > 0) ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginTop: 18,
          }}
        >
          <People title="Drivers online" rows={data.drivers} total={data.totals.drivers} />
          <People title="Passengers online" rows={data.passengers} total={data.totals.passengers} />
        </div>
      ) : null}

      {composing ? (
        <Composer
          composing={composing}
          sending={sending}
          onChange={setComposing}
          onCancel={() => setComposing(null)}
          onSend={send}
        />
      ) : null}
    </section>
  );
}

function People({ title, rows, total }: { title: string; rows: OnlineRow[]; total: number }) {
  return (
    <div>
      <h3 style={{ fontSize: 12.5, fontWeight: 800, margin: '0 0 8px' }}>
        {title} <span style={{ color: colors.muted, fontWeight: 600 }}>({total})</span>
      </h3>
      {rows.length === 0 ? (
        <p style={{ color: colors.muted, fontSize: 12.5, margin: 0 }}>Nobody right now.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {rows.map((r) => (
            <li
              key={r.uid}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, padding: '4px 0' }}
            >
              <strong style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.name}
              </strong>
              <span style={{ color: colors.muted, fontSize: 12.5 }}>{r.area}</span>
              <span style={{ color: colors.muted, fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {ago(r.lastSeenMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length ? (
        <p style={{ color: colors.muted, fontSize: 12, marginBottom: 0 }}>+{total - rows.length} more</p>
      ) : null}
    </div>
  );
}

/** Written here, sent to whoever is in that area at the moment Send is pressed. */
function Composer({
  composing,
  sending,
  onChange,
  onCancel,
  onSend,
}: {
  composing: Composing;
  sending: boolean;
  onChange: (c: Composing) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const who: Audience[] = ['passengers', 'drivers', 'both'];
  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: 13.5 }}>
          Send to {composing.area ?? 'everybody online'}
        </strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {who.map((w) => (
            <button
              key={w}
              onClick={() => onChange({ ...composing, to: w })}
              style={{
                border: `1px solid ${w === composing.to ? colors.primary : colors.border}`,
                background: w === composing.to ? `${colors.primary}12` : 'transparent',
                color: w === composing.to ? colors.primary : colors.muted,
                borderRadius: 999,
                padding: '4px 11px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <input
        value={composing.title}
        maxLength={80}
        onChange={(e) => onChange({ ...composing, title: e.target.value })}
        aria-label="Notification title"
        style={field}
      />
      <textarea
        value={composing.body}
        maxLength={300}
        rows={2}
        onChange={(e) => onChange({ ...composing, body: e.target.value })}
        aria-label="Notification message"
        style={{ ...field, resize: 'vertical' }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onSend}
          disabled={sending || composing.title.trim().length < 2 || composing.body.trim().length < 2}
          style={{
            border: 'none',
            background: colors.primary,
            color: '#fff',
            borderRadius: 10,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? 'Sending…' : 'Send it now'}
        </button>
        <button onClick={onCancel} style={{ ...linkBtn, marginRight: 0 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const dot = (live: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: live ? colors.success : colors.border,
});

const th: React.CSSProperties = { padding: '0 8px 6px 0', fontWeight: 700 };
const td: React.CSSProperties = { padding: '8px 8px 8px 0', verticalAlign: 'middle' };

const pill: React.CSSProperties = {
  marginLeft: 8,
  borderRadius: 999,
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 800,
};

const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: colors.secondary,
  fontWeight: 700,
  fontSize: 12.5,
  cursor: 'pointer',
  marginRight: 10,
  padding: 0,
};

const field: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: '8px 11px',
  fontSize: 13.5,
  fontFamily: 'inherit',
  marginBottom: 8,
  background: '#fff',
};
