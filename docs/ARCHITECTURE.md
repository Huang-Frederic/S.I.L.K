# Architecture

S.I.L.K is a static site: Vite and TypeScript (strict), no UI framework, no backend. Everything runs
in the browser. It talks to Wikipedia directly, ranks links with a small language model in a Web
Worker, renders articles as DOM, and draws the spider and every effect on one full-window canvas on
top. The rules are in [GAMEPLAY.md](GAMEPLAY.md).

## Contents

1. Code map
2. How a race runs
3. Wikipedia, politely
4. Rendering articles
5. The spider's brain
6. The stage
7. The spider
8. Attacks
9. Languages
10. Tests
11. Showcase capture
12. Running and deploying

---

## Code map

```
src/
  main.ts                 entry point: per-language services, screen switching
  config.ts               URLs, user agent, request limits
  settings.ts             language, Reduce motion, Hard-mode wins (localStorage, guarded)
  i18n/                   en.ts (defines the shape), fr.ts (typed against it), t() / setLang()
  wiki/
    http.ts               the request queue: concurrency, priorities, cache, back-off
    client.ts             REST + Action API calls (articles, links, backlinks, info, random, search)
    sanitize.ts           allowlist rebuild of Parsoid HTML, playable-link rules
    articles.ts           article store (fetch + sanitize + cache)
    titles.ts             title normalization, namespaces per language, href parsing
  game/
    race.ts, clock.ts     race state, paths, hops, the pausable clock
    snatch.ts             link-snatch rules (pure)
    difficulty.ts         the difficulty table and rage multipliers
    pairs.ts              target pools per language, random start/target
    comedy.ts             taunts and roasts
  spider/ai/
    brain.ts              decision rules (pure)
    agent.ts              the brain walking a page graph, with backtracking
    semantic.ts           embedding ranker (cosine similarity, cache, batching)
    lexical.ts            word-matching ranker (stems, stop words, trigrams)
    embed.worker.ts       transformers.js in a Web Worker
    workerEmbedder.ts     the main-thread side of the worker
  spider/
    rig.ts                the line-drawn body and its IK legs
    actor.ts              every move: crawl, zip, leap, laser, yeet, stomp, grab, dive, dance
    route.ts              the walk's geometry: serpentine, approach, camera (pure)
    runner.ts             the hop loop: decide → scan → lock → crawl → grab → hop
    world.ts              candidate links of a loaded page
  stage/
    stage.ts              full-window canvas, frame loop, coroutines, z-layers
    racerPane.ts          a role-agnostic pane (owner, header, brain panel, article)
    wordIndex.ts          lazy word wrapping and damage bookkeeping
    cursor.ts             the virtual cursor (for harassment)
  attacks/                director, web, fan laser, bombardment, decoys, mini-spiders, harassment
  fx/                     line-art effects, RGB-split glitches, speech bubble
  ui/                     title (demo, illustrations), race, finish screens, widgets
  styles/                 design tokens, article typography, screens
tests/                    unit and integration tests, fake Wikipedia + demo world
scripts/
  generate-icons.mjs      the favicon set in public/, drawn from the rig
  showcase/               the README's GIFs and screenshots (capture.mjs, make_gif.py)
```

---

## How a race runs

1. **The game opens.** `main.ts` builds the services for the current language: a `WikiClient`, an
   `ArticleStore`, and a `WorkerEmbedder` that starts downloading the ranking model in the
   background right away, so it is usually ready by the time a race starts.
2. **The title screen** validates the pair (both pages exist, neither is a disambiguation page, they
   are not the same page), resolving redirects to canonical titles, and keeps their descriptions and
   summaries.
3. **The race screen** ([`src/ui/raceScreen.ts`](../src/ui/raceScreen.ts)) shows a checklist while it
   loads, in parallel, the start article for the player (a priority request) and the rest of the
   **target profile**: up to 2,000 backlinks and the redirects that point to the target. Then it
   gives the model up to **8 s** more, if it is still loading.
4. It builds the spider: a `SpiderBrain` wrapped in a `SpiderAgent`, played by a `SpiderRunner`
   through the `SpiderActor`, and the attack `Director`. The spider's copy of the start page loads
   behind the **3-2-1 countdown**.
5. **Racing.** The runner's hop loop and the director run as coroutines on the stage's frame loop.
   Player clicks go through `navigate()`; on Hard, a click may be answered by a link snatch once the
   page behind it has loaded (the spider gets 300 ms to decide).
