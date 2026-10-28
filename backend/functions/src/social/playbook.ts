/**
 * The playbook — the craft the desk works to, given to everyone once instead of
 * being typed into the brief box every morning.
 *
 * Everything in here is distilled from three open skill packs:
 *
 * - `Jakeschincariol/instagram-agent-skill` (MIT) — the 26 hook formulas, the
 *   five-property hook panel, the caption fold, the humanizer lexicon and the
 *   twelve-point profile rubric.
 * - `sergebulaev/instagram-skills` (MIT) — the 2026 ranking heuristics and the
 *   sized-hashtag model.
 * - `tenfoldmarc/video-edit-skill` (MIT) — the beat timings a cut lives or dies
 *   by. The renderer itself is a local tool and cannot run here; what survives
 *   the trip is the timing discipline, which is the part a brief needs anyway.
 *
 * Three decisions worth knowing about:
 *
 * 1. **It is sliced per role, not pasted whole.** The designer never sees the
 *    hook formulas and the writer never sees the sticker table. Every employee
 *    carries their slice on every job, which is what makes "the team knows how
 *    Instagram works" true rather than something somebody has to remember to
 *    say. It is also the cheap way to do it: a whole playbook in eight prompts
 *    is eight times the tokens to tell eight people seven things they will not
 *    use.
 * 2. **The hard rules still win.** A formula here is a *shape*, never a fact.
 *    "33% of X never Y" is a template for a sentence, not permission to invent
 *    a statistic — `HARD_RULES` in crew.ts outranks everything below, and the
 *    FACTS block is still the only place a number may come from.
 * 3. **Platform numbers go stale, so they are dated.** The five-hashtag cap is
 *    the live one as of this file's date, down from thirty on 18 December 2025.
 *    When Instagram moves, Instagram is right and this file is wrong — change
 *    it here and the whole desk changes with it.
 *
 * The deterministic half of the same craft lives in `lint.ts`, which scores
 * what the writer produced against these rules in code, for free, before a
 * human is asked to read it.
 */
import type { ContentFormat, Role } from './types';

// ── what the ranker actually rewards ────────────────────────────────────────

/**
 * Shared by everyone, because a designer who does not know that sends outrank
 * likes draws a prettier picture than the one that gets sent.
 */
export const ALGORITHM = `HOW REACH IS ACTUALLY WON (2026):
Instagram ranks on predicted engagement, and the kinds are not equal. In order of how far they carry a piece:
1. Sends — somebody forwarding it to one friend in DMs. The strongest signal there is.
2. Saves — "I will need this later". Lists, how-tos, fare breakdowns, before/after.
3. Comments, especially ones we reply to. A conversation reads as quality.
4. Watch time and rewatches on a reel.
5. Profile visit, then follow.
6. Likes. Cheap, and worth very little reach.
A "not interested", a hide or a report outweighs a pile of likes.

So the question before anything goes out is not "is this nice" — it is: would one person send this to one specific friend, or save it to use on Thursday? If neither, it is a post nobody asked for.

What suppresses reach, every time:
- Engagement bait: "comment YES", "tag three friends", "double tap if".
- A watermark from another app on the video.
- A wall of generic hashtags.
- Anything outside 4:5 to 1.91:1 in the feed, which gets cropped.
Reels are the only format that reliably reaches people who do not follow us. Carousels go deeper with the people who already do.`;

// ── the hooks ───────────────────────────────────────────────────────────────

/**
 * Twenty-six shapes a first line can take. The writer picks one on purpose
 * rather than drifting into the two it would have reached for anyway.
 *
 * The template is the shape; the trap is how that shape is usually ruined. The
 * examples are deliberately not about Velocity Rides: an example close to the
 * subject gets copied instead of used.
 */
