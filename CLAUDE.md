# Velocity — agent toolchain

This repo is ~870 tracked files, ~720 of them TS/TSX. Grepping it blind is the
main reason a session burns its context. The tools below are installed; use
them before falling back to `grep` or opening files one by one. None of them
needs an API key unless the section says so.

## Answer "where / what / what breaks" from the graph, not from grep

`graphify-out/graph.json` is a knowledge graph of every tracked source file,
built locally with tree-sitter: no LLM, no API key, nothing leaves the machine.
It is derived output and is gitignored — rebuild it, never commit it.

    graphify query "which function writes the pool trip doc" --budget 2000
    graphify explain "poolTripFactory"       # a node and its neighbours
    graphify affected "stampDriverCell"      # what a change to it reaches
    graphify path "joinPoolRide" "poolRoster"  # how two things connect
    graphify god-nodes                       # the architectural hubs

Rebuild after pulling a branch that moved code:

    graphify update .                  # incremental, changed files only
    graphify extract . --code-only     # full local re-scan, no API key

Node labels carry their parentheses (`requireAdmin()`, not `requireAdmin`), and
a symbol defined in several files is ambiguous: the command lists the
candidates and you retry as `path::symbol`, e.g.

    graphify affected "backend/functions/src/lib/guards.ts::requireAdmin()"

"No match" usually means the graph is stale rather than the code being absent,
so rebuild before concluding anything is missing.

## Coding tasks

- **ponytail** is on by default: the smallest change that fully solves the
  task, stdlib first, no abstraction nobody asked for. Levels:
  `/ponytail lite|full|ultra`. A deliberate shortcut is marked with a
  `shortcut:` comment naming its ceiling; `/ponytail-debt` lists the ledger.
- `/ponytail-review` reviews a change, `/ponytail-audit` the whole repo.
- **agent-skills** covers the lifecycle: `/spec` `/plan` `/build` `/test`
  `/constraints` `/agent-skills:review` `/ship` `/webperf` `/code-simplify`.
  (`/review` is taken by the built-in, so use the namespaced form.)

## Internet research

**agent-reach** routes research to 16 platforms — Reddit, X, Facebook,
Instagram, YouTube transcripts, RSS, and any URL through Jina Reader. Use it
rather than guessing what riders or competitors are saying. `agent-reach
doctor` prints which channels are live; the rest need credentials, so ask
before promising a platform.

## Video

The **moneyprinterturbo-video** skill renders a finished MP4 from a topic
(TTS + stock footage). It needs a Pexels key and an LLM key, so confirm those
exist before starting. The social desk already renders reels with ffmpeg at no
per-video cost — prefer that for anything the desk can do itself.

## Sales outreach (machine-local, outside this repo)

Harvey is an autonomous cold-email agent that runs on the Claude subscription
rather than an API key. On this machine it lives at
`C:\Users\DELL\ai-tools\harvey`; run it from there with
`.venv\Scripts\harvey status`. It cannot send anything until a real sending
mailbox exists, so treat it as idle until then.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