6. **The finish.** First on the target wins. The winner's side plays its ending (victory walk, badge
   eaten, dance; or the spider's collapse), then the finish screen compares both paths with hops,
   time and words eaten, and the spider roasts you with the race's numbers.

The race pauses while the tab is hidden: the clock stops and the frame loop stops ticking.

---

## Wikipedia, politely

- Everything is read from the Wikipedia of the game's language (`en.` or `fr.wikipedia.org`).
- Article HTML comes from the REST API (`/api/rest_v1/page/html/{title}`, Parsoid output). Redirect
  titles answer with a 307 to the canonical page, which `fetch` follows; the canonical title is read
  from the document head (or the final URL).
- Everything else uses the Action API with `origin=*` (anonymous CORS): `generator=links` with
  `redirects=1` to resolve every link of a page, `list=backlinks` (with `blredirect=1`) for the
  target, page info (extract, description, disambiguation flag), `generator=random`, and
  `generator=prefixsearch` with short descriptions for autocomplete (`opensearch` as a fallback).
- All requests go through one queue ([`src/wiki/http.ts`](../src/wiki/http.ts)): at most **3 in
  flight**, an in-memory cache keyed by URL (in-flight requests are shared), an `Api-User-Agent`
  header identifying the game, and back-off on `429` / `5xx` / network errors (`Retry-After` when
  readable, otherwise 5 s, 10 s, 15 s).
- The player never waits behind the spider: one of the 3 slots is kept for the player's page loads,
  which also jump the queue (a page the spider had queued is promoted), skip the global back-off on
  their first try, and start **while the cursor rests on a link** (or on touch down), so that most
  clicks open instantly. Showing an article does no extra layout work: words are measured only where
  the spider walks.
- Backlinks are fetched in up to 4 batches of 500 (`bllimit=max`); for very popular targets the set
  is partial: a heuristic, not an oracle.

---

## Rendering articles

