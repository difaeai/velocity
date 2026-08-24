/**
 * The network adapters: prove a credential, post in whatever format the crew
 * made, and read the comments that come back.
 *
 * Each adapter does up to four things — `verify` turns a pasted token into a
 * profile (which is how the console can say "connected as @velocity.rides_,
 * 158k followers" rather than "saved"), `publish` puts one finished piece up,
 * `listComments` reads what people said under it, and `reply` answers them.
 * Anything a network cannot do is absent rather than faked; `PLATFORM_FORMATS`
 * in types.ts is the matrix the pipeline trusts, and the console greys out the
 * rest.
 *
 * ⚠️ These were written from each platform's public API documentation. Meta,
 * TikTok, X, LinkedIn and YouTube all gate publishing behind app review and
 * scopes that only exist on an approved app, so the first successful post from
 * a *new* app is the real test — verify each adapter against your app's own
 * docs before turning the crew loose. Every call fails loudly with the
 * network's own error text, which is what you will need when one of them does
 * not match.
 *
 * Most networks pull media from a URL rather than accepting an upload from us,
 * which is why everything the crew makes lands in Cloud Storage behind a signed
 * URL first (see assets.ts). YouTube, X and LinkedIn are the exceptions: they
 * want the bytes, so the file is streamed back through the backend.
 */
import { logger } from 'firebase-functions';

import { downloadAsset } from './assets';
import type {
  ContentFormat,
  MediaAsset,
  Platform,
  PlatformCredentials,
  PlatformProfile,
} from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS = 'https://graph.threads.net/v1.0';

