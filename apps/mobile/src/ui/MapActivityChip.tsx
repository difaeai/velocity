import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { BikeMarkIcon, CarMarkIcon, RiderMarkIcon } from './RideIcons';
import { themed } from '../theme';

/**
 * The legend for the home map's activity layer: what is online around you, split
 * into bikes and cars, and how many other people with Velocity are around you.
 *
 * The map alone is ambiguous — a marker and a red mark mean nothing on first
 * sight, and a sparse map could equally be "nobody here" or "not loaded yet".
 * The chip names the marks and gives the totals, which also carry the part the
 * pins can't: the arrays on the map are capped, these numbers are not.
 *
 * Bikes and cars are counted apart because they are different products, not
 * different sizes of the same one: "4 nearby" is useless to someone who needs a
 * car and is looking at four motorbikes. Both segments show even at zero, so the
 * chip keeps a stable shape between polls and "no bikes here" stays a visible,
 * honest answer rather than a segment that quietly disappears.
 *
 * A red dot is anyone nearby with the app — a passenger, not necessarily someone
 * waiting. When some of them do have a request open that becomes a further
 * segment, because "2 waiting" is the number that tells a driver-curious user
 * there is money on the table right now.
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

  return (
    <View style={styles.chip} pointerEvents="none">
      {quiet ? (
        <Text style={styles.quietText}>Quiet around you right now</Text>
      ) : (
        <>
          <View style={styles.item}>
            <CarMarkIcon size={13} color={colors.text} accent={colors.primary} />
            <Text style={styles.count}>{carCount}</Text>
            <Text style={styles.label}>{carCount === 1 ? 'car' : 'cars'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.item}>
            <BikeMarkIcon size={13} color={colors.text} accent={colors.primary} />
            <Text style={styles.count}>{bikeCount}</Text>
            <Text style={styles.label}>{bikeCount === 1 ? 'bike' : 'bikes'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.item}>
            <RiderMarkIcon size={12} color="#ef4444" />
            <Text style={styles.count}>{passengerCount}</Text>
            <Text style={styles.label}>{passengerCount === 1 ? 'passenger' : 'passengers'}</Text>
          </View>
          {waitingCount > 0 ? (
            <>
              <View style={styles.divider} />
              <View style={styles.item}>
                <Text style={styles.waitingCount}>{waitingCount}</Text>
                <Text style={styles.label}>waiting</Text>
              </View>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 16,
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontSize: 12, fontWeight: '900', color: colors.primary },
  // Waiting passengers are the urgent number, so they take the red the dots use
  // rather than the lime everything else on this chip shares.
  waitingCount: { fontSize: 12, fontWeight: '900', color: '#ef4444' },
  label: { fontSize: 10, fontWeight: '700', color: colors.muted },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  quietText: { fontSize: 10.5, fontWeight: '700', color: colors.muted },
}));
