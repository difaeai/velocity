import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

/**
 * Light onboarding palette.
 *
 * The rest of the app uses the dark brand palette in `src/config`, but the
 * driver-registration forms follow the reference design: a dark top bar over
 * light document-capture screens (white cards, near-black text, forest-green
 * accents). These tokens are local so they never leak into the dark passenger UI.
 */
export const oc = {
  header: '#1c1b1b', // dark top bar
  screen: '#e7e8ea', // light grey page background
  card: '#ffffff', // white card
  text: '#1b1b1b', // near-black text
  sub: '#6b7177', // muted grey
  line: '#ececee', // hairline divider
  green: '#1ea64b', // forest-green accent / active buttons
  greenDark: '#1b7a2e', // benefits card / branded green
  field: '#f5f6f7', // input background
  fieldBorder: '#d9dcdf', // input border
  disabled: '#c5c9cd', // disabled button background
  note: '#fbf3c9', // support note background
  noteText: '#5b5320', // support note text
};

export async function pickPhoto(onPicked: (uri: string) => void) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo access to add your documents.');
    return;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  if (!res.canceled && res.assets[0]) onPicked(res.assets[0].uri);
}

/** Dark top bar with ← arrow / title / Close, matching the onboarding design. */
export function StepHeader({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
        <Text style={styles.headerArrow}>←</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable onPress={() => router.replace('/passenger/home')} hitSlop={12} style={styles.headerBtn}>
        <Text style={styles.headerSideMuted}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Green primary action used across the light onboarding forms. */
export function OnbButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.onbBtn,
        { backgroundColor: disabled ? oc.disabled : oc.green, opacity: pressed && !disabled ? 0.9 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.onbBtnText}>{label}</Text>}
    </Pressable>
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
      <TextInput placeholderTextColor={oc.sub} style={styles.fieldInput} {...input} />
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

/** Pale-yellow "contact Support" note shown at the foot of capture screens. */
export function SupportNote() {
  const router = useRouter();
  return (
    <View style={styles.note}>
      <Text style={styles.noteBody}>
        If you have questions, please contact{' '}
        <Text style={styles.noteLink} onPress={() => router.push('/passenger/support-chat')}>
          Support
        </Text>
        .
      </Text>
    </View>
  );
}

/** Green outlined "Add a photo" / "Change photo" pill. */
export function AddPhotoButton({ uri, onPick }: { uri: string | null; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} style={styles.addPhotoBtn}>
      <Text style={styles.addPhotoText}>{uri ? 'Change photo' : 'Add a photo'}</Text>
    </Pressable>
  );
}

/** A tappable row in a section hub: label (+ optional value), done tick, chevron. */
export function HubRow({
  label,
  value,
  done,
  onPress,
  first,
}: {
  label: string;
  value?: string;
  done?: boolean;
  onPress: () => void;
  first?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.hubRow, !first && styles.hubRowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.hubLabel}>{label}</Text>
        {value ? <Text style={styles.hubValue}>{value}</Text> : null}
      </View>
      {done ? (
        <View style={styles.hubCheck}>
          <Text style={styles.hubCheckMark}>✓</Text>
        </View>
      ) : null}
      <Text style={styles.hubChevron}>›</Text>
    </Pressable>
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

/** "What not to do" selfie illustration: hat + sunglasses + ID, with a red cross. */
export function SelfieDontArt() {
  return (
    <View style={styles.selfieArt}>
      <Text style={styles.selfieCross}>✕</Text>
      <View style={styles.hatCrown} />
      <View style={styles.hatBrim} />
      <View style={styles.head}>
        <View style={styles.glasses} />
      </View>
      <View style={styles.idInHand} />
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
      {uri ? <Image source={{ uri }} style={styles.preview} resizeMode="cover" /> : (art ?? <IdCardArt />)}
      <AddPhotoButton uri={uri} onPick={onPick} />
    </View>
  );
}

/** Round avatar / selfie picker. */
export function PhotoCircle({ uri, onPick }: { uri: string | null; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} style={styles.photoCircleWrap}>
      <View style={styles.photoCircle}>
        {uri ? <Image source={{ uri }} style={styles.photoCircleImg} /> : <Text style={styles.photoPlus}>＋</Text>}
      </View>
      <Text style={styles.addPhotoText}>{uri ? 'Change photo' : 'Add a photo'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    backgroundColor: oc.header,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerBtn: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerArrow: { color: '#fff', fontSize: 24, fontWeight: '700' },
  headerSideMuted: { color: '#9aa3a0', fontSize: 18, fontWeight: '600' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },

  onbBtn: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  onbBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  fieldCard: { backgroundColor: oc.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  fieldLabel: { fontSize: 16, fontWeight: '800', color: oc.text, textAlign: 'center', marginBottom: 12 },
  optional: { color: oc.sub, fontWeight: '600', fontSize: 14 },
  fieldInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: oc.fieldBorder,
    backgroundColor: oc.field,
    paddingHorizontal: 14,
    fontSize: 16,
    color: oc.text,
  },

  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { color: oc.text, fontSize: 16, lineHeight: 22 },
  bulletText: { flex: 1, fontSize: 15, color: oc.text, lineHeight: 22 },

  note: { backgroundColor: oc.note, borderRadius: 12, padding: 14, marginTop: 4 },
  noteBody: { color: oc.noteText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  noteLink: { color: oc.green, fontWeight: '800', textDecorationLine: 'underline' },

  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  hubRowBorder: { borderTopWidth: 1, borderTopColor: oc.line },
  hubLabel: { fontSize: 16, fontWeight: '600', color: oc.text },
  hubValue: { fontSize: 13, color: oc.sub, marginTop: 2 },
  hubCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: oc.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCheckMark: { color: oc.green, fontSize: 13, fontWeight: '900' },
  hubChevron: { color: oc.green, fontSize: 24, fontWeight: '500' },

  uploadCard: { backgroundColor: oc.card, borderRadius: 18, padding: 18, marginBottom: 14, gap: 14 },
  uploadTitle: { fontSize: 16, fontWeight: '800', color: oc.text, textAlign: 'center' },
  preview: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#eef0ef' },
  addPhotoBtn: {
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: oc.green,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  addPhotoText: { color: oc.green, fontWeight: '800', fontSize: 15 },

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
  idLabel: { position: 'absolute', top: 8, right: 12, fontSize: 10, fontWeight: '900', color: oc.green },

  selfieArt: { height: 150, alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  selfieCross: { position: 'absolute', top: 8, left: '34%', fontSize: 30, color: '#e23b3b', fontWeight: '900', zIndex: 2 },
  hatCrown: { width: 70, height: 26, backgroundColor: '#23272b', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  hatBrim: { width: 96, height: 8, backgroundColor: '#23272b', borderRadius: 4, marginTop: -1 },
  head: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#f0d4ba', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  glasses: { width: 58, height: 16, backgroundColor: '#23272b', borderRadius: 8, marginTop: 8 },
  idInHand: { position: 'absolute', left: '24%', bottom: 18, width: 44, height: 30, backgroundColor: '#cfe8d6', borderRadius: 5, borderWidth: 1.5, borderColor: oc.green },

  photoCircleWrap: { alignItems: 'center', gap: 10 },
  photoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#eef6f1',
    borderWidth: 2,
    borderColor: oc.green,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoCircleImg: { width: '100%', height: '100%' },
  photoPlus: { fontSize: 40, color: oc.green, fontWeight: '300' },
});
