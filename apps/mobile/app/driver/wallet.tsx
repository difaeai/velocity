import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { useWalletComingSoon } from '../../src/hooks/driver';
import { WalletScreen } from '../../src/ui/WalletScreen';
import { DriverTabBar } from '../../src/ui/DriverTabBar';

/**
 * Wallet tab. WalletScreen is shared with the passenger app — the driver
 * bottom navigation is layered here rather than inside it.
 *
 * Hidden until the wallet economy officially launches. The tab and the drawer
 * row are both gone while `walletTopupEnabled` is false, but a route is not a
 * link — a notification deep link or a back-stack entry from an older build can
 * still land here, so those are bounced home. Nothing a locked driver needs
 * lives on this screen: the commission settle flow renders inline on the home
 * tab. Flipping the flag re-opens it with no deploy.
 */
export default function DriverWallet() {
  const router = useRouter();
  const hidden = useWalletComingSoon();

  useEffect(() => {
    if (hidden) router.replace('/driver/home');
  }, [hidden, router]);

  if (hidden) return null;

  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        <WalletScreen role="driver" />
      </View>
      <DriverTabBar active="wallet" />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
}));
