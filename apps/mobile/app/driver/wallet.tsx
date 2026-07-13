import { StyleSheet, View } from 'react-native';

import { colors } from '../../src/config';
import { WalletScreen } from '../../src/ui/WalletScreen';
import { DriverTabBar } from '../../src/ui/DriverTabBar';

/** Wallet tab. WalletScreen is shared with the passenger app — the driver
 *  bottom navigation is layered here rather than inside it. */
export default function DriverWallet() {
  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        <WalletScreen role="driver" />
      </View>
      <DriverTabBar active="wallet" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
});
