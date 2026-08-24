# Velocity — The social desk

Everything behind **Manage social** in the admin console: the connected
accounts, and the daily pipeline that writes, renders and publishes a video to
them without anyone opening an editor.

Companion documents: [FEATURES](FEATURES.md) · [ADMIN](ADMIN.md) ·
[SECURITY](SECURITY.md) · [DEPLOY](DEPLOY.md)

---

## 1. What it replaces

Three jobs, in one scheduled Cloud Function:

| Stage | Who used to do it | What does it now |
|---|---|---|
| Angle and script | copywriter | Claude (`claude-opus-5`), fed Velocity's own live numbers |
| Video | editor | Google Veo through the Gemini API — or a file you attach yourself |
| Publishing | social media manager | the platform APIs, called directly from the backend |
| Deciding it's 10am | a person with a calendar | Cloud Scheduler |

Code: [`backend/functions/src/social/`](../backend/functions/src/social).
Console: `app/(app)/dashboard/social/`.

---

## 2. The run

```
hourly tick ──► is automation on?        no ─► stop
             ──► is it the configured hour?  no ─► stop
             ──► does today already have a post?  yes ─► stop
             │
             ├─ 1. gather facts    live counters, commission rate, last 7 days
             ├─ 2. script          Claude drafts hook / shots / voiceover / caption
             ├─ 3. render          Veo renders the video, stored in our bucket
             ├─ 4. approval gate   requireApproval → stop here
             └─ 5. publish         each connected network, one at a time
```

It ticks hourly rather than on a fixed cron so the run hour can be changed from
the console without a redeploy, and the post id **is the Pakistan date**, so a
retried or duplicated tick can never post twice.

Each stage writes its outcome to `socialPosts/{date}` before the next begins. A
failure halfway through therefore leaves a post you can open, read and retry —
never a silent gap in the calendar.

### The approval gate

`requireApproval` defaults to **on**, and should stay on. Everything the model
writes is a claim Velocity is making in public; the queue shows the script, the
video, and — under a disclosure — the exact numbers the script was written from,
so a claim can be checked before it is made rather than after.

### What stops it inventing figures

The prompt carries a `FACTS` block (completed trips, driver payout total,
approved drivers, last-7-day fares, commission rate) and one hard rule: every
number in the output must come from that block. The facts are stored on the post
alongside the script, so any published claim can be traced back to the figure it
came from months later.

---

## 3. Connecting an account