/** How long to wait for a network to finish ingesting media before giving up. */
const INGEST_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export class PlatformError extends Error {
  constructor(
    readonly platform: Platform,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

async function call<T>(
  platform: Platform,
  url: string,
  init?: RequestInit & { form?: Record<string, string>; json?: unknown },
): Promise<T> {
  const options: RequestInit = { method: init?.method ?? 'GET', headers: { ...(init?.headers ?? {}) } };
  if (init?.form) {
    options.method = init.method ?? 'POST';
    options.body = new URLSearchParams(init.form).toString();
    options.headers = {
      ...(options.headers as Record<string, string>),
      'content-type': 'application/x-www-form-urlencoded',
    };
  } else if (init?.json !== undefined) {
    options.method = init.method ?? 'POST';
    options.body = JSON.stringify(init.json);
    options.headers = { ...(options.headers as Record<string, string>), 'content-type': 'application/json' };
  }

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new PlatformError(platform, `Network error talking to ${platform}: ${(e as Error).message}`);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    // Surface the network's own message — "(#200) requires pages_manage_posts"
    // tells you exactly what to fix; "request failed" does not.
    const b = body as
      | { error?: { message?: string }; error_description?: string; message?: string; detail?: string }
      | string
      | null;
    const detail =
      typeof b === 'string'
        ? b.slice(0, 300)
        : (b?.error?.message ?? b?.error_description ?? b?.message ?? b?.detail ?? `HTTP ${res.status}`);
    throw new PlatformError(platform, detail);
  }
  return body as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a finished piece looks like to an adapter. */
export interface PublishPayload {
  format: ContentFormat;
  /** One video, or one to ten images in slide order. */
  media: MediaAsset[];
  caption: string;
  title: string;
  tags: string[];
  /**
   * What the search desk wrote for YouTube. Used verbatim when present —
   * a title written for search is the entire reason that job exists, and
   * re-deriving one from the hook here would quietly throw that work away.
   */
  youtube?: { title: string; description: string; tags: string[] } | null;
}

export interface RawComment {
  commentId: string;
  mediaId: string;
  authorName: string;
  text: string;
  permalink: string | null;
  createdAtMs: number;
}

const firstVideo = (p: PublishPayload, platform: Platform): MediaAsset => {
  const video = p.media.find((m) => m.kind === 'video' && m.url);
  if (!video?.url) throw new PlatformError(platform, 'That post has no rendered video to publish.');
  return video;
};

const images = (p: PublishPayload, platform: Platform): MediaAsset[] => {
  const list = p.media.filter((m) => m.kind === 'image' && m.url).sort((a, b) => a.slide - b.slide);
  if (!list.length) throw new PlatformError(platform, 'That post has no images to publish.');
  return list;
};

// ── Facebook Page ───────────────────────────────────────────────────────────

async function verifyFacebook(c: PlatformCredentials): Promise<PlatformProfile> {
  // A page access token answers /me as the page itself.
  const me = await call<{ id: string; name: string; username?: string; followers_count?: number }>(
    'facebook',
    `${GRAPH}/${c.externalId ?? 'me'}?fields=id,name,username,followers_count,fan_count&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return {
    displayName: me.name,
    handle: me.username ? `@${me.username}` : null,
    externalId: me.id,
    followers: me.followers_count ?? null,
    avatarUrl: `${GRAPH}/${me.id}/picture?type=large`,
  };
}

/** Upload one photo without publishing it, so it can be attached to something. */
async function facebookStagePhoto(c: PlatformCredentials, url: string): Promise<string> {
  const res = await call<{ id: string }>('facebook', `${GRAPH}/${c.externalId}/photos`, {
    form: { url, published: 'false', access_token: c.accessToken },
  });
  return res.id;
}

async function publishFacebook(
  c: PlatformCredentials,
  p: PublishPayload,
): Promise<{ id: string; url: string }> {
  if (p.format === 'reel' || p.format === 'video') {
    const video = firstVideo(p, 'facebook');
    const res = await call<{ id: string }>('facebook', `${GRAPH}/${c.externalId}/videos`, {
      form: { file_url: video.url!, description: p.caption, access_token: c.accessToken },
    });
    return { id: res.id, url: `https://www.facebook.com/${res.id}` };
  }

  if (p.format === 'story') {
    // Stories attach an already-uploaded photo rather than taking a URL.
    const photoId = await facebookStagePhoto(c, images(p, 'facebook')[0].url!);
    const res = await call<{ post_id?: string; id?: string; success?: boolean }>(
      'facebook',
      `${GRAPH}/${c.externalId}/photo_stories`,
      { form: { photo_id: photoId, access_token: c.accessToken } },
    );
    const id = res.post_id ?? res.id ?? photoId;
    return { id, url: `https://www.facebook.com/${c.externalId}` };
  }

  const photos = images(p, 'facebook');
  if (p.format === 'post' && photos.length === 1) {
    const res = await call<{ post_id?: string; id: string }>('facebook', `${GRAPH}/${c.externalId}/photos`, {
      form: { url: photos[0].url!, caption: p.caption, access_token: c.accessToken },
    });
    return { id: res.post_id ?? res.id, url: `https://www.facebook.com/${res.post_id ?? res.id}` };
  }

  // A carousel on a Page is one feed post with several attached photos.
  const staged: string[] = [];
  for (const image of photos.slice(0, 10)) staged.push(await facebookStagePhoto(c, image.url!));
  const res = await call<{ id: string }>('facebook', `${GRAPH}/${c.externalId}/feed`, {
    form: {
      message: p.caption,
      attached_media: JSON.stringify(staged.map((id) => ({ media_fbid: id }))),
      access_token: c.accessToken,
    },
  });
  return { id: res.id, url: `https://www.facebook.com/${res.id}` };
}

async function facebookComments(c: PlatformCredentials, mediaId: string): Promise<RawComment[]> {
  const res = await call<{
    data?: { id: string; message?: string; created_time?: string; permalink_url?: string; from?: { name?: string } }[];
  }>(
    'facebook',
    `${GRAPH}/${mediaId}/comments?fields=id,message,created_time,permalink_url,from&limit=50&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return (res.data ?? []).map((comment) => ({
    commentId: comment.id,
    mediaId,
    authorName: comment.from?.name ?? 'Someone',
    text: comment.message ?? '',
    permalink: comment.permalink_url ?? null,
    createdAtMs: comment.created_time ? Date.parse(comment.created_time) : Date.now(),
  }));
}

async function facebookReply(c: PlatformCredentials, commentId: string, text: string): Promise<string> {
  const res = await call<{ id: string }>('facebook', `${GRAPH}/${commentId}/comments`, {
    form: { message: text, access_token: c.accessToken },
  });
  return res.id;
}

// ── Instagram (Business/Creator) ────────────────────────────────────────────

async function verifyInstagram(c: PlatformCredentials): Promise<PlatformProfile> {
  if (!c.externalId) {
    throw new PlatformError('instagram', 'Instagram needs the Business account ID as well as a token.');
  }
  const me = await call<{
    id: string;
    username: string;
    name?: string;
    followers_count?: number;
    profile_picture_url?: string;
  }>(
    'instagram',
    `${GRAPH}/${c.externalId}?fields=id,username,name,followers_count,profile_picture_url&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return {
    displayName: me.name ?? me.username,
    handle: `@${me.username}`,
    externalId: me.id,
    followers: me.followers_count ?? null,
    avatarUrl: me.profile_picture_url ?? null,
  };
}

/**
 * Instagram containers are asynchronous: it downloads and transcodes the file
 * on its own time, and publishing a container that is still `IN_PROGRESS` is
 * the single most common way this call fails. Hence the poll.
 */
async function instagramAwait(c: PlatformCredentials, containerId: string): Promise<void> {
  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    const status = await call<{ status_code: string; status?: string }>(
      'instagram',
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(c.accessToken)}`,
    );
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PlatformError('instagram', `Instagram rejected the media: ${status.status ?? status.status_code}`);
    }
    if (Date.now() > deadline) {
      throw new PlatformError('instagram', 'Instagram is still processing the media after 5 minutes.');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function instagramContainer(c: PlatformCredentials, form: Record<string, string>): Promise<string> {
  const res = await call<{ id: string }>('instagram', `${GRAPH}/${c.externalId}/media`, {
    form: { ...form, access_token: c.accessToken },
  });
  return res.id;
}

async function publishInstagram(
  c: PlatformCredentials,
  p: PublishPayload,
): Promise<{ id: string; url: string }> {
  let containerId: string;

  if (p.format === 'reel') {
    containerId = await instagramContainer(c, {
      media_type: 'REELS',
      video_url: firstVideo(p, 'instagram').url!,
      caption: p.caption,
      share_to_feed: 'true',
    });
  } else if (p.format === 'story') {
    containerId = await instagramContainer(c, {
      media_type: 'STORIES',
      image_url: images(p, 'instagram')[0].url!,
    });
  } else if (p.format === 'carousel') {
    const slides = images(p, 'instagram').slice(0, 10);
    if (slides.length < 2) throw new PlatformError('instagram', 'A carousel needs at least two images.');
    const children: string[] = [];
    for (const slide of slides) {
      const child = await instagramContainer(c, { image_url: slide.url!, is_carousel_item: 'true' });
      await instagramAwait(c, child);
      children.push(child);
    }
    containerId = await instagramContainer(c, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: p.caption,
    });
  } else {
    containerId = await instagramContainer(c, {
      image_url: images(p, 'instagram')[0].url!,
      caption: p.caption,
    });
  }

  await instagramAwait(c, containerId);

  const published = await call<{ id: string }>('instagram', `${GRAPH}/${c.externalId}/media_publish`, {
    form: { creation_id: containerId, access_token: c.accessToken },
  });
  const path = p.format === 'reel' ? 'reel' : 'p';
  return { id: published.id, url: `https://www.instagram.com/${path}/${published.id}` };
}

async function instagramComments(c: PlatformCredentials, mediaId: string): Promise<RawComment[]> {
  const res = await call<{
    data?: { id: string; text?: string; timestamp?: string; username?: string }[];
  }>(
    'instagram',
    `${GRAPH}/${mediaId}/comments?fields=id,text,timestamp,username&limit=50&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return (res.data ?? []).map((comment) => ({
    commentId: comment.id,
    mediaId,
    authorName: comment.username ? `@${comment.username}` : 'Someone',
    text: comment.text ?? '',
    permalink: null,
    createdAtMs: comment.timestamp ? Date.parse(comment.timestamp) : Date.now(),
  }));
}

async function instagramReply(c: PlatformCredentials, commentId: string, text: string): Promise<string> {
  const res = await call<{ id: string }>('instagram', `${GRAPH}/${commentId}/replies`, {
    form: { message: text, access_token: c.accessToken },
  });
  return res.id;
}

// ── Threads ─────────────────────────────────────────────────────────────────

async function verifyThreads(c: PlatformCredentials): Promise<PlatformProfile> {
  const me = await call<{ id: string; username: string; threads_profile_picture_url?: string }>(
    'threads',
    `${THREADS}/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return {
    displayName: me.username,
    handle: `@${me.username}`,
    externalId: me.id,
    followers: null,
    avatarUrl: me.threads_profile_picture_url ?? null,
  };
}

async function threadsContainer(c: PlatformCredentials, form: Record<string, string>): Promise<string> {
  const res = await call<{ id: string }>('threads', `${THREADS}/${c.externalId}/threads`, {
    form: { ...form, access_token: c.accessToken },
  });
  return res.id;
}

async function threadsAwait(c: PlatformCredentials, containerId: string): Promise<void> {
  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    const status = await call<{ status: string; error_message?: string }>(
      'threads',
      `${THREADS}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(c.accessToken)}`,
    );
    if (status.status === 'FINISHED') return;
    if (status.status === 'ERROR' || status.status === 'EXPIRED') {
      throw new PlatformError('threads', status.error_message ?? `Threads returned ${status.status}`);
    }
    if (Date.now() > deadline) throw new PlatformError('threads', 'Threads is still processing after 5 minutes.');
    await sleep(POLL_INTERVAL_MS);
  }
}

async function threadsPublish(c: PlatformCredentials, containerId: string): Promise<{ id: string; url: string }> {
  const published = await call<{ id: string }>('threads', `${THREADS}/${c.externalId}/threads_publish`, {
    form: { creation_id: containerId, access_token: c.accessToken },
  });
  return { id: published.id, url: `https://www.threads.net/@${c.externalId}/post/${published.id}` };
}

async function publishThreads(c: PlatformCredentials, p: PublishPayload): Promise<{ id: string; url: string }> {
  let containerId: string;

  if (p.format === 'reel') {
    containerId = await threadsContainer(c, {
      media_type: 'VIDEO',
      video_url: firstVideo(p, 'threads').url!,
      text: p.caption,
    });
  } else if (p.format === 'carousel') {
    const slides = images(p, 'threads').slice(0, 10);
    const children: string[] = [];
    for (const slide of slides) {
      const child = await threadsContainer(c, {
        media_type: 'IMAGE',
        image_url: slide.url!,
        is_carousel_item: 'true',
      });
      await threadsAwait(c, child);
      children.push(child);
    }
    containerId = await threadsContainer(c, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      text: p.caption,
    });
  } else {
    const image = p.media.find((m) => m.kind === 'image' && m.url);
    containerId = image
      ? await threadsContainer(c, { media_type: 'IMAGE', image_url: image.url!, text: p.caption })
      : await threadsContainer(c, { media_type: 'TEXT', text: p.caption });
  }

  await threadsAwait(c, containerId);
  return threadsPublish(c, containerId);
}

async function threadsComments(c: PlatformCredentials, mediaId: string): Promise<RawComment[]> {
  const res = await call<{
    data?: { id: string; text?: string; timestamp?: string; username?: string; permalink?: string }[];
  }>(
    'threads',
    `${THREADS}/${mediaId}/replies?fields=id,text,timestamp,username,permalink&access_token=${encodeURIComponent(c.accessToken)}`,
  );
  return (res.data ?? []).map((reply) => ({
    commentId: reply.id,
    mediaId,
    authorName: reply.username ? `@${reply.username}` : 'Someone',
    text: reply.text ?? '',
    permalink: reply.permalink ?? null,
    createdAtMs: reply.timestamp ? Date.parse(reply.timestamp) : Date.now(),
  }));
}

async function threadsReply(c: PlatformCredentials, commentId: string, text: string): Promise<string> {
  const containerId = await threadsContainer(c, { media_type: 'TEXT', text, reply_to_id: commentId });
  await threadsAwait(c, containerId);
  const published = await threadsPublish(c, containerId);
  return published.id;
}

// ── TikTok ──────────────────────────────────────────────────────────────────

async function verifyTikTok(c: PlatformCredentials): Promise<PlatformProfile> {
  const res = await call<{
    data: { user: { open_id: string; display_name: string; follower_count?: number; avatar_url?: string } };
  }>(
    'tiktok',
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,avatar_url',
    { headers: { authorization: `Bearer ${c.accessToken}` } },
  );
  const u = res.data.user;
  return {
    displayName: u.display_name,
    handle: null,
    externalId: u.open_id,
    followers: u.follower_count ?? null,
    avatarUrl: u.avatar_url ?? null,
  };
}

/**
 * TikTok pulls the file from our signed URL. The URL's host must be on the
 * app's verified-domain list in the TikTok developer portal, or init returns
 * `url_ownership_unverified` — that is a portal setting, not a bug here.
 */
async function publishTikTok(c: PlatformCredentials, p: PublishPayload): Promise<{ id: string; url: string }> {
  const video = firstVideo(p, 'tiktok');
  const res = await call<{ data: { publish_id: string }; error?: { code: string; message: string } }>(
    'tiktok',
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      headers: { authorization: `Bearer ${c.accessToken}` },
      json: {
        post_info: { title: p.caption.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE' },
        source_info: { source: 'PULL_FROM_URL', video_url: video.url! },
      },
    },
  );
  if (res.error && res.error.code !== 'ok') {
    throw new PlatformError('tiktok', `${res.error.code}: ${res.error.message}`);
  }
  // TikTok finishes the upload asynchronously and gives no public URL until the
  // video is live, so the publish id is what we keep.
  return { id: res.data.publish_id, url: 'https://www.tiktok.com/' };
}

// ── YouTube ─────────────────────────────────────────────────────────────────

/**
 * YouTube access tokens last an hour, so what is stored is the refresh token
 * plus the OAuth client that issued it. Every call mints a fresh access token.
 */
async function youtubeAccessToken(c: PlatformCredentials): Promise<string> {
  if (!c.clientId || !c.clientSecret) {
    throw new PlatformError('youtube', 'YouTube needs the OAuth client ID and secret alongside the refresh token.');
  }
  const res = await call<{ access_token: string }>('youtube', 'https://oauth2.googleapis.com/token', {
    form: {
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.accessToken,
      grant_type: 'refresh_token',
    },
  });
  return res.access_token;
}

async function verifyYouTube(c: PlatformCredentials): Promise<PlatformProfile> {
  const token = await youtubeAccessToken(c);
  const res = await call<{
    items?: {
      id: string;
      snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } };
      statistics?: { subscriberCount?: string };
    }[];
  }>('youtube', 'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { authorization: `Bearer ${token}` },
  });
  const channel = res.items?.[0];
  if (!channel) throw new PlatformError('youtube', 'That account has no YouTube channel.');
  return {
    displayName: channel.snippet.title,
    handle: channel.snippet.customUrl ?? null,
    externalId: channel.id,
    followers: channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : null,
    avatarUrl: channel.snippet.thumbnails?.default?.url ?? null,
  };
}

