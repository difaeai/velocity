import { LogBox } from 'react-native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../src/auth/AuthContext';

// Suppress noisy Firebase offline warning shown as a red LogBox banner.
// The app handles offline state gracefully via Firestore's local cache.
LogBox.ignoreLogs([
  'Could not reach Cloud Firestore backend',
  '@firebase/firestore',
]);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Slot />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
