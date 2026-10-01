/**
 * The caller's own account state, assembled for the Rapid Response agent.
 *
 * WHY THIS EXISTS. Almost every real support message is about a specific thing
 * that already happened: "why am I locked", "where is my driver", "I was
 * charged 240 for a cancelled ride", "my target didn't pay out". An agent
 * without those facts can only produce the kind of answer that makes people
 * ask for a human — a correct, general, useless one.
 *
 * So the agent is handed the person's actual figures and is told, in its brief,
 * that it may quote these and nothing else. That is also the guard against the
 * failure mode in the other direction: a model that has real numbers in front
 * of it has no reason to invent any.
 *
 * WHAT IS LEFT OUT, DELIBERATELY. No other user's data, ever — a passenger
 * complaining about a driver does not get the driver's phone number read back
 * to them by a chatbot. No full CNIC, no document URLs, no partner earnings of
 * anyone but the caller. Trips are summarised, not dumped.
 */
import { db } from '../lib/firebase';
import {
  commissionBreakdown,
  commissionCredit,
  getCommissionSettings,
  type CommissionSettings,
} from '../domain/commission';
import { getCancellationSettings, walletOutstanding, type CancellationSettings } from '../domain/cancellation';
import {
  dailyTargetProgress,
  type DailyTargetProgress,
} from '../domain/dailyTarget';
import { dailyTargetRef, readDailyTargetDay, todayKey } from '../drivers/dailyTarget';

export interface SupportContext {
  /** Rendered block handed to the model. */
  brief: string;
  /** Live settings, so the knowledge brief quotes today's deal. */
  commission: CommissionSettings;
  cancellation: CancellationSettings;
  /** For the ticket document, so the desk sees the same facts the AI did. */
  snapshot: {
    role: string;
    displayName: string | null;
    activeTripId: string | null;
    banned: boolean;
    outstanding: number;
    commissionCredit: number;
    commissionDue: number;
    dailyTarget: DailyTargetProgress | null;
  };
}

function money(n: number): string {
  return `PKR ${Math.round(n).toLocaleString()}`;
}

function when(ts: { toMillis(): number } | undefined | null): string {
  if (!ts) return 'unknown date';
  return new Date(ts.toMillis()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/**
 * Read everything the agent is allowed to know about this caller.
 *
 * Every query is bounded and the whole thing is one round of parallel reads, so
 * it costs about the same as opening a screen in the app. A read that fails is
 * left out of the brief rather than failing the ticket — a support request must
 * never be refused because a secondary lookup had a bad minute.
 */
export async function buildSupportContext(uid: string): Promise<SupportContext> {
  const day = todayKey();
  const [
    commission,
    cancellation,
    userSnap,
    driverSnap,
    walletSnap,
    daySnap,
    tripsSnap,
  ] = await Promise.all([
    getCommissionSettings(),
    getCancellationSettings(),
    db.doc(`users/${uid}`).get(),
    db.doc(`drivers/${uid}`).get(),
    db.doc(`wallets/${uid}`).get(),
    dailyTargetRef(uid, day).get(),
    db
      .collection('trips')
      .where('passengerId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get()
      .catch(() => null),
  ]);

  const role = (userSnap.get('role') as string | undefined) ?? 'passenger';
  const displayName = (userSnap.get('displayName') as string | undefined) ?? null;
  const isDriver = driverSnap.exists;
  const outstanding = walletOutstanding(walletSnap);
  const activeTripId = (userSnap.get('activeTripId') as string | null | undefined) ?? null;
  const banned = userSnap.get('banned') === true;

  const lines: string[] = [];
  lines.push(`Name: ${displayName ?? 'not set'}`);
  lines.push(`Role: ${isDriver ? 'driver (also rides as a passenger)' : 'passenger'}`);
  lines.push(`Account: ${banned ? 'BANNED — only a human can lift this' : 'active'}`);
  if (outstanding > 0) {
    lines.push(
      `Unpaid cancellation fees: ${money(outstanding)}` +
        (cancellation.outstandingLimit > 0 && outstanding >= cancellation.outstandingLimit
          ? ' — this is at or over the limit, so their account is blocked from booking/accepting until it is cleared'
          : ''),
    );
  } else {
    lines.push('Unpaid cancellation fees: none');
  }

  // ── Driver money ──────────────────────────────────────────────────────────
  let target: DailyTargetProgress | null = null;
  let due = 0;
  if (isDriver) {
    const breakdown = commissionBreakdown(driverSnap, commission);
    due = breakdown.due;
    const credit = commissionCredit(driverSnap);
    const cycleGross = (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
    target = dailyTargetProgress(readDailyTargetDay(daySnap, day), commission);

    lines.push('');
    lines.push('DRIVER ACCOUNT');
    lines.push(`Verification: ${(driverSnap.get('verificationStatus') as string | undefined) ?? 'unknown'}`);
    lines.push(`Lifetime rides: ${(driverSnap.get('tripsCount') as number | undefined) ?? 0}`);
    lines.push(
      `Current cycle: ${money(cycleGross)} of fares out of ${money(commission.threshold)} before settling`,
    );
    lines.push(
      `Commission on this cycle: ${money(breakdown.grossDue)} total, of which ` +
        `${money(breakdown.creditApplied)} is covered by their credit — ` +
        `they personally owe ${money(breakdown.due)} right now`,
    );
    lines.push(`Commission credit available: ${money(credit)} (cannot be withdrawn as cash)`);
    lines.push(
      `Locked out of new rides: ${cycleGross >= commission.threshold && due > 0 ? 'YES — they must settle first' : 'no'}`,
    );
    lines.push('');
    lines.push(`TODAY'S TARGET (${day}, Pakistan time)`);
    if (!target.enabled) {
      lines.push('The daily target programme is currently switched off.');
    } else {
      lines.push(
        `Qualifying rides: ${target.rides} of ${target.target} — bonus ${money(target.bonus)}`,
      );
      lines.push(
        target.granted
          ? "Today's bonus has ALREADY been paid into their credit."
          : target.met
            ? 'Every requirement is met; the bonus pays on this ride.'
            : `Still needed today: ${target.blockers
                .map((b) => `${b.label} (has ${b.have}, needs ${b.need})`)
                .join('; ')}`,
      );
      lines.push(
        `Today's rides commission-free: ${target.commissionWaived ? 'yes' : 'no, not yet'}`,
      );
    }
  }

  // ── Recent rides ──────────────────────────────────────────────────────────
  if (tripsSnap && !tripsSnap.empty) {
    lines.push('');
    lines.push('THEIR LAST RIDES AS A PASSENGER');
    for (const d of tripsSnap.docs) {
      const status = (d.get('status') as string | undefined) ?? 'unknown';
      const fare = (d.get('fare') as number | undefined) ?? (d.get('offeredFare') as number | undefined);
      lines.push(
        `- ${d.id} · ${status} · ${fare ? money(fare) : 'no fare'} · ` +
          `${(d.get('pickup.address') as string | undefined) ?? '?'} → ` +
          `${(d.get('dropoff.address') as string | undefined) ?? '?'} · ` +
          `${when(d.get('createdAt'))}`,
      );
    }
  }
  if (activeTripId) {
    lines.push('');
    lines.push(`They have a ride in progress right now: ${activeTripId}`);
  }

  return {
    brief: lines.join('\n'),
    commission,
    cancellation,
    snapshot: {
      role: isDriver ? 'driver' : role,
      displayName,
      activeTripId,
      banned,
      outstanding,
      commissionCredit: commissionCredit(driverSnap),
      commissionDue: due,
      dailyTarget: target,
    },
  };
}
