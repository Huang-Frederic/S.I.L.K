# S.I.L.K

**Spider Indexing Links & Knowledge**: a Wikirace against an AI web crawler.

You and a spider start on the same Wikipedia article and race to the same target article by
following links. You click; the spider *crawls*. It runs a small language model in your browser to
guess which link leads closest to the target, walks over the real text to reach it (eating the words
on its way), and dives in. On Hard it also comes after you.

The game is in **English by default** (English texts, races on [en.wikipedia.org](https://en.wikipedia.org/));
the **EN / FR** switch in the top bar turns it into French (French texts, races on
[fr.wikipedia.org](https://fr.wikipedia.org/)). The choice is remembered in the browser.

▶ **Play: <https://huang-frederic.github.io/S.I.L.K/>**

## How to play

1. Pick a **start** and a **target** page. Type to get suggestions (with their short descriptions),
   or roll the dice: a random start is a genuinely random article, a random target comes from a pool
   of well-known topics, so every race is winnable (in theory).
2. Choose the spider's **difficulty** (below; the game opens on Normal). Its brain is the same on
   every level; only its speed and its manners change.
3. Click links in your pane (amber border, **YOU** badge, **TOI** in French). Only links to other articles in the body
   count. **← back** is allowed but counts as a hop. Hovering a link shows `hop N → Title`.
4. First on the target wins. The finish screen compares both paths, hops, times and the number of
   words the spider ate.

The race pauses while the tab is hidden. **Reduce motion** (title screen, on by default when the
system asks for it) removes screen shake and shortens transitions; it never changes the difficulty.

### Difficulty

| Level | What the spider does |
| --- | --- |
| **Easy** | Thinks slowly, crawls, and tears up its own page. Never touches yours. Winnable. |
| **Normal** (default) | Runs. Adds a **web trap** (links near your cursor can't be clicked for a few seconds), the **fan laser** (a big beam from its eye sweeps a fan across your page, centred on your cursor, and burns every word and link it passes over, its own page included) and a **word bombardment** (words from its page land on your links and cover them), about every 25 s. **Rage** when your page links to the target: faster, angrier, glowing eye, attacks twice as often. Hard but winnable. |
| **Hard** | An attack every 4–8 s, chained (web, then the fan laser, then a bombardment…), with no warning, rage always on. It tears its page apart as it goes (more destruction moves, more torn-up words) and fumbles a little for the right link: it often heads for another link first and thinks better of it. **Decoys**: up to 3 fake target links in your text; click one and it bursts into mini-spiders that wander about your page, slowly, breaking every word they walk over, links included (no time lost). **Cursor harassment**, now and then (at most once every 45 s): a silk line sticks to your cursor and drags it for 2 s. **Link snatch** when you are winning: if the link you click takes you closer to the target and leaves you closer than the spider, it leaps across, eats that link, dives in, and the panes swap owners: you continue from its page. Never on your first three links, never the last two links of a path (the target, or a page that links to it), and at most one snatch a minute. Expected win rate: almost zero. |

Hard is meant as a show, not a fair fight: people should lose, laugh, and share the clip. The spider
may burn, web or cover the target link and may leave you with nothing clickable for a while. There are
no time penalties: the first one on the target wins. The
spider taunts you in short speech bubbles (at most one every ~6 s), celebrates a win by walking to
the middle of the screen, eating your badge and dancing, and roasts you on the lose screen
with the race's real numbers. Beat it on Hard and it collapses, its eye flickers out, and the finish
screen says **IMPOSSIBLE. (screenshot this.)**; a per-browser "Hard mode wins" counter on the title
screen keeps the score (stored locally, never a global or invented statistic).

## How it works

### Wikipedia, politely

- Everything is read from the Wikipedia of the game's language (`fr.` or `en.wikipedia.org`).
- Article HTML comes from the REST API (`/api/rest_v1/page/html/{title}`, Parsoid output). Redirect
  titles answer with a 307 to the canonical page, which `fetch` follows; the canonical title is read
  from the document head (or the final URL).
- Everything else uses the Action API with `origin=*` (anonymous CORS): `generator=links` with
  `redirects=1` to resolve every link of a page, `list=backlinks` (with `blredirect=1`) for the
  target, page info (extract, description, disambiguation flag), `generator=random`, and
  `generator=prefixsearch` with short descriptions for autocomplete (`opensearch` as a fallback).
- All requests go through one queue (`src/wiki/http.ts`): at most **3 in flight**, an in-memory
  cache keyed by URL (in-flight requests are shared), an `Api-User-Agent` header identifying the game,
  and back-off on `429` / `5xx` / network errors (`Retry-After` when readable, otherwise 5 s, 10 s,
  15 s).
- The player never waits behind the spider: one of the 3 slots is kept for the player's page loads,
  which also jump the queue (a page the spider had queued is promoted), skip the global back-off on
  their first try, and start **while the cursor rests on a link** (or on touch down), so that most
  clicks open instantly. Showing an article does no extra layout work: words are measured only where
  the spider walks.

### Rendering articles

`src/wiki/sanitize.ts` rebuilds each article from an **allowlist** of tags, attributes and classes
instead of trying to delete dangerous markup, so no script, style, image, event handler or id
survives. Reference sections ("References", "External links", "Further reading"…, and on French
Wikipedia "Notes et références", "Bibliographie", "Liens externes"…), citations, navboxes, the portal
bar, edit links, maintenance templates, figures and galleries are dropped; French infoboxes are styled
like English ones. A link stays playable only if it is a `mw:WikiLink` to another main-namespace
article (French Wikipedia's own namespace names, such as `Fichier:` or `Catégorie:`, are known) that
is not a red link or a link to the page itself. The result is shown with serif typography in a dark theme, with a CC BY-SA
attribution, a link to the source article and a link to its history (authors) under every pane.

Missing pages, redirects (`Redirected from …`) and disambiguation pages are handled: disambiguation
pages are refused as start or target, flagged when you land on one, and the spider avoids them.

### The spider's brain (`src/spider/ai/`)

The decision logic is a pure module, unit tested against a mocked Wikipedia. On every page:

1. **Target in sight**: if the target (or one of its redirect titles) is linked, take it.
2. **Backlinks**: the set of pages linking to the target is fetched once at race start; if a link
   leads to one of them, take the most relevant of those.
3. **Semantic ranking**: otherwise every link title is embedded via
   [transformers.js](https://github.com/huggingface/transformers.js) and compared (cosine similarity)
   with an embedding of the target's title and summary. In English the model is
   [`all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (≈23 MB); in French it is
   [`paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
   (≈118 MB), which ranks French titles much better than the English model does. Embeddings run in a
   Web Worker and are cached across pages. While the model downloads (once, cached by the browser),
   or if it cannot load, a **lexical** score takes over: shared stemmed words (English and French
   stopwords aside) with the target's title, description and summary, plus character-trigram
   similarity.

Visited pages are never chosen again. The only exception is a dead end, where the spider climbs back
along its thread to the previous page and tries its next best link. The library is imported at runtime
from jsDelivr at a pinned version (its self-contained build), which keeps the game's own bundle small.

### The stage (`src/stage/`)

The race screen is two **role-agnostic panes** under one **full-window canvas** (the stage). A pane
belongs to the player or to the spider and can change owner mid-race: the badge, the colours, the
counters, the brain panel and whether its links can be clicked follow the owner, which is what makes
the link snatch's pane swap possible. The stage runs one frame loop; animations are coroutines that
`await stage.frame()`, so they read top to bottom and pause with the tab. Drawing in a pane's content
coordinates keeps effects glued to the text while it scrolls; airborne moves (leaps, the victory walk)
use stage coordinates and cross the gutter freely.

Words are wrapped in spans lazily, only near the spider or under the fan laser (`WordIndex`), so long
articles stay light. Destroyed words keep their box (dashed outline, strike-through, 20 % ink, a
dashed hole for thrown words, a faint dotted trace where a crushed word cracked and fell, red embers for burned
ones), so the text never reflows under the player's cursor.

### The spider (`src/spider/rig.ts`, `actor.ts`, `runner.ts`)

The rig follows the mockups' rig sheet: a plain outlined body with one red eye and eight 1.5 px legs
placed by two-bone inverse kinematics. The body stays upright (it never spins round): its eye slides
round the inside of the body to face where it goes, looking down as it drops into a page on its
thread. Each leg owns a sector around the body and its hip, knee and foot never leave it, so legs
never pass over or under each other. Feet only ever stand on words (each planted foot boxes its word
in cyan); a leg with no word within reach is held up rather than gripping thin air. The legs walk in
an alternating tetrapod paced by the distance covered, each foot landing far enough ahead to stay
balanced around its resting spot, and settle back when the spider stops. What it breaks is what it
grips: a foot letting go of a word may tear it up, and the word cracks and its pieces drop off the
line. One hop is:

1. **scan**: rays from the eye to every visible link while the brain decides; the SPIDER.BRAIN panel
   shows the best scores;
2. **crawl & eat**: the eye laser locks the link (slicing words on the way); sometimes it heads for
   another link first and thinks better of it. Then the spider goes there **on foot**, weaving from
   side to side like a snake (a long way, across most of the text column rather than straight down
   one side), breaking into a run and bounding forward now and then when the link is far, and
   straightens out for a short run along the link's line, from whichever side it comes (never out of
   the margin). Its feet tear up the words they grip; on the way it randomly lasers a word in half,
   sweeps the laser along a line, plucks a word and throws it off the page (`yeet()`), or stomps one
   to pieces (`THUD`). While it thinks it paces about. A link a few lines away is sometimes reached
   with a **web zip** instead (a silk line, then one long jump). A link far down the page gets
   **zips ahead**: it shoots silk further down the way and zips along it, but never right onto the
   link (it always walks the last stretch), and whenever it would not otherwise make it, it skips its
   tricks and zips more, so that it never spends more than **40 s** on a page;
3. **grab**: the legs wrap the link, the link lights up and the pane edges glitch;
4. **hop**: it dives in, the page glitches out in RGB-split slices, the next article glitches in,
   and the spider drops in on its silk thread.

The runner plays the agent's decisions with these moves and prefetches the next page while the spider
crawls. Attacks (`src/attacks/`) are small coroutines picked by a director with cooldowns, chains and
rage. The link snatch answers a click of the player's, once the page behind it has loaded, and
interrupts the hop loop. Its rules are a pure, tested module (`src/game/snatch.ts`): "closer to the
target" is the spider's own estimate, first the hops left (1 from a page that links to the target, 2
from a page that links to one of those, 3 otherwise), then, at equal hops, how close the page's title
is to the target in meaning.

All art (spider, effects, illustrations, logo, favicon) is drawn in code; there are no image assets
and no bundled fonts (the mockups' fonts, Space Grotesk, Source Serif 4 and JetBrains Mono, are used
when installed, with close system fallbacks otherwise).

## Run it locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/S.I.L.K/
npm test           # unit tests (Vitest + jsdom, Wikipedia mocked)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run icons      # regenerate the favicon set in public/ (scripts/generate-icons.mjs)
```

The app is served under `/S.I.L.K/` (Vite `base`), matching the GitHub Pages URL.

## Deployment

`.github/workflows/deploy.yml` runs the tests and the build on every pull request, and deploys `main`
to GitHub Pages. One-time setup in the repository: **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

## Project layout

```
src/
  main.ts                 entry point, screen switching
  config.ts               URLs, user agent, request limits
  settings.ts             language, Reduce motion, Hard-mode wins (localStorage, guarded)
  i18n/                   English (default) and French texts
  wiki/                   HTTP queue, API client, sanitizer, article cache, titles
  game/                   race rules, link-snatch rules, clock, difficulty table,
                          pair selection, taunts and roasts
  spider/ai/              decision rules, rankers, embeddings worker, agent (pure, tested)
  spider/                 rig (IK body), actor (moves), runner (hop loop), route, world
  stage/                  full-window stage, role-agnostic panes, word index, virtual cursor
  attacks/                web, fan laser, bombardment, decoys and mini-spiders, harassment, director
  fx/                     line-art effects, RGB-split glitches, speech bubble
  ui/                     title (demo, illustrations), race, finish screens, widgets
  styles/                 design tokens, article typography, screens
tests/                    unit and integration tests, fake Wikipedia + demo world
scripts/generate-icons.mjs
```

## Credits and licenses

- Article text comes from [French Wikipedia](https://fr.wikipedia.org/) and
  [English Wikipedia](https://en.wikipedia.org/) and is available under the
  [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  license; every page shown in the game links to its source article and its history (authors).
- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) and the
  [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) and
  [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
  models (Apache-2.0) are loaded at runtime from jsDelivr and Hugging Face.
- Everything else, including all visuals, is original and drawn procedurally in this repository.