export const HOOK_FORMULAS = `THE 26 HOOK SHAPES. Pick one deliberately and name it. The example shows the SHAPE — never reuse its numbers, and every figure you write comes from FACTS.

1. Cost Confession — "{amount} is what {one mistake} cost me." Trap: a cost that is not a number.
2. Negative Command — "Stop {common action}. Do {alternative} instead." Trap: a habit nobody actually has.
3. Nobody Tells You — "Nobody tells you that {uncomfortable truth}." Trap: a truth everybody already says.
4. The Replacement — "{This} replaced {expensive thing} for {price}." Trap: overstating what it replaced.
5. Time Collapse — "This used to take {long}. Now it takes {short}." Trap: a ratio nobody believes.
6. The Receipt — "I did {thing} for {N days}. Here are the actual numbers." Trap: no screen, so it is only a claim.
7. Wrong Way, Right Way — "You are doing {thing} wrong, and it is not your fault. {The fix}." Trap: dropping the absolution, so it reads as an insult.
8. Insider Leak — "{N years} inside {the thing}. Here is what we never said out loud." Trap: promising a secret, delivering the brochure.
9. The Steal — "Steal this {artifact}. It took me {time}." Trap: the artifact not being on screen to screenshot.
10. If This, Then Watch — "If you {specific situation}, this {short time} fixes it." Trap: a situation so broad it qualifies nobody.
11. Numbered With A Favourite — "{N} {things} that {outcome}. Number {k} is the one nobody uses." Trap: N above seven.
12. The Objection — "'{objection in their words}.' Fine. Here is the version that works anyway." Trap: inventing the objection instead of quoting it.
13. Before And After, On Screen — show the old, show the new, name ONE lever. Trap: naming three levers.
14. The Callout — "{Specific group}, this is the one you have been ignoring." Trap: a group too large to be a callout.
15. The Flop Record — "My first {N} did nothing. Here is what changed on {N+1}." Trap: making the change sound like luck.
16. The Verbatim Question — "'{question exactly as asked}' — I get this every week." Trap: tidying the question up. Its value is that it is in their words. This is the search-friendly one.
17. Head To Head — "{A} versus {B}. I ran both and one was not close." Trap: a diplomatic ending, which is no ending.
18. Cold Open Demo — start mid-action, hand already moving. "Watch what this does." Trap: a payoff twelve seconds away.
19. The Deadline — "{Thing} changes on {date}. Do {action} before then." Trap: a manufactured deadline. One fake and every future one is discounted.
20. Permission — "You do not need {the thing everyone says you need}." Trap: removing the blocker and putting nothing in its place.
21. Mid-Sentence Start — "...and that is when {the turn}." Trap: never filling in the gap afterwards.
22. Contrarian Flip — a well-known saying, inverted. Trap: flipping a saying nobody says.
23. The Statistic — "{N}% of {group} {surprising fact}." Trap: a statistic with no source. Ours must come from FACTS or it does not get written.
24. The Reveal — "This is the new {thing}." Trap: holding it up without saying what it changes.
25. Someone Else's Result — "There was one {person} who {outcome} in {time}." Trap: an anonymous miracle, which is a rumour.
26. The Superlative — "The {fastest/only} {thing} is {the answer}." Trap: a soft answer. If the second half is "consistency", nothing was said.

HOW A HOOK IS BUILT:
- The spoken hook and the on-screen hook are two different sentences. On screen is shorter and blunter: six words or fewer, no punctuation it does not need.
- No setup. Start at the sentence you would normally reach at second six.
- Say the number out loud. "A lot" is not a number.
- Five to twelve words. Past that it does not land before the thumb moves.
- Put the payload in the first three words. The interesting word cannot be in position nine.
- Speak to one person: "you", singular — or open on an imperative.
- Something has to be at stake. A line with no tension is a statement, not a hook.
- If the hook would work for any other business selling the same thing, it is not our hook.
- A hook promises something. Deliver it before the halfway mark.

NEVER, in any hook: "stop scrolling", "don't scroll", "in this video", "wait for it", "watch till the end", a greeting of any kind, a hashtag, or an emoji.`;

// ── the formats ─────────────────────────────────────────────────────────────

