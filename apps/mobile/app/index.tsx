import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/config';

/** Entry route: sends the user to the right experience based on auth + role. */
export default function Index() {
  const { initializing, user, role } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth/sign-in" />;
  if (role === 'driver') return <Redirect href="/driver/home" />;
  return <Redirect href="/passenger/home" />;
}
