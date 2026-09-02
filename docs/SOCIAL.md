# Velocity — The social desk

Everything behind **Manage social** in the admin console: the people you hire,
the content they plan and make, the accounts they post to, the queue you approve
everything through, and the inbox where they answer the people who reply.

Companion documents: [FEATURES](FEATURES.md) · [ADMIN](ADMIN.md) ·
[SECURITY](SECURITY.md) · [DEPLOY](DEPLOY.md)

---

## 1. It is a team you staff, not a fixed crew

Nobody is built in. **An empty desk makes nothing.** You hire people on the
Employees page, give them names, and from that moment each of them does the job
their role covers — on every run, without being asked again.

| Role | Stage they own | What they actually do |
|---|---|---|
| **Research assistant** | market read | Searches every morning: what is travelling on Pakistani feeds, what the other apps are posting, which hook shapes keep coming back. Reports the pages it read. |
| **SEO expert** | search brief | Briefs the writer *before* they write: the query this piece should answer, phrases that belong in the copy, hashtags people actually search, real alt text. |
| **Content writer** | the script | The hook, the shots or slides, the voiceover, the caption. Ruthless about the first three seconds. |
| **Google SEO expert** | YouTube & Google | Writes the YouTube title, description and tags the video is posted with — used verbatim — and names the query velocityrides.app should try to own. |
| **Designer** | the pictures | Art directs each frame and writes the brief it is made from: the carousel slides, the post image, the story frame, or the cover a video opens on. Nothing is rendered here — you make the file and attach it. |
| **Video editor** | the cut | The second-by-second edit — pacing, the pattern interrupt, the sound bed — written as a brief you shoot, edit or render from. |
| **YouTube ads expert** | campaign brief | The brief a human takes into Google Ads: objective, five-second hooks to test, targeting, budget range, what success looks like. |
| **Social media manager** | where it goes | Rewrites the caption per network, picks the targets, publishes once you approve, and drafts a reply to every comment. |

Code: [`backend/functions/src/social/`](../backend/functions/src/social).
Console: `app/(app)/dashboard/social/`.

### Hiring, sharing and gaps

- **Hire two people into the same job and they share it.** Whoever went longest
  without a job takes the next one; ties go to whoever has been here longest.
  Two writers alternate, the way two writers actually would.
- **Some jobs cover for others.** With no researcher the writer reads around the
  subject themselves; with no SEO specialist the search desk covers, and vice
  versa. The work log says "covering" when that happens.
- **Some jobs have no cover.** No designer means no pictures; no video editor
  means reels stop at the script; no ads expert means no campaign brief. The
  stage is recorded as skipped **with the reason**, and the Employees page lists
  every gap in plain words before it costs you a bad piece.
- **Nobody is deleted quietly.** Removing someone takes them off the roster, but
  every piece they worked on keeps their name — "who wrote this claim" is a
  question you may need answered next year.
- **Off duty** is a switch, not a deletion. An off-duty employee is skipped and
  their work goes to whoever else can cover it.

`adminSeedSocialTeam` ("Hire one of each") exists only so the first five minutes
are not eight name fields. It is not a hidden default team — an empty desk stays
empty until somebody presses it.

### They plan together first

Every run opens with a **standup**: one model call that argues the concept out
in the voices of everyone on shift — by name — and commits to it. Concept,
audience, hook direction, visual direction, edit direction, distribution, plus a
line per person about their part. Each stage then inherits that decision instead
of re-deciding it.

That is the difference between a team and one prompt run eight times: the
designer is not decorating a script it never saw, and the editor is not cutting
to a hook nobody chose. The plan is stored on the piece and shown in the queue,
so you can veto the idea rather than the execution.

---

## 2. A working day

