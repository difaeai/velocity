# Research audit — Velocity AI Studio (2026-10-28)

Phase 1 of the research-engine upgrade: how the agents research today, traced
through the code and checked against production data, before anything was
changed. The second half says what this pass fixed and what is still owed.

## How research flows today

```
10am run (pipeline.ts runDaily)            hourly batch (makeAhead, until 2026-10-28)
        │                                          │
        └──────────── createPost → runTeam ────────┘
                            │
             research.ts runResearch (once per date, cached in socialResearch/{date})
               ├─ one grounded call (Gemini Interactions + Google Search) → trends,
               │  competitorMoves, opportunities, hookPatterns, sounds, viral, accounts
               └─ discovery.ts readAccounts → Instagram Business Discovery: each
                  account's last 25 posts, ranked by multiple over its own median
                            │
             crew.ts researchBlock → standup (planContent) → writer, designer, SEO
             strategy.ts planMonth ← market.ts planningResearch (once a month)
             launch.ts (Studio customers) readLinks → reads the customer's own pages
```

Tools that are genuinely available: Gemini grounded search (`GEMINI_KEY_RESEARCH`,
free grounding only on `gemini-2.5-flash`), Instagram Business Discovery through
the connected account (free), our own Instagram insights (`insights.ts`), Pixabay,
and a plain `fetch` of public pages (launch, sales). No browsing agent, no Meta Ad
Library access (below), no search-trends API.

## Root causes found (with the evidence)

| # | Finding | Evidence |
|---|---|---|
| 1 | **Research never reached the content.** The calendar was written 30 days at once (26 Oct), then nothing was written until <3 days were left. The daily read changed nothing for a month. | `system/socialAutomation`: `calendarUntil 2026-11-26`; 32 pieces `ready` with the 26 Oct research |
| 2 | **No competitor was ever read with numbers until today.** The default competitor list had no Instagram handles, so Business Discovery only read accounts the search happened to name. | `socialResearch/2026-10-23 … 10-27`: `accounts: []` every day; 10-28 the first read (careempak, indrive.pk, yango.pakistan) |
| 3 | **A failed search threw away the account reads too.** `readAccounts` ran only after the grounded call succeeded, and `researchBlock` dropped everything when `error` was set. | `research.ts` before this change; log "the market read failed" 19:00–21:00 27 Oct |
| 4 | **The fallback engine was dead.** Groq shut down `llama-3.3-70b-versatile` on 2026-08-16; a 404 was not treated as "next engine", so 23 stories failed instead of reaching the local writer. | `socialPosts` 2026-11-01…26-story: `Standup: 404: The model … does not exist` |
| 5 | **The refusal text was never logged.** The bench warning passed `{ message }`, which the logger's own message field overwrote. Gemini has refused within ~250 ms, no retry, every hour since 16:03 UTC 27 Oct — a hard credit/quota refusal — and the logs cannot say which. | `socialdailycontent` warnings 27–28 Oct |
| 6 | **Every angle was a product feature.** The month plan and the rotation only offered feature angles, so the writing was adverts ("Islamabad: your fares, your rules") while the competitors' own numbers showed their outliers were humour and small stories. | 10-28 read: inDrive Roman Urdu meme 10.8× its normal, Careem relatable reel 51.9×, Yango late-parcel story 3× |
| 7 | **Citations are opaque.** Grounded sources are `vertexaisearch.cloud.google.com/grounding-api-redirect/…` links titled only by domain; they expire, so a stored claim cannot be traced later. | `socialPosts/*.research.sources` |
| 8 | Searches are not repeated (one read per date, cached) and the cost is metered per job ("The market read" ≈ $0.015/call). | `aiUsage/2026-10_velocity.byWhat` |

What was **not** found: no fabricated sources (only `url_citation` annotations
become sources, `viralList` keeps only real https paths), no claims of browsing
without a tool call, and tenant isolation holds (`sdb`/`wsPath` prefix every
research path per workspace).

## Fixed in this pass

- **Day by day** (`makeAheadDays` 0): each morning's read writes that day; the month
  plan's topic is a starting point the morning's read may override.
- **Competitors read every morning with real numbers**: Careem `careempak`, inDrive
  `indrive.pk`, Yango `yango.pakistan`; plus a house study list of Indian brands whose
  content travels (`rapidoapp`, `zomato`, `swiggyindia`, `letsblinkit`). Up to 14
  accounts, one free Graph call each. Bykea's site links no Instagram account.
- **Account reads survive a failed search** and still reach the standup.
- **The content mix** (`playbook.ts` `CONTENT_MIX`, plus meme / that-one-friend /
  nostalgia / small-story shapes): ~7 in 10 entertain, ~2 teach, ≤1 sells — read by
  the standup and the month plan, with the competitors' numbers as the evidence.
- **Engines**: a retired model id benches that engine like a spent account; the free
  default is `openai/gpt-oss-120b`; a piece whose last model refused mid-way is made by
  the local writer instead of failing; the refusal text is logged as `error`.
- **Cost**: calls and finished pieces are counted per day; AI keys & usage shows a
  day-by-day table in dollars and rupees.

## Still owed (later phases, not started)

- **Phase 2 orchestrator + Phase 9 evidence model**: one research call shape for every
  agent (content, Ad Expert, sales) with a claim/source/date/confidence record. Today
  each agent has its own prompt around the same `generateJson({ grounded: true })`.
- **Canonical citations**: resolve the grounding redirects to the real page before
  they expire — check Google's grounding display terms first.
- **Phase 3 for the house**: the customer launch reads the customer's site; Velocity's
  own desk still works from hand-written brand material, not velocityrides.app.
- **Phase 4 ads**: Meta's Ad Library API returns commercial ads only for the EU/UK
  (elsewhere political/issue ads), so competitor ads in Pakistan cannot be read by API.
  Business Discovery gives likes and comments, not reach or views.
- **Phase 10 memory**: research is kept per date; there is no competitor profile that
  accumulates over weeks or a list of disproven assumptions.
- **Phase 12 evaluation suite** across the five sample businesses — not built; quality
  is so far judged by our own page's numbers (`insights.ts`).

## Credentials and access to check

- `GEMINI_KEY_RESEARCH` refuses every call since 27 Oct 16:03 UTC — see AI keys & usage
  → "Velocity's own work" for the exact refusal (likely prepaid credit). Until it
  answers there is no grounded search; the free model cannot search at all.
- Instagram Business Discovery needs the connected account's token (working: 10-28).
