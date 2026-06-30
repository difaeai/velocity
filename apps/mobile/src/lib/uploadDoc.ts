import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export interface UploadResult {
  path: string;
  url: string;
}

// React Native's fetch().blob() fails on some platforms — use XHR instead,
// which creates a native Blob without going through ArrayBuffer.
function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new TypeError('Failed to read file for upload.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

export async function uploadDriverDoc(uid: string, kind: string, uri: string): Promise<UploadResult> {
  const path = `drivers/${uid}/documents/${kind}-${Date.now()}`;
  const storageRef = ref(storage, path);
  const blob = await uriToBlob(uri);
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);
  return { path, url };
}
