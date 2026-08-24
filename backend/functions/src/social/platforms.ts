/**
 * The network adapters: prove a credential, then post a video with it.
 *
 * Each adapter does exactly two things — `verify` turns a pasted token into a
 * profile (which is how the console can say "connected as @velocity.rides_,
 * 158k followers" rather than "saved"), and `publish` puts one finished video
 * up. Anything a network cannot do is absent rather than faked; `VIDEO_CAPABLE`
 * in types.ts is the list the pipeline trusts.
 *
 * ⚠️ These were written from each platform's public API documentation. Meta,
 * TikTok and YouTube all gate publishing behind app review and scopes that only
 * exist on an approved app, so the first successful post from a *new* app is
 * the real test — verify each adapter against your app's own docs before
 * turning auto-publish on. Every call fails loudly with the network's own error
 * text, which is what you will need when one of them does not match.
 *
 * All three video networks pull the file from a URL rather than accepting an
 * upload from us, which is why the pipeline puts each render in Cloud Storage
 * behind a signed URL first (see video.ts).
 */
import { logger } from 'firebase-functions';

import type { Platform, PlatformCredentials, PlatformProfile } from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS = 'https://graph.threads.net/v1.0';

/** How long to wait for a network to finish ingesting a video before giving up. */
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
    const b = body as { error?: { message?: string }; error_description?: string } | string | null;
    const detail =
      typeof b === 'string'
        ? b.slice(0, 300)
        : (b?.error?.message ?? b?.error_description ?? `HTTP ${res.status}`);
    throw new PlatformError(platform, detail);
  }
  return body as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function publishFacebook(
  c: PlatformCredentials,
  v: { videoUrl: string; caption: string },
): Promise<{ id: string; url: string }> {
  const res = await call<{ id: string }>('facebook', `${GRAPH}/${c.externalId}/videos`, {
    form: { file_url: v.videoUrl, description: v.caption, access_token: c.accessToken },
  });
  return { id: res.id, url: `https://www.facebook.com/${res.id}` };
}

// ── Instagram (Business/Creator, Reels) ─────────────────────────────────────

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
 * Instagram's two-step publish: create a container, wait for Instagram to
 * finish downloading and transcoding the file, then publish the container.
 * Publishing a container that is still `IN_PROGRESS` is the single most common
 * way this call fails, hence the poll.
 */
async function publishInstagram(
  c: PlatformCredentials,
  v: { videoUrl: string; caption: string },
): Promise<{ id: string; url: string }> {
  const container = await call<{ id: string }>('instagram', `${GRAPH}/${c.externalId}/media`, {
    form: {
      media_type: 'REELS',
      video_url: v.videoUrl,
      caption: v.caption,
      share_to_feed: 'true',
      access_token: c.accessToken,
    },
  });

  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    const status = await call<{ status_code: string; status?: string }>(
      'instagram',
      `${GRAPH}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(c.accessToken)}`,
    );
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PlatformError('instagram', `Instagram rejected the video: ${status.status ?? status.status_code}`);
    }
    if (Date.now() > deadline) {
      throw new PlatformError('instagram', 'Instagram is still processing the video after 5 minutes.');
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const published = await call<{ id: string }>('instagram', `${GRAPH}/${c.externalId}/media_publish`, {
    form: { creation_id: container.id, access_token: c.accessToken },
  });
  return { id: published.id, url: `https://www.instagram.com/reel/${published.id}` };
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

async function publishThreads(
  c: PlatformCredentials,
  v: { videoUrl: string; caption: string },
): Promise<{ id: string; url: string }> {
  const container = await call<{ id: string }>('threads', `${THREADS}/${c.externalId}/threads`, {
    form: {
      media_type: 'VIDEO',
      video_url: v.videoUrl,
      text: v.caption,
      access_token: c.accessToken,
    },
  });

  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    const status = await call<{ status: string; error_message?: string }>(
      'threads',
      `${THREADS}/${container.id}?fields=status,error_message&access_token=${encodeURIComponent(c.accessToken)}`,
    );
    if (status.status === 'FINISHED') break;
    if (status.status === 'ERROR' || status.status === 'EXPIRED') {
      throw new PlatformError('threads', status.error_message ?? `Threads returned ${status.status}`);
    }
    if (Date.now() > deadline) throw new PlatformError('threads', 'Threads is still processing after 5 minutes.');
    await sleep(POLL_INTERVAL_MS);
  }

  const published = await call<{ id: string }>('threads', `${THREADS}/${c.externalId}/threads_publish`, {
    form: { creation_id: container.id, access_token: c.accessToken },
  });
  return { id: published.id, url: `https://www.threads.net/@${c.externalId}/post/${published.id}` };
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
async function publishTikTok(
  c: PlatformCredentials,
  v: { videoUrl: string; caption: string },
): Promise<{ id: string; url: string }> {
  const res = await call<{ data: { publish_id: string }; error?: { code: string; message: string } }>(
    'tiktok',
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      headers: { authorization: `Bearer ${c.accessToken}` },
      json: {
        post_info: { title: v.caption.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE' },
        source_info: { source: 'PULL_FROM_URL', video_url: v.videoUrl },
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
async function publishYouTube(
  c: PlatformCredentials,
  v: { videoUrl: string; caption: string; title: string; tags: string[] },
): Promise<{ id: string; url: string }> {
  const token = await youtubeAccessToken(c);

  const start = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          title: v.title.slice(0, 100),
          description: v.caption.slice(0, 5000),
          tags: v.tags.slice(0, 20),
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    },
  );
  const uploadUrl = start.headers.get('location');
  if (!start.ok || !uploadUrl) {
    throw new PlatformError('youtube', `Could not start the upload: ${(await start.text()).slice(0, 300)}`);
  }

  const file = await fetch(v.videoUrl);
  if (!file.ok) throw new PlatformError('youtube', 'Could not read the rendered video back from storage.');
  const bytes = Buffer.from(await file.arrayBuffer());

  const done = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) },
    body: bytes,
  });
  if (!done.ok) throw new PlatformError('youtube', `Upload failed: ${(await done.text()).slice(0, 300)}`);
  const result = (await done.json()) as { id: string };
  return { id: result.id, url: `https://www.youtube.com/watch?v=${result.id}` };
}

