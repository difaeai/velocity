# Self-hosted web fonts

The latin variable cuts of the three faces the marketing site uses, byte-for-byte
the files Google Fonts serves. They live here so `next build` never has to reach
fonts.gstatic.com — that fetch failed on 2026-10-17 and took the Admin · build
job down with a module-not-found on the generated `@font-face`.

| File | Family | Axis | Source |
| --- | --- | --- | --- |
| `outfit-latin.woff2` | Outfit v15 | `wght` 100–900 | `fonts.googleapis.com/css2?family=Outfit:wght@100..900` |
| `work-sans-latin.woff2` | Work Sans v24 | `wght` 100–900 | `fonts.googleapis.com/css2?family=Work+Sans:wght@100..900` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono v24 | `wght` 100–800 | `fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800` |

All three are licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>), which permits bundling them with the site.

To refresh a file, request the CSS above with a desktop browser user agent, take
the `src: url(...)` out of the `/* latin */` block and download it. Only the latin
subset is kept; the old `next/font/google` call asked for `subsets: ['latin']` too.
