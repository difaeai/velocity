import { Stack } from 'expo-router';

export default function SpecialRidesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animationEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="compose" />
      <Stack.Screen name="details" />
      <Stack.Screen name="my-cars" />
      <Stack.Screen name="booking-confirmation" />
    </Stack>
  );
}
