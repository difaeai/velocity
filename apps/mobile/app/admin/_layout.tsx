import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';

export default function AdminLayout() {
  const { user, role, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Redirect href="/auth/sign-in" />;
  if (role !== 'admin') return <Redirect href="/passenger/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