const FORMAT_CRAFT: Record<ContentFormat, string> = {
  reel: `REEL CRAFT:
- Three seconds decide everything. Second zero has motion, a face or a hand, and on-screen text — a static talking head at 0:00 wastes all three hooks at once.
- No beat sits longer than four seconds without something changing on screen. A static frame is where people leave.
- Break the pattern around second five: a cut, a reveal, a number appearing.
- Loop it. If the last line echoes the first, the rewatch is free reach.
- Original audio and on-screen text both help. A watermark from another app actively hurts.
- Spoken pace is about 165 words a minute — roughly 2.75 words a second. Write to the seconds you have, not past them.`,

  video: `LANDSCAPE VIDEO CRAFT:
- The first five seconds still decide it, but there is room to explain one idea properly rather than hint at it.
- The title promise and the opening line have to be the same promise. A title that over-promises is the fastest way to lose the watch.
- No beat longer than four seconds without something changing on screen.
- End on the thing a person would repeat to someone else.`,

  carousel: `CAROUSEL CRAFT:
- Slide one earns the swipe and does nothing else. If it needs a second idea, it is not a cover.
- Slide one is also the grid thumbnail: it has to be legible at the size of a thumbnail, with the text away from the edges.
- Middle slides carry exactly one idea each, front-loaded — the value is not on slide seven.
- The last slide asks for the one action this piece earns, and names it.
- Carousels get a second look: somebody who does not swipe may be shown slide two later, so slide two has to stand alone too.
- All slides are images. A carousel that mixes a video in is rejected outright.`,

  post: `SINGLE IMAGE CRAFT:
- The overlay is the whole message: six words at most, readable at thumbnail size.
- The scene stops the scroll before the words are read. Nothing is more ignorable than a screenshot of the app with no human in it.
- 4:5 — anything outside 4:5 to 1.91:1 gets cropped in the feed.
- One idea. A picture carrying two is carrying none.`,

  story: `STORY CRAFT:
- Three to seven frames a day, no more: past seven, the tap-forward rate climbs and the last frames play to nobody.
- The shape: 1 open (a face or a hand, something happening today) — 2 to 3 middle (the actual thing: the process, the result, the mistake) — 4 the ask, ONE sticker — 5 the close (the answer, the outcome, or tomorrow's setup).
- The ask goes at frame four, never frame seven. Completion drops with every tap.
- Which sticker does which job: a poll is the cheapest tap there is, for volume not information. A question box harvests the exact words people use and is the most undervalued sticker on the platform — every answer is a future hook. A quiz teaches by letting people be wrong. A link is the only clickable surface besides the bio. A countdown is for a real deadline.
- Text stays in the middle band: on 1080x1920, nothing above y=250 or below y=1600 — the profile row sits on top and the reply bar underneath.
- "You", singular. A story is the closest thing to a DM that is not one.
- Never repost our own feed post to a story with no comment on it. Say what happened in the comments and why it is worth going back for.
- Selling belongs here rather than in a feed post: three frames of context, one of offer, one of proof — and it costs no reach.`,
};

// ── captions, tags, replies ─────────────────────────────────────────────────

export const CAPTION_CRAFT = `THE CAPTION, AND THE 125 CHARACTERS THAT DECIDE IT:
Instagram shows roughly the first 125 characters in the feed and hides the rest behind "... more". Almost every caption that fails, fails there.
- Line one is a sentence that can survive being cut mid-word. Either it fits inside 125 characters or the cut lands on a cliffhanger — never on a subordinate clause.
- Something checkable in that window: a number, a place, a name. "Nothing checkable before the tap" is the commonest reason a caption is scrolled past.
- Never open on a hashtag or a mention. That position is worth a sentence.
- ONE ask. Two asks is the same as none, and no ask means nobody decided what the post was for.
- Hashtags go at the bottom, below the fold, never inside the visible window.
- Links in a caption are not clickable. Point at the bio or the DMs instead.
- Emoji are punctuation, not decoration. A handful at most, never as bullet points.
- Urdu/English code-switching is natural here and reads as human. Keep it to the way people actually speak, not a translation.`;

