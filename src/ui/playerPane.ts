/**
 * The player's half of the screen: an article that navigates when a link is
 * clicked, a back button and a hop counter.
 */
import type { ArticleStore, LoadedArticle } from '../wiki/articles';
import { ArticleNotFoundError } from '../wiki/client';
import { ArticleView } from './articleView';
import { errorMessage, h } from './dom';

export interface PlayerPaneOptions {
  store: ArticleStore;
  /** Called after the player successfully moved to a new page. */
  onMove: (title: string, via: 'link' | 'back') => void;
}

export class PlayerPane {
  readonly element: HTMLElement;
  readonly view: ArticleView;
  private readonly hopsEl: HTMLElement;
  private readonly whereEl: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  /** Pages visited, used by the back button. */
  private readonly history: string[] = [];
  private busy = false;
  private enabled = false;

  constructor(private readonly options: PlayerPaneOptions) {
    this.view = new ArticleView({ onLinkClick: (title) => void this.navigate(title, 'link') });
    this.hopsEl = h('strong', { text: '0' });
    this.whereEl = h('span', { class: 'pane-where' });
    this.backBtn = h('button', {
      class: 'btn btn-secondary btn-small',
      text: '◀ Back',
      attrs: { type: 'button', title: 'Go back to the previous article (counts as a hop)' },
      on: { click: () => this.goBack() },
    });
    this.backBtn.disabled = true;
    this.element = h(
      'section',
      { class: 'pane pane-player', attrs: { 'aria-label': 'Your article' } },
      h('div', { class: 'pane-bar' }, h('span', { class: 'pane-who', text: 'YOU' }), h('span', { class: 'pane-stat' }, 'hops ', this.hopsEl), this.whereEl, this.backBtn),
      this.view.element,
    );
  }

  /** Shows the start article (not counted as a hop). */
  async showStart(title: string): Promise<LoadedArticle> {
    this.view.showLoading(`Loading “${title}”…`);
    const loaded = await this.options.store.load(title, { priority: true });
    this.display(loaded);
    this.history.length = 0;
    this.history.push(loaded.title);
    this.updateBack();
    return loaded;
  }

  /** Enables or disables clicking (before the countdown ends / after the race). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.element.classList.toggle('is-locked', !enabled);
    this.updateBack();
  }

  setHops(hops: number): void {
    this.hopsEl.textContent = String(hops);
  }

  private display(loaded: LoadedArticle): void {
    this.view.render(loaded);
    this.whereEl.textContent = loaded.title;
    this.whereEl.title = loaded.title;
  }

  private goBack(): void {
    if (this.history.length < 2) return;
    void this.navigate(this.history[this.history.length - 2], 'back');
  }

  private updateBack(): void {
    this.backBtn.disabled = !this.enabled || this.busy || this.history.length < 2;
  }

  private async navigate(title: string, via: 'link' | 'back'): Promise<void> {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    this.updateBack();
    this.view.showLoading(`Loading “${title}”…`);
    try {
      const loaded = await this.options.store.load(title, { priority: true });
      if (!this.enabled) {
        // The race ended while we were loading.
        this.view.clearOverlay();
        return;
      }
      this.display(loaded);
      if (via === 'back') this.history.pop();
      else this.history.push(loaded.title);
      this.options.onMove(loaded.title, via);
    } catch (error) {
      const message =
        error instanceof ArticleNotFoundError
          ? `“${title}” does not exist on Wikipedia (it may have been deleted). Pick another link.`
          : `Could not load “${title}”: ${errorMessage(error)}`;
      this.view.showError(message, [
        { label: 'Retry', run: () => void this.retry(title, via) },
        { label: 'Dismiss', run: () => this.view.clearOverlay() },
      ]);
    } finally {
      this.busy = false;
      this.updateBack();
    }
  }

  private async retry(title: string, via: 'link' | 'back'): Promise<void> {
    this.view.clearOverlay();
    await this.navigate(title, via);
  }
}