/**
 * YouTube is the one network that will not fetch the file itself, so the video
 * is streamed through us: start a resumable session, then PUT the bytes.
 */
async function publishYouTube(c: PlatformCredentials, p: PublishPayload): Promise<{ id: string; url: string }> {
  const token = await youtubeAccessToken(c);
  const video = firstVideo(p, 'youtube');

  const start = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          // A vertical upload under a minute is a Short; the hashtag is what
          // tells YouTube to treat it as one.
          title: `${(p.youtube?.title || p.title).slice(0, 90)}${p.format === 'reel' ? ' #Shorts' : ''}`.slice(0, 100),
          description: (p.youtube?.description || p.caption).slice(0, 5000),
          tags: (p.youtube?.tags.length ? p.youtube.tags : p.tags).slice(0, 20),
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    },
  );
  const uploadUrl = start.headers.get('location');
  if (!start.ok || !uploadUrl) {
    throw new PlatformError('youtube', `Could not start the upload: ${(await start.text()).slice(0, 300)}`);
  }

  const bytes = await downloadAsset(video).catch(() => {
    throw new PlatformError('youtube', 'Could not read the rendered video back from storage.');
  });

  const done = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) },
    body: new Uint8Array(bytes),
  });
  if (!done.ok) throw new PlatformError('youtube', `Upload failed: ${(await done.text()).slice(0, 300)}`);
  const result = (await done.json()) as { id: string };
  return { id: result.id, url: `https://www.youtube.com/watch?v=${result.id}` };
}

