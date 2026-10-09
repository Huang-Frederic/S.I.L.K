# S.I.L.K

**Spider Indexing Links & Knowledge**: a Wikirace against an AI web crawler.

You and a spider start on the same English Wikipedia article and race to the same target article by
following links. You click; the spider *crawls*. It runs a small language model in your browser to
guess which link leads closest to the target, walks along the lines of text to reach it (eating the
words on its way), then dives into the link.

▶ **Play: <https://huang-frederic.github.io/S.I.L.K/>**

## How to play

1. Pick a **start** and a **target** article. Type to get title suggestions, or roll the dice: a random
   start is a genuinely random article, a random target comes from a pool of well-known topics, so
   every race is winnable.
2. Choose the spider's **difficulty**. It only changes how long the spider thinks on each page and
   how fast it crawls, never how clever it is. *Easy* is beatable by most humans; *Hard* is not
   forgiving.
3. Click links in the article on the left (or the **You** tab on small screens). Only links to other
   articles in the body count; references, navigation boxes and external links are disabled.
   **Back** is allowed, but counts as a hop.
4. First on the target wins. The end screen compares both paths: hops, times, every article visited,
   and why the spider picked each link. The loser may keep going to finish their own path.

The race pauses when the tab is hidden.

## How it works

### Wikipedia, politely

- Article HTML comes from the REST API (`/api/rest_v1/page/html/{title}`, Parsoid output). Redirect
  titles answer with a 307 to the canonical page, which `fetch` follows; the canonical title is read
  from the document head (or the final URL).
- Everything else uses the Action API with `origin=*` (anonymous CORS): `generator=links` with
  `redirects=1` to resolve every link of a page, `list=backlinks` (with `blredirect=1`) for the
  target, page info (extract, description, disambiguation flag), `generator=random`, and `opensearch`
  for autocomplete.
- All requests go through one queue (`src/wiki/http.ts`): at most **3 in flight**, an in-memory
  cache keyed by URL (in-flight requests are shared), an `Api-User-Agent` header identifying the game,
  and back-off on `429` / `5xx` / network errors (`Retry-After` when readable, otherwise 5 s, 10 s,
  15 s). The player's page loads jump the queue.

### Rendering articles

`src/wiki/sanitize.ts` rebuilds each article from an **allowlist** of tags, attributes and classes
instead of trying to delete dangerous markup, so no script, style, image, event handler or id
survives. Reference sections ("References", "External links", "Further reading"…), citations,
navboxes, edit links, maintenance templates, figures and galleries are dropped. A link stays playable
only if it is a `mw:WikiLink` to another main-namespace article that is not a red link or a link to
the page itself. The result is shown with Wikipedia-like typography in a dark theme, with a CC BY-SA
attribution and a link to the source article at the bottom of every page.

Missing pages, redirects (`Redirected from …`) and disambiguation pages are handled: disambiguation
pages are refused as start or target, flagged when you land on one, and the spider avoids them.

### The spider's brain (`src/spider/ai/`)

The decision logic is a pure module, unit tested against a mocked Wikipedia. On every page:

1. **Target in sight**: if the target (or one of its redirect titles) is linked, take it.
2. **Backlinks**: the set of pages linking to the target is fetched once at race start; if a link
   leads to one of them, take the most relevant of those.
3. **Semantic ranking**: otherwise every link title is embedded with
   [`all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via
   [transformers.js](https://github.com/huggingface/transformers.js) and compared (cosine similarity)
   with an embedding of the target's title and summary. Embeddings run in a Web Worker and are cached
   across pages. While the model downloads (≈23 MB, once, cached by the browser), or if it cannot
   load, a **lexical** score takes over: shared stemmed words with the target's title, description
   and summary, plus character-trigram similarity.

Visited pages are never chosen again. The only exception is a dead end, where the spider climbs back
along its thread to the previous page and tries its next best link. The library is imported at runtime
from jsDelivr at a pinned version (its self-contained build), which keeps the game's own bundle small.

### The spider's body (`src/spider/render/`)

The spider is a glowing line-art crawler drawn on a full-resolution canvas layered over its own copy
of the article (devicePixelRatio-aware, drawn in the article's content coordinates so effects stay
glued to the text while the camera scrolls).

- **Legs**: eight two-segment legs with procedural locomotion. Feet stay planted (preferably on
  hyperlinks: the crawler walks on the web's edges) until the body moves too far, then step ahead of
  it in an alternating tetrapod gait; knees come from two-bone inverse kinematics.
- **Indexing**: while it thinks, a scan line sweeps the page; links light up in cyan with graph
  edges back to the spider. The chosen link gets a pink lock-on box, a label saying why, and a
  tracking beam.
- **Eating**: words of the link's line are wrapped in spans on demand. The spider abseils on silk to
  the line, then walks along it; every word its mouth passes loses its ink (its box stays, so nothing
  reflows) and leaves a neon bite mark and a burst of data shards.
- **Diving**: the spider spins into the link, the visible text is captured as line fragments that
  spiral into it, and the next article streams out of the same point before the spider drops in on a
  fresh thread.

All art (spider, effects, logo, icons, favicon) is drawn in code; there are no image assets.
`prefers-reduced-motion` shortens the transitions.

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
  wiki/                   HTTP queue, API client, sanitizer, article cache, titles
  game/                   race rules, clock, difficulty levels, pair selection
  spider/ai/              decision rules, rankers, embeddings worker, agent (pure, tested)
  spider/render/          overlay canvas, crawler (IK legs), effects, warp, walk planning
  spider/spiderPane.ts    the spider's half of the screen (animation coroutines)
  spider/spiderRunner.ts  plays the agent's decisions on the pane
  ui/                     setup screen, race screen, end card, article view, logo, widgets
  styles/                 chrome, article typography, screens
tests/                    unit and integration tests, fake Wikipedia + demo world
scripts/generate-icons.mjs
```

## Credits and licenses

- Article text comes from [English Wikipedia](https://en.wikipedia.org/) and is available under the
  [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  license; every page shown in the game links to its source article and its history (authors).
- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) and the
  [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) model
  (Apache-2.0) are loaded at runtime from jsDelivr and Hugging Face.
- Everything else, including all visuals, is original and drawn procedurally in this repository.
