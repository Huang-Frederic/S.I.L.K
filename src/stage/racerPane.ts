/**
 * One half of the race screen. Panes are role-agnostic: whoever owns a pane
 * (player or spider) decides its badge, colours, counters, panels and
 * whether its links can be clicked, so the spider can steal the player's
 * pane and both panes simply swap owners.
 *
 * The pane also tracks the state of its links under attack (webbed, covered,
 * burned, eaten) and the decoys planted in it.
 */
import type { Racer } from '../game/race';
import { lang, t } from '../i18n';
import { ArticleView } from '../ui/articleView';
import { h } from '../ui/dom';
import type { LoadedArticle } from '../wiki/articles';
import { wikipediaUrl } from '../wiki/titles';
import type { Box, Point } from './stage';
import { WordIndex } from './wordIndex';

export type LinkDamage = 'webbed' | 'covered' | 'burned' | 'eaten';

/** Something the spider can walk on: an article with geometry helpers. */
export interface Surface {
  readonly scroller: HTMLElement;
  readonly words: WordIndex;
  /** Visible area in stage coordinates. */
  readonly rect: Box;
  toStage(p: Point): Point;
  fromStage(p: Point): Point;
  /** Client rect -> content coordinates. */
  toContent(rect: DOMRect | DOMRectReadOnly): Box;
  /** Visible part of the content, in content coordinates. */
  visibleContent(): Box;
  readonly articleElement: HTMLElement | null;
}

export interface BrainRow {
  title: string;
  score: number;
  tag?: string;
}

export class RacerPane implements Surface {
  readonly element: HTMLElement;
  readonly view: ArticleView;
  readonly words: WordIndex;
  owner: Racer;
  rect: Box = { left: 0, top: 0, right: 0, bottom: 0 };
  /** Incremented every time a new article is shown (effects tied to a page check it). */
  generation = 0;
  /** Called for clicks on playable links (the race decides what is allowed). */
  onLinkClick: ((title: string, anchor: HTMLAnchorElement) => void) | null = null;
  onBack: (() => void) | null = null;

  private readonly badge: HTMLElement;
  private readonly hopsEl: HTMLElement;
  private readonly crumbsEl: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly brainEl: HTMLElement;
  private readonly brainHead: HTMLElement;
  private readonly brainRows: HTMLElement;
  private readonly sourceLink: HTMLAnchorElement;
  private readonly authorsLink: HTMLAnchorElement;
  private readonly eatenEl: HTMLElement;
  private readonly damage = new Map<HTMLAnchorElement, { kind: LinkDamage; until: number }>();
  private scrollX = 0;
  private scrollY = 0;
  private rootLeft = 0;
  private rootTop = 0;