async function youtubeComments(c: PlatformCredentials, mediaId: string): Promise<RawComment[]> {
  const token = await youtubeAccessToken(c);
  const res = await call<{
    items?: {
      snippet?: {
        topLevelComment?: {
          id: string;
          snippet?: { authorDisplayName?: string; textOriginal?: string; publishedAt?: string };
        };
      };
    }[];
  }>(
    'youtube',
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(mediaId)}&maxResults=50&order=time`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return (res.items ?? [])
    .map((item) => item.snippet?.topLevelComment)
    .filter((comment): comment is NonNullable<typeof comment> => Boolean(comment?.id))
    .map((comment) => ({
      commentId: comment.id,
      mediaId,
      authorName: comment.snippet?.authorDisplayName ?? 'Someone',
      text: comment.snippet?.textOriginal ?? '',
      permalink: `https://www.youtube.com/watch?v=${mediaId}&lc=${comment.id}`,
      createdAtMs: comment.snippet?.publishedAt ? Date.parse(comment.snippet.publishedAt) : Date.now(),
    }));
}

async function youtubeReply(c: PlatformCredentials, commentId: string, text: string): Promise<string> {
  const token = await youtubeAccessToken(c);
  const res = await call<{ id: string }>('youtube', 'https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    headers: { authorization: `Bearer ${token}` },
    json: { snippet: { parentId: commentId, textOriginal: text } },
  });
  return res.id;
}