export const HASHTAG_CRAFT = `HASHTAGS, THE 2026 RULES:
Instagram capped captions at FIVE hashtags on 18 December 2025, down from thirty. Tags past the fifth do nothing, and a wall of them reads as an account that stopped paying attention years ago.
Spend the five by size, not by popularity:
- 2 niche: what this specific piece is about, small enough that we can actually rank in them (#lahoreride, #karachicommute).
- 2 mid: the category someone browses (#ridesharingpakistan, #pakistandrivers).
- 1 broad: the widest tag that still describes the thing (#pakistan, #lahore).
Never: #viral #fyp #explore #explorepage #foryou #trending #instagood #reels. They describe nothing, they rank for nothing, and they are the clearest signal of a bought engagement strategy.
Tags people search beat tags people post. A tag is worth one of the five only if somebody types it.`;

export const HUMAN_VOICE = `WRITING THAT DOES NOT READ AS MACHINE-WRITTEN:
A reader clocks this in a second and trusts the account less afterwards, so it matters more than it sounds.

Words that give it away — never use them: delve, leverage, utilize, harness, embark, foster, facilitate, showcase, unlock, elevate, streamline, cultivate, amplify, curate, empower, revolutionize, transformative, robust, seamless, pivotal, crucial, comprehensive, cutting-edge, game-changer, groundbreaking, unparalleled, invaluable, meticulous, myriad, holistic, bespoke, innovative, profound, compelling, tapestry, realm, landscape, journey, testament to, cornerstone, beacon, paradigm, synergy, ecosystem, treasure trove, plethora, arsenal, moreover, furthermore, additionally, nevertheless, consequently, thus, hence, ultimately, in essence, supercharge, skyrocket, unleash, effortlessly, captivating, stunning, breathtaking, iconic, must-have, no-brainer, hidden gem, secret sauce, level up.

Phrases that give it away — never use them: "in today's fast-paced world", "let's face it", "here's the thing", "picture this", "imagine a world where", "it's no secret that", "we've all been there", "let that sink in", "at the end of the day", "the choice is yours", "food for thought", "buckle up", "without further ado", "spoiler alert", "read that again", "save this for later", "stop scrolling", "in today's video", "watch till the end", "you won't believe", "nobody is talking about this", "this changed everything", "this is your sign to", "fast forward to today", "and just like that", "the rest is history", "run don't walk", "don't sleep on this", "follow for more", "double tap if", "tag someone who needs this", "let me know in the comments", "the algorithm loves".

Shapes that give it away — never write them:
- "It's not just X, it's Y." Say the one thing you mean.
- "Not only X but also Y." Two sentences, or drop the weaker half.
- "This isn't about X. It's about Y." Lead with Y.
- The rule of three: "fast, cheap, and easy". Two items or four — three is the default rhythm of a machine.
- A one-word rhetorical line on its own: "The result?" Answer it inline.
- "Here's what I learned". State the lesson.
- Emoji used as bullet points. A hyphen or a line break.
- THREE SHOUTED WORDS in a row. Caps are a volume knob, not a highlighter.
- An essay closer: "In summary", "In conclusion".
- Reflex bait at the end: "Agree?", "Thoughts?", "Who else?"

Punctuation: no em dashes, no curly quotes, no "…" character — a comma, a straight quote and three full stops respectively. Never a zero-width or invisible character.
Vary the sentence length hard. A machine writes every sentence the same length; a person writes a nine-word sentence and then a two-word one. Use contractions. Say "we" and "you".`;

const RESEARCH_CRAFT = `READING THE MARKET HONESTLY:
Raw view counts are not evidence. An account with two million followers doing 400,000 views had a quiet Tuesday; an account with four thousand followers doing 400,000 views found something. Rank what you find by how far each piece beat its OWN account's normal numbers, not by the absolute number.
Name the hook shape every time you report a piece that travelled, so the writer can use the shape rather than copy the piece.
Report what you actually read, with the pages. A pattern you cannot point at is a guess.`;

const REPLY_CRAFT = `ANSWERING PEOPLE, SORTED BEFORE ANSWERED:
Sort every thread before writing a word, and answer in this order:
- LEAD — somebody describing a problem we solve. A real answer in public, then a door. This is the one that is worth the time.
- SUBSTANCE — they added something, disagreed, or extended it. Give them the longest reply on the thread.
- QUESTION — a question many people have. Answer it, and flag it: it is a reel, not just a reply.
- SUPPORT — "🔥", "nice". A like and three to eight words, no more.
- NOISE — a pitch, spam, bad faith. Nothing at all, or one line and out.
Replying inside the first hour is itself a reach signal: early comments with an author reply under them pull more comments and tell the ranker there is a conversation happening.
Never "🔥🔥🔥" from the brand account. Never argue, ever. Never answer a safety comment with anything but a route to a human.`;

