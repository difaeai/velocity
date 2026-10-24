import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { BikeMarkIcon, CarMarkIcon, RiderMarkIcon } from './RideIcons';
import { themed } from '../theme';

/** Light-on-dark literals: the column floats over a dark map in both themes. */
const LIME = '#ccff00';
const RED = '#ef4444';

/**
 * The legend for the home map's activity layer: what is online around you, split
 * into bikes and cars, and how many other people with Velocity are around you.
 *
 * The map alone is ambiguous — a marker and a red mark mean nothing on first
 * sight, and a sparse map could equally be "nobody here" or "not loaded yet".
 * The column names the marks and gives the totals, which also carry the part the
 * pins can't: the arrays on the map are capped, these numbers are not.
 *
 * Bikes and cars are counted apart because they are different products, not
 * different sizes of the same one: "4 nearby" is useless to someone who needs a
 * car and is looking at four motorbikes. Both rows show even at zero, so the
 * column keeps a stable shape between polls and "no bikes here" stays a visible,
 * honest answer rather than a row that quietly disappears.
 *
 * A red dot is anyone nearby with the app — a passenger, not necessarily someone
 * waiting. When some of them do have a request open that becomes a further
 * row, because "2 waiting" is the number that tells a driver-curious user there
 * is money on the table right now.
 *
 * ── Why a column on the right ───────────────────────────────────────────────
 * It was a horizontal chip on the left, stacked above the sharing pill, so the
 * two controls a rider actually taps were pushed down the map by a legend they
 * only read. As a narrow column down the right edge it sits BESIDE them — the
 * left side is for things you tap, the right for things you read — and its rows
 * fade in one after another, so it arrives as a list rather than appearing as a
 * block. A number that changes on the next poll fades through to its new value,
 * which is how a rider sees the map is live without anything looping forever.
 *
 * WITH NOTHING AROUND, THIS RENDERS NOTHING. A quiet map already says "quiet"
 * by itself (see ShareGenderSelector for what took that strip of map).
 *
 * Non-interactive on purpose. It floats over a map the user pans and pinches, so
 * it must never swallow a gesture; anything actionable belongs in the sheet.
 */
export function MapActivityChip({
  driverCount,
  bikeCount,
  carCount,
  passengerCount,
  waitingCount,
}: {
  driverCount: number;
  bikeCount: number;
  carCount: number;
  passengerCount: number;
  waitingCount: number;
}) {
  const quiet = driverCount === 0 && passengerCount === 0;
  /** The column's own fade and slide in from the edge; the rows follow it in. */
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (quiet) return;
    appear.setValue(0);
    Animated.timing(appear, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [quiet, appear]);

  // Nothing online and nobody around: no column at all. See the file note.
  if (quiet) return null;

  const rows: { key: string; icon: ReactNode; count: number; label: string; color: string }[] = [
    {
      key: 'cars',
      icon: <CarMarkIcon size={14} color="#ffffff" accent={LIME} />,
      count: carCount,
      label: carCount === 1 ? 'car' : 'cars',
      color: LIME,
    },
    {
      key: 'bikes',
      icon: <BikeMarkIcon size={14} color="#ffffff" accent={LIME} />,
      count: bikeCount,
      label: bikeCount === 1 ? 'bike' : 'bikes',
      color: LIME,
    },
    {
      key: 'people',
      icon: <RiderMarkIcon size={13} color={RED} />,
      count: passengerCount,
      label: passengerCount === 1 ? 'passenger' : 'passengers',
      color: LIME,
    },
  ];
  // Waiting passengers are the urgent number, so they take the red the dots use.
  if (waitingCount > 0) {
    rows.push({ key: 'waiting', icon: <View style={styles.waitingDot} />, count: waitingCount, label: 'waiting', color: RED });
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.column,
        {
          opacity: appear.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
        },
      ]}
    >
      {rows.map((row, i) => (
        <View key={row.key}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <StatRow icon={row.icon} count={row.count} label={row.label} color={row.color} index={i} />
        </View>
      ))}
    </Animated.View>
  );
}

function StatRow({
  icon,
  count,
  label,
  color,
  index,
}: {
  icon: ReactNode;
  count: number;
  label: string;
  color: string;
  /** Place in the column: each row fades in a beat after the one above. */
  index: number;
}) {
  // Its own entrance rather than a slice of the column's, so a row that turns
  // up later ("waiting") fades in too instead of popping into place.
  const enter = useRef(new Animated.Value(0)).current;
  /** Dips and comes back when the number changes — the "this is live" cue. */
  const blink = useRef(new Animated.Value(1)).current;
  const shown = useRef(count);

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 480,
      delay: 140 + index * 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);

  useEffect(() => {
    if (shown.current === count) return;
    shown.current = count;
    blink.setValue(0.1);
    Animated.timing(blink, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [count, blink]);

  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        },
      ]}
    >
      <View style={styles.iconBubble}>{icon}</View>
      <Animated.View style={{ opacity: blink }}>
        <Text style={[styles.count, { color }]}>{count}</Text>
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  column: {
    marginRight: 16,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 18,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5 },
  iconBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  waitingDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: RED },
  // Line heights pinned so every row is the same height whatever the font does.
  count: { fontSize: 13.5, lineHeight: 15, fontWeight: '900' },
  label: { fontSize: 9.5, lineHeight: 11, fontWeight: '700', color: '#9aa2a0' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
}));