[`src/wiki/sanitize.ts`](../src/wiki/sanitize.ts) rebuilds each article from an **allowlist** of
tags, attributes and classes instead of trying to delete dangerous markup, so no script, style,
image, event handler or id survives. Reference sections ("References", "External links", "Further
reading"…, and on French Wikipedia "Notes et références", "Bibliographie", "Liens externes"…),
citations, navboxes, the portal bar, edit links, maintenance templates, figures and galleries are
dropped; French infoboxes are styled like English ones.

A link stays playable only if it is a `mw:WikiLink` to another main-namespace article (French
Wikipedia's own namespace names, such as `Fichier:` or `Catégorie:`, are known) that is not a red
link or a link to the page itself. The result is shown with serif typography in a dark theme, with a
CC BY-SA attribution, a link to the source article and a link to its history (authors) under every
pane.

---

## The spider's brain

The decision logic ([`src/spider/ai/`](../src/spider/ai/)) is a pure module, unit tested against a
mocked Wikipedia. On every page:

1. **Target in sight**: if the target (or one of its redirect titles) is linked, take it.
2. **Backlinks**: the set of pages linking to the target is fetched once at race start; if a link
   leads to one of them, take the most relevant of those.
3. **Semantic ranking**: otherwise every link title is embedded via
   [transformers.js](https://github.com/huggingface/transformers.js) and compared (cosine similarity)
   with an embedding of the target's title and summary. In English the model is
   [`all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (≈23 MB); in French it is
   [`paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
   (≈118 MB), which ranks French titles much better than the English model does (mean AUC 0.98
   against 0.91 on 5 French targets and 320 titles). Both give 384-dimension vectors.

Embeddings run in a Web Worker, in batches of 64, for at most the first 400 links of a page (reading
order), and are cached across pages. While the model downloads (once, then cached by the browser),
or if it cannot load, a **lexical** score takes over: shared stemmed words (English and French
stopwords aside) with the target's title, description and summary, plus character-trigram
similarity. `FallbackRanker` switches between the two.

Visited pages are never chosen again. The only exception is a dead end, where the spider climbs back
along its thread to the previous page and tries its next best link. The library is imported at
runtime from jsDelivr at a pinned version (its self-contained build), which keeps the game's own
bundle small (63 kB of gzipped JavaScript).

---

## The stage

The race screen is two **role-agnostic panes** under one **full-window canvas** (the stage,
[`src/stage/`](../src/stage/)). A pane belongs to the player or to the spider and can change owner
mid-race: the badge, the colours, the counters, the brain panel and whether its links can be clicked
follow the owner, which is what makes the link snatch's pane swap possible.

The stage runs one frame loop; animations are coroutines that `await stage.frame()`, so they read top
to bottom and pause with the tab. Drawing in a pane's content coordinates keeps effects glued to the
text while it scrolls; airborne moves (leaps, the victory walk) use stage coordinates and cross the
gutter freely.

Words are wrapped in spans lazily, only near the spider or under the fan laser (`WordIndex`), so long
articles stay light. Destroyed words keep their box (dashed outline, strike-through, 20 % ink, a
dashed hole for thrown words, a faint dotted trace where a crushed word cracked and fell, red embers
for burned ones), so the text never reflows under the player's cursor. The brain panel has a fixed
height for the same reason: when it filled in after the start, it used to push the spider's article
down.

---

## The spider

**The rig** ([`src/spider/rig.ts`](../src/spider/rig.ts)): a plain outlined body with one red eye and
eight 1.5 px legs placed by two-bone inverse kinematics (femur 52 px, tibia 56 px). The body stays
upright (it never spins round): its eye slides round the inside of the body to face where it goes,
looking down as it drops into a page on its thread. Each leg owns a sector around the body and its
hip, knee and foot never leave it, so legs never pass over or under each other. Feet only ever stand
on words (each planted foot boxes its word in cyan); a leg with no word within reach is held up
rather than gripping thin air. The legs walk in an alternating tetrapod paced by the distance
covered, each foot landing far enough ahead to stay balanced around its resting spot, and settle back
when the spider stops. What it breaks is what it grips: a foot letting go of a word may tear it up,
and the word cracks and its pieces drop off the line.

**The route** ([`src/spider/route.ts`](../src/spider/route.ts), pure and tested): the spider weaves
from side to side like a snake, across most of the text column, with swings scaled to the length of
the trip and a drift toward the middle of the column; then it straightens out for a short run along
the link's line, from whichever side it comes (never out of the margin).

**One hop** ([`src/spider/runner.ts`](../src/spider/runner.ts) and
[`src/spider/actor.ts`](../src/spider/actor.ts)):

1. **scan**: rays from the eye to every visible link while the brain decides; the SPIDER.BRAIN panel
   shows the best scores. While it thinks it paces about;
2. **crawl & eat**: the eye laser locks the link (slicing words on the way); sometimes it heads for
   another link first and thinks better of it. Then it goes there **on foot**, breaking into a run
   and bounding forward now and then when the link is far. Its feet tear up the words they grip; on
   the way it randomly lasers a word in half, sweeps the laser along a line, plucks a word and throws
   it off the page (`yeet()`), or stomps one to pieces (`THUD`). A link a few lines away (90 to
   380 px) is sometimes reached with a **web zip** instead (a silk line, then one long jump). A link
   1,200 px or more down the page gets **zips ahead**: it shoots silk further down the way and zips
   along it, but never right onto the link (it always walks the last 300 px), and whenever it would
   not otherwise make it, it skips its tricks and zips more, so that it never spends more than
   **40 s** on a page;
3. **grab**: the legs wrap the link, the link lights up and the pane edges glitch;
4. **hop**: it dives in, the page glitches out in RGB-split slices, the next article glitches in,
   and the spider drops in on its silk thread.

The runner plays the agent's decisions with these moves and prefetches the next page while the
spider crawls. The link snatch answers a click of the player's, once the page behind it has loaded,
and interrupts the hop loop.

All art (spider, effects, illustrations, logo, favicon) is drawn in code; there are no image assets
and no bundled fonts (Space Grotesk, Source Serif 4 and JetBrains Mono are used when installed, with
close system fallbacks otherwise).

---

## Attacks

Attacks ([`src/attacks/`](../src/attacks/)) are small coroutines that share one context (the stage,
the actor, the cursor, the player's pane). A **director** picks them with cooldowns, chains and rage,
following the difficulty table ([`src/game/difficulty.ts`](../src/game/difficulty.ts)), and only
while the race is on:

- **web trap**: geometric line-art webs over the links near the cursor, which can't be clicked for a
  few seconds;
- **fan laser**: a beam from the eye sweeps a fan centred on the cursor and burns every word and
  link it crosses, the spider's own page included;
- **word bombardment**: words from the spider's page fly over and cover the player's links;
- **decoys** (Hard): fake target links planted in the player's text; clicking one releases
  mini-spiders ([`minions.ts`](../src/attacks/minions.ts)) that wander at 42 px/s for 16 s and break
  the words they walk over;
- **cursor harassment** (Hard): a silk line drags the game's cursor for 2 s. The real OS cursor is
  never moved: inside the race screen it is hidden for the duration and a lagging virtual cursor
  ([`src/stage/cursor.ts`](../src/stage/cursor.ts)) is drawn instead, which every cursor-driven
  effect follows;
- **link snatch** (Hard): see [GAMEPLAY.md](GAMEPLAY.md#the-link-snatch-hard). Its rules are a pure,
  tested module ([`src/game/snatch.ts`](../src/game/snatch.ts)): "closer to the target" is the
  spider's own estimate, first the hops left (1 from a page that links to the target, 2 from a page
  that links to one of those, 3 otherwise), then, at equal hops, how close the page's title is to the
  target in meaning.

---

## Languages

Texts live in [`src/i18n/`](../src/i18n/): `en.ts` defines the shape (`Strings = typeof en`), and
`fr.ts` is typed against it, so a missing French string is a compile error. Entries can be functions
(plurals, roasts built from the race's numbers); French uses non-breaking spaces before units and the
singular for 0 and 1. `t()` returns the current dictionary, `setLang()` changes it, and the choice is
stored in `localStorage`.

Everything tied to one Wikipedia is built per language by `servicesFor(lang)` in
[`src/main.ts`](../src/main.ts): the client (REST and Action API endpoints from `wikiRestBase(lang)`
and `wikiActionApi(lang)`), the article store, and the embedder with that language's model. Switching
language disposes of the old worker and builds new services. Namespaces
([`src/wiki/titles.ts`](../src/wiki/titles.ts)), excluded sections and infobox classes
([`src/wiki/sanitize.ts`](../src/wiki/sanitize.ts)) and target pools
([`src/game/pairs.ts`](../src/game/pairs.ts), 196 English and 195 French titles) are per language too.

---

## Tests

`npm test` runs **159 tests in 16 files** with Vitest and jsdom; none of them touches the network.

- [`tests/helpers/fakeWiki.ts`](../tests/helpers/fakeWiki.ts) answers the REST and Action API for
  both languages.
- [`tests/helpers/demoWorld.ts`](../tests/helpers/demoWorld.ts) is the *Silken Isles*, a small
  fictional encyclopedia with a hand-written link graph and seeded prose, so every page has text to
  walk on.
- [`tests/helpers/conceptEmbedder.ts`](../tests/helpers/conceptEmbedder.ts) stands in for the model.

Covered: the brain, rankers and search with backtracking; the route geometry, the IK and the gait,
the laser geometry; the race, snatch and difficulty rules; the attack director's pacing; the
sanitizer on an English and a French page; the API client, the request queue's priorities, cache and
back-off; titles and namespaces; settings; taunts and roasts; the panes in jsdom.

---

## Showcase capture

[`scripts/showcase/capture.mjs`](../scripts/showcase/capture.mjs) regenerates every image in
`docs/screenshots/` (`npm run showcase`, or `npm run showcase -- <shot>` for one):

- It serves the production build from `dist/` under `/S.I.L.K/` through Playwright's `page.route()`,
  and answers Wikipedia with the same fake Wikipedia as the tests, plus the real *Spider* article
  from [`scripts/showcase/fixtures/`](../scripts/showcase/fixtures/). The model download is blocked,
  so the spider ranks links by word matching, the same way on every run.
- GIFs are recorded as lossless PNG frames with the DevTools screencast (`Page.startScreencast`),
  only during the moments worth showing, joined into a lossless video with their real timings, then
  turned into 960×540 GIFs under 4 MB by [`make_gif.py`](../scripts/showcase/make_gif.py) (ffmpeg
  two-pass palette, lowering the frame rate and then the colours until the file fits).
- Attacks are random, so two runs show different attacks; the shots wait for the event they show
  (a hop, a burn, a decoy) rather than for a fixed time.

---

## Running and deploying

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/S.I.L.K/
npm test           # unit tests (Vitest + jsdom, Wikipedia mocked)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run icons      # regenerate the favicon set in public/ (scripts/generate-icons.mjs)
npm run showcase   # re-record docs/screenshots/ (Playwright + ffmpeg)
```

The app is served under `/S.I.L.K/` (Vite `base`), matching the GitHub Pages URL.

`.github/workflows/deploy.yml` runs the tests and the build on every pull request, and deploys
`main` to GitHub Pages. One-time setup in the repository: **Settings → Pages → Build and deployment
→ Source: GitHub Actions**.