  constructor(
    owner: Racer,
    readonly side: 'left' | 'right',
  ) {
    this.owner = owner;
    this.view = new ArticleView({
      attribution: false,
      onLinkClick: (title, anchor) => this.onLinkClick?.(title, anchor),
    });
    this.words = new WordIndex((rect) => this.toContent(rect));

    this.badge = h('span', { class: 'pane-badge' });
    this.hopsEl = h('strong', { text: '0' });
    this.crumbsEl = h('span', { class: 'pane-crumbs' });
    const text = t().pane;
    this.backBtn = h('button', {
      class: 'pane-back',
      text: text.back,
      attrs: { type: 'button', title: text.backHint },
      on: { click: () => this.onBack?.() },
    });
    this.brainHead = h('div', { class: 'brain-head' });
    this.brainRows = h('ol', { class: 'brain-rows' });
    this.brainEl = h('div', { class: 'brain', attrs: { 'aria-label': text.reasoning } }, this.brainHead, this.brainRows);
    this.sourceLink = h('a', { text: text.viewOriginal, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.authorsLink = h('a', { text: text.authors, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.eatenEl = h('span', { class: 'pane-eaten' });

    this.element = h(
      'section',
      { class: `pane pane-${side}` },
      h('header', { class: 'pane-head' }, this.badge, h('span', { class: 'pane-hops' }, text.hops, this.hopsEl), this.backBtn, this.crumbsEl),
      this.brainEl,
      this.view.element,
      h(
        'footer',
        { class: 'pane-foot' },
        text.textFrom,
        h('a', { text: 'CC BY-SA 4.0', attrs: { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener noreferrer' } }),
        ' · ',
        this.sourceLink,
        ' · ',
        this.authorsLink,
        this.eatenEl,
      ),
    );
    this.setOwner(owner);
  }

  get scroller(): HTMLElement {
    return this.view.scroller;
  }

  get articleElement(): HTMLElement | null {
    return this.view.articleElement;
  }

  get badgeElement(): HTMLElement {
    return this.badge;
  }

  // -------------------------------------------------------------- ownership

  setOwner(owner: Racer): void {
    this.owner = owner;
    const isPlayer = owner === 'player';
    this.element.classList.toggle('is-player', isPlayer);
    this.element.classList.toggle('is-spider', !isPlayer);
    const text = t().pane;
    this.element.setAttribute('aria-label', isPlayer ? text.yourArticle : text.spiderArticle);
    this.badge.textContent = isPlayer ? text.you : text.spider;
    this.badge.classList.remove('is-eaten');
    this.backBtn.hidden = !isPlayer;
    this.brainEl.hidden = isPlayer;
    this.eatenEl.hidden = isPlayer;
    this.view.setInteractive(isPlayer);
  }

  setHops(hops: number): void {
    this.hopsEl.textContent = String(hops);
  }

  setBackEnabled(enabled: boolean): void {
    this.backBtn.disabled = !enabled;
  }

  /** Breadcrumb of the owner's path, shortened in the middle. */
  setCrumbs(titles: readonly string[]): void {
    const shown = titles.length > 4 ? [titles[0], titles[1], '…', titles[titles.length - 1]] : titles;
    this.crumbsEl.replaceChildren(
      ...shown.flatMap((t, i) => [
        i ? h('span', { class: 'crumb-sep', text: ' → ' }) : null,
        h('span', { class: i === shown.length - 1 ? 'crumb is-current' : 'crumb', text: t }),
      ]).filter((n): n is HTMLElement => n !== null),
    );
    this.crumbsEl.title = titles.join(' → ');
  }

  setWordsEaten(count: number): void {
    this.eatenEl.textContent = t().pane.wordsEaten(count);
  }

  setBrain(head: string, rows: BrainRow[]): void {
    this.brainHead.textContent = head;
    const top = Math.max(0.0001, ...rows.map((r) => r.score));
    this.brainRows.replaceChildren(
      ...rows.map((row, i) =>
        h(
          'li',
          { class: i === 0 ? 'is-best' : '' },
          h('span', { class: 'brain-name', text: row.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') }),
          h('span', { class: 'brain-bar' }, h('i', { attrs: { style: `width:${Math.round(Math.max(0.04, row.score / top) * 100)}%` } })),
          h('span', { class: 'brain-score', text: row.score.toFixed(2) }),
          row.tag ? h('span', { class: 'brain-tag', text: row.tag }) : null,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- content

  showArticle(loaded: LoadedArticle): void {
    this.generation++;
    this.view.render(loaded);
    this.damage.clear();
    this.words.reset(this.view.articleElement);
    const url = wikipediaUrl(loaded.title, lang());
    this.sourceLink.href = url;
    this.authorsLink.href = `${url}?action=history`;
  }

  /** Hides the article text while a glitch transition draws it instead. */
  setHidden(hidden: boolean): void {
    this.element.classList.toggle('is-glitching', hidden);
  }

  get title(): string | null {
    return this.view.article?.title ?? null;
  }

  // --------------------------------------------------------------- geometry

  /** Refreshes the stage rect (called every frame by the stage). */
  measure(root: DOMRect): void {
    const r = this.scroller.getBoundingClientRect();
    this.rect = { left: r.left - root.left, top: r.top - root.top, right: r.right - root.left, bottom: r.bottom - root.top };
    this.scrollX = this.scroller.scrollLeft;
    this.scrollY = this.scroller.scrollTop;
    this.rootLeft = root.left;
    this.rootTop = root.top;
  }

  toStage(p: Point): Point {
    return { x: this.rect.left + p.x - this.scrollX, y: this.rect.top + p.y - this.scrollY };
  }

  fromStage(p: Point): Point {
    return { x: p.x - this.rect.left + this.scrollX, y: p.y - this.rect.top + this.scrollY };
  }

  /**
   * Makes `ctx` draw in this pane's content coordinates (scrolling with the
   * article), optionally clipped to the visible article area.
   */
  enterContent(ctx: CanvasRenderingContext2D, clip = true): void {
    if (clip) {
      ctx.beginPath();
      ctx.rect(this.rect.left, this.rect.top, this.rect.right - this.rect.left, this.rect.bottom - this.rect.top);
      ctx.clip();
    }
    ctx.translate(this.rect.left - this.scrollX, this.rect.top - this.scrollY);
  }

  boxToStage(box: Box): Box {
    const a = this.toStage({ x: box.left, y: box.top });
    return { left: a.x, top: a.y, right: a.x + (box.right - box.left), bottom: a.y + (box.bottom - box.top) };
  }

  toContent(rect: DOMRect | DOMRectReadOnly): Box {
    const base = this.scroller.getBoundingClientRect();
    const dx = this.scroller.scrollLeft - base.left;
    const dy = this.scroller.scrollTop - base.top;
    return { left: rect.left + dx, top: rect.top + dy, right: rect.right + dx, bottom: rect.bottom + dy };
  }

  visibleContent(): Box {
    return {
      left: this.scroller.scrollLeft,
      top: this.scroller.scrollTop,
      right: this.scroller.scrollLeft + this.scroller.clientWidth,
      bottom: this.scroller.scrollTop + this.scroller.clientHeight,
    };
  }

  /** The article's box in content coordinates (where the spider may walk). */
  articleBox(): Box | null {
    const article = this.view.articleElement;
    return article ? this.toContent(article.getBoundingClientRect()) : null;
  }

  /** True when a stage point lies inside the visible article area. */
  containsStage(p: Point): boolean {
    return p.x >= this.rect.left && p.x <= this.rect.right && p.y >= this.rect.top && p.y <= this.rect.bottom;
  }

  // ------------------------------------------------------------------ links

  /** Playable links of the current article (decoys included). */
  links(): HTMLAnchorElement[] {
    return Array.from(this.scroller.querySelectorAll<HTMLAnchorElement>('a.wiki-link'));
  }

  /** Box of a link's first line (several rects once its words are wrapped). */
  linkBox(anchor: Element): Box {
    const rects = Array.from(anchor.getClientRects());
    if (!rects.length) return this.toContent(anchor.getBoundingClientRect());
    const first = rects[0];
    let left = first.left;
    let right = first.right;
    let top = first.top;
    let bottom = first.bottom;
    for (const rect of rects.slice(1)) {
      const cy = (rect.top + rect.bottom) / 2;
      if (cy < first.top || cy > first.bottom) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return this.toContent(new DOMRect(left, top, right - left, bottom - top));
  }

  /** Links currently visible in the pane, with their content boxes. */
  visibleLinks(filter: (a: HTMLAnchorElement) => boolean = (a) => this.usable(a)): Array<{ el: HTMLAnchorElement; box: Box }> {
    const view = this.visibleContent();
    const out: Array<{ el: HTMLAnchorElement; box: Box }> = [];
    for (const el of this.links()) {
      if (!filter(el) || !el.getClientRects().length) continue;
      const box = this.linkBox(el);
      if (box.bottom > view.top && box.top < view.bottom && box.right > view.left) out.push({ el, box });
    }
    return out;
  }

  damageOf(anchor: HTMLAnchorElement): LinkDamage | null {
    return this.damage.get(anchor)?.kind ?? null;
  }

  usable(anchor: HTMLAnchorElement): boolean {
    return !this.damage.has(anchor) && anchor.isConnected;
  }

  /** Blocks a link for a while (webbed, covered) or for good (burned, eaten). */
  damageLink(anchor: HTMLAnchorElement, kind: LinkDamage, until = Infinity): void {
    const current = this.damage.get(anchor);
    if (current && (current.kind === 'burned' || current.kind === 'eaten')) return;
    if (current) anchor.classList.remove(`is-${current.kind}`);
    this.damage.set(anchor, { kind, until });
    anchor.classList.add('is-damaged', `is-${kind}`);
    anchor.setAttribute('aria-disabled', 'true');
  }

  /** Lifts timed damage whose time is up. */
  expireDamage(now: number): void {
    for (const [anchor, state] of this.damage) {
      if (state.until > now) continue;
      this.damage.delete(anchor);
      anchor.classList.remove('is-damaged', `is-${state.kind}`);
      anchor.removeAttribute('aria-disabled');
    }
  }

  /**
   * Inserts a fake link to the target in the running text, at the word
   * boundary nearest to a stage point (null when there is no text there).
   */
  plantDecoyAt(p: Point, targetTitle: string): HTMLAnchorElement | null {
    const client = { x: p.x + this.rootLeft, y: p.y + this.rootTop };
    const doc = this.scroller.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(client.x, client.y);
      if (pos) ({ offsetNode: node, offset } = pos);
    } else if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(client.x, client.y);
      if (range) ({ startContainer: node, startOffset: offset } = range);
    }
    if (!node || node.nodeType !== 3 || !this.view.articleElement?.contains(node)) return null;
    const parent = node.parentElement;
    if (!parent || parent.closest('a, h1, h2, h3, h4, h5, h6, .wiki-subtitle')) return null;
    const text = node as Text;
    // Move to the next space so that no word is cut in half.
    const space = text.data.indexOf(' ', offset);
    if (space < 0) return null;
    const rest = text.splitText(space + 1);
    const decoy = h('a', { class: 'wiki-link is-decoy', text: targetTitle, attrs: { href: `#${encodeURIComponent(targetTitle)}`, title: targetTitle } });
    decoy.dataset.title = targetTitle;
    decoy.dataset.decoy = '1';
    rest.before(decoy, document.createTextNode(' '));
    this.words.relayout();
    return decoy;
  }

  decoys(): HTMLAnchorElement[] {
    return Array.from(this.scroller.querySelectorAll<HTMLAnchorElement>('a.is-decoy'));
  }
}
