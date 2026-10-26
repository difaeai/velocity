import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TravelMateTabBar } from '../../../src/ui/TravelMateTabBar';
import { Text } from '../../../src/ui/Text';
import { useEnsureTMProfile } from '../../../src/hooks/travelMateCommunity';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import TravelMateSetup from './setup';

export default function TravelMateLayout() {
  // The sign-up profile IS the Travel Partner profile — built here on first
  // open, so no screen below ever has to ask anyone to create one.
  const gate = useEnsureTMProfile();
  const router = useRouter();

  if (gate === 'missing') return <TravelMateSetup />;
  if (gate !== 'ready') {
    return (
      <SafeAreaView style={s.safe}>
        {gate === 'loading' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={s.box}>
            <Text style={s.title}>Travel Partner is for riders 18 and over</Text>
            <Text style={s.sub}>You can still book rides and share them with people you know.</Text>
            <Pressable style={s.btn} onPress={() => router.replace('/passenger/home')}>
              <Text style={s.btnText}>Back to booking</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <Tabs
      tabBar={(props) => <TravelMateTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* The four real tabs — labels and icons live in TravelMateTabBar. */}
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* Not tabs — push-navigated full-screen (Matches and Chats open from Profile) */}
      <Tabs.Screen name="matches" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
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

const s = themed(() => StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  box:     { padding: 32, gap: 12, alignItems: 'center' },
  title:   { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  sub:     { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  btn:     { marginTop: 8, paddingHorizontal: 24, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '900', color: '#000' },
}));
