import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../../src/config';

export default function TravelMateLayout() {
  const insets = useSafeAreaInsets();
  // Always keep the bar clear of the system navigation bar / gesture area,
  // even on devices that under-report the bottom inset.
  const bottomInset = Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 58 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '🏠' : '🏡'}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '🌍' : '🌎'}</Text>
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
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 20 }}>{focused ? '🧑' : '👤'}</Text>
          ),
        }}
      />
      {/* Not tabs — push-navigated full-screen */}
      <Tabs.Screen name="discover" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="setup" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="travel-locations" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="subscription" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="chat" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="group" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="group-chat" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="group-invite" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="shared-ride" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="mate" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      {/* Community feed — push-navigated full-screen */}
      <Tabs.Screen name="post" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="community" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="communities" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="feed-search" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="feed-profile" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="blocked-users" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}
