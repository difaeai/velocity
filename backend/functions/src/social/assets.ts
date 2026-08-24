/**
 * Where the crew's files live.
 *
 * Everything Rang draws and everything Raftar renders ends up in our own
 * bucket, under one folder per post, because the networks *pull* media from a
 * URL rather than accepting an upload from us — Instagram, Facebook, Threads
 * and TikTok all work this way. A file the crew made and nobody can fetch is
 * not a post.
 *
 * Signed URLs are preferred: the link expires and nothing is left permanently
 * open. On a bucket with uniform access and no token-creator role the signing
 * call fails, in which case the object is made public instead — this is
 * marketing media about to be posted publicly anyway, so the fallback costs
 * nothing but is worth knowing about.
 */
import { logger } from 'firebase-functions';

import { storage } from '../lib/firebase';
import type { MediaAsset } from './types';

/** Long enough that a post retried days later still has a working link. */
export const URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredFile {
  path: string;
  url: string;
  /** 0 means "public object, never expires". */
  expiresAtMs: number;
}

/** One folder per post keeps a five-slide carousel from littering the bucket. */
export function postFolder(postId: string): string {
  return `social/${postId}`;
}

export async function storeFile(params: {
  path: string;
  bytes: Buffer;
  contentType: string;
}): Promise<StoredFile> {
  const file = storage.bucket().file(params.path);
  await file.save(params.bytes, { contentType: params.contentType, resumable: false });

  const expiresAtMs = Date.now() + URL_TTL_MS;
  try {
    const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAtMs });
    return { path: params.path, url, expiresAtMs };
  } catch (e) {
    logger.warn('social: could not sign a media URL, falling back to a public object', { path: params.path, e });
    await file.makePublic();
    return {
      path: params.path,
      url: `https://storage.googleapis.com/${storage.bucket().name}/${params.path}`,
      expiresAtMs: 0,
    };
  }
}

/** Re-sign one asset whose URL has aged out, so a retry days later still works. */
export async function refreshAssetUrl(asset: MediaAsset): Promise<MediaAsset> {
  if (!asset.storagePath) return asset;
  if (asset.urlExpiresAtMs === 0) return asset; // public object, never expires
  if (asset.urlExpiresAtMs && asset.urlExpiresAtMs > Date.now() + 60_000) return asset;

  const file = storage.bucket().file(asset.storagePath);
  const expiresAtMs = Date.now() + URL_TTL_MS;
  try {
    const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAtMs });
    return { ...asset, url, urlExpiresAtMs: expiresAtMs };
  } catch (e) {
    logger.warn('social: could not re-sign a media URL', { path: asset.storagePath, e });
    return asset;
  }
}

export async function refreshAssetUrls(assets: MediaAsset[]): Promise<MediaAsset[]> {
  return Promise.all(assets.map(refreshAssetUrl));
}

/** Read one of our own files back — YouTube is the network that won't fetch. */
export async function downloadAsset(asset: MediaAsset): Promise<Buffer> {
  if (asset.storagePath) {
    const [bytes] = await storage.bucket().file(asset.storagePath).download();
    return bytes;
  }
  if (!asset.url) throw new Error('That asset has neither a storage path nor a URL.');
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`Could not read the media back (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
