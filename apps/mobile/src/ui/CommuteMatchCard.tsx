/**
 * How many people take the same commute you do.
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE MOST IMPORTANT CARD ON THE HOME SCREEN
 * -----------------------------------------------------
 * A shared ride booked on the spot needs two strangers to want the same journey
 * inside the same ten minutes. At Velocity's volume that almost never happens:
 * the ride opens, nobody joins, the host pays the solo fare. Nobody loses
 * money — but the saving the app promised never arrives, and a rider who sees
 * that twice stops believing in shared rides at all. Every extra rule we need
 * (gender, radius, drop zone) divides an already-thin pool further.
 *
 * A commute does not need two people online at once. It needs RECURRENCE: the
 * same journey, declared once, matched against everyone else who declared it.
 * The matching window stops being ten minutes wide and becomes days wide. That
 * is the difference between shared rides that work here and shared rides that
 * need a city the size of Uber's.
 *
 * The data was already being collected — riders have been saving commute
 * schedules all along — and read by exactly one thing: the DRIVER's demand
 * screen. Two women travelling Gulberg → Blue Area at 08:30 every weekday had
 * no way of ever learning the other existed. This card is the other half of
 * that pipe, and the screen it leads to was three taps deep behind a browser
 * most riders never open.
 *
 * WHAT IT SHOWS
 * -------------
 * Counts, never people. `getCommuteMatches` returns totals and area names and
 * deliberately no uid, name, address or coordinate — "four women take your
 * route" is everything a rider needs in order to decide to share, and anything
 * more hands a stranger's home and daily movements to somebody who has not met
 * them. Names come later and by consent, when a ride actually forms.
 *
 * Three states, and the empty one matters most: a rider with no saved commute
 * sees the invitation, because that rider is the entire supply of future
 * matches.
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api } from '../api/client';
// Colours here are light-on-dark literals, not theme tokens: this card sits in
// the home sheet, which is dark in BOTH themes — see SharedRideGenderStrip.
import { themed } from '../theme';

interface Matches {
  hasSchedule: boolean;
  total: number;
  males: number;
  females: number;
  destinationAreaName: string | null;
  morningTime: string | null;
}

/** "08:30" → "8:30 am", because nobody says their commute in 24-hour time. */
function clock(hhmm: string | null): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':');
  const hour = parseInt(h ?? '', 10);
  if (!Number.isFinite(hour)) return null;
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m ?? '00'} ${suffix}`;
}

export function CommuteMatchCard({ onPress }: { onPress: () => void }) {
  const [data, setData] = useState<Matches | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    api.getCommuteMatches({})
      .then((r) => setData(r))
      // Best-effort: a home screen that shows one fewer card is fine, an error
      // box on it is not.
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nothing is drawn until we know which of the three states this is. Flashing
  // "save your route" at somebody who saved one months ago is a bug, not a nudge.
  if (!loaded) return null;

  const hasSchedule = data?.hasSchedule === true;
  const total = data?.total ?? 0;
  const where = data?.destinationAreaName;
  const when = clock(data?.morningTime ?? null);

  /** The gender split, said the way a rider would ask about it. */
  const company = (() => {
    const f = data?.females ?? 0;
    const m = data?.males ?? 0;
    if (f > 0 && m === 0) return `${f} ${f === 1 ? 'woman' : 'women'}`;
    if (m > 0 && f === 0) return `${m} ${m === 1 ? 'man' : 'men'}`;
    if (f > 0 && m > 0) return `${f} women · ${m} men`;
    return null;
  })();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, total > 0 && styles.cardLive, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        hasSchedule
          ? `Your daily route — ${total} other riders take it`
          : 'Save your daily route to be matched with riders who take it too'
      }
    >
      <View style={styles.head}>
        <Text style={styles.icon}>🛣️</Text>
        <Text style={[styles.title, total > 0 && styles.titleLive]}>
          {hasSchedule ? 'Your daily route' : 'Travel the same way every day?'}
        </Text>
        <View style={{ flex: 1 }} />
        {total > 0 ? (
          <View style={styles.count}><Text style={styles.countTxt}>{total}</Text></View>
        ) : (
          <Text style={styles.arrow}>→</Text>
        )}
      </View>

      <Text style={styles.body}>
        {!hasSchedule
          /* The invitation. This rider IS the supply of future matches, so it
             says what they get rather than what we want. */
          ? 'Save it once and we will find the people who travel it with you — a shared seat costs a fraction of the whole car.'
          : total === 0
            /* Honest, and not a dead end. Nobody yet is a fact about today, not
               about the idea, and the route stays saved and keeps looking. */
            ? `Saved${where ? ` to ${where}` : ''}${when ? ` at ${when}` : ''}. Nobody else on it yet — we will tell you the moment somebody saves the same one.`
            : `${company ?? `${total} ${total === 1 ? 'rider' : 'riders'}`} travel${total === 1 ? 's' : ''} your route${when ? ` around ${when}` : ''}. Tap to share it with them.`}
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 6,
  },
  /* Lime only when there is somebody there. The colour means "real, now" on
     this sheet and it should not be spent on an empty route. */
  cardLive: {
    borderColor: 'rgba(204,255,0,0.45)',
    backgroundColor: 'rgba(204,255,0,0.07)',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: { fontSize: 15 },
  title: {
    fontSize: 13.5,
    fontWeight: '900',
    color: '#ffffff',
  },
  titleLive: { color: '#ccff00' },
  count: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ccff00',
  },
  countTxt: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0b0f0c',
  },
  arrow: {
    fontSize: 15,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.45)',
  },
  body: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
  },
}));