// ── X ───────────────────────────────────────────────────────────────────────

async function verifyX(c: PlatformCredentials): Promise<PlatformProfile> {
  const res = await call<{ data: { id: string; name: string; username: string } }>(
    'x',
    'https://api.twitter.com/2/users/me?user.fields=public_metrics,profile_image_url',
    { headers: { authorization: `Bearer ${c.accessToken}` } },
  );
  const d = res.data as typeof res.data & {
    public_metrics?: { followers_count: number };
    profile_image_url?: string;
  };
  return {
    displayName: d.name,
    handle: `@${d.username}`,
    externalId: d.id,
    followers: d.public_metrics?.followers_count ?? null,
    avatarUrl: d.profile_image_url ?? null,
  };
}

/** X wants the bytes, as multipart, before it will attach anything to a post. */
async function xUploadImage(c: PlatformCredentials, asset: MediaAsset): Promise<string> {
  const bytes = await downloadAsset(asset);
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'image.png');
  form.append('media_category', 'tweet_image');

  const res = await fetch('https://api.x.com/2/media/upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${c.accessToken}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new PlatformError('x', `Media upload failed: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { data?: { id?: string }; media_id_string?: string };
  const id = body.data?.id ?? body.media_id_string;
  if (!id) throw new PlatformError('x', 'X accepted the image but returned no media id.');
  return id;
}

