/**
 * Chat attachment helpers — camera, gallery, document, contact, location.
 *
 * These wrap the Expo native modules and Firebase Storage so the chat screens
 * (1:1 match chat and group chat) can share one implementation. Photos and
 * documents are uploaded to `travelMateChat/{uid}/...`; the send* Cloud
 * Functions verify the returned URL belongs to our bucket before attaching it.
 *
 * `expo-document-picker` and `expo-contacts` were added to the app after the
 * current binary was built, so their native calls are wrapped — on an app that
 * hasn't been rebuilt yet the user gets a clear "update the app" message
 * instead of a crash.
 */
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { storage } from '../firebase';

export interface PickedImage {
  uri: string;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  size?: number | null;
}

export interface PickedFile {
  uri: string;
  name: string;
  size?: number | null;
  mime?: string | null;
}

export interface PickedContact {
  name: string;
  phone: string;
}

export interface PickedLocation {
  lat: number;
  lng: number;
  label?: string | null;
}

export class AttachmentError extends Error {}

// React Native's fetch().blob() is unreliable on Android — read via XHR, which
// yields a native Blob directly (mirrors src/lib/uploadDoc.ts).
function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new AttachmentError('Could not read the file to upload.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

function randomId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Upload a local file URI to Storage and return its public download URL. */
export async function uploadChatFile(
  uid: string,
  uri: string,
  ext = 'jpg',
): Promise<{ url: string; path: string }> {
  const path = `travelMateChat/${uid}/${randomId()}.${ext}`;
  const storageRef = ref(storage, path);
  const blob = await uriToBlob(uri);
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

function extFromMime(mime?: string | null, fallback = 'jpg'): string {
  if (!mime) return fallback;
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  };
  if (map[mime]) return map[mime];
  const sub = mime.split('/')[1];
  return sub ? sub.replace(/[^a-z0-9]/gi, '').slice(0, 8) || fallback : fallback;
}

/** Take a live photo with the camera. Returns null if cancelled. */
export async function captureChatPhoto(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new AttachmentError('Allow camera access to take a photo.');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
  });
  if (result.canceled || !result.assets[0]) return null;
  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height, mime: a.mimeType, size: a.fileSize };
}

/** Pick a photo from the gallery. Returns null if cancelled. */
export async function pickChatPhoto(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new AttachmentError('Allow photo access to share a picture.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
  });
  if (result.canceled || !result.assets[0]) return null;
  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height, mime: a.mimeType, size: a.fileSize };
}

/** Upload a picked image and return the attachment payload for the message. */
export async function uploadImageAttachment(uid: string, img: PickedImage) {
  const { url } = await uploadChatFile(uid, img.uri, extFromMime(img.mime, 'jpg'));
  return {
    url,
    mime: img.mime ?? 'image/jpeg',
    width: img.width ?? null,
    height: img.height ?? null,
    size: img.size ?? null,
  };
}

/** Pick a document/file. Requires expo-document-picker (native rebuild). */
export async function pickChatDocument(): Promise<PickedFile | null> {
  let DocumentPicker: typeof import('expo-document-picker');
  try {
    DocumentPicker = await import('expo-document-picker');
  } catch {
    throw new AttachmentError('Update the app to share documents.');
  }
  let result;
  try {
    result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  } catch {
    throw new AttachmentError('Update the app to share documents.');
  }
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  if ((a.size ?? 0) > 25 * 1024 * 1024) throw new AttachmentError('Files must be under 25 MB.');
  return { uri: a.uri, name: a.name, size: a.size, mime: a.mimeType };
}

/** Upload a picked document and return the attachment payload. */
export async function uploadFileAttachment(uid: string, file: PickedFile) {
  const extFromName = file.name.includes('.') ? file.name.split('.').pop() : undefined;
  const { url } = await uploadChatFile(uid, file.uri, extFromName || extFromMime(file.mime, 'bin'));
  return { url, name: file.name, size: file.size ?? null, mime: file.mime ?? null };
}

/** Pick a phone contact. Requires expo-contacts (native rebuild). */
export async function pickChatContact(): Promise<PickedContact | null> {
  let Contacts: typeof import('expo-contacts');
  try {
    Contacts = await import('expo-contacts');
  } catch {
    throw new AttachmentError('Update the app to share contacts.');
  }
  const perm = await Contacts.requestPermissionsAsync();
  if (!perm.granted) throw new AttachmentError('Allow contacts access to share a contact.');
  const picked = await Contacts.presentContactPickerAsync();
  if (!picked) return null;
  const name = picked.name || [picked.firstName, picked.lastName].filter(Boolean).join(' ') || 'Contact';
  const phone = picked.phoneNumbers?.[0]?.number?.trim();
  if (!phone) throw new AttachmentError('That contact has no phone number.');
  return { name, phone };
}

/** Read the device's current GPS location for sharing. */
export async function getChatLocation(): Promise<PickedLocation | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new AttachmentError('Allow location access to share your location.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  let label: string | null = null;
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (place) {
      label = [place.name, place.street, place.city].filter(Boolean).join(', ') || null;
    }
  } catch {
    /* reverse geocode is best-effort */
  }
  return { lat, lng, label };
}
