/**
 * The race screen: HUD (target, timer), the player's pane on the left, the
 * spider's pane on the right, the pre-race checklist and countdown, and the
 * end card. It owns the race rules:
 *
 *  - the first racer to reach the target wins;
 *  - when the spider arrives first, the player's pane locks immediately and
 *    the end card shows after the spider's arrival animation;
 *  - after the race is decided, the loser may keep going (the player can
 *    finish their path, or watch the spider finish its own);
 *  - the race pauses while the browser tab is hidden.
 */
import type { Difficulty } from '../game/difficulty';
import type { ValidatedPair } from '../game/pairs';
import { Race, type Racer } from '../game/race';
import { SpiderAgent } from '../spider/ai/agent';
import { SpiderBrain } from '../spider/ai/brain';
import type { Decision, Ranker, TargetProfile } from '../spider/ai/types';
import type { WorkerEmbedder } from '../spider/ai/workerEmbedder';
import { SpiderPane } from '../spider/spiderPane';
import { SpiderRunner } from '../spider/spiderRunner';
import { buildTargetProfile, createPageLoader } from '../spider/world';
import type { ArticleStore } from '../wiki/articles';
import { ArticleNotFoundError, type WikiClient } from '../wiki/client';
import { errorMessage, formatTime, h } from './dom';
import { createEndCard } from './endScreen';
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
  /** Same pair and difficulty again. */
  onRematch: () => void;
}

/**
 * loading -> countdown -> racing -> (finishing: the spider plays its arrival)
 * -> intermission (end card, someone may continue) -> ... -> over
 */
type Phase = 'loading' | 'countdown' | 'racing' | 'finishing' | 'intermission' | 'over';

const BASE_TITLE = 'S.I.L.K: Spider Indexing Links & Knowledge';