async function publishX(c: PlatformCredentials, p: PublishPayload): Promise<{ id: string; url: string }> {
  const image = p.media.find((m) => m.kind === 'image' && m.url);
  const mediaIds: string[] = [];
  if (image) {
    try {
      mediaIds.push(await xUploadImage(c, image));
    } catch (e) {
      // A text post that goes out beats a post that didn't because the image
      // endpoint moved. The error is logged, not swallowed silently.
      logger.warn('social: X would not take the image; posting text only', { message: (e as Error).message });
    }
  }

  const res = await call<{ data: { id: string } }>('x', 'https://api.x.com/2/tweets', {
    headers: { authorization: `Bearer ${c.accessToken}` },
    json: {
      text: p.caption.slice(0, 280),
      ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
    },
  });
  return { id: res.data.id, url: `https://x.com/i/web/status/${res.data.id}` };
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

async function verifyLinkedIn(c: PlatformCredentials): Promise<PlatformProfile> {
  const me = await call<{ sub: string; name: string; picture?: string }>(
    'linkedin',
    'https://api.linkedin.com/v2/userinfo',
    { headers: { authorization: `Bearer ${c.accessToken}` } },
  );
  return {
    displayName: me.name,
    handle: null,
    externalId: c.externalId ?? me.sub,
    followers: null,
    avatarUrl: me.picture ?? null,
  };
}

/** Post as the organisation when a URN was given, otherwise as the person. */
function linkedinAuthor(c: PlatformCredentials): string {
  const id = c.externalId ?? '';
  return id.startsWith('urn:li:') ? id : `urn:li:person:${id}`;
}

async function linkedinUploadImage(c: PlatformCredentials, asset: MediaAsset): Promise<string> {
  const author = linkedinAuthor(c);
  const registered = await call<{
    value?: { asset?: string; uploadMechanism?: Record<string, { uploadUrl?: string }> };
  }>('linkedin', 'https://api.linkedin.com/v2/assets?action=registerUpload', {
    headers: { authorization: `Bearer ${c.accessToken}`, 'x-restli-protocol-version': '2.0.0' },
    json: {
      registerUploadRequest: {
        owner: author,
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
        ],
      },
    },
  });

  const mechanism = registered.value?.uploadMechanism ?? {};
  const uploadUrl = Object.values(mechanism)[0]?.uploadUrl;
  const assetUrn = registered.value?.asset;
  if (!uploadUrl || !assetUrn) throw new PlatformError('linkedin', 'LinkedIn did not return an upload URL.');

  const bytes = await downloadAsset(asset);
  const put = await fetch(uploadUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.accessToken}`, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new PlatformError('linkedin', `Image upload failed: ${(await put.text()).slice(0, 300)}`);
  return assetUrn;
}

async function publishLinkedIn(c: PlatformCredentials, p: PublishPayload): Promise<{ id: string; url: string }> {
  const author = linkedinAuthor(c);
  const image = p.media.find((m) => m.kind === 'image' && m.url);

  let assetUrn: string | null = null;
  if (image) {
    try {
      assetUrn = await linkedinUploadImage(c, image);
    } catch (e) {
      logger.warn('social: LinkedIn would not take the image; posting text only', {
        message: (e as Error).message,
      });
    }
  }

  const res = await call<{ id: string }>('linkedin', 'https://api.linkedin.com/v2/ugcPosts', {
    headers: { authorization: `Bearer ${c.accessToken}`, 'x-restli-protocol-version': '2.0.0' },
    json: {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: p.caption.slice(0, 3000) },
          shareMediaCategory: assetUrn ? 'IMAGE' : 'NONE',
          ...(assetUrn
            ? { media: [{ status: 'READY', media: assetUrn, description: { text: image?.alt ?? '' } }] }
            : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    },
  });
  return { id: res.id, url: `https://www.linkedin.com/feed/update/${res.id}` };
}

