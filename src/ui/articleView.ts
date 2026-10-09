/**
 * Displays a sanitized article inside a scrollable pane, with the CC BY-SA
 * attribution, and reports clicks on playable links.
 */
import type { LoadedArticle } from '../wiki/articles';
import { wikipediaUrl } from '../wiki/titles';
import { h } from './dom';

export interface ArticleViewOptions {
  /** Called when the reader clicks a playable link. Omit for read-only panes. */
  onLinkClick?: (title: string, anchor: HTMLAnchorElement) => void;
  /** Extra class on the pane body (e.g. to theme the spider's copy). */
  className?: string;
}

export class ArticleView {
  /** Positioned container: scroller + overlays. */
  readonly element: HTMLElement;
  /** The scrolling element that holds the article. */
  readonly scroller: HTMLElement;
  private readonly overlay: HTMLElement;
  private current: LoadedArticle | null = null;

  constructor(options: ArticleViewOptions = {}) {
    this.scroller = h('div', { class: 'pane-scroll' });
    this.overlay = h('div', { class: 'pane-overlay', attrs: { 'aria-live': 'polite' } });
    this.element = h('div', { class: `pane-body ${options.className ?? ''}` }, this.scroller, this.overlay);

    if (options.onLinkClick) {
      this.scroller.addEventListener('click', (event) => {
        const anchor = (event.target as Element | null)?.closest?.('a');
        if (!anchor || !this.scroller.contains(anchor)) return;
        // Only our sanitized wiki links navigate; attribution links open Wikipedia.
        if (!anchor.classList.contains('wiki-link')) return;
        event.preventDefault();
        const title = anchor.dataset.title;
        if (title) options.onLinkClick!(title, anchor as HTMLAnchorElement);
      });
    } else {
      // Read-only copy (the spider's): not focusable nor clickable.
      this.scroller.inert = true;
    }
  }

  get article(): LoadedArticle | null {
    return this.current;
  }

  /** The rendered <article> element, if any. */
  get articleElement(): HTMLElement | null {
    return this.scroller.querySelector('article.wiki-article');
  }

  render(loaded: LoadedArticle): HTMLElement {
    this.current = loaded;
    const { article } = loaded;
    const articleEl = h(
      'article',
      { class: 'wiki-article', attrs: { lang: 'en' } },
      h('h1', { class: 'wiki-title', text: loaded.title }),
      h(
        'p',
        { class: 'wiki-subtitle' },
        'From Wikipedia, the free encyclopedia',
        article.description ? h('span', { class: 'wiki-shortdesc', text: ` · ${article.description}` }) : null,
      ),
      loaded.redirectedFrom ? h('p', { class: 'wiki-redirect-note', text: `(Redirected from ${loaded.redirectedFrom})` }) : null,
      article.isDisambiguation
        ? h('p', { class: 'wiki-disambig-note', text: 'This is a disambiguation page: it lists articles that share a similar title.' })
        : null,
      article.body.cloneNode(true),
      attribution(loaded.title),
    );
    this.scroller.replaceChildren(articleEl);
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
    this.clearOverlay();
    return articleEl;
  }

  /** Dims the article and shows a loading message on top of it. */
  showLoading(label: string): void {
    this.element.classList.add('is-busy');
    this.overlay.replaceChildren(
      h('div', { class: 'pane-message pane-loading' }, h('span', { class: 'loader', attrs: { 'aria-hidden': 'true' } }), h('span', { text: label })),
    );
  }

  showError(message: string, actions: Array<{ label: string; run: () => void }> = []): void {
    this.element.classList.add('is-busy');
    this.overlay.replaceChildren(
      h(
        'div',
        { class: 'pane-message pane-error', attrs: { role: 'alert' } },
        h('p', { text: message }),
        h(
          'div',
          { class: 'pane-actions' },
          ...actions.map((action) => h('button', { class: 'btn btn-small', text: action.label, on: { click: action.run } })),
        ),
      ),
    );
  }

  clearOverlay(): void {
    this.element.classList.remove('is-busy');
    this.overlay.replaceChildren();
  }

  /** Empties the pane (e.g. before the race starts). */
  clear(): void {
    this.current = null;
    this.scroller.replaceChildren();
    this.clearOverlay();
  }
}

/** CC BY-SA attribution footer required for reusing Wikipedia text. */
function attribution(title: string): HTMLElement {
  const url = wikipediaUrl(title);
  const external = { target: '_blank', rel: 'noopener noreferrer' };
  return h(
    'footer',
    { class: 'wiki-attribution' },
    'Text from the Wikipedia article “',
    h('a', { attrs: { href: url, ...external }, text: title }),
    '” (',
    h('a', { attrs: { href: `${url}?action=history`, ...external }, text: 'authors' }),
    '), available under ',
    h('a', { attrs: { href: 'https://creativecommons.org/licenses/by-sa/4.0/', ...external }, text: 'CC BY-SA 4.0' }),
    '. Shown in simplified form: images, references and navigation boxes were removed.',
  );
}
