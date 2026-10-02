'use client';

/**
 * Commission settings — the one page that decides what a driver pays and earns.
 *
 * Everything here writes to `config/commissionSettings`, which the backend
 * reads on every settlement (domain/commission.ts) and the driver app STREAMS
 * (useCommissionSettings). So a change saved on this page is live for every
 * open app within a second, with no deploy and no release: a new daily target,
 * a different bonus, a changed rate. That is the point of the page.
 *
 * ── TWO RULES THAT LOOK SMALL AND ARE NOT ───────────────────────────────────
 *
 * 1. **Every field is validated against the same range the backend validates
 *    against.** A value the backend rejects falls back to the DEFAULT there, so
 *    saving 200000 as a bonus here would not pay 200000 — it would silently pay
 *    2000 while this page said otherwise. The ranges are duplicated rather than
 *    imported because the backend is a separate package, so the comments name
 *    the file they must agree with.
 *
 * 2. **The anti-farming minimums default ON.** A flat bonus for a ride count is
 *    trivially gamed — a driver and one friend, fifteen minimum-fare rides
 *    around a car park, every day. The three minimums are what make the day
 *    have to be a real shift. They can all be set to 0 to switch them off, and
 *    the preview below spells out what that means before it is saved.
 */

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { colors } from '@/lib/config';
import { Button, Card } from '@/components/ui';

/** Mirrors DEFAULT_COMMISSION + DEFAULT_DAILY_TARGET on the backend. */
const DEFAULTS = {
  threshold: 5000,
  ratePct: 10,
  dailyTargetEnabled: true,
  dailyTargetRides: 15,
  dailyTargetBonus: 2000,
  dailyTargetWaivesCommission: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  dailyTargetMinDayFare: 2500,
};

