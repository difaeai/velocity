# Velocity — The social desk

Everything behind **Manage social** in the admin console: the four agents who
plan and make Velocity's content, the accounts they post to, the queue you
approve everything through, and the inbox where they answer the people who
reply.

Companion documents: [FEATURES](FEATURES.md) · [ADMIN](ADMIN.md) ·
[SECURITY](SECURITY.md) · [DEPLOY](DEPLOY.md)

---

## 1. The crew

Four agents, each owning one stage, all running on Google Gemini through one
key. They are named rather than numbered because the console shows the line
running live, and *"Rang is drawing slide 3 of 5"* is something an operator can
act on where *"stage 2/4"* is not.

| | Agent | Role | What it actually does |
|---|---|---|---|
| قلم | **Qalam** | Content writer | Searches what is travelling on Pakistani feeds this week and what the other ride-hailing apps are publishing, brings it to standup, then writes the hook, the frames and the caption. |
| رنگ | **Rang** | Designer | Art directs every frame — subject, light, lens, type, where the lime accent sits — then renders the carousel slides, the post image, the story frame, or the cover a video opens on. |
| رفتار | **Raftar** | Video editor | Writes the second-by-second cut (pacing, the pattern interrupt, the sound bed) and renders it through Veo. |
| آواز | **Awaaz** | Social media manager | Rewrites the caption per network, decides where the piece belongs, publishes once you approve, then reads and answers the comments. |

Code: [`backend/functions/src/social/`](../backend/functions/src/social).
Console: `app/(app)/dashboard/social/`.

### They plan together first

Every run opens with a **standup**: one model call that argues the concept out
in all four voices and commits to it — the idea, the audience, the hook
direction, the visual direction, the edit direction, and what Awaaz will do with
it afterwards. Each agent then inherits that decision instead of re-deciding it.

That is the difference between four agents and one prompt run four times: the
designer is not decorating a script it never saw, and the editor is not cutting
to a hook nobody chose. The plan is stored on the post and shown in the queue,
so you can veto the idea rather than the execution.

---

## 2. The run

```
 tick ──► automation on? ──no──► stop
      ──► right hour?     ──no──► stop
      ──► today has this format already? ──yes──► stop
      │
      ├─ Qalam   market read (grounded search) ─► standup ─► script
      ├─ Rang    art direction ─► render slides / post image / cover frame
      ├─ Raftar  the cut ─► Veo render                    (video formats only)
      ├─ Awaaz   caption per network ─► pick the targets
      │
      └────────────────────► THE APPROVAL QUEUE ◄──────────────────────
                                      │
             approve ─► publish   ask for changes ─► back to the crew
                                  reject / delete
```

**Nothing publishes itself.** There is no auto-publish switch. Every run ends at
`awaiting_approval`, because everything the crew writes is a claim Velocity is
making in public, and the cost of reading one post a day is nothing next to the
cost of the one that should not have gone out.

Each stage writes its outcome to `socialPosts/{id}` before the next begins, so a
failure halfway through leaves a post you can open, read and retry — never a
silent gap in the calendar. The crew log on the post is what the console renders
as four live status lights.

The tick is hourly rather than a fixed cron so the run hour can be changed from
the console without a redeploy, and the post id is **the Pakistan date plus the
format** (`2026-08-24-reel`), so a retried or duplicated tick can never produce
a duplicate.

### What stops it inventing figures

The prompt carries a `FACTS` block (completed trips, driver payout total,
approved drivers, last-7-day fares, commission rate) and one hard rule: every
number in the output must come from that block. The facts are stored on the post
alongside the script, so any published claim can be traced back to the figure it
came from months later.

Two more rules no instruction overrides: no competitor is ever named in output,
and no guaranteed-income language ("earn X per month") — the crew describes how
earnings work, never what someone will make.

---

## 3. Formats

The format decides who works and where it can go.

| Format | Ratio | What the crew makes | Who takes it |
|---|---|---|---|
| **Reel** | 9:16, ~20s | Cover frame + rendered video | Instagram, TikTok, Facebook, YouTube (as a Short), Threads |
| **Video** | 16:9, ~30s | Cover frame + rendered video | YouTube, Facebook |
| **Carousel** | 4:5 ×5 | Five designed slides in one set | Instagram, Facebook, Threads |
| **Post** | 4:5 | One designed image | Instagram, Facebook, Threads, X, LinkedIn |
| **Story** | 9:16 | One designed frame | Instagram, Facebook |

`PLATFORM_FORMATS` in [`types.ts`](../backend/functions/src/social/types.ts) is
the matrix everything trusts: the console greys out what an adapter cannot do,
and the pipeline filters targets through it, so a story is never quietly posted
to YouTube.

