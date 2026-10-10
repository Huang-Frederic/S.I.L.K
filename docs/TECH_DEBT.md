# Honest tech debt

S.I.L.K was built in one day of short feedback rounds, and every round shipped with trade-offs. This
is the full list: what is not perfect, why it was left that way, and what fixing it would take.
Roughly in order of how much I would want it fixed.

---

## Code structure

### `src/spider/actor.ts` is 1,434 lines

- **What.** One class holds every move the spider can make: crawl, run, leap, web zip, zip ahead,
  laser cut and sweep, yeet, stomp, pace, grab, dive, the snatch leap, the victory dance and the
  collapse.
- **Why it stayed.** The moves share a lot of state (the rig, the pane it walks on, the word index,
  the interruption logic of a snatch), and they were rewritten in almost every feedback round. The
  pure parts already moved out: the walk's geometry to [`route.ts`](../src/spider/route.ts), the
  legs to [`rig.ts`](../src/spider/rig.ts).
- **The fix.** Split by family (locomotion, mischief, hop sequence, endings) into modules that take
  the actor's shared state as a parameter, keeping `SpiderActor` as a thin facade.

### `src/ui/raceScreen.ts` mixes the view and the race

- **What.** At 859 lines, the race screen builds the HUD and the panes, and also orchestrates the
  race: it wires the runner and the attack director, decides link snatches, swaps panes and plays
  the endings.
- **Why it stayed.** Most of that orchestration is a few lines per event, and each event needs the
  DOM anyway (a click, a pane, an overlay).
- **The fix.** Extract a DOM-free race controller that owns the race, the runner and the director,
  and leave the screen as a view that forwards clicks and renders state. The controller could then
  be tested like the rules are.

---

## Testing

### No end-to-end tests in CI

- **What.** CI runs the 159 unit tests and the build. Full races (pacing, the start-of-race layout
  shift, the mini-spiders, long trips) were checked with Playwright scripts run by hand, the same
  harness the showcase script uses, but none of them runs on pull requests.
- **Why it stayed.** A full race takes about a minute, and the spider's choices are random, so the
  assertions need care to avoid flaky tests.
- **The fix.** One Playwright job, on the fake Wikipedia, that runs a race per level with a seeded
  RNG (below) and checks it finishes, with no console error, no layout shift on the panes, and a
  time within bounds.

### Randomness is not seedable

- **What.** The spider's choices (attacks, mischief, hesitation, gait jitter) call `Math.random()`
  directly. Two runs of the same race differ, which is the point when playing, but it makes
  end-to-end tests and showcase captures vary from run to run. The showcase script works around it by
  waiting for the event each shot shows rather than for a fixed time.
- **Why it stayed.** Nothing needed it until the showcase script.
- **The fix.** Pass a random generator through the difficulty and attack context, as
  [`pairs.ts`](../src/game/pairs.ts) already does with its `rng` parameter.

### The French sanitizer is tested on a handwritten page

- **What.** French Wikipedia's namespaces, excluded sections and infobox classes are covered by a
  fixture written by hand from frwiki's markup. The test suite never sees a real French page.
- **Why it stayed.** Automated requests to fr.wikipedia.org from the build environment were
  rate-limited (HTTP 429). The French target pool was checked through the API instead: every title
  exists and none is a disambiguation page.
- **The fix.** Record a dozen real French pages (Parsoid HTML, with their attribution) as fixtures,
  the way the showcase stores the English *Spider* article, and test the sanitizer against them.

---

## Performance and loading

### The French model is a 118 MB download

- **What.** In French the spider ranks links with `paraphrase-multilingual-MiniLM-L12-v2` (118 MB)
  instead of `all-MiniLM-L6-v2` (23 MB). It loads in about 10 s instead of 4.
- **Why it stayed.** It ranks French titles much better: mean AUC 0.98 against 0.91 on 5 French
  targets and 320 titles. The cost is paid once (the browser caches it), a race never waits more
  than 8 s for it, and word matching covers the wait.
- **The fix.** Benchmark smaller multilingual models with the same test set and switch if one comes
  close to 0.98.

### The request cache never forgets

- **What.** The cache in [`src/wiki/http.ts`](../src/wiki/http.ts) is a `Map` keyed by URL with no
  eviction: a session keeps every article and API answer it fetched.
- **Why it stayed.** A race touches tens of pages, and rematches reuse them; memory only matters for a
  tab left open for many races.
- **The fix.** A size cap with least-recently-used eviction (a few hundred entries).

### Backlinks stop at 2,000

- **What.** The target's backlinks are fetched in 4 batches of 500. Popular targets have many more,
  so the spider may miss a page that links to the target and pick a weaker link instead.
- **Why it stayed.** Four requests keep the race start fast, and the semantic ranking usually finds
  a good path anyway: the backlinks are a heuristic, not an oracle.
- **The fix.** Keep fetching batches in the background once the race has started.

---

## Security and dependencies

### Code loaded from a CDN at runtime, without an integrity check

- **What.** transformers.js is imported at runtime from jsDelivr at a pinned version (4.3.1), and the
  models come from Hugging Face. A dynamic `import()` cannot carry Subresource Integrity, so the
  browser trusts whatever the CDN serves for that URL.
- **Why it stayed.** It keeps the game's bundle at 63 kB gzipped, and the model weights come from a
  CDN anyway. If the CDN is unreachable, the spider falls back to word matching and the game still
  works.
- **The fix.** Self-host the library build (in `public/`, served with the game) or bundle it into the
  worker, and pin the model files by revision.

---

## Game design

### Built for a mouse

- **What.** The attacks follow the cursor. On a touch screen there is none: the fan laser and the
  web traps aim at the middle of the visible page, and cursor harassment is off. The layout adapts
  to small screens, but the game is easier and less fun there.
- **Why it stayed.** The show (a beam sweeping around your cursor, a silk line dragging it) is built
  on the mouse, and desktop was the target.
- **The fix.** Touch-specific attacks (aimed at the last tap, at the link under the thumb) and a
  stacked layout tuned for phones.

### Balance is checked with a stopwatch, not data

- **What.** The difficulty levels were tuned by watching races and timing a fixed 8-hop route on
  the test encyclopedia (Hard about 52 s, Normal about 71 s). "Expected win rate on Hard: almost
  zero" is a design intent, not a measurement: the game has no analytics, on purpose, and the
  Hard-mode win counter is local to each browser.
- **Why it stayed.** No tracking was a choice for a small portfolio game.
- **The fix.** A simulation: the spider against a scripted player (one that always picks the best
  link after a fixed delay) on many fake pairs, to estimate win rates per level before shipping a
  change.