const DESIGN_CRAFT = `WHAT A PICTURE HAS TO DO BEFORE IT IS PRETTY:
- Legible at thumbnail size, which is where the decision is actually made. If the words cannot be read at 120px, they are not on the picture.
- A person or a hand beats an interface. A screenshot of the app with nobody in it is the single most scrolled-past thing we can make.
- Text away from the edges: Instagram's own UI covers the top and bottom of a 9:16 frame, and a grid crop eats the sides of a 4:5.
- Reel covers are chosen, never left as frame one, because nine of them in a row are the first thing a stranger sees on the profile.
- One idea per frame. The overlay is six words at most.
- Real streets, real light, real people. Stock-looking polish reads as an advert, and an advert is scrolled past.`;

const EDIT_CRAFT = `THE CUT, IN SECONDS:
Write the brief to the clock, because whoever shoots it cannot add time later.
- Speech runs at about 165 words a minute — roughly 2.75 words a second. 30 seconds is about 80 spoken words, and that includes the hook.
- The hook has three seconds. If the opening line takes longer than that to say, it is not the opening line.
- No beat runs past four seconds without something changing on screen: a cut, a punch-in, a word landing, a hand entering. A static frame is where people leave.
- Three beats in a row with nothing concrete in them is the other place they leave. Put a number, a place or an object in one of them.
- Loop the last line back to the first. A second watch costs nothing and counts as reach.
- Cut the dead air between lines to nothing. The pause a person leaves while thinking is the pause the viewer leaves in.
- Shoot vertical and oversize it if you can: a 4K frame survives a punch-in, a 1080 frame does not.

THE REELS SAFE ZONE (1080x1920) — Instagram's own interface covers these, so nothing that has to be read goes there:
- Top 220px: the header.
- Bottom 450px: the username, caption and audio row. Nothing below y=1470.
- 35px down each side.
- The right 100px from about y=1155 down: the like, comment and share column.
Captions sit centred around the chest, roughly y=950 to y=1300 — over the body is fine, over the face from the eyes to the chin is not. Big punch words go behind the head near the top, or large across the chest.`;

const ADS_CRAFT = `WHAT A CAMPAIGN BRIEF OWES WHOEVER SPENDS THE MONEY:
- Five-second openings to test against each other, written out in full — not "test some hooks".
- The one metric that decides whether it worked, named before it runs.
- Organic reach and paid reach are not the same game: a piece that earns sends organically is not automatically the piece to put money behind, and the brief should say which it is.`;

/** The ad numbers, for every seat that plans or reads paid campaigns (the Ads desk includes it too). */
export const AD_NUMBERS = `THE AD NUMBERS — what each one is, how it is worked out, and what it tells you:
- CPM (cost per mille) = spend ÷ impressions × 1,000. What 1,000 views cost: the price of attention in that auction. Audience, city and season move it; the creative barely does.
- CTR (link click-through rate) = link clicks ÷ impressions × 100. The share of viewers who tapped. It scores the creative: a low CTR is the picture or the first line, not the budget.
- CPC (cost per link click) = spend ÷ link clicks, which is also CPM ÷ (CTR × 10). A click gets cheaper two ways, a cheaper auction or a better ad — fix CTR first, it is the one you control.
- Frequency = impressions ÷ reach. Above about 3.5 the same people stop noticing; change the creative before adding budget.
- Cost per result = spend ÷ the objective's own result (link clicks, engagements, or people reached per 1,000).
- Cost per order = spend ÷ orders. For Velocity an order is a completed ride.
- ROAS (return on ad spend) = revenue ÷ spend, where revenue is what the business itself keeps. For a marketplace like Velocity that is its commission, not the fare: 1.0 is break-even, under 1 the ads cost more than the orders earned. Guides quote ROAS on sales; for a marketplace that looks many times bigger than what it keeps, so never compare the two.
- Meta cannot see an order made outside it (for Velocity, a ride booked in the app), so cost per order and ROAS are BLENDED: every completed ride in the week against the whole week's ad bill. Riders who came on their own are in it too, so it flatters the ads. Read it as a trend over weeks; never credit or blame one campaign with it, and never claim a campaign brought orders.`;