The rotation (Automation → format rotation) runs in order and repeats — reels
appear more than once on purpose, because they are what travels, and a grid five
videos deep is a worse channel than a mixed one.

---

## 4. The queue — four decisions

Everything lands here. The four actions are deliberately different weights:

| Action | What happens |
|---|---|
| **Approve & post now** | Publishes to the ticked networks, one at a time, with the per-network caption. |
| **Approve only** | Marks it ready. It goes out when you press publish. |
| **Ask for changes** | Your note goes back to the crew, and only the stages you tick re-run. |
| **Reject** | It never goes out. It stays readable. |
| **Delete** | Gone. |

The queue shows the standup concept, the hook (with the alternatives the writer
offered), the slides or the video, the caption — editable in place — the caption
per network, the numbers the script was written from, the pages the market read
came from, and every round of feedback you have already given.

### Asking for changes is scoped, and the cost is why

| You tick | What re-runs |
|---|---|
| Caption | One cheap model call. No re-render. |
| Design | Rang, then Awaaz. |
| Video | Raftar, then Awaaz. |
| Script | The standup, the writer, the designer and the editor. |

Re-rendering a video because someone wanted a different word in the caption is
how you spend a month's budget in an afternoon.

**Feedback is permanent.** Every note is stored on the post and fed to every
agent on every later version of it, so "the hook is generic, open on the hands"
does not have to be said twice.

---

## 5. Telling all four of them something

Two different things, deliberately in two different places:

| Where | Scope | For |
|---|---|---|
| **Crew page → standing instructions** | Every agent, every run, forever | "We are recruiting drivers in Lahore this month." "Never say cheapest." |
| **Crew page → direction for one agent** | One agent, every run | "Rang: street light only, no studio shots." |
| **Queue → ask for changes** | One post | "This hook is weak." |

Putting them in one box would mean either repeating yourself every morning, or
accidentally turning one post's note into a permanent rule.

The crew page is also where the competitor list lives — the pages Qalam reads
around before writing. Reading the market and copying it are different jobs, and
only one of them is publishable, which is why naming a competitor in output is a
hard rule violation.

---

## 6. Connecting an account

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

| Network | Paste | Scopes worth double-checking |
|---|---|---|
| Facebook Page | long-lived Page token + Page ID | `pages_manage_posts`, `pages_read_engagement` |
| Instagram | the same Page token + IG Business account ID | `instagram_content_publish`, `instagram_manage_comments` |
| YouTube | OAuth **refresh** token + client ID + secret | `youtube.upload`, `youtube.force-ssl` (for replies) |
| TikTok | access token | `video.publish` |
| Threads | Threads access token | `threads_content_publish`, `threads_manage_replies` |
| X | OAuth 2.0 user token | `tweet.write`, `media.write` |
| LinkedIn | access token (+ optional organization URN) | `w_member_social` |

YouTube is the odd one out twice over: its access tokens last an hour, so what is
stored is a refresh token and the OAuth client that issued it; and it is one of
three networks that will not fetch a file itself, so the video is streamed
through the backend on a resumable upload. X and LinkedIn want the image bytes
for the same reason.

### Where the tokens live

`socialAccounts/{platform}` holds the profile — name, handle, follower count,
status — and the console reads it live.

`socialAccounts/{platform}/secret/credentials` holds the token, encrypted with
AES-256-GCM under `SOCIAL_TOKEN_KEY`. **Every client read of that subcollection
is denied, admins included** (see `firestore.rules`). A Facebook page token is a
password that can post as Velocity to the whole audience; only Cloud Functions
has any business holding one.

This is the single backend secret that **fails closed**. With no
`SOCIAL_TOKEN_KEY`, accounts simply cannot be connected, because the alternative
is storing publishing credentials in the clear.

---

## 7. Comments

Every two hours, Awaaz reads the comments under everything published in the last
fortnight, classifies each one, and drafts a reply. Whether that reply is *sent*
is a separate switch (`autoReply`), off by default.

Three things it will not do, whatever the settings say:

- **Never auto-answers a safety comment.** Anything about a crash, harassment,
  a woman feeling unsafe or the police is marked `escalated` and left for a
  person. An automated "sorry to hear that!" under a comment about a driver is
  worse than silence.
- **Never argues.** Complaints get an acknowledgement and a route to support,
  never a defence of the platform.
- **Never invents a fact.** Same FACTS rule as the writer.

Spam is closed without a reply. Comment reading works on Facebook, Instagram,
Threads and YouTube; TikTok, X and LinkedIn are publish-only here.

---

## 8. Secrets

