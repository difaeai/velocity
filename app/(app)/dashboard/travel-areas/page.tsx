'use client';

/**
 * Travel demand: people going from one area to another, entered by an admin.
 *
 * The app's "Locations people are traveling to" list (home map, and the
 * driver's "Heading somewhere?" screen) comes from `getTravelAreas`, which
 * merges these seeds with riders' real saved routes. Each seeded man or woman
 * counts as one person in that list, so a seed and a real route between the
 * same two areas land in the same row. No app release is involved.
 *
 * Only area names leave the server, but a seed still needs a point so the app
 * can show it to riders near it: the typed area is geocoded once, on add, and
 * rounded to two decimals (about 1 km), an area and not an address.
 */

import { useEffect, useState } from 'react';
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { adminApi } from '@/lib/api';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

interface Place {
  lat: number;
  lng: number;
  address: string;
}

/** Shaped like a saved daily route, so the backend parses both the same way. */
interface Seed {
  pickup: Place;
  dropoff: Place;
  male: number;
  female: number;
  time: string | null;
  addedAt: number;
}

const SEEDS = doc(db, 'adminConfig', 'travelAreas');

const round = (n: number) => Math.round(n * 100) / 100;
const count = (v: string) => Math.min(99, Math.max(0, Math.floor(Number(v) || 0)));

async function locate(text: string): Promise<Place> {
  const res = await adminApi.geocodeAddress({ text });
  if (!res.configured) throw new Error('Place lookup is not configured on the server.');
  if (!res.detail) throw new Error(`Could not find "${text}". Add the city, e.g. "F-7, Islamabad".`);
  return { lat: round(res.detail.lat), lng: round(res.detail.lng), address: text };
}

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  color: colors.text,
  fontSize: 14,
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 4 };

export default function TravelDemandPage() {
  const [seeds, setSeeds] = useState<Seed[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [male, setMale] = useState('0');
  const [female, setFemale] = useState('0');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => onSnapshot(SEEDS, (s) => setSeeds((s.get('seeds') as Seed[] | undefined) ?? []), (e) => setError(e.message)),
    [],
  );

  const people = count(male) + count(female);
  const ready = from.trim() !== '' && to.trim() !== '' && people > 0;

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const [pickup, dropoff] = await Promise.all([locate(from.trim()), locate(to.trim())]);
      const seed: Seed = { pickup, dropoff, male: count(male), female: count(female), time: time || null, addedAt: Date.now() };
      await setDoc(SEEDS, { seeds: arrayUnion(seed) }, { merge: true });
      setFrom('');
      setTo('');
      setMale('0');
      setFemale('0');
      setTime('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(seed: Seed) {
    if (!window.confirm(`Remove ${seed.pickup.address} → ${seed.dropoff.address}?`)) return;
    setError(null);
    try {
      await setDoc(SEEDS, { seeds: arrayRemove(seed) }, { merge: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove.');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Travel demand</h1>
      <p style={{ color: colors.muted, marginBottom: 20, maxWidth: 720 }}>
        Add how many men and women travel from one area to another. They show in the app&apos;s
        &quot;Locations people are traveling to&quot; list, together with riders&apos; real saved
        routes, for everyone within 25 km of the pickup area. Area names only, never an exact place.
        Live instantly, no app update.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}

      <Card style={{ maxWidth: 640, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <div>
            <label htmlFor="from" style={label}>From area</label>
            <input id="from" value={from} maxLength={80} placeholder="F-7, Islamabad" onChange={(e) => setFrom(e.target.value)} style={input} />
          </div>
          <div>
            <label htmlFor="to" style={label}>To area</label>
            <input id="to" value={to} maxLength={80} placeholder="Blue Area, Islamabad" onChange={(e) => setTo(e.target.value)} style={input} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginTop: 14 }}>
          <div>
            <label htmlFor="male" style={label}>♂ Men</label>
            <input id="male" type="number" min={0} max={99} value={male} onChange={(e) => setMale(e.target.value)} style={input} />
          </div>
          <div>
            <label htmlFor="female" style={label}>♀ Women</label>
            <input id="female" type="number" min={0} max={99} value={female} onChange={(e) => setFemale(e.target.value)} style={input} />
          </div>
          <div>
            <label htmlFor="time" style={label}>Time (optional)</label>
            <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: colors.muted, margin: '8px 0 14px', lineHeight: 1.5 }}>
          Write the area, then the city. The app shows the area part only (&quot;F-7&quot;), so use
          the same spelling riders&apos; addresses use and the counts join their row.
        </div>
        <Button onClick={add} disabled={busy || !ready}>
          {busy ? 'Adding…' : `Add ${people || ''} ${people === 1 ? 'person' : 'people'}`}
        </Button>
      </Card>

      {seeds === null ? (
        <div style={{ color: colors.muted }}>Loading…</div>
      ) : seeds.length === 0 ? (
        <div style={{ color: colors.muted }}>Nothing added yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
          {[...seeds].sort((a, b) => b.addedAt - a.addedAt).map((s) => (
            <Card key={s.addedAt}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 800 }}>
                    {s.pickup.address} → {s.dropoff.address}
                  </div>
                  <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                    {s.male > 0 && `♂ ${s.male}  `}
                    {s.female > 0 && `♀ ${s.female}  `}
                    · {s.time ?? 'any time'} ·{' '}
                    {[s.pickup, s.dropoff].map((p, i) => (
                      <a
                        key={i}
                        href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: colors.secondary, marginRight: 8 }}
                      >
                        {i === 0 ? 'from on map' : 'to on map'}
                      </a>
                    ))}
                  </div>
                </div>
                <Button variant="danger" onClick={() => remove(s)}>Remove</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
