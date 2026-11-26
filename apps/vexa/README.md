# Vexa app — UI only

Expo app for the Vexa mobile client. It is **frontend only**: nothing is wired
to an API, auth or Firebase — but nothing is faked inside a screen either.

**The rule: no screen holds data.** Everything shown is derived from
`src/store.ts` — real timestamps rendered through `timeAgo()`, credits counted
out of a ledger, ad estimates worked out from your own campaign history, the
drawer ring counted from today's jobs. Every feature books its work through
one function, `record()`, which spends the credits, writes the Activity line
and raises the notification, so Activity, Usage and Notifications can never
drift from what actually happened. Ask her for content on the home screen and
the drafts really appear in the Content Team calendar; ask for ads and a draft
campaign is really waiting in Ads Expert.

What is *not* real: the outside world. She does not send a Gmail, search
Instagram or post to an account — that needs a backend and the platform
approvals that are still pending.

## The flow

```
Splash  ->  How it works (3)  ->  Sign in  ->  App shell  ->  every feature
```

* **Splash** — the mark, the name, Vexa rising, and she *says* one line out
  loud: "I am Vexa, your social media manager and Ad Expert for Facebook,
  Instagram and Google." It holds for **at least five seconds and never cuts
  her off mid-sentence** (hard cap 13s). The line also types itself out beside
  a waveform, so a muted phone loses nothing. Tap anywhere to skip.
* **How it works** — one job a page, spoken aloud as you reach it: "I create
  your content and manage your social media", "I run your ads on Facebook,
  Instagram and Google", "I answer your customers and close your sales". Each
  page is a drawn scene (`components/Scenes.tsx`) inside a glass arena, with
  the platforms she works through orbiting the rim, one short line, and a pill
  that replays her voice. Skip is top right, facing her mark; Get started is
  bottom right under it.
* **Sign in** — Continue with Google, or +92 phone then a 6-box OTP.
* **App shell** — header, tab bar (Home · Activity · Content · Profile), left
  drawer, and a pushed detail that slides in from the right.

## Her voice

`src/voice.ts` scores every system voice and always picks a **female** one.
The trap it solves: the voice list is empty on the first call and every
platform's *default* voice may be male — on this machine it is "Microsoft
George" — which is exactly how she ended up sounding male. It now waits for
the list, scores it (female names up, male names heavily down, English
preferred), and caches only a successful pick. She never goes silent: a phone
with nothing but male voices still gets her line, pitched up. On-device
(`expo-speech`), no key, nothing leaves the phone.

## The screens behind the drawer

Every row in the drawer, every tile on home and every tab goes somewhere real,
with the whole flow in place — create, read, update, delete, and the states a
real network has.

| Destination | What works |
|---|---|
| **Ask Vexa** (the home box) | Type what you want in your own words, English or Roman Urdu — "find me 60 investors on instagram and gmail se email bhejo in Karachi". She shows what she understood (who, where, how many, which city — each tappable to change), her plan, then does it: finds the people, drafts the message, sends on your word. Content, ads and research asks make real drafts, draft campaigns and briefs instead. |
| **Outreach** | Everyone she found, what state each is in, the messages she reuses, and every search she has run. Add people by hand, move them through found → written to → replied → won, turn one into an enquiry for the Sales Team. |
| **Research Team** | Ask a question → a four-step job with a progress ring → a saved brief. Open, rename, copy, delete. Market bar chart. |
| **Content Team** (also the Content tab) | Week strip, five filters, cards per piece. New/edit piece: format, accounts, caption ("Let Vexa write it"), hashtags, day, time. Approve, schedule, duplicate, delete. Posted pieces show views/likes/comments. |
| **Ads Expert** | Today's spend ring against the daily budget, blended ROAS, campaign cards with 7-day bars. Four-step build: goal → audience → budget (PKR/day) → creative, then launch. Pause, resume, edit, delete, and a "why it costs what it costs" note. **Its first load fails on purpose** so the retry path is a real screen. |
| **Sales Team** | Pipeline stats, stage filters, enquiry cards. One enquiry: call/WhatsApp, stage chips, worth, conversation with a composer, "Let Vexa reply" (typing dots), notes, mark won/lost, delete. Add an enquiry by hand. |
| **Connected Accounts** | Five platforms, a connect flow that shows the permissions first and then runs a four-step job, sync-all, per-account permissions, disconnect with a warning. **YouTube refuses the first attempt** so the failure and retry are real. |
| **Make me Learn** | What she knows (ring), train her (job), her voice and always/never chips, add a rule / link / file, edit, delete, and "try her out" — ask a question and she answers using your rules. |
| **Usage** | Credits ring and meter, per-agent breakdown, 7-day bars, price list, auto top-up switch, buy a pack. |
| **Billing** | Plan card, card list (add with validation, make primary, remove), bank transfer with the account details and an "I have paid" form, invoices, billing details. |
| **Vexa Pro / Subscription** | Monthly–yearly toggle, three plans, change plan, cancel, FAQ. |
| **Activity tab** | What she is doing now, counters, agent filters, a timeline rail, load earlier. |
| **Profile tab** | You, your business, her voice, what she may do unattended, notifications, language, look, account rows, log out, delete account. |
| **Notifications** (the bell) | Unread filter, mark read, mark all, remove, clear all; tapping one opens the screen it came from. |
| **Your plan** (the home goal box) | Say a goal → she thinks → a four-point plan you can switch on and off, what it costs, "let her start". |

