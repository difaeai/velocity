import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { Badge, Card, PrimaryButton } from '../../src/ui/components';

export default function PassengerHome() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hello}>Hello 👋</Text>
            <Text style={styles.email}>{user?.email ?? 'Passenger'}</Text>
          </View>
          <Badge label="Passenger" />
        </View>

        <Card>
          <Text style={styles.cardTitle}>Book a ride</Text>
          <Text style={styles.cardBody}>
            Choose a bike, rickshaw, mini, AC car, comfort or XL — set your fare
            and let nearby drivers bid.
          </Text>
          <PrimaryButton label="Where to?" onPress={() => router.push('/passenger/booking')} />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Drive with Velocity</Text>
          <Text style={styles.cardBody}>
            Earn on your schedule. Submit your documents to get verified — an admin
            approves you, then the driver experience unlocks in this same app.
          </Text>
          <PrimaryButton
            variant="secondary"
            label="Become a driver"
            onPress={() =>
              Alert.alert('Coming next', 'Driver onboarding (document upload) lands in the next stage.')
            }
          />
        </Card>

        <PrimaryButton variant="danger" label="Sign out" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { fontSize: 15, color: colors.muted },
  email: { fontSize: 20, fontWeight: '900', color: colors.text },
  cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  cardBody: { fontSize: 14, color: colors.muted, lineHeight: 20 },
});