```
 tick ──► automation on? ──no──► stop
      ──► right hour?     ──no──► stop
      ──► anyone hired?   ──no──► stop
      ──► today has this format already? ──yes──► stop
      │
      ├─ standup            everyone on shift agrees one concept
      ├─ market read        research assistant (grounded Google Search)
      ├─ search brief       SEO expert — before a word is written
      ├─ the script         content writer
      ├─ YouTube & Google   Google SEO expert
      ├─ the pictures       designer
      ├─ the cut           video editor            (video formats only)
      ├─ campaign brief     YouTube ads expert      (video formats only)
      ├─ where it goes      social media manager
      │
      └────────────────► THE APPROVAL QUEUE ◄──────────────────
                                 │
        approve ─► publish   ask for changes ─► back to whoever owns that stage
                             reject / delete
```

**Nothing publishes itself.** There is no auto-publish switch. Every run ends at
`awaiting_approval`, because everything the team writes is a claim Velocity is
making in public, and the cost of reading one piece a day is nothing next to the
cost of the one that should not have gone out.

Each stage writes its outcome to `socialPosts/{id}` before the next begins, so a
failure halfway through leaves a piece you can open, read and retry — never a
silent gap in the calendar. The work log is what the console renders live, with
the name of the person whose turn it is.

The tick is hourly rather than a fixed cron so the run hour can be changed from
the console without a redeploy, and the post id is **the Pakistan date plus the
format** (`2026-08-24-reel`), so a retried or duplicated tick can never produce
a duplicate.

### What stops anyone inventing figures

The prompt carries a `FACTS` block (completed trips, driver payout total,
approved drivers, last-7-day fares, commission rate) and one hard rule: every
number in the output must come from that block. The facts are stored on the
piece alongside the script, so any published claim can be traced back to the
figure it came from months later.

Two more rules nobody's own brief overrides: no competitor is ever named in
output, and no guaranteed-income language ("earn X per month").

---

## 3. Formats

The format decides which stages run and where the piece can go.

| Format | Ratio | What is made | Who takes it |
|---|---|---|---|
| **Reel** | 9:16, ~20s | A cover-frame brief and a cut | Instagram, TikTok, Facebook, YouTube (as a Short), Threads |
| **Video** | 16:9, ~30s | A cover-frame brief and a cut | YouTube, Facebook |
| **Carousel** | 4:5 ×5 | Five slide briefs, art-directed as one set | Instagram, Facebook, Threads |
| **Post** | 4:5 | One image brief | Instagram, Facebook, Threads, X, LinkedIn |
| **Story** | 9:16 | One frame brief | Instagram, Facebook |

`PLATFORM_FORMATS` in [`types.ts`](../backend/functions/src/social/types.ts) is
the matrix everything trusts: the console greys out what an adapter cannot do,
and the pipeline filters targets through it, so a story is never quietly posted
to YouTube. Still formats skip the editing and ads stages entirely.

---

## 4. The queue — four decisions

| Action | What happens |
|---|---|
| **Approve & post now** | Publishes to the ticked networks, one at a time, with the per-network caption (and the YouTube title/description/tags verbatim). |
| **Approve only** | Marks it ready. It goes out when you press publish. |
| **Ask for changes** | Your note goes back to the team, and only the stages you tick re-run. |
| **Reject** | It never goes out. It stays readable. |
| **Delete** | Gone. |

The queue shows who did what, the standup concept, the hook (with the
alternatives the writer offered), the slides or the video, the search brief, the
YouTube copy, the campaign brief, the caption — editable in place — the caption
per network, the numbers, the sources, and every round of feedback so far.

### Asking for changes is scoped, and the cost is why

| You tick | Who is called back in |
|---|---|
| Just the caption | The writer, one cheap call. Your files are untouched. |
| Redraw it | The designer rewrites the brief, then the manager. Files you already attached stay put — upload a replacement to change one. |
| Recut it | The editor and the ads expert, then the manager. |
| Redo the search work | The SEO and Google SEO experts. |
| Redo the ad brief | The ads expert alone. |
| Rewrite it | A fresh standup, then most of the team. |

