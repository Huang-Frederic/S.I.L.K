/**
 * Word-level geometry of an article, built lazily: text blocks are wrapped in
 * per-word spans only when the spider comes near them, and each word's box is
 * kept (in content coordinates) for quick spatial lookups: feet snap to words,
 * jaws eat them, legs pluck and stomp them.
 */
import type { Box, Point } from './stage';

export const WORD_CLASS = 'sw';
export const EATEN_CLASS = 'sw-eaten';

const TEXT_BLOCKS = 'p, li, dd, dt, td, th, caption, blockquote, pre, h1, h2, h3, h4, h5, h6, .wiki-hatnote, .wiki-subtitle';

export interface Word {
  el: HTMLElement;
  /** Content coordinates. */
  box: Box;
  /** The link this word belongs to, if any. */
  link: HTMLAnchorElement | null;
  /** Eaten, thrown, sliced or squashed: no longer a foothold or a meal. */
  gone: boolean;
}

/** Converts a client rect into the content coordinates of a surface. */
export type ToContent = (rect: DOMRect | DOMRectReadOnly) => Box;

/** Wraps each word of `block` in a span (idempotent). Returns the new spans. */
export function wrapWords(block: Element): HTMLElement[] {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.classList.contains(WORD_CLASS) || !text.data.trim()) continue;
    texts.push(text);
  }
  const created: HTMLElement[] = [];
  for (const text of texts) {
    const fragment = doc.createDocumentFragment();
    for (const part of text.data.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.appendChild(doc.createTextNode(part));
      } else {
        const span = doc.createElement('span');
        span.className = WORD_CLASS;
        span.textContent = part;
        fragment.appendChild(span);
        created.push(span);
      }
    }
    text.replaceWith(fragment);
  }
  return created;
}

export class WordIndex {
  private words: Word[] = [];
  private blocks: Array<{ el: Element; box: Box; wrapped: boolean }> = [];

  constructor(private readonly toContent: ToContent) {}

  /** Starts over on a new article. */
  reset(root: Element | null): void {
    this.words = [];
    this.blocks = [];
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll(TEXT_BLOCKS))) {
      // Nested blocks are covered by their outermost text block.
      if (el.parentElement?.closest(TEXT_BLOCKS) && root.contains(el.parentElement.closest(TEXT_BLOCKS))) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      this.blocks.push({ el, box: this.toContent(rect), wrapped: false });
    }
  }

  get size(): number {
    return this.words.length;
  }

  all(): readonly Word[] {
    return this.words;
  }

  /** Makes sure every word of the blocks intersecting `region` is indexed. */
  ensure(region: Box): void {
    let added = false;
    for (const block of this.blocks) {
      if (block.wrapped || block.box.bottom < region.top || block.box.top > region.bottom) continue;
      block.wrapped = true;
      for (const el of wrapWords(block.el)) {
        const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
        if (!rect.width) continue;
        this.words.push({ el, box: this.toContent(rect), link: el.closest('a'), gone: false });
        added = true;
      }
    }
    if (added) this.words.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  }

  /** Words of one link (wrapping its block first). */
  wordsOf(link: Element): Word[] {
    return this.words.filter((w) => w.link === link);
  }

  /** The word nearest to `p` within `maxDistance` (content coordinates). */
  nearest(p: Point, maxDistance: number, accept: (w: Word) => boolean = (w) => !w.gone): Word | null {
    let best: Word | null = null;
    let bestDistance = maxDistance;
    for (let i = this.lowerBound(p.y - maxDistance - 60); i < this.words.length; i++) {
      const w = this.words[i];
      if (w.box.top > p.y + maxDistance) break;
      const dx = Math.max(w.box.left - p.x, 0, p.x - w.box.right);
      const dy = Math.max(w.box.top - p.y, 0, p.y - w.box.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= bestDistance && accept(w)) {
        bestDistance = d;
        best = w;
      }
    }
    return best;
  }

  /** Words whose centre lies inside `box`. */
  inside(box: Box, accept: (w: Word) => boolean = (w) => !w.gone): Word[] {
    const out: Word[] = [];
    for (let i = this.lowerBound(box.top - 60); i < this.words.length; i++) {
      const w = this.words[i];
      if (w.box.top > box.bottom) break;
      const cx = (w.box.left + w.box.right) / 2;
      const cy = (w.box.top + w.box.bottom) / 2;
      if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom && accept(w)) out.push(w);
    }
    return out;
  }

  /** Recomputes boxes after a layout change (resize). */
  relayout(): void {
    for (const block of this.blocks) block.box = this.toContent(block.el.getBoundingClientRect());
    for (const w of this.words) {
      const rect = w.el.getClientRects()[0];
      if (rect) w.box = this.toContent(rect);
    }
    this.words.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  }

  private lowerBound(top: number): number {
    let lo = 0;
    let hi = this.words.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.words[mid].box.top < top) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