Both are their own GitHub Actions secrets, assembled into the functions `.env`
by `.github/workflows/deploy-functions.yml`. Neither goes in the
`PAYMENTS_GATEWAY_ENV` block — that block is overwritten wholesale and cannot be
read back, so anything appended to it has to be retyped from memory.

| Secret | Without it |
|---|---|
| `GEMINI_API_KEY` | the whole crew is dead — nothing is planned, written, drawn or rendered |
| `SOCIAL_TOKEN_KEY` (`openssl rand -base64 32`) | accounts cannot be connected; nothing publishes |

⚠️ Rotating `SOCIAL_TOKEN_KEY` makes every stored token unreadable. Reconnect
each account afterwards.

### Model ids are settings, not code

`textModel`, `imageModel` and `videoModel` are editable on the crew page.
Google renames preview models often; when `gemini-2.5-flash-image` becomes
something else, that is a text field, not a redeploy. Defaults:

| | Default | Used by |
|---|---|---|
| Text | `gemini-2.5-pro` | standup, Qalam, Awaaz's captions and replies |
| Image | `gemini-2.5-flash-image` | Rang (`imagen-*` ids are also handled, on a different endpoint) |
| Video | `veo-3.1-generate-preview` | Raftar |

---

## 9. Before the first live post

The API adapters were written from each platform's public documentation, the way
the payments adapter was. Meta, TikTok, X, LinkedIn and YouTube all gate
publishing behind app review and scopes that only exist on an approved app, so
**the first successful post from a new app is the real test**. Work through it in
this order:

1. Add `GEMINI_API_KEY` and `SOCIAL_TOKEN_KEY`, redeploy, and connect **one**
   account.
2. Leave automation off. Press **Brief the crew now** on the overview and pick
   **Post** — the cheapest format, one image, no render minutes.
3. Read what comes back in the queue. Try **ask for changes** on the caption
   once; that is the cheapest way to see the loop work end to end.
4. Publish that one piece by hand, to one network.
5. Switch `videoProvider` to `veo` and brief a **reel**. Watch the function logs
   on that first render — that is where a wrong model name or a changed response
   shape shows up.
6. Only then set a run hour and turn automation on.
7. Turn the comment inbox on. Read a few dozen drafted replies before you even
   consider `autoReply`.

---

## 10. Data model

| Path | What |
|---|---|
| `socialAccounts/{platform}` | profile + status; admin-readable |
| `socialAccounts/{platform}/secret/credentials` | sealed token; **no client access** |
| `socialPosts/{YYYY-MM-DD-format}` | plan, script, media, captions, targets, per-network results, crew log, feedback history |
| `socialResearch/{YYYY-MM-DD}` | the day's market read and the pages it came from |
| `socialComments/{platform}_{commentId}` | one comment, its reading, and the reply |
| `system/socialAutomation` | the settings the scheduler and every agent read |

`system/` rather than `config/` for the settings: `config/{doc}` is readable by
every signed-in user because fares and ride settings live there, and the
marketing brief does not belong in the mobile app's cache.

Media lands in Cloud Storage under `social/{postId}/` — `video.mp4`, `cover.png`,
`slide-1.png`…. Instagram, Facebook, Threads and TikTok all *pull* files from a
URL rather than accepting an upload, so each is served over a time-limited signed
URL — falling back to a public object if the bucket cannot sign, which is
unremarkable for media that is about to be posted publicly anyway.

Posts made before formats existed carry a single `video` field and no `media`
array. One shim (`postMedia`) reads both; there is no migration, because those
documents are a calendar archive and rewriting history to make an old post look
like a new one buys nothing.

---

## 11. Callables

| Function | What it does |
|---|---|
| `adminGetSocialConnectSchema` | what the connect form should ask for, per network |
| `adminConnectSocialAccount` | verify a pasted credential, then seal and store it |
| `adminVerifySocialAccount` | re-check a stored credential |
| `adminDisconnectSocialAccount` | delete the credential; keep the profile row |
| `adminGetSocialSettings` | settings + which keys are actually configured |
| `adminUpdateSocialSettings` | validated write |
| `adminGenerateSocialPost` | run the whole crew on demand, for a date and format |
| `adminRequestSocialChanges` | send a piece back with feedback; re-runs only the scoped stages |
| `adminReviewSocialPost` | approve / reject, optionally publish |
| `adminPublishSocialPost` | publish, or retry the networks that failed |
| `adminAttachSocialMedia` | attach a video or slide made outside the pipeline |
| `adminDeleteSocialPost` | remove a post |
| `adminSyncSocialComments` | read the comments now, and draft replies |
| `adminReplySocialComment` | send one reply |
| `adminSetCommentStatus` | close a comment without answering it |
| `socialDailyContent` | the hourly scheduler tick (not callable) |
| `socialEngagement` | the two-hourly comment pass (not callable) |
