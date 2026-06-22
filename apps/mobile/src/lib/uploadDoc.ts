import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

/**
 * Uploads a local file URI to the driver's private documents folder and returns
 * the storage path. Storage rules allow the owner to write here (capped 15MB)
 * but only the owner and admins can read it back.
 */
export async function uploadDriverDoc(uid: string, kind: string, uri: string): Promise<string> {
  const path = `drivers/${uid}/documents/${kind}-${Date.now()}`;
  const res = await fetch(uri);
  const blob = await res.blob();
  await uploadBytes(ref(storage, path), blob);
  return path;
}