// ── X and LinkedIn (authenticate only) ──────────────────────────────────────

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

// ── registry ────────────────────────────────────────────────────────────────

export interface VideoPost {
  videoUrl: string;
  caption: string;
  title: string;
  tags: string[];
}

interface Adapter {
  label: string;
  verify: (c: PlatformCredentials) => Promise<PlatformProfile>;
  publish?: (c: PlatformCredentials, v: VideoPost) => Promise<{ id: string; url: string }>;
  /** What the console tells you to paste, in order. */
  fields: { key: keyof PlatformCredentials; label: string; hint: string; secret: boolean }[];
}

export const ADAPTERS: Record<Platform, Adapter> = {
  facebook: {
    label: 'Facebook Page',
    verify: verifyFacebook,
    publish: publishFacebook,
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
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        hint: 'The same long-lived Page token, with instagram_basic and instagram_content_publish.',
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
    publish: (c, v) => publishYouTube(c, v),
    fields: [
      {
        key: 'accessToken',
        label: 'OAuth refresh token',
        hint: 'Scope https://www.googleapis.com/auth/youtube.upload, obtained once with access_type=offline.',
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
    fields: [
      {
        key: 'accessToken',
        label: 'Threads access token',
        hint: 'Threads API, scopes threads_basic and threads_content_publish.',
        secret: true,
      },
    ],
  },
  x: {
    label: 'X',
    verify: verifyX,
    fields: [
      {
        key: 'accessToken',
        label: 'OAuth 2.0 user token',
        hint: 'X developer portal, scope users.read tweet.read tweet.write.',
        secret: true,
      },
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    verify: verifyLinkedIn,
    fields: [
      { key: 'accessToken', label: 'Access token', hint: 'LinkedIn app, scopes openid profile w_member_social.', secret: true },
      {
        key: 'externalId',
        label: 'Organization URN (optional)',
        hint: 'urn:li:organization:xxxxx to post as the company rather than a person.',
        secret: false,
      },
    ],
  },
};

/** Post one video to one network, or explain why that network cannot take it. */
export async function publishTo(
  platform: Platform,
  credentials: PlatformCredentials,
  post: VideoPost,
): Promise<{ id: string; url: string }> {
  const adapter = ADAPTERS[platform];
  if (!adapter.publish) {
    throw new PlatformError(
      platform,
      `Publishing video to ${adapter.label} is not implemented yet — the account is connected for reporting only.`,
    );
  }
  logger.info('social: publishing', { platform });
  return adapter.publish(credentials, post);
}
