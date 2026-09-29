import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { useWalletComingSoon } from '../../src/hooks/driver';
import { WalletScreen } from '../../src/ui/WalletScreen';

/**
 * The wallet screen is unreachable from navigation until the wallet economy
 * officially launches, but a route is not a link: a notification deep link, a
 * back-stack entry from an older build, or a typed URL can still land here.
 * Bounce those to home rather than showing a screen the app is not admitting to.
 *
 * Flipping `walletTopupEnabled` re-opens it with no deploy. Nothing is lost on
 * the way out — a blocked passenger settles cancellation fees from the card on
 * the home screen.
 */
export default function PassengerWallet() {
  const router = useRouter();
  const hidden = useWalletComingSoon();

  useEffect(() => {
    if (hidden) router.replace('/passenger/home');
  }, [hidden, router]);

  if (hidden) return null;
  return <WalletScreen role="passenger" />;
}
