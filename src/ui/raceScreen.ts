/**
 * The race screen: HUD (target, timer), the player's pane, countdown and the
 * result overlay.
 */
import type { ValidatedPair } from '../game/pairs';
import { Race } from '../game/race';
import type { ArticleStore } from '../wiki/articles';
import { wikipediaUrl } from '../wiki/titles';
import { errorMessage, formatTime, h } from './dom';
import { PlayerPane } from './playerPane';

export interface RaceScreenOptions {
  store: ArticleStore;
  pair: ValidatedPair;
  /** Back to the setup screen. */
  onExit: () => void;
  /** Same pair again. */
  onRematch: () => void;
}

export class RaceScreen {
  readonly element: HTMLElement;
  private readonly race: Race;
  private readonly player: PlayerPane;
  private readonly clockEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly giveUpBtn: HTMLButtonElement;
  private frame = 0;
  private destroyed = false;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(private readonly options: RaceScreenOptions) {
    const { pair } = options;
    this.race = new Race(pair.start.title, pair.target.title);
    this.player = new PlayerPane({
      store: options.store,
      onMove: (title, via) => this.onPlayerMove(title, via),
    });

    this.clockEl = h('span', { class: 'hud-clock', text: formatTime(0), attrs: { 'aria-label': 'Race time' } });
    this.giveUpBtn = h('button', {
      class: 'btn btn-danger btn-small',
      text: 'Give up',
      attrs: { type: 'button' },
      on: { click: () => this.giveUp() },
    });
    this.overlay = h('div', { class: 'race-overlay' });
    this.overlay.hidden = true;

    this.element = h(
      'main',
      { class: 'screen screen-race' },
      h(
        'header',
        { class: 'hud' },
        h(
          'div',
          { class: 'hud-target' },
          h('span', { class: 'label', text: 'Target' }),
          h('strong', { class: 'hud-target-title', text: pair.target.title, attrs: { title: pair.target.extract } }),
          pair.target.description ? h('span', { class: 'hud-target-desc', text: pair.target.description }) : null,
        ),
        this.clockEl,
        h('div', { class: 'hud-actions' }, this.giveUpBtn),
      ),
      h('div', { class: 'race-panes' }, this.player.element),
      this.overlay,
    );
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Loads the start article, runs the countdown and starts the clock. */
  async begin(): Promise<void> {
    try {
      await this.player.showStart(this.race.startTitle);
    } catch (error) {
      this.player.view.showError(`Could not load the start article: ${errorMessage(error)}`, [
        { label: 'Retry', run: () => void this.begin() },
        { label: 'Back', run: () => this.options.onExit() },
      ]);
      return;
    }
    if (this.destroyed) return;
    await this.countdown();
    if (this.destroyed) return;
    this.race.clock.start();
    this.player.setEnabled(true);
    this.tick();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private async countdown(): Promise<void> {
    this.overlay.hidden = false;
    for (const step of ['3', '2', '1', 'GO!']) {
      this.overlay.replaceChildren(h('div', { class: 'countdown', text: step }));
      await new Promise((resolve) => setTimeout(resolve, step === 'GO!' ? 450 : 700));
      if (this.destroyed) return;
    }
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private tick = (): void => {
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());
    if (!this.race.winner && !this.race.player.retired) this.frame = requestAnimationFrame(this.tick);
  };

  private onPlayerMove(title: string, via: 'link' | 'back'): void {
    const arrived = this.race.move('player', title, via);
    this.player.setHops(this.race.player.hops);
    if (arrived) this.finish();
  }

  private giveUp(): void {
    if (this.race.winner) return;
    this.race.retire('player');
    this.finish();
  }

  private handleVisibility(): void {
    if (this.race.winner || this.race.player.retired || !this.player) return;
    if (document.hidden) this.race.clock.pause();
    else if (this.player.view.article) this.race.clock.start();
  }

  private finish(): void {
    this.race.clock.pause();
    this.player.setEnabled(false);
    this.giveUpBtn.disabled = true;
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());

    const { player } = this.race;
    const won = player.finishedAt !== null;
    this.overlay.hidden = false;
    this.overlay.replaceChildren(
      h(
        'div',
        { class: 'result-card panel' },
        h('h2', { class: 'result-title', text: won ? 'Target reached!' : 'You gave up' }),
        h(
          'p',
          { class: 'result-summary' },
          won ? `${player.hops} hops in ${formatTime(player.finishedAt!)}` : `After ${player.hops} hops in ${formatTime(this.race.clock.elapsed())}`,
        ),
        h(
          'ol',
          { class: 'result-path' },
          ...player.path.map((step) =>
            h(
              'li',
              {},
              h('a', { attrs: { href: wikipediaUrl(step.title), target: '_blank', rel: 'noopener noreferrer' }, text: step.title }),
              step.via === 'back' ? h('span', { class: 'result-back', text: ' (back)' }) : null,
            ),
          ),
        ),
        h(
          'div',
          { class: 'result-actions' },
          h('button', { class: 'btn', text: 'Rematch', on: { click: () => this.options.onRematch() } }),
          h('button', { class: 'btn btn-secondary', text: 'New race', on: { click: () => this.options.onExit() } }),
        ),
      ),
    );
  }
}