Connecting is a **paste, not a redirect**. You give the desk a token; the backend
immediately spends it on a read call against that network. If a profile comes
back, the credential is real and is stored sealed. If it doesn't, nothing is
written and you see the network's own error — `(#200) requires
pages_manage_posts` tells you what to fix in a way "connection failed" never
would.

This is deliberate: OAuth buttons look nicer but need a reviewed app per network
before they can request publishing scopes, and until that review lands they are
buttons that do nothing. The stored shape is identical either way, so an OAuth
flow can be added on top later without touching the data model.

### What each network wants

| Network | Paste | Can post video? |
|---|---|---|
| Facebook Page | long-lived Page access token + Page ID | yes |
| Instagram | the same Page token (with `instagram_content_publish`) + IG Business account ID | yes — as a Reel |
| YouTube | OAuth **refresh** token + client ID + client secret | yes |
| TikTok | access token with `video.publish` | yes |
| Threads | Threads access token | yes |
| X | OAuth 2.0 user token | not yet — connected for reporting |
| LinkedIn | access token (+ optional organization URN) | not yet — connected for reporting |

The console renders this table from the backend
([`platforms.ts`](../backend/functions/src/social/platforms.ts)), so the form can
never ask for something the adapter doesn't use.

YouTube is the odd one out twice over: its access tokens last an hour, so what is
stored is a refresh token and the OAuth client that issued it; and it is the only
network that won't fetch the file itself, so the video is streamed through the
backend on a resumable upload.

### Where the tokens live

`socialAccounts/{platform}` holds the profile — name, handle, follower count,
status — and the console reads it live.

`socialAccounts/{platform}/secret/credentials` holds the token, encrypted with
AES-256-GCM under `SOCIAL_TOKEN_KEY`. **Every client read of that subcollection
is denied, admins included** (see `firestore.rules`). A Facebook page token is a
password that can post as Velocity to the whole audience; only Cloud Functions
has any business holding one.

This is the single backend secret that **fails closed**. Everything else in
Velocity degrades when its key is missing — no Maps key means en-route pickups
fall back to the client polyline, no gateway keys means the wallet runs on the
mock provider. With no `SOCIAL_TOKEN_KEY`, accounts simply cannot be connected,
because the alternative is storing publishing credentials in the clear.

---

## 4. Secrets

Both are their own GitHub Actions secrets, assembled into the functions `.env`
by `.github/workflows/deploy-functions.yml`. Neither goes in the
`PAYMENTS_GATEWAY_ENV` block — that block is overwritten wholesale and cannot be
read back, so anything appended to it has to be retyped from memory.

| Secret | Without it |
|---|---|
| `SOCIAL_TOKEN_KEY` (`openssl rand -base64 32`) | accounts cannot be connected; nothing publishes |
| `GEMINI_API_KEY` | scripts are still written; the video is attached by hand |
| `ANTHROPIC_API_KEY` (already in the block) | nothing is drafted at all |

⚠️ Rotating `SOCIAL_TOKEN_KEY` makes every stored token unreadable. Reconnect
each account afterwards.

---

## 5. Before the first live post

The API adapters were written from each platform's public documentation, the way
the payments adapter was. Meta, TikTok and YouTube all gate publishing behind app
review and scopes that only exist on an approved app, so **the first successful
post from a new app is the real test**. Work through it in this order:

1. Add `SOCIAL_TOKEN_KEY`, redeploy, and connect **one** account.
2. Leave automation off. Use **Generate today's post now** on the social
   overview, and read what comes back in the approval queue.
3. With `videoProvider: veo`, watch the function logs on that first render —
   that is where a wrong model name or a changed response shape shows up.
4. Publish that one post by hand from the queue, to one network.
5. Only then set a run hour and turn automation on — with approval still
   required.

Auto-publish (approval off) is the last switch to touch, not the first.

---

## 6. Data model

| Path | What |
|---|---|
| `socialAccounts/{platform}` | profile + status; admin-readable |
| `socialAccounts/{platform}/secret/credentials` | sealed token; **no client access** |
| `socialPosts/{YYYY-MM-DD}` | angle, script, caption, video, targets, per-network results |
| `system/socialAutomation` | the settings the scheduler reads |

`system/` rather than `config/` for the settings: `config/{doc}` is readable by
every signed-in user because fares and ride settings live there, and the
marketing brief does not belong in the mobile app's cache.

Videos land in Cloud Storage at `social/{postId}.mp4`. Instagram, Facebook,
Threads and TikTok all *pull* the file from a URL rather than accepting an
upload, so it is served over a time-limited signed URL — falling back to a public
object if the bucket cannot sign, which is unremarkable for a video that is about
to be posted publicly anyway.

---

## 7. Callables

| Function | What it does |
|---|---|
| `adminGetSocialConnectSchema` | what the connect form should ask for, per network |
| `adminConnectSocialAccount` | verify a pasted credential, then seal and store it |
| `adminVerifySocialAccount` | re-check a stored credential |
| `adminDisconnectSocialAccount` | delete the credential; keep the profile row |
| `adminGetSocialSettings` | settings + which keys are actually configured |
| `adminUpdateSocialSettings` | validated write |
| `adminGenerateSocialPost` | run the draft (and render) stages on demand |
| `adminReviewSocialPost` | approve / reject, optionally publish |
| `adminPublishSocialPost` | publish, or retry the networks that failed |
| `adminAttachSocialVideo` | attach a video made outside the pipeline |
| `adminDeleteSocialPost` | remove a post |
| `socialDailyContent` | the hourly scheduler tick (not callable) |