// ── registry ────────────────────────────────────────────────────────────────

interface Adapter {
  label: string;
  verify: (c: PlatformCredentials) => Promise<PlatformProfile>;
  publish?: (c: PlatformCredentials, p: PublishPayload) => Promise<{ id: string; url: string }>;
  /** Read what people said under one of our posts. */
  listComments?: (c: PlatformCredentials, mediaId: string) => Promise<RawComment[]>;
  /** Answer one of them. */
  reply?: (c: PlatformCredentials, commentId: string, text: string) => Promise<string>;
  /** What the console tells you to paste, in order. */
  fields: { key: keyof PlatformCredentials; label: string; hint: string; secret: boolean }[];
}

export const ADAPTERS: Record<Platform, Adapter> = {
  facebook: {
    label: 'Facebook Page',
    verify: verifyFacebook,
    publish: publishFacebook,
    listComments: facebookComments,
    reply: facebookReply,
    fields: [
      {
        key: 'accessToken',
        label: 'Page access token',
        hint: 'Graph API Explorer → your Page → pages_manage_posts, pages_read_engagement. Exchange it for a long-lived token.',
        secret: true,
      },
      { key: 'externalId', label: 'Page ID', hint: 'Page → About → Page transparency.', secret: false },
    ],
  },
  instagram: {
    label: 'Instagram',
    verify: verifyInstagram,
    publish: publishInstagram,
    listComments: instagramComments,
    reply: instagramReply,
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        hint: 'The same long-lived Page token, with instagram_basic, instagram_content_publish and instagram_manage_comments.',
        secret: true,
      },
      {
        key: 'externalId',
        label: 'Instagram Business account ID',
        hint: 'GET /{page-id}?fields=instagram_business_account',
        secret: false,
      },
    ],
  },
  youtube: {
    label: 'YouTube',
    verify: verifyYouTube,
    publish: publishYouTube,
    listComments: youtubeComments,
    reply: youtubeReply,
    fields: [
      {
        key: 'accessToken',
        label: 'OAuth refresh token',
        hint: 'Scopes youtube.upload and youtube.force-ssl, obtained once with access_type=offline.',
        secret: true,
      },
      { key: 'clientId', label: 'OAuth client ID', hint: 'Google Cloud console → Credentials.', secret: false },
      { key: 'clientSecret', label: 'OAuth client secret', hint: 'From the same credential.', secret: true },
    ],
  },
  tiktok: {
    label: 'TikTok',
    verify: verifyTikTok,
    publish: publishTikTok,
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        hint: 'TikTok for Developers → Content Posting API, scope video.publish.',
        secret: true,
      },
    ],
  },
  threads: {
    label: 'Threads',
    verify: verifyThreads,
    publish: publishThreads,
    listComments: threadsComments,
    reply: threadsReply,
    fields: [
      {
        key: 'accessToken',
        label: 'Threads access token',
        hint: 'Threads API, scopes threads_basic, threads_content_publish and threads_manage_replies.',
        secret: true,
      },
    ],
  },
  x: {
    label: 'X',
    verify: verifyX,
    publish: publishX,
    fields: [
      {
        key: 'accessToken',
        label: 'OAuth 2.0 user token',
        hint: 'X developer portal, scopes users.read tweet.read tweet.write media.write.',
        secret: true,
      },
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    verify: verifyLinkedIn,
    publish: publishLinkedIn,
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        hint: 'LinkedIn app, scopes openid profile w_member_social.',
        secret: true,
      },
      {
        key: 'externalId',
        label: 'Organization URN (optional)',
        hint: 'urn:li:organization:xxxxx to post as the company rather than a person.',
        secret: false,
      },
    ],
  },
};

