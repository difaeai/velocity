import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export interface UploadResult {
  path: string;
  url: string;
}

/**
 * Uploads a local file URI to the driver's private documents folder.
 * Returns both the storage path AND a permanent download URL so the admin
 * panel can display the image directly from Firestore without extra API calls.
 */
export async function uploadDriverDoc(uid: string, kind: string, uri: string): Promise<UploadResult> {
  const path = `drivers/${uid}/documents/${kind}-${Date.now()}`;
  const storageRef = ref(storage, path);
  const res = await fetch(uri);
  const blob = await res.blob();
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);
  return { path, url };
}
