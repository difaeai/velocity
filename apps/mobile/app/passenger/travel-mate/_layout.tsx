import { Tabs } from 'expo-router';
import { TravelMateTabBar } from '../../../src/ui/TravelMateTabBar';

export default function TravelMateLayout() {
  return (
    <Tabs
      tabBar={(props) => <TravelMateTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* The five real tabs — labels and icons live in TravelMateTabBar. */}
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="matches" options={{ title: 'Matches' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* Not tabs — push-navigated full-screen */}
      <Tabs.Screen name="discover" options={{ href: null }} />
      <Tabs.Screen name="setup" options={{ href: null }} />
      <Tabs.Screen name="travel-locations" options={{ href: null }} />
      <Tabs.Screen name="subscription" options={{ href: null }} />
      <Tabs.Screen name="chat" options={{ href: null }} />
      <Tabs.Screen name="group" options={{ href: null }} />
      <Tabs.Screen name="group-chat" options={{ href: null }} />
      <Tabs.Screen name="group-invite" options={{ href: null }} />
      <Tabs.Screen name="shared-ride" options={{ href: null }} />
      <Tabs.Screen name="mate" options={{ href: null }} />
      <Tabs.Screen name="message-requests" options={{ href: null }} />
      {/* Community feed — push-navigated full-screen */}
      <Tabs.Screen name="post" options={{ href: null }} />
      <Tabs.Screen name="community" options={{ href: null }} />
      <Tabs.Screen name="communities" options={{ href: null }} />
      <Tabs.Screen name="feed-search" options={{ href: null }} />
      <Tabs.Screen name="feed-profile" options={{ href: null }} />
      <Tabs.Screen name="blocked-users" options={{ href: null }} />
    </Tabs>
  );
}