/** Post one finished piece to one network, or explain why that network can't take it. */
export async function publishTo(
  platform: Platform,
  credentials: PlatformCredentials,
  payload: PublishPayload,
): Promise<{ id: string; url: string }> {
  const adapter = ADAPTERS[platform];
  if (!adapter.publish) {
    throw new PlatformError(
      platform,
      `Publishing to ${adapter.label} is not implemented yet — the account is connected for reporting only.`,
    );
  }
  logger.info('social: publishing', { platform, format: payload.format });
  return adapter.publish(credentials, payload);
}

export function canListComments(platform: Platform): boolean {
  return typeof ADAPTERS[platform].listComments === 'function';
}

export async function listComments(
  platform: Platform,
  credentials: PlatformCredentials,
  mediaId: string,
): Promise<RawComment[]> {
  const adapter = ADAPTERS[platform];
  if (!adapter.listComments) return [];
  return adapter.listComments(credentials, mediaId);
}

export async function replyToComment(
  platform: Platform,
  credentials: PlatformCredentials,
  commentId: string,
  text: string,
): Promise<string> {
  const adapter = ADAPTERS[platform];
  if (!adapter.reply) {
    throw new PlatformError(platform, `Replying on ${adapter.label} is not supported by its API here.`);
  }
  return adapter.reply(credentials, commentId, text);
}
