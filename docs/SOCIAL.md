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
      │    └─ the checks    free, in code — one scoped rewrite if they fail
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

**By default, nothing publishes itself.** Every run ends at
`awaiting_approval`, because everything the team writes is a claim Velocity is
making in public, and the cost of reading one piece a day is nothing next to the
cost of the one that should not have gone out.

There is now an `autoPublish` switch for an owner who has weighed that and
decided otherwise. On, a finished piece goes straight to the connected networks
with **no quality gate in front of it** — that is what it says and it is the
whole point of it. What still holds is what lives in the writing rather than in
a check: every number comes from the FACTS block, no competitor is ever named,
and nothing promises an income. The piece is still scored and the scorecard is
still stored, so one that went out weak is findable afterwards; it is simply not
stopped. `approvedBy` is written as `auto`, because "who approved this" is a
question somebody asks a year later and "nobody did" is the honest answer.

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

## 2a. The playbook, and the checks that cost nothing

Everyone on the desk is given the same craft, and it is given to them **once, in
code**, rather than typed into the brief box every morning.

### The playbook

[`playbook.ts`](../backend/functions/src/social/playbook.ts) carries what is
actually known about getting reach on Instagram in 2026: the ranking order
(sends beat saves beat comments beat watch time, and likes are worth almost
nothing), the 26 hook formulas with the trap that ruins each one, the
125-character fold a caption lives or dies at, the five-hashtag cap, the story
frame order and which sticker does which job, the Reels safe zone in pixels, the
stock vocabulary that makes writing read as machine-written, and the triage
order for answering a thread.

