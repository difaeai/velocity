import { Stack } from 'expo-router';

import { OnboardingProvider } from '../../../src/onboarding/context';

export default function BecomeDriverLayout() {
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </OnboardingProvider>
  );
}
