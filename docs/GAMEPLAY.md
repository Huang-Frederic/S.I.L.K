# Gameplay

The rules of S.I.L.K in full: how a race works, what each difficulty level does, and when the spider
may steal a link. For how it is built, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Contents

1. How to play
2. Difficulty
3. The show on Hard
4. Languages

---

## 1. How to play

You and a spider start on the same Wikipedia article and race to the same target article by
following links. You click; the spider *crawls*.

1. Pick a **start** and a **target** page. Type to get suggestions (with their short descriptions),
   or roll the dice: a random start is a genuinely random article, a random target comes from a pool
   of well-known topics, so every race is winnable (in theory). Disambiguation pages are refused as
   start or target.
2. Choose the spider's **difficulty** (below; the game opens on Normal). Its brain is the same on
   every level; only its speed and its manners change.
3. Click links in your pane (amber border, **YOU** badge, **TOI** in French). Only links to other
   articles in the body count. **← back** is allowed but counts as a hop. Hovering a link shows
   `hop N → Title`.
4. First on the target wins. The finish screen compares both paths, hops, times and the number of
   words the spider ate.

The race pauses while the tab is hidden. **Reduce motion** (title screen, on by default when the
system asks for it) removes screen shake and shortens transitions; it never changes the difficulty.

Missing pages, redirects (`Redirected from …`) and disambiguation pages are handled: you are told
when you land on a disambiguation page, and the spider avoids them.

---

## 2. Difficulty

| Level | What the spider does |
| --- | --- |
| **Easy** | Thinks slowly, crawls, and tears up its own page. Never touches yours. Winnable. |
| **Normal** (default) | Runs. Adds a **web trap** (links near your cursor can't be clicked for a few seconds), the **fan laser** (a big beam from its eye sweeps a fan across your page, centred on your cursor, and burns every word and link it passes over, its own page included) and a **word bombardment** (words from its page land on your links and cover them), about every 25 s. **Rage** when your page links to the target: faster, angrier, glowing eye, attacks twice as often. Hard but winnable. |
| **Hard** | An attack every 4–8 s, chained (web, then the fan laser, then a bombardment…), with no warning, rage always on. It tears its page apart as it goes (more destruction moves, more torn-up words) and fumbles a little for the right link: it often heads for another link first and thinks better of it. **Decoys**: up to 3 fake target links in your text; click one and it bursts into mini-spiders that wander about your page, slowly, breaking every word they walk over, links included (no time lost). **Cursor harassment**, now and then (at most once every 45 s): a silk line sticks to your cursor and drags it for 2 s. **Link snatch** when you are winning (below). Expected win rate: almost zero. |

The numbers behind each level (thinking time, speeds, chances, cooldowns) are in one table,
[`src/game/difficulty.ts`](../src/game/difficulty.ts).

### The link snatch (Hard)

If the link you click takes you closer to the target and leaves you closer than the spider, the
spider leaps across, eats that link, dives in, and the panes swap owners: you continue from its
page.

- "Closer" is the spider's own estimate: first the hops left (1 from a page that links to the
  target, 2 from a page that links to one of those, 3 otherwise), then, at equal hops, how close the
  page's title is to the target in meaning.
- Never on your first three links.
- Never the last two links of a path: the target, or a page that links to it.
- At most one snatch a minute.

The rules are a pure, tested module: [`src/game/snatch.ts`](../src/game/snatch.ts).

---

## 3. The show on Hard

Hard is meant as a show, not a fair fight: people should lose, laugh, and share the clip. The spider
may burn, web or cover the target link and may leave you with nothing clickable for a while. There
are no time penalties: the first one on the target wins.

- The spider taunts you in short speech bubbles (at most one every ~6 s).
- When it wins, it walks to the middle of the screen, eats your badge and dances, then roasts you on
  the finish screen with the race's real numbers.
- Beat it on Hard and it collapses, its eye flickers out, and the finish screen says
  **IMPOSSIBLE. (screenshot this.)**
- A per-browser "Hard mode wins" counter on the title screen keeps the score (stored locally, never a
  global or invented statistic).

---

## 4. Languages

The game is in **English by default** (English texts, races on
[en.wikipedia.org](https://en.wikipedia.org/)); the **EN / FR** switch in the top bar turns it into
French (French texts, races on [fr.wikipedia.org](https://fr.wikipedia.org/)). The choice is
remembered in the browser. In French, the spider ranks links with a multilingual model (see
[ARCHITECTURE.md](ARCHITECTURE.md#the-spiders-brain)).