export default function CommissionSettingsPage() {
  const [threshold, setThreshold] = useState(DEFAULTS.threshold);
  const [rate, setRate] = useState(DEFAULTS.ratePct); // percent here; saved as a fraction
  const [targetOn, setTargetOn] = useState(DEFAULTS.dailyTargetEnabled);
  const [targetRides, setTargetRides] = useState(DEFAULTS.dailyTargetRides);
  const [targetBonus, setTargetBonus] = useState(DEFAULTS.dailyTargetBonus);
  const [waives, setWaives] = useState(DEFAULTS.dailyTargetWaivesCommission);
  const [minRideFare, setMinRideFare] = useState(DEFAULTS.dailyTargetMinRideFare);
  const [minRiders, setMinRiders] = useState(DEFAULTS.dailyTargetMinRiders);
  const [minDayFare, setMinDayFare] = useState(DEFAULTS.dailyTargetMinDayFare);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'config', 'commissionSettings'))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (typeof d.threshold === 'number') setThreshold(d.threshold);
        if (typeof d.rate === 'number') setRate(Math.round(d.rate * 100));
        if (typeof d.dailyTargetEnabled === 'boolean') setTargetOn(d.dailyTargetEnabled);
        if (typeof d.dailyTargetRides === 'number') setTargetRides(d.dailyTargetRides);
        if (typeof d.dailyTargetBonus === 'number') setTargetBonus(d.dailyTargetBonus);
        if (typeof d.dailyTargetWaivesCommission === 'boolean') {
          setWaives(d.dailyTargetWaivesCommission);
        }
        if (typeof d.dailyTargetMinRideFare === 'number') setMinRideFare(d.dailyTargetMinRideFare);
        if (typeof d.dailyTargetMinRiders === 'number') setMinRiders(d.dailyTargetMinRiders);
        if (typeof d.dailyTargetMinDayFare === 'number') setMinDayFare(d.dailyTargetMinDayFare);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function touched() {
    setSaved(false);
    setError(null);
  }

  async function save() {
    // These bounds are the backend's bounds. See the file header.
    if (threshold < 100 || threshold > 1_000_000) {
      setError('Settle threshold must be between 100 and 1,000,000 PKR.');
      return;
    }
    if (rate < 1 || rate > 50) {
      setError('Commission rate must be between 1% and 50%.');
      return;
    }
    if (targetOn) {
      if (targetRides < 1 || targetRides > 100) {
        setError('Daily target must be between 1 and 100 rides.');
        return;
      }
      if (targetBonus < 0 || targetBonus > 50_000) {
        setError('Daily bonus must be between 0 and 50,000 PKR.');
        return;
      }
      if (minRideFare < 0 || minRideFare > 100_000) {
        setError('Minimum ride fare must be between 0 and 100,000 PKR.');
        return;
      }
      if (minRiders < 0 || minRiders > 100) {
        setError('Minimum different passengers must be between 0 and 100.');
        return;
      }
      if (minDayFare < 0 || minDayFare > 1_000_000) {
        setError('Minimum day fares must be between 0 and 1,000,000 PKR.');
        return;
      }
      // A day that cannot possibly satisfy its own rules pays nobody, and the
      // driver app would show a target with an impossible condition on it.
      if (minRideFare > 0 && minDayFare > 0 && minDayFare > minRideFare * targetRides) {
        setError(
          `Impossible target: ${targetRides} rides of at least ${minRideFare} PKR can only reach ` +
            `${(targetRides * minRideFare).toLocaleString()} PKR, but you require ` +
            `${minDayFare.toLocaleString()} PKR of fares. Lower the day total or the ride count.`,
        );
        return;
      }
      if (minRiders > targetRides) {
        setError(
          `Impossible target: you require ${minRiders} different passengers but only ` +
            `${targetRides} rides. A ride cannot carry more passengers than it has.`,
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(db, 'config', 'commissionSettings'),
        {
          threshold,
          rate: rate / 100,
          dailyTargetEnabled: targetOn,
          dailyTargetRides: targetRides,
          dailyTargetBonus: targetBonus,
          dailyTargetWaivesCommission: waives,
          dailyTargetMinRideFare: minRideFare,
          dailyTargetMinRiders: minRiders,
          dailyTargetMinDayFare: minDayFare,
        },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  const bonusPerRide = targetRides > 0 ? Math.round(targetBonus / targetRides) : 0;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Commission &amp; driver rewards</h1>
      <p style={{ color: colors.muted, marginBottom: 10 }}>
        What drivers pay us, and what they earn for a full day. Saved changes reach every
        open app within a second — no app update needed.
      </p>

      {error && <div style={{ color: colors.danger, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
      {saved && (
        <div style={{ color: colors.success, fontWeight: 700, marginBottom: 14 }}>
          ✓ Saved — live in every driver app now
        </div>
      )}

      {loading ? (
        <div style={{ color: colors.muted }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 20, maxWidth: 560 }}>
          {/* ── What drivers pay ── */}
          <Card>
            <h2 style={h2}>What drivers pay Velocity Rides</h2>
            <div style={{ display: 'grid', gap: 20, marginTop: 14 }}>
              <Field
                label="Commission rate (%)"
                hint="Velocity Rides' cut of the cash fares a driver collects. Commission on online rides is taken instantly at trip completion, so it is never charged twice."
              >
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={rate}
                  onChange={(e) => { setRate(Number(e.target.value)); touched(); }}
                  style={inputStyle}
                />
              </Field>
              <Field
                label="Settle threshold (PKR)"
                hint="A driver is asked to settle once the fares they have collected since their last payment reach this amount. Until then nothing is owed up front."
              >
                <input
                  type="number"
                  min={100}
                  step={500}
                  value={threshold}
                  onChange={(e) => { setThreshold(Number(e.target.value)); touched(); }}
                  style={inputStyle}
                />
              </Field>
            </div>
          </Card>

          {/* ── The daily target ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ ...h2, marginBottom: 0 }}>🎯 Daily ride target</h2>
              <Toggle
                on={targetOn}
                onChange={(v) => { setTargetOn(v); touched(); }}
                label={targetOn ? 'On' : 'Off'}
              />
            </div>
            <p style={{ color: colors.muted, fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              A driver who completes the target in one day (midnight to midnight,
              Pakistan time) earns a fixed <strong>bonus</strong>. The bonus is not cash
              and cannot be withdrawn — it pays their commission automatically, day after
              day, until it runs out.
            </p>
            <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
              To a driver this is always a <strong>bonus</strong>, never a &ldquo;commission&rdquo;.
              Commission is only ever what they pay us — opposite direction of money, so the
              two never share a word anywhere a driver can read it.
            </p>

            {targetOn && (
              <div style={{ display: 'grid', gap: 20, marginTop: 18 }}>
                <Field
                  label="Rides needed per day (the bonus threshold)"
                  hint="Cross this many qualifying rides in a day and the bonus activates. Qualifying means it cleared the minimums below."
                >
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={targetRides}
                    onChange={(e) => { setTargetRides(Number(e.target.value)); touched(); }}
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label="Bonus earned (PKR)"
                  hint={`Works out at about ${bonusPerRide.toLocaleString()} PKR per ride at this target.`}
                >
                  <input
                    type="number"
                    min={0}
                    max={50_000}
                    step={100}
                    value={targetBonus}
                    onChange={(e) => { setTargetBonus(Number(e.target.value)); touched(); }}
                    style={inputStyle}
                  />
                </Field>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <Toggle
                    on={waives}
                    onChange={(v) => { setWaives(v); touched(); }}
                    label="A target day is also commission-free"
                  />
                  <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
                    {waives ? (
                      <>
                        <strong>On.</strong> A driver who hits the target owes no commission on
                        that day&apos;s rides, so they keep the whole {targetBonus.toLocaleString()} PKR
                        bonus for other days. This is the more generous setting and it is the
                        one the programme was designed around.
                      </>
                    ) : (
                      <>
                        <strong>Off.</strong> Commission still accrues on a target day; the
                        bonus simply offsets it. Cheaper for us, and a driver who hits the
                        target sees most of their bonus go straight back into that same day.
                      </>
                    )}
                  </p>
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: colors.text, marginBottom: 4 }}>
                    Anti-farming minimums
                  </div>
                  <p style={{ color: colors.muted, fontSize: 12.5, marginBottom: 16, lineHeight: 1.6 }}>
                    Without these, a driver and one friend can book {targetRides} minimum-fare
                    rides around a car park and collect {targetBonus.toLocaleString()} PKR every
                    day. Set any of them to 0 to switch that check off.
                  </p>
                  <div style={{ display: 'grid', gap: 18 }}>
                    <Field
                      label="Minimum fare for a ride to count (PKR)"
                      hint="A ride below this still earns the driver their fare — it just does not count toward the target."
                    >
                      <input
                        type="number"
                        min={0}
                        step={25}
                        value={minRideFare}
                        onChange={(e) => { setMinRideFare(Number(e.target.value)); touched(); }}
                        style={inputStyle}
                      />
                    </Field>
                    <Field
                      label="Different passengers needed in the day"
                      hint="Stops the same friend riding fifteen times. Pool rides count every rider aboard."
                    >
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={minRiders}
                        onChange={(e) => { setMinRiders(Number(e.target.value)); touched(); }}
                        style={inputStyle}
                      />
                    </Field>
                    <Field
                      label="Total fares needed in the day (PKR)"
                      hint="The day has to look like a real shift, not fifteen trips round the block."
                    >
                      <input
                        type="number"
                        min={0}
                        step={250}
                        value={minDayFare}
                        onChange={(e) => { setMinDayFare(Number(e.target.value)); touched(); }}
                        style={inputStyle}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* ── What a driver actually experiences ── */}
          <Card>
            <h2 style={h2}>What a driver sees</h2>
            <ul style={listStyle}>
              <li>
                Every completed ride adds its fare to the driver&apos;s cycle. At{' '}
                <strong>{threshold.toLocaleString()} PKR</strong> of fares they are asked to settle
                — they transfer <strong>{rate}%</strong> of the cash they collected and upload a
                screenshot, which an AI check clears in seconds.
              </li>
              {targetOn ? (
                <>
                  <li>
                    <strong>{targetRides} qualifying rides in a day</strong> earns{' '}
                    a <strong>{targetBonus.toLocaleString()} PKR bonus</strong>
                    {waives ? ', and that day costs them no commission at all' : ''}.
                  </li>
                  <li>
                    The bonus pays their next commission by itself. A driver holding{' '}
                    {targetBonus.toLocaleString()} PKR who later owes{' '}
                    {Math.round(targetBonus / 2).toLocaleString()} PKR pays <strong>nothing</strong>
                    {' '}— it comes off the bonus, and they are never locked out until it reaches zero.
                  </li>
                  <li>
                    The bonus <strong>cannot be withdrawn as cash</strong>. That is a regulatory
                    line, not a preference — money we can hand out and they can cash out would
                    make us an e-money issuer.
                  </li>
                  <li>
                    Their app shows the live count and names every unmet condition, so a day
                    that will not pay out says so while there is still time to fix it.
                  </li>
                </>
              ) : (
                <li>
                  The daily target is <strong>off</strong>. Drivers see no target card and earn no
                  bonus; an existing bonus still pays their commission until it runs out.
                </li>
              )}
            </ul>
            <p style={{ color: colors.muted, fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
              Need to grant or claw back a bonus for one driver by hand — a cash payment at
              the office, or a bonus a bug lost? Use the Driver approvals page; there is no
              gateway top-up yet, so that is the manual lever.
            </p>
          </Card>

          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <p style={{ color: colors.muted, fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>{hint}</p>
      {children}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontSize: 13,
        fontWeight: 700,
        color: colors.text,
      }}
    >
      <span
        style={{
          width: 42,
          height: 24,
          borderRadius: 12,
          background: on ? colors.success : colors.border,
          position: 'relative',
          transition: 'background 140ms',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: '#fff',
            transition: 'left 140ms',
          }}
        />
      </span>
      {label}
    </button>
  );
}

const h2: React.CSSProperties = { fontSize: 16, fontWeight: 900, color: colors.text, marginBottom: 0 };
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: colors.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  color: colors.text,
  fontSize: 16,
  fontWeight: 700,
  boxSizing: 'border-box',
};
const listStyle: React.CSSProperties = {
  color: colors.muted,
  fontSize: 13,
  paddingLeft: 18,
  margin: '12px 0 0',
  lineHeight: 1.8,
};