It is distilled from three open MIT skill packs —
[instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill),
[instagram-skills](https://github.com/sergebulaev/instagram-skills) and
[video-edit-skill](https://github.com/tenfoldmarc/video-edit-skill) — and it is
**sliced per role**. The designer never sees the hook formulas; the writer never
sees the sticker table. A block nobody in that seat will use is a block we pay
for eight times a week to no effect.

The hard rules still outrank it. A hook formula is a *shape*, never a fact:
"{N}% of {group}" is a template for a sentence, not permission to invent a
statistic, and the FACTS block remains the only place a number may come from.

### The checks

[`lint.ts`](../backend/functions/src/social/lint.ts) is the half of the same
craft that can be decided arithmetically, ported from the Python tools in the
first pack. It runs on every piece, in Cloud Functions, on plain strings:

| Check | What it catches |
|---|---|
| **The hook panel** | Length, specificity, stakes, frontloading and who it speaks to — plus the dealbreakers: a greeting, "stop scrolling", a video preamble, a hashtag or an emoji in the hook. |
| **The caption lint** | Exactly what the feed shows before "… more", a first line that gets cut mid-clause, a sixth hashtag, generic tags, two asks or none, a dead link. |
| **The voice panel** | Sentence-length variation, concreteness, stock vocabulary density, the typographic fingerprint, and the shapes models default to. |
| **The beat sheet** | Ninety words of script in a twenty-second cut, a hook that takes five seconds to say, a beat with nothing changing on screen, no loop back to the first line. |

**It is free.** A quality gate that costs a model call per piece is a gate that
doubles the bill; this one is a few milliseconds of regex. It only spends a call
when it actually found something, and then exactly one: a scoped rewrite that is
kept only if it scored better than the draft it replaced. Never a loop — an
unattended run that can call itself until it is happy is one that can spend a
month's budget overnight.

The scorecard is stored on the piece and shown in the queue, so "the hook scores
42 and there are six hashtags" is a reason to send something back without
reading it end to end first.

**What the number is not.** The pack's own measurement, repeated here because it
decides how much weight to put on it: against hooks written deliberately badly
the panel separates well (AUC 0.83); between one good writer's hits and that
same writer's misses it is close to a coin flip (AUC 0.56). It is a floor, not a
judge. Nothing that only reads text can tell you which of two good hooks will
travel.

One deliberate departure from the Python: a check that cannot judge a piece of
text — burstiness needs four sentences — is left out of the arithmetic instead
of scoring a neutral 50 that drags the verdict down. Instagram captions are
three sentences long, and a gate that flags everything is one people learn to
click past.

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

A story is also the one format that is **not** only a rotation slot. With *A
story every day* on (the default), the desk queues one every day it runs, on top
of whatever the rotation landed on, and skips it on a day the rotation already
made one. Stories are for the people who already follow us — a ring on the
profile most days is the difference between a company somebody works at and a
logo — while a reel is what reaches the people who do not.

`PLATFORM_FORMATS` in [`types.ts`](../backend/functions/src/social/types.ts) is
the matrix everything trusts: the console greys out what an adapter cannot do,
and the pipeline filters targets through it, so a story is never quietly posted
to YouTube. Still formats skip the editing and ads stages entirely.

---

## 3a. The desk cuts its own reels

A video run no longer stops at a brief. With *Cut the reel here* on (the
default), [`reel.ts`](../backend/functions/src/social/reel.ts) renders a
finished 1080x1920 MP4 from the script the writer already wrote, and attaches it
to the piece through the same storage path a hand-made file takes — so it
reaches the queue, and publishes, exactly as one always did.

**It costs nothing per video.** Every open tool that claims to automate short
video turns out to need something paid behind it: a stock-footage key, a
text-to-speech model, an image model per frame, or a rendering service. This is
ffmpeg, two OFL fonts and the script. The only cost is the CPU seconds, which is
why the run functions moved from 1GiB to 2GiB — on Cloud Functions the memory
tier is what buys the CPU.

What it makes is a **kinetic typography reel**: the hook, then one line per
beat, moving on near-black and lime, cut to the timings `lint.ts` already
computes from the spoken script. That is not a consolation format — the feed is
watched muted, and words are what survive that. When slides have been attached
they become the backdrop with a slow push-in behind a scrim; with none, the
typography carries it alone.

| Decision | Why |
|---|---|
| The hook is capped at 2.5–4s | Sharing the clock by line length gives the longest line the most time, and the longest line is the hook. Seven seconds of opening would contradict the one rule the playbook is built on. |
| Nothing is drawn in the top 240px, below y=1470, or in the right-hand column | Instagram's own interface sits there. Text placed there is text nobody reads. |
| Moving parts are `overlay`, never `drawbox` | `drawbox` reads `t` as its thickness option and leaves an animated expression frozen at frame one. It renders a bar that never moves and looks fine until you check a later frame. |
| The words go in files, not in the filter graph | A caption with an apostrophe in it is otherwise a quoting problem three layers deep. |
| An attached video is never overwritten | If somebody shot the real thing, that is the piece. |
| A failed render is not a failed run | The brief, the script and the frames survive, and the queue still offers the upload control. |

`planReel` and `filterGraph` are pure functions, so the timings, the wrapping
and the safe zone are tested in CI, which has no ffmpeg in it. Only the render
itself spawns anything.

---

## 3b. Reading our own page

Everything above decides what to make. [`insights.ts`](../backend/functions/src/social/insights.ts)
decides what to make **next**, from what already happened.

An hour before the team starts, it reads how our own posts actually did through
the network's own insights — which cost nothing — and ranks them by the
**multiple over this account's own median**. Raw reach is not evidence: 400,000
views is a quiet Tuesday on one account and a discovery on another, and the only
baseline that says anything about the *post* rather than the account is the
account's own normal. Sends and saves are reported per thousand reached and are
weighted ahead of likes, because that is the order the ranker itself uses.

One model call turns that into a few sentences — what to do more of, what to
stop — and the standup reads it **before** the market read, because what a
stranger's account did is a hint and what ours did is evidence. The loop is the
point: make, measure, feed it back. That is the difference between a team and a
content generator.

Once a week the same desk scores the profile out of 100 against the twelve-point
rubric in the playbook — name field, bio, pinned three, highlights, the first
nine covers, whether the account looks alive — worst item first, with the
rewrites written out rather than described. It can read the text fields but not
the pictures, and it says so rather than pretending.

Both land in `socialInsights/{latest|profile}`, admin-read-only, and are shown
on **What is working**. Zero posts yet means it says so instead of inventing a
pattern from three data points.

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
| **Employees → brief the team** | everyone, every job, forever | Five boxes: who we are, what you want from a post, what you mean by viral, how people who reply are answered, and what must never happen. Written once on the first day and read on every job after it. Each box goes only to the people it is for. |
| **Employees → standing instructions** | everyone, every job, forever | The short note box for what is true *now*: "We are recruiting drivers in Lahore this month." "Never say cheapest." |
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

### Instagram and Facebook: one button

Instagram connects through **Facebook Login**, not a paste —
`backend/functions/src/social/meta.ts` and `components/social/instagramConnect.tsx`.
Press *Continue with Facebook*, sign in as whoever manages the Velocity Rides
Page, tick the Page, done. The backend then does what the paste flow asked a
human to do by hand:

1. `adminStartMetaConnect` mints a one-time `state` and returns the dialog URL.
2. Facebook redirects to `/connect/instagram` — a public page on our own domain
   whose only job is to hand the authorization code back to the console window
   and close. It is allowed to be public because a code cannot be spent without
   the app secret, which never leaves Cloud Functions.
3. `adminFinishMetaConnect` exchanges the code for a short-lived user token,
   exchanges **that** for a long-lived one, and reads `/me/accounts`. The order
   matters: Page tokens minted from a long-lived user token do not expire, and
   doing it the other way round gives you a desk that silently stops publishing
   about two months later.
4. `adminChooseMetaPage` stores the Page the admin picked — both the Facebook
   Page and the Instagram Business account attached to it, since they share one
   Page token.

Both end up in `connectVerifiedAccount`, the same function a pasted token goes
through, so there is exactly one path that writes a credential.

Setup is once, in the Meta console: add **Facebook Login** to the app that owns
the Page, whitelist `https://velocityrides.app/connect/instagram` as a valid
OAuth redirect URI, and paste the App ID and App Secret into the accounts page.
The secret is proved with a client-credentials call before it is stored, sealed
under `SOCIAL_TOKEN_KEY` at `system/socialMetaApp/secret/credentials`. If
`META_APP_ID`/`META_APP_SECRET` are in the function environment they win; failing
both, the `WHATSAPP_APP_ID`/`WHATSAPP_APP_SECRET` pair already deployed for the
WhatsApp Cloud API is used, because it belongs to the same Meta app.

### Everything else: a paste

For the networks Meta does not own, connecting is a **paste, not a redirect**.
You give the desk a token; the backend immediately spends it on a read call
against that network. If a profile comes back, the credential is real and is
stored sealed. If it doesn't, nothing is written and you see the network's own
error — `(#200) requires pages_manage_posts` tells you what to fix in a way
"connection failed" never would.

An OAuth button per network needs a reviewed app per network before it can
request publishing scopes, which is why only Meta's has been built. The stored
shape is identical either way, so the rest can follow without touching the data
model.

| Network | Paste | Scopes worth double-checking |
|---|---|---|
| Facebook Page | long-lived Page token + Page ID | `pages_manage_posts`, `pages_read_engagement` |
| Instagram | *(use the button above)* — or the same Page token + IG Business account ID | `instagram_content_publish`, `instagram_manage_comments` |
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

`socialOAuthStates/{state}` holds the few minutes between *Connect* being
pressed and a Page being chosen — including the Page tokens Facebook just
returned, sealed with the same key. Unlike every other social record it is
**closed to the console as well**, because nothing client-side ever needs it:
the `state` string travels through the redirect, and the callables look the
document up with the Admin SDK.

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
| `ANTHROPIC_API_KEY` | the desk falls back to the local engine — see below. Plainer writing, and no market read |
| `SOCIAL_TOKEN_KEY` (`openssl rand -base64 32`) | accounts cannot be connected; nothing publishes |

Only one of these is a hard stop. `SOCIAL_TOKEN_KEY` is: a page token is a
password and storing one in the clear is not an option, so with no vault there
is nowhere to post. `ANTHROPIC_API_KEY` used to be, and is not any more.

⚠️ Rotating `SOCIAL_TOKEN_KEY` makes every stored token unreadable. Reconnect
each account afterwards.

### The second engine: writing with no key

`src/social/local/` is a writer that needs no key, no network and no quota. It
is reached by one check — `if (!claudeReady())` — at the top of every stage, so
the pipeline, the console and the queue are unchanged and a key appearing later
switches everything back with no migration.

It works by inverting something the desk already owned. `lint.ts` is 900 lines
of deterministic critic: it scores a hook on length, specificity, stakes,
frontloading and whether the viewer is addressed; it lints a caption against the
fold, the five-tag cap and the one-ask rule; it times a voiceover at 165 words a
minute and faults a beat over four seconds. All of it was built to mark the
model's homework. Pointed the other way it is a fitness function — so the local
engine generates every piece its material allows, scores them all, and keeps the
one the critic has nothing left to say about.

| | `claude.ts` | `local/` |
|---|---|---|
| Hook, caption, script | written | composed from `material.ts`, then selected |
| Numbers | instructed to use FACTS only | **cannot** name a figure whose fact is absent |
| Market read | live web search | none — says so, never invents a trend |
| Per-network captions | asked to respect limits | applies them exactly |
| Page lessons | describes the numbers | computes them (better) |
| Profile audit | yes | no local equivalent |
| Change requests | read and applied | cannot be read; the caller says so |
| Cost / failure modes | per call; refusals, quota, timeouts | none |

The honest limit is that the ceiling is the material. It will never write a
sentence nobody wrote down, never notice that today is different, and over a
long run the feed reads as a family of shapes. Variety is rotation plus
selection, which is not the same as having an idea — so `claudeReady()` still
wins whenever a key exists, and the console says which engine ran.

Two things to know before editing `material.ts`:

- **Every line that names a figure declares the fact it needs.** A line whose
  fact is zero or missing is dropped before scoring. That is HARD_RULES #1
  enforced in code, and it matters more here than it did with a model, because
  a template will happily print "Rs 0" where a model would have hesitated.
- **The timer ignores a proper noun at the start of a sentence** (its regex is
  `(?!^)`), so "Velocity Rides checks the papers" counts as having nothing
  checkable in it and "The Velocity Rides check covers the papers" does not.
  Spoken lines are written around that, and the tests enforce it.

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
| `socialInsights/latest` | how our own posts did, ranked against our own median |
| `socialInsights/profile` | the profile, scored out of 100, with the rewrites |
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
| `adminGetMetaConnectState` | whether one-click Instagram is possible, and the redirect URI to whitelist |
| `adminSetMetaApp` | prove a Meta App ID + Secret against Facebook, then seal the secret |
| `adminStartMetaConnect` | mint the one-time `state` and the Facebook dialog URL |
| `adminFinishMetaConnect` | spend the code, and report the Pages the grant reached |
| `adminChooseMetaPage` | store the chosen Page and its Instagram Business account |
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
| `adminReadOwnPage` | read our own numbers now and rank them |
| `adminAuditProfile` | score the profile now |
| `socialDailyContent` | the hourly scheduler tick (not callable) |
| `socialPageRead` | the daily read of our own page, an hour before the team starts (not callable) |
| `socialProfileAudit` | the weekly profile score (not callable) |
| `socialEngagement` | the two-hourly comment pass (not callable) |
