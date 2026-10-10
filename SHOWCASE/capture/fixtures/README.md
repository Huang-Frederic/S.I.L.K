# Showcase fixtures

Pages served to the game by [`capture.mjs`](../capture.mjs) in place of live Wikipedia, so that every
capture of the README's GIFs and screenshots plays on the same pages.

## `spider.html.gz`

The article **[Spider](https://en.wikipedia.org/wiki/Spider)** from English Wikipedia, as returned by
the REST API (`/api/rest_v1/page/html/Spider`, Parsoid HTML), gzipped.

- Revision: [1377148305](https://en.wikipedia.org/w/index.php?title=Spider&oldid=1377148305)
  (last modified 2026-09-28).
- Authors: the Wikipedia contributors listed in the
  [page history](https://en.wikipedia.org/w/index.php?title=Spider&action=history).
- License: [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  The file is the unmodified API response, compressed; the game sanitizes it at display time, as it
  does with every article.

Every other page the capture uses is a stand-in. *Moth Orchard*, *Tidewatch Observatory* and the
rest of the *Silken Isles* come from the test helpers
([`tests/helpers/demoWorld.ts`](../../../tests/helpers/demoWorld.ts)). Two short pages are written in
`capture.mjs` itself: *Uttu* (a real title, linked near the end of the *Spider* article, with
made-up text) and the fictional *Loom of Heaven*.
