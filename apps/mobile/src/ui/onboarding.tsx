import type { ReactNode } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { colors } from '../config';

export async function pickPhoto(onPicked: (uri: string) => void) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo access to add your documents.');
    return;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  if (!res.canceled && res.assets[0]) onPicked(res.assets[0].uri);
}

/** Dark top bar with Back / title / Close, matching the onboarding design. */
export function StepHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.headerSide}>Back</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable onPress={() => router.replace('/passenger/home')} hitSlop={12}>
        <Text style={styles.headerSideMuted}>Close</Text>
      </Pressable>
    </View>
  );
}

export function Field({
  label,
  optional,
  ...input
}: { label: string; optional?: boolean } & TextInputProps) {
  return (
    <View style={styles.fieldCard}>
      <Text style={styles.fieldLabel}>
        {label}
        {optional ? <Text style={styles.optional}>  Optional</Text> : null}
      </Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.fieldInput} {...input} />
    </View>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

/** Stylised ID-card placeholder shown before a document photo is added. */
export function IdCardArt({ label = 'ID' }: { label?: string }) {
  return (
    <View style={styles.idArt}>
      <View style={styles.idPhoto} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={[styles.idLine, { width: '75%' }]} />
        <View style={[styles.idLine, { width: '55%' }]} />
        <View style={[styles.idLine, { width: '65%' }]} />
      </View>
      <Text style={styles.idLabel}>{label}</Text>
    </View>
  );
}

/** Document upload card: shows the example art or the picked photo + a button. */
export function UploadCard({
  title,
  uri,
  onPick,
  art,
}: {
  title?: string;
  uri: string | null;
  onPick: () => void;
  art?: ReactNode;
}) {
  return (
    <View style={styles.uploadCard}>
      {title ? <Text style={styles.uploadTitle}>{title}</Text> : null}
      {uri ? (
        <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
      ) : (
        (art ?? <IdCardArt />)
      )}
      <Pressable onPress={onPick} style={styles.addPhotoBtn}>
        <Text style={styles.addPhotoText}>{uri ? 'Change photo' : 'Add a photo'}</Text>
      </Pressable>
    </View>
  );
}

/** Round avatar / selfie picker. */
export function PhotoCircle({ uri, onPick }: { uri: string | null; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} style={styles.photoCircleWrap}>
      <View style={styles.photoCircle}>
        {uri ? (
          <Image source={{ uri }} style={styles.photoCircleImg} />
        ) : (
          <Text style={styles.photoPlus}>＋</Text>
        )}
      </View>
      <Text style={styles.addPhotoText}>{uri ? 'Change photo' : 'Add a photo'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    backgroundColor: '#1c1b1b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerSide: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSideMuted: { color: '#9aa3a0', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },

  fieldCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  fieldLabel: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 12 },
  optional: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  fieldInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },

  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { color: colors.text, fontSize: 16, lineHeight: 22 },
  bulletText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 22 },

  uploadCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, marginBottom: 14, gap: 14 },
  uploadTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  preview: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#eef0ef' },
  addPhotoBtn: {
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  addPhotoText: { color: colors.primary, fontWeight: '800', fontSize: 15 },

  idArt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#eef6f1',
    borderRadius: 14,
    padding: 18,
  },
  idPhoto: { width: 56, height: 64, borderRadius: 8, backgroundColor: '#c9ddd1' },
  idLine: { height: 9, borderRadius: 5, backgroundColor: '#c9ddd1' },
  idLabel: { position: 'absolute', top: 8, right: 12, fontSize: 10, fontWeight: '900', color: colors.primary },

  photoCircleWrap: { alignItems: 'center', gap: 10 },
  photoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#eef6f1',
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoCircleImg: { width: '100%', height: '100%' },
  photoPlus: { fontSize: 40, color: colors.primary, fontWeight: '300' },
});
