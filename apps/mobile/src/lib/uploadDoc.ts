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
  return upload(path, uri);
}

/**
 * Payment screenshot proving a debt to Velocity was settled. Lives under
 * `settlements/{uid}/` — a path passengers can write to as well, since anyone
 * can owe a cancellation fee (driver commission proofs stay under drivers/).
 */
export async function uploadSettlementProof(uid: string, uri: string): Promise<UploadResult> {
  const path = `settlements/${uid}/fee-${Date.now()}`;
  return upload(path, uri);
}

/**
 * Passenger CNIC photo — the identity gate in front of the courier flow. Lives
 * under `cnic/{uid}/` (readable only by the owner and admins, per storage.rules).
 */
export async function uploadCnicDoc(uid: string, side: 'front' | 'back', uri: string): Promise<UploadResult> {
  const path = `cnic/${uid}/${side}-${Date.now()}`;
  return upload(path, uri);
}

/**
 * Pro Partner registration-fee receipt. Lives under `partners/{uid}/` — readable
 * only by the applicant and the admin who reviews it, since it carries their
 * bank details.
 */
export async function uploadPartnerPaymentProof(uid: string, uri: string): Promise<UploadResult> {
  const path = `partners/${uid}/payment-${Date.now()}`;
  return upload(path, uri);
}

/**
 * The offer picture that goes out with a business-ad push. Lives under
 * `businessAdMedia/{uid}/` — readable by any signed-in user, because whoever gets
 * the notification has to be able to see the picture.
 */
export async function uploadBusinessAdImage(uid: string, uri: string): Promise<UploadResult> {
  const path = `businessAdMedia/${uid}/offer-${Date.now()}`;
  return upload(path, uri);
}

/**
 * Advertising-fee receipt. Lives under `businessAdPayments/{uid}/` — owner and
 * admin only, same as the partner receipts, since it carries bank details.
 */
export async function uploadBusinessAdPaymentProof(uid: string, uri: string): Promise<UploadResult> {
  const path = `businessAdPayments/${uid}/payment-${Date.now()}`;
  return upload(path, uri);
}

/**
 * Special Rides host papers — insurance proof or vehicle registration. Lives
 * under `specialRides/{uid}/documents/`, readable only by the host and the
 * admin who reviews the listing, since the papers carry the owner's details.
 *
 * The content type is set explicitly: the storage rule for this path accepts
 * images only, and a blob read back from a local file does not always carry
 * its type. The pickers feeding this are image-only, so JPEG is the fallback.
 */
export async function uploadSpecialRidesDoc(
  uid: string,
  kind: 'insurance' | 'registration',
  uri: string,
  mime?: string | null,
): Promise<UploadResult> {
  const path = `specialRides/${uid}/documents/${kind}-${Date.now()}`;
  return upload(path, uri, mime?.startsWith('image/') ? mime : 'image/jpeg');
}

async function upload(path: string, uri: string, contentType?: string): Promise<UploadResult> {
  const storageRef = ref(storage, path);
  const blob = await uriToBlob(uri);
  await uploadBytes(storageRef, blob, contentType ? { contentType } : undefined);
  const url = await getDownloadURL(storageRef);
  return { path, url };
}