const SEARCH_CRAFT = `IN-PLATFORM SEARCH:
People type questions into Instagram, TikTok and YouTube the way they type them into Google — "sasti ride Lahore", "Lahore to Islamabad kiraya". A question asked in the viewer's own words, left in the caption and said out loud in the first lines, is what search matches on weeks later.
Keep the question in their words, typos and all. Tidying it up is what loses the match.`;

const PROFILE_RUBRIC = `THE PROFILE, SCORED OUT OF 100 — what a stranger who arrived from one reel actually processes:
- Name field (12) — the bold line, 30 characters, and the one Instagram's search indexes. It carries the name AND what we do in words people search: "Velocity Rides | Apni fare offer karo". Most accounts waste it on the name alone.
- Bio line one (12) — who this is for and what changes for them. Not a list of adjectives separated by bars.
- Bio body (8) — one proof or one specific offer, in sentences.
- Pinned three (10) — three posts doing three jobs: best proof, clearest explanation of what we are, best introduction to the people behind it.
- Link (8) — one destination that matches what the bio just promised. A menu converts worse than a door.
- Highlights (8) — four to six, named for the questions people actually ask: Fares, Safety, Drivers, How it works.
- Grid legibility (8) — the first nine covers say what this account is, at thumbnail size, with no tap.
- Photo (6) — recognisable at 40 pixels.
- Handle (6) — sayable out loud, same everywhere.
- Category and contact (6) — professional account, working contact button.
- Recent activity (10) — posted in the last seven days, comments answered. An account that last posted in March reads as closed.
- A story up (6) — the difference between a profile and a person.`;

// ── assembly ────────────────────────────────────────────────────────────────

/**
 * What each role is handed on every job. Deliberately narrow: a block nobody
 * in that seat will use is a block we pay for eight times a week to no effect.
 */
const BY_ROLE: Record<Role, string[]> = {
  'content-writer': [HOOK_FORMULAS, CAPTION_CRAFT, HUMAN_VOICE],
  'seo-expert': [HASHTAG_CRAFT, SEARCH_CRAFT, CAPTION_CRAFT],
  'google-seo-expert': [SEARCH_CRAFT],
  designer: [DESIGN_CRAFT],
  'video-editor': [EDIT_CRAFT],
  'social-manager': [CAPTION_CRAFT, HASHTAG_CRAFT, HUMAN_VOICE, REPLY_CRAFT],
  'research-assistant': [RESEARCH_CRAFT],
  'youtube-ads-expert': [ADS_CRAFT, AD_NUMBERS],
};

/**
 * The playbook one employee carries into one job.
 *
 * Everyone gets the ranking signals, because every stage makes a decision that
 * either earns a send or does not. The format block goes to the people who
 * shape the piece; the rest is whatever their seat needs.
 */
export function playbookFor(role: Role, format: ContentFormat | null): string {
  const blocks = [ALGORITHM];

  // The people deciding what the thing *is* need to know what that format has
  // to do. The ads desk and the research desk do not.
  const shapesTheWork: Role[] = [
    'content-writer',
    'designer',
    'video-editor',
    'social-manager',
    'seo-expert',
  ];
  if (format && shapesTheWork.includes(role)) blocks.push(FORMAT_CRAFT[format]);

  blocks.push(...BY_ROLE[role]);
  return blocks.filter(Boolean).join('\n\n');
}

/** The standup needs the shapes and the signals, since it picks the concept. */
export function playbookForStandup(format: ContentFormat): string {
  return [ALGORITHM, CONTENT_MIX, FORMAT_CRAFT[format], HOOK_FORMULAS].join('\n\n');
}

/**
 * What a feed is made of. The house calendar of October 2026 was thirty
 * adverts ("Islamabad: your fares, your rules") and reached 10–500 people a
 * piece, while the competitors' read that same week showed their outliers were
 * all jokes and small stories: a Roman Urdu meme at 10.8x the account's normal,
 * a relatable office reel at 52x, a late-parcel story at 3x — not one advert.
 */
