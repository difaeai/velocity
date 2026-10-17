/**
 * "Is anything on my way broken?" — answered in one line, on both sides.
 * ----------------------------------------------------------------------------
 * TWO VARIANTS, ONE COMPONENT, BECAUSE IT IS ONE QUESTION
 * -------------------------------------------------------
 *  · `map` floats over the route on the rider's booking screen, directly under
 *    the fuel chip, 152pt wide so it lines up with the SAME TRIP card above it.
 *    Height on that screen is the scarcest thing there is, so it is one line
 *    collapsed and opens on a tap.
 *  · `panel` is the driver's full-width card. A driver about to commit to a
 *    forty-minute run needs the whole list, in the order they will meet it,
 *    with how far in — so this one is open by default and measures everything
 *    against their own route.
 *
 * IT ALWAYS ANSWERS, INCLUDING "NOTHING"
 * --------------------------------------
 * Most of the time there is no alert, and the obvious design is to render
 * nothing. That is wrong here, and it is the one decision in this file worth
 * arguing about. A strip that only ever appears when something is wrong is a
 * strip whose silence means nothing — the rider cannot tell "we checked and the
 * road is fine" from "this feature is broken" or "this feature does not exist
 * on my phone". Since the whole value of a road alert rests on being believed,
 * the quiet state is a deliberate, very small, very grey line that says we
 * looked. It costs one line and it is what makes the loud state mean something.
 *
 * WHAT IT WILL NOT SAY
 * --------------------
 * No delay in minutes, ever. The server reads newspapers, not traffic sensors,
 * and it has no idea how fast anything is moving — Google's own traffic colours
 * are already under the route line for that. It names the road, says what
 * happened, names the paper, and links the story. See the backend's types.ts.
 *
 * It also never invents an hour. A row says "till 6pm" only when a newspaper
 * printed 6pm; when the story gave no times the server sends none and the row
 * falls back to how long ago it was reported. An invented time would look
 * exactly as authoritative as a real one, which is the problem with it.
 * ----------------------------------------------------------------------------
 */
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import type { TrafficAlertView } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';

/**
 * Severity colours. Local rather than theme tokens because these three are the
 * only place in the app that needs an amber, and a warning ramp in the global
 * palette would invite its use for things that are not warnings.
 */
const SEVERITY_COLOUR: Record<TrafficAlertView['severity'], string> = {
  high: colors.danger,
  medium: '#f59e0b',
  low: colors.muted,
};

/**
 * A glyph per kind. Deliberately plain symbols rather than emoji faces: this
 * strip may be telling somebody there has been a crash on their route, and a
 * cartoon is the wrong register for that.
 */
const KIND_GLYPH: Record<TrafficAlertView['kind'], string> = {
  closure: '⛔',
  protest: '✊',
  vip_movement: '🚓',
  accident: '⚠',
  weather: '🌧',
  construction: '🚧',
  congestion: '🐢',
};

const KIND_WORD: Record<TrafficAlertView['kind'], string> = {
  closure: 'Road closed',
  protest: 'Protest',
  vip_movement: 'VIP movement',
  accident: 'Accident',
  weather: 'Weather',
  construction: 'Roadworks',
  congestion: 'Heavy traffic',
};

