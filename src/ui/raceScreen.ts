/**
 * The race screen: HUD (target, timer), the player's pane on the left, the
 * spider's pane on the right, the countdown and the result overlay.
 */
import type { Difficulty } from '../game/difficulty';
import type { ValidatedPair } from '../game/pairs';
import { Race, type Racer } from '../game/race';
import { SpiderAgent } from '../spider/ai/agent';
import { SpiderBrain } from '../spider/ai/brain';
import type { Ranker } from '../spider/ai/types';
import type { WorkerEmbedder } from '../spider/ai/workerEmbedder';
import { SpiderPane } from '../spider/spiderPane';
import { SpiderRunner } from '../spider/spiderRunner';
import { buildTargetProfile, createPageLoader } from '../spider/world';
import type { ArticleStore } from '../wiki/articles';
import { ArticleNotFoundError, type WikiClient } from '../wiki/client';
import { wikipediaUrl } from '../wiki/titles';
import { errorMessage, formatTime, h } from './dom';
import { PlayerPane } from './playerPane';

export interface RaceScreenOptions {
  client: WikiClient;
  store: ArticleStore;
  /** Shared across races so that link embeddings stay cached. */
  ranker: Ranker;
  embedder: WorkerEmbedder;
  pair: ValidatedPair;
  difficulty: Difficulty;
  /** Back to the setup screen. */
  onExit: () => void;
  /** Same pair again. */
  onRematch: () => void;
}

export class RaceScreen {
  readonly element: HTMLElement;
  private readonly race: Race;
  private readonly player: PlayerPane;
  private readonly spider: SpiderPane;
  private runner: SpiderRunner | null = null;
  private readonly clockEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly giveUpBtn: HTMLButtonElement;
  private frame = 0;
  private started = false;
  private destroyed = false;
  private readonly unsubscribeBrain: () => void;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(private readonly options: RaceScreenOptions) {
    const { pair } = options;
    this.race = new Race(pair.start.title, pair.target.title);
    this.player = new PlayerPane({
      store: options.store,
      onMove: (title, via) => this.onMove('player', title, via),
    });
    this.spider = new SpiderPane({ difficulty: options.difficulty });
    this.unsubscribeBrain = options.embedder.onChange(() => this.updateBrainBadge());
    this.updateBrainBadge();

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
      h('div', { class: 'race-panes is-split' }, this.player.element, this.spider.element),
      this.overlay,
    );
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Loads the start article and the spider's knowledge, then counts down. */
  async begin(): Promise<void> {
    const { client, store, pair, ranker, difficulty } = this.options;
    this.spider.setStatus('Reading the target…');
    let profile;
    try {
      [, profile] = await Promise.all([this.player.showStart(this.race.startTitle), buildTargetProfile(client, pair.target)]);
    } catch (error) {
      this.player.view.showError(`Could not load the start article: ${errorMessage(error)}`, [
        { label: 'Retry', run: () => void this.begin() },
        { label: 'Back', run: () => this.options.onExit() },
      ]);
      return;
    }
    if (this.destroyed) return;

    const agent = new SpiderAgent(new SpiderBrain(profile, ranker), createPageLoader(store, client));
    this.runner = new SpiderRunner({
      pane: this.spider,
      agent,
      difficulty,
      isMissing: (error) => error instanceof ArticleNotFoundError,
      onMove: (title, via) => this.onMove('spider', title, via),
      onStuck: () => this.onSpiderStuck(),
    });
    this.spider.setStatus(`Ready · ${difficulty.label}`);

    await this.countdown();
    if (this.destroyed) return;
    this.started = true;
    this.race.clock.start();
    this.player.setEnabled(true);
    void this.runner.run(this.race.startTitle);
    this.tick();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.runner?.stop();
    this.spider.destroy();
    this.unsubscribeBrain();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private async countdown(): Promise<void> {
    this.overlay.hidden = false;
    for (const step of ['3', '2', '1', 'GO!']) {
      this.overlay.replaceChildren(h('div', { class: `countdown ${step === 'GO!' ? 'is-go' : ''}`, text: step }));
      await new Promise((resolve) => setTimeout(resolve, step === 'GO!' ? 450 : 700));
      if (this.destroyed) return;
    }
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private tick = (): void => {
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());
    if (!this.isOver()) this.frame = requestAnimationFrame(this.tick);
  };

  private isOver(): boolean {
    return this.race.winner !== null || this.race.player.retired;
  }

  private onMove(who: Racer, title: string, via: 'link' | 'back'): void {
    if (this.isOver()) return;
    const arrived = this.race.move(who, title, via);
    if (who === 'player') this.player.setHops(this.race.player.hops);
    else this.spider.setHops(this.race.spider.hops);
    if (arrived) this.finish();
  }

  private onSpiderStuck(): void {
    this.race.retire('spider');
  }

  private giveUp(): void {
    if (this.isOver()) return;
    this.race.retire('player');
    this.finish();
  }

  private handleVisibility(): void {
    if (!this.started || this.isOver()) return;
    if (document.hidden) {
      this.race.clock.pause();
      this.spider.pause();
    } else {
      this.race.clock.start();
      this.spider.resume();
    }
  }

  private updateBrainBadge(): void {
    const { embedder } = this.options;
    switch (embedder.status) {
      case 'loading':
        this.spider.setBrain(`AI ${Math.round(embedder.progress * 100)}%`, 'Loading the sentence-embedding model (all-MiniLM-L6-v2); using word matching meanwhile');
        break;
      case 'ready':
        this.spider.setBrain('AI · MiniLM', 'Ranking links by semantic similarity (all-MiniLM-L6-v2 in your browser)');
        break;
      case 'failed':
        this.spider.setBrain('AI · lexical', `The embedding model could not load (${embedder.error ?? 'unknown error'}); ranking links by word matching`);
        break;
      default:
        this.spider.setBrain('');
    }
  }

  private finish(): void {
    this.race.clock.pause();
    this.player.setEnabled(false);
    this.giveUpBtn.disabled = true;
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());
    if (this.race.winner !== 'spider') this.runner?.stop();
    this.spider.pause();

    const { player, spider, winner } = this.race;
    const title = winner === 'player' ? 'You win!' : winner === 'spider' ? 'The spider wins' : 'You gave up';
    this.overlay.hidden = false;
    this.overlay.replaceChildren(
      h(
        'div',
        { class: 'result-card panel' },
        h('h2', { class: 'result-title', text: title }),
        h(
          'p',
          { class: 'result-summary' },
          `You: ${player.hops} hops${player.finishedAt !== null ? ` in ${formatTime(player.finishedAt)}` : ''} · Spider: ${spider.hops} hops${spider.finishedAt !== null ? ` in ${formatTime(spider.finishedAt)}` : ''}`,
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
          h('button', { class: 'btn btn-primary', text: 'Rematch', on: { click: () => this.options.onRematch() } }),
          h('button', { class: 'btn btn-secondary', text: 'New race', on: { click: () => this.options.onExit() } }),
        ),
      ),
    );
  }
}
