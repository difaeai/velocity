/**
 * Camera and gallery capture, with the permission prompt attached.
 *
 * Deliberately separate from `src/ui/onboarding.tsx` (which owns the light
 * document-capture palette): the driver-side car screens are dark and have no
 * business importing a stylesheet to get at a file picker.
 *
 * Both helpers resolve to `null` when the user backs out, which is not an
 * error — a cancelled camera is a normal thing to do — and throw only when the
 * permission was actually refused, so callers can tell the two apart.
 */
import * as ImagePicker from 'expo-image-picker';

/**
 * Take a live photo. Resolves to a local file URI, or null if cancelled.
 *
 * The camera, not the gallery: a verification photo of a car is worth something
 * precisely because it was taken just now, of the car that is present.
 */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Allow camera access to take the photo.');
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
  if (res.canceled || !res.assets[0]) return null;
  return res.assets[0].uri;
}

/** Pick an existing photo. Resolves to a local file URI, or null if cancelled. */
export async function choosePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Allow photo access to pick a picture.');
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  if (res.canceled || !res.assets[0]) return null;
  return res.assets[0].uri;
}