Rebriefing the whole team because someone wanted a different word in the caption
is how you spend a month's budget in an afternoon.

**Feedback is permanent.** Every note is stored on the piece and fed to everyone
who touches it later, so "the hook is generic, open on the hands" does not have
to be said twice.

---

## 5. Telling them things — three different scopes

| Where | Applies to | Example |
|---|---|---|
| **Employees → standing instructions** | everyone, every job, forever | "We are recruiting drivers in Lahore this month." "Never say cheapest." |
| **Employees → an individual's card** | that person, until they leave | "Rang: street light only, no studio shots." |
| **Queue → ask for changes** | one piece | "This hook is weak, open on the hands." |

One box for all three would mean either repeating yourself every morning or
accidentally turning one piece's note into a permanent rule. Personal direction
lives on the employee record rather than in settings, so it leaves when they do.

---

## 6. What the ads expert does and does not do

It writes a brief. It does **not** spend money: this backend holds no Google Ads
credential, books nothing and bids on nothing. A human takes the brief into Ads
Manager.

That is a deliberate line, not a missing feature. Connecting a spending account
to an unattended language model is a decision about money with a different risk
profile from a decision about a caption, and it is not one the content desk
should make on somebody's behalf. If it is ever wired up, it belongs behind its
own credential, its own approval step and its own budget ceiling.

---

## 7. Connecting an account

