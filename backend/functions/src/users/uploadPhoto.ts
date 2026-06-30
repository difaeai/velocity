import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { randomUUID } from 'crypto';

if (!admin.apps.length) admin.initializeApp();

const schema = z.object({
  base64: z.string().min(10).max(8_000_000), // ~6 MB encoded limit
  kind: z.enum(['avatar', 'travelMate']),
});

/**
 * Uploads a user photo from a base64 string to Firebase Storage via the
 * Admin SDK. Avoids all React Native Blob/ArrayBuffer limitations.
 * Returns a permanent download URL with an embedded token.
 */
export const uploadUserPhoto = onCall(
  { region: 'asia-south1', maxInstances: 10 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;

    const parsed = schema.safeParse(req.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid photo data.');
    }
    const { base64, kind } = parsed.data;

    const path = kind === 'avatar'
      ? `avatars/${uid}.jpg`
      : `travelMatePhotos/${uid}.jpg`;

    const buffer = Buffer.from(base64, 'base64');
    const token = randomUUID();
    const bucket = admin.storage().bucket();

    await bucket.file(path).save(buffer, {
      metadata: {
        contentType: 'image/jpeg',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });

    const encodedPath = encodeURIComponent(path);
    const photoURL =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
      `/o/${encodedPath}?alt=media&token=${token}`;

    return { photoURL };
  },
);