/** How long to wait for the embedding model before starting anyway. */
const MODEL_GRACE_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RaceScreen {
  readonly element: HTMLElement;
  private readonly race: Race;
  private readonly player: PlayerPane;
  private readonly spider: SpiderPane;
  private runner: SpiderRunner | null = null;
  private readonly clockEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly giveUpBtn: HTMLButtonElement;
  private readonly panes: HTMLElement;
  private readonly tabs: Record<Racer, HTMLButtonElement>;
  private phase: Phase = 'loading';
  /** Whether the spider's animation should be running (ignoring tab visibility). */
  private spiderActive = false;
  private frame = 0;
  private destroyed = false;
  private readonly unsubscribeBrain: () => void;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(private readonly options: RaceScreenOptions) {
    const { pair, difficulty } = options;
    this.race = new Race(pair.start.title, pair.target.title);
    this.player = new PlayerPane({ store: options.store, onMove: (title, via) => this.onMove('player', title, via) });
    this.spider = new SpiderPane({ difficulty });
    this.unsubscribeBrain = options.embedder.onChange(() => this.updateBrainBadge());
    this.updateBrainBadge();

    this.clockEl = h('span', { class: 'hud-clock', text: formatTime(0), attrs: { role: 'timer', 'aria-label': 'Race time' } });
    this.noteEl = h('span', { class: 'hud-note', attrs: { 'aria-live': 'polite' } });
    this.giveUpBtn = h('button', {
      class: 'btn btn-danger btn-small',
      text: 'Give up',
      attrs: { type: 'button' },
      on: { click: () => this.giveUp() },
    });
    this.giveUpBtn.disabled = true;
    this.overlay = h('div', { class: 'race-overlay' });

    // Small screens show one pane at a time; these tabs switch between them.
    this.panes = h('div', { class: 'race-panes is-split', dataset: { show: 'player' } }, this.player.element, this.spider.element);
    const tab = (who: Racer, label: string) =>
      h('button', {
        class: `pane-tab is-${who}`,
        text: label,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(who === 'player') },
        on: { click: () => this.showPane(who) },
      });
    this.tabs = { player: tab('player', 'You'), spider: tab('spider', 'Spider') };

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
        h('div', { class: 'hud-center' }, this.clockEl, this.noteEl),
        h(
          'div',
          { class: 'hud-actions' },
          h('span', { class: `hud-difficulty is-${difficulty.id}`, text: difficulty.label, attrs: { title: difficulty.blurb } }),
          this.giveUpBtn,
        ),
      ),
      this.panes,
      h('nav', { class: 'pane-switch', attrs: { role: 'tablist', 'aria-label': 'Which article to show' } }, this.tabs.player, this.tabs.spider),
      this.overlay,
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    this.setTitle(`${pair.start.title} → ${pair.target.title}`);
  }

  // ------------------------------------------------------------ lifecycle

  /** Loads everything both racers need, counts down, and starts the race. */
  async begin(): Promise<void> {
    const { client, store, pair, ranker, difficulty, embedder } = this.options;
    const checklist = new Checklist(['Start article', 'Target backlinks', "Spider's brain"]);
    this.overlay.hidden = false;
    this.overlay.replaceChildren(checklist.element);

    let profile: TargetProfile;
    try {
      const start = this.player.showStart(this.race.startTitle).then(() => checklist.done(0, pair.start.title));
      const target = buildTargetProfile(client, pair.target).then((p) => {
        checklist.done(1, p.backlinks.size ? `${p.backlinks.size} pages link to it` : 'unavailable, similarity only');
        return p;
      });
      [, profile] = await Promise.all([start, target]);
    } catch (error) {
      checklist.fail(0, errorMessage(error));
      this.overlay.replaceChildren(
        h(
          'div',
          { class: 'pane-message pane-error' },
          h('p', { text: `Could not load the start article: ${errorMessage(error)}` }),
          h(
            'div',
            { class: 'pane-actions' },
            h('button', { class: 'btn btn-small', text: 'Retry', on: { click: () => void this.begin() } }),
            h('button', { class: 'btn btn-secondary btn-small', text: 'Back', on: { click: () => this.options.onExit() } }),
          ),
        ),
      );
      return;
    }
    if (this.destroyed) return;

    // The model has been loading since the game opened; give it a moment.
    if (embedder.status === 'loading' || embedder.status === 'idle') {
      const progress = () => checklist.pending(2, `loading model ${Math.round(embedder.progress * 100)}%`);
      progress();
      const stop = embedder.onChange(progress);
      await Promise.race([embedder.load().catch(() => {}), sleep(MODEL_GRACE_MS)]);
      stop();
    }
    checklist.done(2, embedder.status === 'ready' ? 'semantic ranking (MiniLM)' : embedder.status === 'failed' ? 'word matching (model unavailable)' : 'word matching until the model is ready');

    const agent = new SpiderAgent(new SpiderBrain(profile, ranker), createPageLoader(store, client));
    const runner = new SpiderRunner({
      pane: this.spider,
      agent,
      difficulty,
      isMissing: (error) => error instanceof ArticleNotFoundError,
      onMove: (title, via, reason) => this.onMove('spider', title, via, reason),
      onArrive: () => this.onSpiderCelebrated(),
      onStuck: () => this.onSpiderStuck(),
    });
    this.runner = runner;
    this.spiderActive = true;
    // The spider's copy of the start page streams in behind the countdown.
    const prepared = runner.prepare(this.race.startTitle).catch(() => {});
    await this.countdown();
    await prepared;
    if (this.destroyed) return;

    this.phase = 'racing';
    this.race.clock.start();
    this.player.setEnabled(true);
    this.giveUpBtn.disabled = false;
    void runner.run(this.race.startTitle);
    this.tick();
  }

  destroy(): void {
    this.destroyed = true;
    document.title = BASE_TITLE;
    cancelAnimationFrame(this.frame);
    this.runner?.stop();
    this.spider.destroy();
    this.unsubscribeBrain();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private async countdown(): Promise<void> {
    this.phase = 'countdown';
    this.overlay.hidden = false;
    for (const step of ['3', '2', '1', 'GO!']) {
      this.overlay.replaceChildren(h('div', { class: `countdown ${step === 'GO!' ? 'is-go' : ''}`, text: step }));
      await sleep(step === 'GO!' ? 450 : 750);
      if (this.destroyed) return;
    }
    this.hideOverlay();
  }

  private tick = (): void => {
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());
    if (this.phase === 'racing') this.frame = requestAnimationFrame(this.tick);
  };

  // ---------------------------------------------------------------- rules

  private onMove(who: Racer, title: string, via: 'link' | 'back', reason?: Decision['reason']): void {
    if (this.phase !== 'racing') return;
    const arrived = this.race.move(who, title, via, who === 'spider' ? reason : undefined);
    if (who === 'player') this.player.setHops(this.race.player.hops);
    else {
      this.spider.setHops(this.race.spider.hops);
      this.tabs.spider.textContent = `Spider · ${this.race.spider.hops}`;
    }
    if (!arrived) return;

    if (who === 'player') {
      this.freeze();
      this.showEnd();
      return;
    }
    // The spider is on the target: nobody else may move while it celebrates.
    this.phase = 'finishing';
    this.player.setEnabled(false);
    this.giveUpBtn.disabled = true;
    this.race.clock.pause();
    this.note(this.race.winner === 'spider' ? 'The spider reached the target!' : '');
  }

  /** Runs once the spider finished its arrival animation on the target. */
  private onSpiderCelebrated(): void {
    this.spiderActive = false;
    this.spider.pause();
    this.showEnd();
  }

  private onSpiderStuck(): void {
    this.race.retire('spider');
    this.spiderActive = false;
    this.note('The spider gave up!');
    if (this.race.over || this.race.isDone('player')) {
      this.race.clock.pause();
      this.showEnd();
    }
  }

  private giveUp(): void {
    if (this.phase !== 'racing' || this.race.isDone('player')) return;
    this.race.retire('player');
    this.freeze();
    this.showEnd();
  }

  /** Stops everything (clock, player, spider) while the end card is shown. */
  private freeze(): void {
    this.player.setEnabled(false);
    this.race.clock.pause();
    this.spider.pause();
  }

  private showEnd(): void {
    this.phase = this.race.over ? 'over' : 'intermission';
    const winner = this.race.winner;
    this.setTitle(winner === 'player' ? 'You win!' : winner === 'spider' ? 'The spider wins' : 'Race over');
    this.giveUpBtn.disabled = true;
    this.clockEl.textContent = formatTime(this.race.clock.elapsed());
    const canKeepPlaying = this.race.winner === 'spider' && !this.race.isDone('player');
    const canWatchSpider = !this.race.isDone('spider') && this.runner !== null;
    this.overlay.hidden = false;
    this.overlay.replaceChildren(
      createEndCard({
        race: this.race,
        difficulty: this.options.difficulty,
        onRematch: () => this.options.onRematch(),
        onNewRace: () => this.options.onExit(),
        onKeepPlaying: canKeepPlaying ? () => this.keepPlaying() : undefined,
        onWatchSpider: canWatchSpider ? () => this.watchSpider() : undefined,
      }),
    );
    this.overlay.querySelector<HTMLElement>('.end-actions .btn')?.focus();
  }

  /** After losing, the player may still finish their own path. */
  private keepPlaying(): void {
    this.hideOverlay();
    this.phase = 'racing';
    this.note('Overtime: finish your path');
    this.race.clock.start();
    this.player.setEnabled(true);
    this.giveUpBtn.disabled = false;
    this.tick();
  }

  /** After winning or giving up, watch the spider finish its path. */
  private watchSpider(): void {
    this.hideOverlay();
    this.phase = 'racing';
    this.note('Watching the spider…');
    this.race.clock.start();
    this.spiderActive = true;
    if (!document.hidden) this.spider.resume();
    this.tick();
  }

  private handleVisibility(): void {
    const animating = this.phase === 'racing' || this.phase === 'finishing';
    if (!animating) return;
    if (document.hidden) {
      this.race.clock.pause();
      this.spider.pause();
      return;
    }
    if (this.phase === 'racing') {
      this.race.clock.start();
      this.tick();
    }
    if (this.spiderActive) this.spider.resume();
  }

  // ------------------------------------------------------------------- UI

  private showPane(who: Racer): void {
    this.panes.dataset.show = who;
    for (const [racer, button] of Object.entries(this.tabs)) button.setAttribute('aria-selected', String(racer === who));
  }

  private hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private setTitle(text: string): void {
    document.title = `${text} · S.I.L.K`;
  }

  private note(text: string): void {
    this.noteEl.textContent = text;
  }

  private updateBrainBadge(): void {
    const { embedder } = this.options;
    switch (embedder.status) {
      case 'loading':
        this.spider.setBrain(`AI ${Math.round(embedder.progress * 100)}%`, 'Loading the sentence-embedding model (all-MiniLM-L6-v2); word matching meanwhile');
        break;
      case 'ready':
        this.spider.setBrain('AI · MiniLM', 'Ranking links by semantic similarity (all-MiniLM-L6-v2, in your browser)');
        break;
      case 'failed':
        this.spider.setBrain('AI · words', `The embedding model could not load (${embedder.error ?? 'unknown error'}); ranking links by word matching`);
        break;
      default:
        this.spider.setBrain('');
    }
  }
}

/** Pre-race loading card: a checklist of what each racer needs. */
class Checklist {
  readonly element: HTMLElement;
  private readonly rows: HTMLElement[];

  constructor(labels: string[]) {
    this.rows = labels.map((label) =>
      h('li', { class: 'check is-pending' }, h('span', { class: 'check-mark' }), h('span', { class: 'check-label', text: label }), h('span', { class: 'check-detail', text: 'loading…' })),
    );
    this.element = h(
      'div',
      { class: 'checklist panel', attrs: { role: 'status' } },
      h('p', { class: 'label', text: 'Preparing the race' }),
      h('ul', {}, ...this.rows),
    );
  }

  pending(index: number, detail: string): void {
    this.set(index, 'is-pending', detail);
  }

  done(index: number, detail: string): void {
    this.set(index, 'is-done', detail);
  }

  fail(index: number, detail: string): void {
    this.set(index, 'is-failed', detail);
  }

  private set(index: number, state: string, detail: string): void {
    const row = this.rows[index];
    row.className = `check ${state}`;
    row.querySelector('.check-detail')!.textContent = detail;
  }
}