/** "in 4.2 km" / "in 600 m". Only ever shown for route results. */
function distanceIn(metres: number | undefined): string | null {
  if (metres === undefined || !Number.isFinite(metres)) return null;
  if (metres < 100) return 'just ahead';
  if (metres < 1000) return `in ${Math.round(metres / 100) * 100} m`;
  return `in ${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** "2pm" / "6:30pm". The 12-hour clock, because that is how Pakistan reads one. */
function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'am' : 'pm';
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * "from 2pm" before it starts, "till 6pm" once it has.
 *
 * ONE END, NOT A RANGE, AND ONLY WHEN THE STORY SAID SO
 * ----------------------------------------------------
 * The rider has one question at a time and it changes at the start of the
 * window: before 2pm it is "when does this hit me", after 2pm it is "when is
 * this over". A full "2pm–6pm" answers both at once, in a 152pt-wide card where
 * there is no room for it, and half of it is always the half they already know.
 *
 * Returns null when the server sent no hours, and the row falls back to how
 * long ago it was reported. We print a time only when a newspaper printed one —
 * an invented "till 11:47pm" from an internal lifetime would look exactly as
 * authoritative as a real one.
 */
function whenLabel(when: { startsAt: number; endsAt: number } | undefined): string | null {
  if (!when) return null;
  const now = Date.now();
  if (now < when.startsAt) {
    const sameDay = new Date(when.startsAt).toDateString() === new Date(now).toDateString();
    const day = sameDay
      ? ''
      : `${new Date(when.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} `;
    return `${day}from ${clock(when.startsAt)}`;
  }
  return `till ${clock(when.endsAt)}`;
}

/** "12 min ago". Published time, so the rider can weigh how fresh it is. */
function ago(publishedAt: number): string {
  const mins = Math.max(0, Math.round((Date.now() - publishedAt) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

interface Props {
  alerts: TrafficAlertView[];
  /** False until the first server answer. Nothing renders before it. */
  loaded: boolean;
  variant?: 'map' | 'panel';
  /**
   * Shapes the quiet line only. A rider is told about their trip, a driver
   * about their route — the same fact, in the words each of them would use.
   */
  audience?: 'rider' | 'driver';
}

export function TrafficStrip({ alerts, loaded, variant = 'map', audience = 'rider' }: Props) {
  const onMap = variant === 'map';
  // The driver's panel opens with everything showing; the rider's costs map
  // height, so it earns its space one tap at a time.
  const [open, setOpen] = useState(!onMap);

  // Nothing at all until the server has answered once. A box that says
  // "checking…" over a map is worse than a box that is not there yet.
  if (!loaded) return null;

  const worst = alerts[0]?.severity ?? 'low';
  const accent = alerts.length > 0 ? SEVERITY_COLOUR[worst] : colors.muted;

  if (alerts.length === 0) {
    return (
      <View style={[onMap ? styles.mapCard : styles.panel, styles.clear]}>
        <Text style={styles.clearTxt} numberOfLines={1}>
          ✓ {audience === 'driver' ? 'Route clear' : 'No road alerts'}
        </Text>
      </View>
    );
  }

  const shown = open ? alerts : alerts.slice(0, 1);

  return (
    <Pressable
      style={[onMap ? styles.mapCard : styles.panel, { borderColor: `${accent}66` }]}
      onPress={onMap ? () => setOpen((v) => !v) : undefined}
    >
      <View style={styles.headRow}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.head, onMap && styles.headMap]} numberOfLines={1}>
          {alerts.length === 1 ? 'ROAD ALERT' : `${alerts.length} ROAD ALERTS`}
        </Text>
        {onMap && <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>}
      </View>

      {shown.map((alert) => (
        <View key={alert.id} style={styles.alertRow}>
          <Text style={[styles.glyph, { color: SEVERITY_COLOUR[alert.severity] }]}>
            {KIND_GLYPH[alert.kind]}
          </Text>
          <View style={styles.alertBody}>
            {/* The road and how far in, which is the whole answer for a driver
                and most of it for a rider. The headline is the evidence. */}
            <Text style={styles.alertTitle} numberOfLines={onMap && !open ? 2 : 3}>
              {alert.roads[0] ?? KIND_WORD[alert.kind]}
              {alert.roads.length > 1 ? ` +${alert.roads.length - 1}` : ''}
              {distanceIn(alert.alongM) ? ` · ${distanceIn(alert.alongM)}` : ''}
            </Text>
            {/* The hours beat the age when we have them: "till 6pm" is what the
                rider can act on, and "20 min ago" is only a proxy for it. */}
            <Text style={styles.alertKind} numberOfLines={1}>
              {KIND_WORD[alert.kind]} · {whenLabel(alert.when) ?? ago(alert.publishedAt)}
            </Text>

            {open && (
              <>
                <Text style={styles.alertLine} numberOfLines={4}>
                  {alert.headline}
                </Text>
                {/* Named and linked, always. This strip is repeating what a
                    newspaper said; the rider is entitled to know which one,
                    and to go and read it rather than take our word. */}
                <Pressable onPress={() => void Linking.openURL(alert.source.url)} hitSlop={8}>
                  <Text style={styles.source} numberOfLines={1}>
                    {alert.source.name} ›
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ))}

      {onMap && !open && alerts.length > 1 && (
        <Text style={styles.more}>+{alerts.length - 1} more · tap</Text>
      )}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  /* 152pt matches MarketCompare's floating strip exactly, so the two stack
     into one column down the left of the map instead of two ragged edges. */
  mapCard: {
    width: 152,
    backgroundColor: colors.glassPanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 11,
    paddingHorizontal: 13,
    gap: 2,
  },

  /* The quiet state: no accent, no icon weight, nothing that reads as an
     alarm. It is a receipt that we looked, not a notification. */
  clear: { paddingVertical: 7, flexDirection: 'row', alignItems: 'center' },
  clearTxt: { fontSize: 10.5, fontWeight: '700', color: colors.muted, letterSpacing: 0.2 },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  head: { flex: 1, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.9, color: colors.muted },
  headMap: { fontSize: 8.5 },
  chevron: { fontSize: 11, fontWeight: '900', color: colors.muted, lineHeight: 12 },

  alertRow: { flexDirection: 'row', gap: 7, paddingVertical: 3 },
  glyph: { fontSize: 12, lineHeight: 16 },
  alertBody: { flex: 1 },
  alertTitle: { fontSize: 11.5, fontWeight: '800', color: colors.text, lineHeight: 15 },
  alertKind: { fontSize: 9.5, color: colors.muted, marginTop: 1 },
  alertLine: { fontSize: 10.5, color: colors.muted, lineHeight: 14, marginTop: 4 },
  source: { fontSize: 10, fontWeight: '800', color: colors.primary, marginTop: 4 },
  more: { fontSize: 9.5, color: colors.muted, marginTop: 4, fontWeight: '700' },
}));