export const CONTENT_MIX = `THE MIX — what a feed that grows is made of:
- About 7 pieces in 10 ENTERTAIN or MOVE people: a meme, a joke about a moment everyone has lived, "that one friend who…", a POV, a small human story, nostalgia. Somebody sends it to a friend because it is funny or true, not because it sells. The brand is a light touch at the end, or not there at all.
- About 2 in 10 TEACH one useful thing (a tip, a hack, how something works).
- At most 1 in 10 SELLS — an offer, a feature, a launch.
- Write the way people here talk: Roman Urdu or Urdu-English mixed when the audience speaks that way, never translated-from-English slogans.
- If it reads like an advert, it is the wrong piece. "Your fares, your rules" is a slogan; a rider haggling with themself at 2am is a piece.
- The accounts' real numbers in the market read are the evidence: build in the SHAPE of what beat its own normal there (never copy the post, never name the account).`;

/**
 * The shapes a piece can take, one handed to each standup by code.
 *
 * A team left to choose falls back on the same explainer every morning —
 * "here is how X works" with a new noun — which is exactly what the feed was
 * full of. The shape is the structure, not the subject: the same angle as a
 * myth busted, a day in someone's life or a quiz is three different posts.
 */
export const STORY_SHAPES: Record<string, string> = {
  pov: 'POV — the viewer IS someone in one specific moment ("POV: it is 11pm and the last bus left"). First person, present tense.',
  'myth-vs-fact': 'Myth vs fact — say the thing people wrongly believe, then knock it down with what is actually true.',
  'before-after': 'Before / after — the old way and our way, the same moment twice, the difference obvious without explaining it.',
  'mini-story': 'A mini story with a turn — a person, a problem, and a resolution nobody saw coming, in three beats.',
  'nobody-tells-you': 'Things nobody tells you — three short, specific insider truths, numbered, the best one last.',
  'how-to': 'How-to in three steps — one useful thing the viewer can do today, step by step, nothing else.',
  relatable: 'The relatable moment — the frustration everyone in this market has had, played for a knowing laugh, then the way out.',
  'day-in-life': 'A day in the life — one person, four moments of their day with times on screen, ending on why it matters.',
  comparison: 'Side by side — two ways of doing the same thing (never a named competitor), the costs or the effort plainly compared.',
  'behind-scenes': 'Behind the scenes — how something works on the inside that customers never see, and why it was built that way.',
  quiz: 'Guess first — ask the viewer to guess (a price, a time, a fact), hold the answer, reveal it at the end. Built to pull comments.',
  'answer-question': 'Answering a real question — the question people actually ask, on screen, answered straight in under twenty seconds.',
  'local-spotlight': 'Local spotlight — one city, one road, one neighbourhood, so specific that people from there send it to each other.',
  meme: 'A meme — one picture and one line of text that is a joke about a moment everyone here has lived, in the words they would use for it. Nothing to sell; the brand at most in the corner.',
  'that-one-friend': '"That one friend who…" — a character everybody knows (the one who never pays, who always says five minutes), played for the laugh, so people tag that exact friend.',
  nostalgia: 'Nostalgia — how getting around (or this business) used to be, a specific memory people of one age share, warm rather than mocking.',
  'small-story': 'A small human story — the person behind an everyday thing (the courier in the rain, the driver at dawn), told with feeling, no pitch at all.',
};

export type StoryShape = keyof typeof STORY_SHAPES;

/**
 * The shape for the next piece: never one of the last six used, and otherwise
 * spread by the seed (the piece's own id) so two desks do not march in step. Pure.
 */
export function nextShape(recent: string[], seed: string): string {
  const all = Object.keys(STORY_SHAPES);
  const fresh = all.filter((s) => !recent.slice(0, 6).includes(s));
  const pool = fresh.length ? fresh : all;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

/** Exported for the profile audit the manager can be asked for. */
export { PROFILE_RUBRIC, FORMAT_CRAFT, REPLY_CRAFT };
