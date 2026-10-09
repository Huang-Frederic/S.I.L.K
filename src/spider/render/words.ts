/**
 * Word-level access to the spider's copy of an article: words are wrapped in
 * spans on demand (one text block at a time, so long articles stay light),
 * and eaten words keep their box but lose their ink.
 */

export const WORD_CLASS = 'sw';
export const EATEN_CLASS = 'sw-eaten';

const TEXT_BLOCKS = 'p, li, dd, dt, td, th, caption, blockquote, pre, h2, h3, h4, h5, h6, .wiki-hatnote';

/** The block of running text around an element (paragraph, list item, cell...). */
export function textBlockOf(el: Element, fallback: Element): Element {
  return el.closest(TEXT_BLOCKS) ?? fallback;
}

/** Wraps each word of `block` in a span (idempotent). Returns the spans in reading order. */
export function wrapWords(block: Element): HTMLElement[] {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.classList.contains(WORD_CLASS) || !text.data.trim()) continue;
    texts.push(text);
  }
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
      }
    }
    text.replaceWith(fragment);
  }
  return Array.from(block.querySelectorAll<HTMLElement>(`span.${WORD_CLASS}`));
}

/** Hides a word's ink but keeps its box, so the layout does not move. */
export function eatWord(word: HTMLElement): void {
  word.classList.add(EATEN_CLASS);
}

export function isEaten(word: Element): boolean {
  return word.classList.contains(EATEN_CLASS);
}
