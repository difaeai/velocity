import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { Badge, Card, PrimaryButton } from '../../src/ui/components';

export default function DriverHome() {
  const { user, signOut } = useAuth();
  const [online, setOnline] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hello}>Driver</Text>
            <Text style={styles.email}>{user?.email ?? 'Driver'}</Text>
          </View>
          <Badge label={online ? 'Online' : 'Offline'} color={online ? colors.primary : colors.muted} />
        </View>

        <Card>
          <Text style={styles.cardTitle}>{online ? "You're online" : 'Go online to receive bids'}</Text>
          <Text style={styles.cardBody}>
            When online, you'll receive nearby ride requests and can bid on them.
            Presence streams to the backend; matching arrives in the next stage.
          </Text>
          <PrimaryButton
            label={online ? 'Go offline' : 'Go online'}
            variant={online ? 'danger' : 'primary'}
            onPress={() => setOnline((v) => !v)}
          />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Today's earnings</Text>
          <Text style={styles.earnings}>0 PKR</Text>
          <Text style={styles.cardBody}>Your ledger updates as you complete trips.</Text>
          <PrimaryButton
            variant="secondary"
            label="View ledger"
            onPress={() => Alert.alert('Coming next', 'The earnings ledger lands in the next stage.')}
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
  earnings: { fontSize: 28, fontWeight: '900', color: colors.primary },
});
