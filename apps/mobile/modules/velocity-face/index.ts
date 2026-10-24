/**
 * Which way the face in one photo is pointing, read on the phone — ML Kit on
 * Android, Apple's Vision on iPhone. Native code: ./android, ./ios.
 *
 * The face scan reads every picture it takes with this, so it can see a head
 * turn the moment it happens instead of firing the shutter on a timer. Nothing
 * here is trusted beyond the screen: the server still scores the frames.
 *
 * `detectFace` is null on a build without the module (a dev client made before
 * it existed); the face scan falls back to its timer there.
 */
import { requireOptionalNativeModule } from 'expo';

export interface FaceReading {
  /** Faces in the picture. */
  count: number;
  /**
   * The largest face's head turn, in degrees. The sign is a direction in the
   * picture, not the person's left or right — a front camera may or may not
   * mirror what it saves.
   */
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** The largest face, as fractions of the picture, from its top-left corner. */
  box?: { x: number; y: number; width: number; height: number };
}

const native = requireOptionalNativeModule<{ detectFaceAsync(uri: string): Promise<FaceReading> }>(
  'VelocityFace',
);

export const detectFace = native ? (uri: string) => native.detectFaceAsync(uri) : null;