Connecting is a **paste, not a redirect**. You give the desk a token; the backend
immediately spends it on a read call against that network. If a profile comes
back, the credential is real and is stored sealed. If it doesn't, nothing is
written and you see the network's own error — `(#200) requires
pages_manage_posts` tells you what to fix in a way "connection failed" never
would.

OAuth buttons look nicer but need a reviewed app per network before they can
request publishing scopes, and until that review lands they are buttons that do
nothing. The stored shape is identical either way, so an OAuth flow can be added
on top later without touching the data model.

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

## 8. Comments

Every two hours, whoever holds the social-manager job reads the comments under
everything published in the last fortnight, classifies each one, and drafts a
reply in their own name. Whether that reply is *sent* is a separate switch
(`autoReply`), off by default. With nobody hired into that job, nothing is
drafted at all — an unanswered comment is better than one answered by a system
with no name against it.

Three things it will not do, whatever the settings say:

- **Never auto-answers a safety comment.** Anything about a crash, harassment, a
  woman feeling unsafe or the police is marked `escalated` and left for a person.
- **Never argues.** Complaints get an acknowledgement and a route to support.
- **Never invents a fact.** Same FACTS rule as the writer.

Spam is closed without a reply. Comment reading works on Facebook, Instagram,
Threads and YouTube; TikTok, X and LinkedIn are publish-only here.

---

## 9. Secrets

Both are their own GitHub Actions secrets, assembled into the functions `.env`
by `.github/workflows/deploy-functions.yml`. Neither goes in the
`PAYMENTS_GATEWAY_ENV` block — that block is overwritten wholesale and cannot be
read back, so anything appended to it has to be retyped from memory.

| Secret | Without it |
|---|---|
| `ANTHROPIC_API_KEY` | nobody can work — nothing is planned, written, briefed or replied to |
| `SOCIAL_TOKEN_KEY` (`openssl rand -base64 32`) | accounts cannot be connected; nothing publishes |

⚠️ Rotating `SOCIAL_TOKEN_KEY` makes every stored token unreadable. Reconnect
each account afterwards.

### There is no image or video key

There used to be. `GEMINI_API_KEY` was removed along with the renderer: this
backend draws nothing and renders nothing, and Claude is the only model it pays
for. The designer and the editor write briefs instead, the briefs are stored on
the piece, and the console shows them with a copy button next to the upload
control. You make the file however you like and attach it from the queue — it
then publishes through exactly the same path a rendered one did.

The trade is deliberate: the renders were the entire Google AI line on the bill,
Veo by far the largest part of it, and a picture nobody looked at before it went
out was never the point of the desk.

### The model id is a setting, not code

`textModel` is editable on the Employees page, so a rename is a settings change
and not a redeploy. It must be a Claude model — a Gemini id left in that field
from before the desk moved is ignored rather than sent to fail, and the console
says so under the field.

| | Default | Used by |
|---|---|---|
| Text | `claude-opus-5` | standup, research, writing, SEO, search, ads, captions, briefs, replies |

---

## 10. Before the first live post

The API adapters were written from each platform's public documentation, the way
the payments adapter was. Meta, TikTok, X, LinkedIn and YouTube all gate
publishing behind app review and scopes that only exist on an approved app, so
**the first successful post from a new app is the real test**. Work through it in
this order:

1. Add `SOCIAL_TOKEN_KEY`, redeploy, and connect **one** account.
2. Hire a team — one of each is fine to start; rename them to whatever you like.
3. Leave automation off. Press **Brief the team now** on the overview and pick
   **Post** — the cheapest format: one frame to make.
4. Read what comes back in the queue, including who did what. Try **ask for
   changes** on the caption once; that is the cheapest way to see the loop work
   end to end.
5. Publish that one piece by hand, to one network.
6. Brief a **reel** and read the cut. It is the brief you shoot or render from
   somewhere else; attach the file and publish that one by hand too.
7. Only then set a run hour and turn automation on.
8. Turn the comment inbox on. Read a few dozen drafted replies before you even
   consider `autoReply`.

---

## 11. Data model

| Path | What |
|---|---|
| `socialEmployees/{id}` | one person: name, role, title, personal direction, status, and what they have worked on |
| `socialAccounts/{platform}` | profile + status; admin-readable |
| `socialAccounts/{platform}/secret/credentials` | sealed token; **no client access** |
| `socialPosts/{YYYY-MM-DD-format}` | the team snapshot, the work log, the plan, script, SEO, search and ads packs, media, captions, targets, results and feedback history |
| `socialResearch/{YYYY-MM-DD}` | the day's market read and the pages it came from |
| `socialComments/{platform}_{commentId}` | one comment, its reading, and the reply |
| `system/socialAutomation` | the settings the scheduler and everyone reads |

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

## 12. Callables

| Function | What it does |
|---|---|
| `adminGetSocialRoles` | the jobs you can hire for, and what each would do |
| `adminHireSocialEmployee` | hire someone, with a name |
| `adminUpdateSocialEmployee` | rename, retitle, re-brief, or send off duty |
| `adminFireSocialEmployee` | remove from the roster (their credits stay) |
| `adminSeedSocialTeam` | hire one of each, for a first run |
| `adminGetSocialConnectSchema` | what the connect form should ask for, per network |
| `adminConnectSocialAccount` | verify a pasted credential, then seal and store it |
| `adminVerifySocialAccount` | re-check a stored credential |
| `adminDisconnectSocialAccount` | delete the credential; keep the profile row |
| `adminGetSocialSettings` | settings, which keys are configured, and what the roster cannot do |
| `adminUpdateSocialSettings` | validated write |
| `adminGenerateSocialPost` | put the team on a piece, for a date and format |
| `adminRequestSocialChanges` | send a piece back with feedback; re-runs only the scoped stages |
| `adminReviewSocialPost` | approve / reject, optionally publish |
| `adminPublishSocialPost` | publish, or retry the networks that failed |
| `adminAttachSocialMedia` | attach a video or slide made outside the pipeline |
| `adminDeleteSocialPost` | remove a piece |
| `adminSyncSocialComments` | read the comments now, and draft replies |
| `adminReplySocialComment` | send one reply |
| `adminSetCommentStatus` | close a comment without answering it |
| `socialDailyContent` | the hourly scheduler tick (not callable) |
| `socialEngagement` | the two-hourly comment pass (not callable) |
