/**
 * A person's own video or pictures, on the way to the team. The brain box and
 * the calendar both start here, so both accept and refuse the same files.
 */

import { ref, uploadBytes } from 'firebase/storage';

import { storage } from '@/lib/firebase';

/** MP4 and MOV are the videos every network here accepts. */
export const OWN_ACCEPT = 'video/mp4,video/quicktime,image/*';

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_PICTURES = 10;

export const hasVideo = (files: File[]) => files.some((f) => f.type.startsWith('video/'));

/** What is wrong with this set of files, or null. storage.rules would refuse a big one with an error nobody could read. */
export function ownFilesProblem(files: File[]): string | null {
  if (hasVideo(files) && files.length > 1) return 'Choose one video, or some pictures, not both.';
  if (files.length > MAX_PICTURES) return `Choose up to ${MAX_PICTURES} pictures.`;
  if (files.some((f) => f.size > MAX_BYTES)) return 'That file is over 200 MB. Trim it and try again.';
  return null;
}

/** Into Storage, in the order they were picked: the backend reads them from there. */
export function uploadOwnFiles(files: File[], path: (p: string) => string): Promise<string[]> {
  return Promise.all(
    files.map(async (file, i) => {
      const upload = path(`socialUploads/own-${Date.now()}-${i}-${file.name.replace(/[^\w.-]/g, '').slice(-80)}`);
      await uploadBytes(ref(storage, upload), file, { contentType: file.type });
      return upload;
    }),
  );
}
