import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../../src/config';

const PINK = '#E8637A';

export default function TravelMateLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PINK,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '💛' : '🤍'}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '❤️' : '🩶'}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '💬' : '🗨️'}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20, color: focused ? PINK : colors.muted }}>⊞</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '🧑' : '👤'}</Text>
          ),
        }}
      />
      {/* Not tabs — push-navigated full-screen */}
      <Tabs.Screen name="setup" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="subscription" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="chat" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="group" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}
