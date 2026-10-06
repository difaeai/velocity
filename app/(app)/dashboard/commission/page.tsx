'use client';

/**
 * Commission settings — the one page that decides what a driver pays.
 *
 * Everything here writes to `config/commissionSettings`, which the backend
 * reads on every settlement (domain/commission.ts) and the driver app STREAMS
 * (useCommissionSettings). So a change saved on this page is live for every
 * open app within a second, with no deploy and no release: a new daily target,
 * a changed rate, pool-only on or off. That is the point of the page.
 *
 * ── THE RULE THIS PAGE CONFIGURES ───────────────────────────────────────────
 *
 * A DAY is the unit. Sixteen qualifying pool rides in one Pakistan day and that
 * day costs the driver no commission at all. Fewer, and the day owes the rate
 * below on the cash it took — payable the moment the day closes at midnight,
 * and the driver cannot take new rides until they clear it.
 *
 * There is no "settle threshold" any more. There used to be a PKR 5,000 one
 * that locked a driver as soon as their unsettled fares passed it, and it had to
 * go: a driver needs the WHOLE day to reach sixteen rides, and at intercity
 * fares that threshold fired around the fourth one. It would have locked every
 * driver short of the exact thing it was meant to reward.
 *
 * ── TWO RULES THAT LOOK SMALL AND ARE NOT ───────────────────────────────────
 *
 * 1. **Every field is validated against the same range the backend validates
 *    against.** A value the backend rejects falls back to the DEFAULT there, so
 *    saving 200000 as a bonus here would not pay 200000 — it would silently pay
 *    0 while this page said otherwise. The ranges are duplicated rather than
 *    imported because the backend is a separate package, so the comments name
 *    the file they must agree with.
 *
 * 2. **The anti-farming minimums default ON.** A free day for a ride count is
 *    trivially gamed — a driver and one friend, sixteen minimum-fare rides
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
  ratePct: 5,
  dailyTargetEnabled: true,
  dailyTargetRides: 16,
  // No separate cash bonus: the commission-free day is the reward.
  dailyTargetBonus: 0,
  dailyTargetWaivesCommission: true,
  dailyTargetPoolOnly: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  dailyTargetMinDayFare: 2000,
};

export default function CommissionSettingsPage() {
  const [rate, setRate] = useState(DEFAULTS.ratePct); // percent here; saved as a fraction
  const [targetOn, setTargetOn] = useState(DEFAULTS.dailyTargetEnabled);
  const [targetRides, setTargetRides] = useState(DEFAULTS.dailyTargetRides);
  const [targetBonus, setTargetBonus] = useState(DEFAULTS.dailyTargetBonus);
  const [waives, setWaives] = useState(DEFAULTS.dailyTargetWaivesCommission);
  const [poolOnly, setPoolOnly] = useState(DEFAULTS.dailyTargetPoolOnly);
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
        if (typeof d.rate === 'number') setRate(Math.round(d.rate * 100));
        if (typeof d.dailyTargetEnabled === 'boolean') setTargetOn(d.dailyTargetEnabled);
        if (typeof d.dailyTargetRides === 'number') setTargetRides(d.dailyTargetRides);
        if (typeof d.dailyTargetBonus === 'number') setTargetBonus(d.dailyTargetBonus);
        if (typeof d.dailyTargetWaivesCommission === 'boolean') {
          setWaives(d.dailyTargetWaivesCommission);
        }
        if (typeof d.dailyTargetPoolOnly === 'boolean') setPoolOnly(d.dailyTargetPoolOnly);
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
      // With no bonus and no waiver the target rewards nothing whatsoever: the
      // driver app would show a counter that pays out in neither direction.
      if (!waives && targetBonus === 0) {
        setError(
          'This target would reward nothing: the commission-free day is switched off and the ' +
            'bonus is 0. Turn the free day back on, or set a bonus, or switch the target off.',
        );
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
      // A day that cannot possibly satisfy its own rules frees nobody, and the
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
          rate: rate / 100,
          dailyTargetEnabled: targetOn,
          dailyTargetRides: targetRides,
          dailyTargetBonus: targetBonus,
          dailyTargetWaivesCommission: waives,
          dailyTargetPoolOnly: poolOnly,
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

  const rideWord = poolOnly ? 'pool rides' : 'rides';

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Commission &amp; driver rewards</h1>
      <p style={{ color: colors.muted, marginBottom: 10 }}>
        What drivers pay us, and what a full day earns them. Saved changes reach every
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
            <p style={{ color: colors.muted, fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Commission is charged <strong>by the day</strong>. A day that hits the target below
              costs the driver nothing; a day that falls short owes this rate on the cash it took,
              and that becomes due at <strong>midnight, Pakistan time</strong>. Nothing is ever
              owed while the day is still running — a driver needs the whole day to reach the
              target.
            </p>
            <div style={{ display: 'grid', gap: 20, marginTop: 14 }}>
              <Field
                label="Commission rate (%)"
                hint="Velocity Rides' cut of the cash fares a driver collects on a day that missed the target. Commission on online rides is taken instantly at trip completion, so it is never charged twice."
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
            </div>
            <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
              A driver with unpaid commission from a closed day <strong>cannot accept any new
              work</strong> until it is cleared. Clearing it unlocks them immediately — they
              transfer the amount and upload a screenshot, and an AI check passes it in seconds.
            </p>
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
              A driver who completes the target in one day (midnight to midnight, Pakistan time)
              owes <strong>no commission at all</strong> on that day&apos;s rides. That waiver is
              the reward — there is no separate cash bonus unless you set one below.
            </p>
            <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
              Anything a driver <em>earns</em> is a <strong>bonus</strong>, never a
              &ldquo;commission&rdquo;. Commission is only ever what they pay us — opposite
              direction of money, so the two never share a word anywhere a driver can read it.
            </p>

            {targetOn && (
              <div style={{ display: 'grid', gap: 20, marginTop: 18 }}>
                <Field
                  label="Rides needed per day"
                  hint="Cross this many qualifying rides in a day and the day goes commission-free. Qualifying means it cleared the minimums below."
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

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <Toggle
                    on={poolOnly}
                    onChange={(v) => { setPoolOnly(v); touched(); }}
                    label="Only pool / sharing rides count"
                  />
                  <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
                    {poolOnly ? (
                      <>
                        <strong>On.</strong> A solo ride still earns the driver their fare and still
                        owes its commission — it just does not move the counter. This is what pushes
                        drivers toward shared seats, which is the product. Pools a rider booked, and
                        solo trips a driver turned into pools with an en-route pickup, both count.
                      </>
                    ) : (
                      <>
                        <strong>Off.</strong> Every completed ride counts, solo or shared. Easier to
                        reach, and it stops rewarding sharing specifically.
                      </>
                    )}
                  </p>
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <Toggle
                    on={waives}
                    onChange={(v) => { setWaives(v); touched(); }}
                    label="A target day is commission-free"
                  />
                  <p style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
                    {waives ? (
                      <>
                        <strong>On.</strong> This is the programme. A driver who hits the target owes
                        no commission on that day&apos;s rides at all.
                      </>
                    ) : (
                      <>
                        <strong>Off.</strong> A target day still owes its commission. With the bonus
                        at 0 that leaves the target rewarding nothing, so set a bonus below or
                        switch the target off altogether.
                      </>
                    )}
                  </p>
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <Field
                    label="Extra cash bonus (PKR) — optional"
                    hint={
                      targetBonus > 0
                        ? `On top of the free day. Works out at about ${Math.round(targetBonus / Math.max(1, targetRides)).toLocaleString()} PKR per ride at this target. It is not cash: it pays the driver's future commission and can never be withdrawn.`
                        : 'Leave at 0 — the commission-free day is the deal. Set it only to run a temporary push on top.'
                    }
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
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: colors.text, marginBottom: 4 }}>
                    Anti-farming minimums
                  </div>
                  <p style={{ color: colors.muted, fontSize: 12.5, marginBottom: 16, lineHeight: 1.6 }}>
                    Without these, a driver and one friend can book {targetRides} minimum-fare
                    rides around a car park and pay us nothing, every day. Set any of them to 0 to
                    switch that check off.
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
                      hint="Stops the same friend riding sixteen times. Pool rides count every rider aboard."
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
                      hint="The day has to look like a real shift, not sixteen trips round the block."
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
              {targetOn ? (
                <>
                  <li>
                    <strong>{targetRides} qualifying {rideWord} in a day</strong>
                    {waives ? ' and that whole day costs them no commission' : ''}
                    {targetBonus > 0
                      ? `${waives ? ', plus' : ' earns'} a ${targetBonus.toLocaleString()} PKR bonus`
                      : ''}
                    .
                  </li>
                  <li>
                    Short of it, <strong>{rate}%</strong> of the cash they took that day is owed. It
                    becomes due at midnight and they cannot accept a new ride until it is cleared.
                  </li>
                  <li>
                    Their app shows the live count, names every unmet condition, and says in rupees
                    what the day will cost if they stop now — so a day that will not qualify says
                    so while there is still time to fix it.
                  </li>
                  <li>
                    At 00:05 we push the drivers whose day closed short, with the amount, so nobody
                    finds out from an error message when they go online.
                  </li>
                  {targetBonus > 0 && (
                    <li>
                      The bonus <strong>cannot be withdrawn as cash</strong>. That is a regulatory
                      line, not a preference — money we can hand out and they can cash out would
                      make us an e-money issuer. It pays their commission by itself until it runs
                      out.
                    </li>
                  )}
                </>
              ) : (
                <>
                  <li>
                    The daily target is <strong>off</strong>. Every day owes <strong>{rate}%</strong>{' '}
                    of the cash it took, due at midnight, with no way to earn a free day.
                  </li>
                  <li>
                    A bonus a driver already holds still pays their commission until it runs out.
                  </li>
                </>
              )}
            </ul>
            <p style={{ color: colors.muted, fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
              Need to grant or claw back a bonus for one driver by hand — a cash payment at
              the office, or a waiver a bug lost? Use the Driver approvals page; there is no
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
