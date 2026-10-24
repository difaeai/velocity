/**
 * The driver's wallet, at the very top of the home screen: how many credits
 * they have, and what they are for.
 *
 * Asked for by name on 2026-10-23 — "show the wallet: how many credits are in
 * it and what to do with them; they were given for the mobile holder". So this
 * card, unlike the "Your bonus" row in DailyTargetCard, says wallet and says
 * credits. It still says the one thing that must never be blurred: the credits
 * pay the driver's commission and are not cash — nothing here tops up, cashes
 * out or implies either. The top-up wallet itself stays hidden until it is
 * officially launched (`walletTopupEnabled`).
 *
 * The balance is `drivers/{uid}.commissionCredit`, the same number the bonus
 * row and the commission lock already use, so all three always agree.
 *
 * Two short lines on purpose (asked 2026-10-24: "too big"): it sits above the
 * request feed, and every line here pushes a ride a driver is waiting for
 * further down. The long explanation is in the label a screen reader reads and
 * on Earnings, a tap away.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';

export function WalletCard({
  credits,
  used,
  onPress,
}: {
  /** Unspent credits, PKR. */
  credits: number;
  /** Credits already spent on commission, PKR. */
  used: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && onPress ? { opacity: 0.9 } : null]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Wallet: ${credits.toLocaleString()} rupees in credits, given for a mobile holder. Commission comes off them first. ${used > 0 ? `${used.toLocaleString()} rupees used so far. ` : ''}They cannot be withdrawn as cash.`}
    >
      <View style={styles.icon}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="M21 7.28V5c0-1.1-.9-2-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-2.28A2 2 0 0 0 22 15V9a2 2 0 0 0-1-1.72zM20 9v6h-7V9h7zM5 19V5h14v2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6v2H5zm11-4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"
            fill={colors.primary}
          />
        </Svg>
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.label}>Wallet</Text>
          <Text style={styles.amount}>PKR {credits.toLocaleString()}</Text>
          <Text style={styles.notCash}>Not cash</Text>
        </View>
        {/* Short enough for one line on a 360-wide phone. */}
        <Text style={styles.what} numberOfLines={1}>
          {credits > 0 ? 'Mobile-holder credits · pay your commission' : 'Credits used up · commission paid as usual'}
        </Text>
      </View>
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 6,
      marginBottom: 2,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.primary + '55',
      backgroundColor: colors.primary + '12',
    },
    icon: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '1f',
    },
    body: { flex: 1, minWidth: 0 },
    topRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    label: { fontSize: 10.5, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
    amount: { fontSize: 15, fontWeight: '900', color: colors.primary },
    notCash: { marginLeft: 'auto', fontSize: 10.5, fontWeight: '800', color: colors.muted },
    what: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
    chevron: { fontSize: 20, color: colors.muted, marginLeft: 2 },
  }),
);