## Look and motion

Apple-style glass everywhere: `components/Glass.tsx` is one frosted pane —
`expo-blur` behind, a diagonal sheen, a hairline rim. `components/Backdrop.tsx`
is the slowly breathing light the glass refracts. One rule: **never wrap a
video in `Glass`** — on the web a backdrop filter over a video smears it, so
the story film has a plain bordered frame.

`components/kit.tsx` holds everything the screens are built from, and
everything in it moves: an indeterminate **loading bar**, shimmering
**skeletons**, a **slow-connection** note that appears when a wait outlasts
1.3s, a failure card with **try again**, **round progress rings** that draw
themselves, **meters** with a shimmer, **count-ups**, **bars** that grow out of
the floor, staggered list rows, spring **sheets**, a popping **dialog**, a
**toast**, **typing dots**, a pulsing **FAB** and sliding **segments**.

`src/net.ts` is the pretend network those states come from: `useLoad`,
`useAction` and `useSteps`. `src/store.ts` is the data — one module-level
object with a subscribe/commit pair, so something you add on one screen is
still there when you come back from another.

```
App.tsx                        splash -> story -> auth -> app, cross-faded
src/theme.ts                   colours, glass tokens, IS_PRO
src/anim.ts                    useEnter (fade/rise/pop), useLoop (float/breathe)
src/store.ts                   the data, the credit ledger, record(), and
                               every derived number the screens show
src/intent.ts                  what she makes of a sentence, who she finds,
                               what she writes
src/net.ts                     fake loads: loading / slow / failed / retry
src/voice.ts                   her voice — female only
src/screens/SplashScreen.tsx   the mark, the bar, and her one spoken line
src/screens/StoryScreen.tsx    Content / Ads / Sales, each spoken aloud
src/screens/AuthScreen.tsx     Google + phone OTP
src/screens/AppShell.tsx       header, tabs, drawer, pushed detail
src/screens/HomeScreen.tsx     the agent stage and the goal box
src/screens/routes.tsx         which title means which screen
src/screens/*Agent.tsx         Research / Content / Ads / Sales
src/screens/ConnectedAccounts.tsx  connect, permissions, disconnect
src/screens/MakeMeLearn.tsx    rules, training, try her out
src/screens/Usage.tsx          credits
src/screens/Billing.tsx        cards, bank transfer, invoices
src/screens/ProPlans.tsx       plans and billing period
src/screens/ActivityScreen.tsx what she did
src/screens/ProfileScreen.tsx  you, your business, her limits
src/screens/NotificationsScreen.tsx
src/screens/GoalPlan.tsx       the goal box answered with a plan
src/screens/Pane.tsx           stand-in for anything not yet designed
src/components/kit.tsx         every shared piece, all animated
src/components/Scenes.tsx      the three drawn welcome scenes
src/components/Glass.tsx       the frosted pane
src/components/VexaProgress.tsx  the drawer's live ring + bar
src/components/Backdrop.tsx    ambient light
src/components/VexaStage.tsx   pedestal, beam, rings and the floating figure
src/components/Drawer.tsx      left drawer, rows stagger in
src/components/Avatar.tsx      Vexa's face
src/components/Icons.tsx       line icons
src/components/BrandMarks.tsx  Google / Instagram / Meta / YouTube / TikTok / WhatsApp
```

## Running it

```
npm install
npm run web      # the UI in a browser via react-native-web
npm start        # Expo dev server for a device
npm run typecheck
npm run check     # typecheck + the intent reader's own cases
```

`scripts/check-intent.mjs` is the one real test: it feeds fourteen sentences
to `src/intent.ts` and asserts what she takes from each, because the words
overlap in traps ("research" contains "search", "boost my post" is an ad not a
post, "write my content" is the calendar but "write to shops" is outreach).

Metro's file watcher does not pick up edits in a git worktree on this machine —
restart the dev server after changing a file.
