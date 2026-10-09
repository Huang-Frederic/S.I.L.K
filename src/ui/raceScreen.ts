/**
 * The race screen (mockup "Race mid-game"): a HUD with the target, the clock
 * and the difficulty, two role-agnostic panes (amber for the player, red for
 * the spider) and the stage, a full-window canvas on top of everything where
 * the spider crawls, leaps between panes and attacks.
 *
 * Rules:
 *  - the first racer on the target wins;
 *  - a fake link (Hard) leads nowhere: clicking it lets out mini-spiders
 *    that eat the player's links;
 *  - a link snatch (Hard, at most once a race) answers a click that would
 *    put the player ahead: the spider leaps across, eats that link, dives in,
 *    and the panes swap owners: the player carries on from the spider's
 *    former page;
 *  - when the spider wins it walks to the middle of the screen, eats the
 *    YOU badge and dances; when the player wins it collapses;
 *  - the race pauses while the browser tab is hidden.
 */
import { Director } from '../attacks/director';
import { type AttackContext } from '../attacks/context';
import { releaseMinis } from '../attacks/minions';
import { SpeechBubble } from '../fx/bubble';
import { AMBER, Fragments, RED, strokeBox } from '../fx/fx';
import { TauntPicker, type TauntEvent } from '../game/comedy';
import { RAGE, type Difficulty } from '../game/difficulty';
import type { ValidatedPair } from '../game/pairs';
import { Race } from '../game/race';
import { linkCloseness, maySnatch, pageCloseness, type Lookup } from '../game/snatch';
import { settings } from '../settings';
import { SpiderActor } from '../spider/actor';
import { SpiderAgent } from '../spider/ai/agent';
import { SpiderBrain } from '../spider/ai/brain';
import type { Decision, Ranker, TargetProfile } from '../spider/ai/types';
import type { WorkerEmbedder } from '../spider/ai/workerEmbedder';
import { SpiderRunner, type SnatchTarget } from '../spider/runner';
import { buildTargetProfile, createPageLoader, linksOfBody, type SpiderArticlePage } from '../spider/world';
import { VirtualCursor } from '../stage/cursor';
import { RacerPane, type BrainRow } from '../stage/racerPane';
import { Stage, Z } from '../stage/stage';
import type { ArticleStore, LoadedArticle } from '../wiki/articles';
import { ArticleNotFoundError, type WikiClient } from '../wiki/client';
import { errorMessage, formatClock, h } from './dom';
import { icon } from './icons';
import { logoMark } from './logo';

export interface RaceResult {
  race: Race;
  difficulty: Difficulty;
  pair: ValidatedPair;
  wordsEaten: number;
  /** The spider's page links to the target (it was one link away). */
  spiderOneAway: boolean;
  gaveUp: boolean;
  /** Fake links the player clicked. */
  decoysClicked: number;
  /** The spider stole one of the player's links. */
  snatched: boolean;
  /** Hard wins in this browser, after this race. */
  hardWins: number;
}

export interface RaceScreenOptions {
  client: WikiClient;
  store: ArticleStore;
  /** Shared across races so that link embeddings stay cached. */
  ranker: Ranker;
  embedder: WorkerEmbedder;
  pair: ValidatedPair;
  difficulty: Difficulty;
  /** Back to the title screen (loading failed). */
  onExit: () => void;
  onFinish: (result: RaceResult) => void;
}

/** loading -> countdown -> racing -> finishing -> over */
type Phase = 'loading' | 'countdown' | 'racing' | 'finishing' | 'over';

const BASE_TITLE = 'S.I.L.K: Spider Indexing Links & Knowledge';
/** How long to wait for the embedding model before starting anyway. */
const MODEL_GRACE_MS = 8000;
/** The player gets teased after this long without a move (s). */
const SLOW_PLAYER = 22;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RaceScreen {
  readonly element: HTMLElement;
  private readonly race: Race;
  private readonly panes: [RacerPane, RacerPane];
  private readonly stage: Stage;
  private readonly fragments = new Fragments();
  private readonly cursor: VirtualCursor;
  private readonly actor: SpiderActor;
  private readonly bubble: SpeechBubble;
  private readonly taunts: TauntPicker;
  private readonly clockEl: HTMLElement;
  private readonly giveUpBtn: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly liveEl: HTMLElement;
  private runner: SpiderRunner | null = null;
  private director: Director | null = null;
  private agent: SpiderAgent<SpiderArticlePage> | null = null;
  private profile: TargetProfile | null = null;
  private attackCtx: AttackContext | null = null;
  private phase: Phase = 'loading';
  private destroyed = false;
  private gaveUp = false;
  private decoysClicked = 0;
  /** Link snatches so far, and the race time of the last one (s). */
  private snatches = 0;
  private lastSnatchAt: number | null = null;
  /** The player's pages, for the back button. */
  private history: string[] = [];
  private navToken = 0;
  private navBusy = false;
  private lastPlayerMove = 0;
  private playerNearTarget = false;
  private brain: { head: string; rows: BrainRow[] } = { head: '', rows: [] };
  private clockText = '';
  /** Link under the cursor, and since when (prefetch after a short hover). */
  private hovered: { anchor: HTMLAnchorElement; since: number; fetched: boolean } | null = null;
  private readonly removeFrameHook: () => void;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onVisibility = () => this.handleVisibility();
  private readonly onClickCapture = (event: MouseEvent) => this.retargetClick(event);

  constructor(private readonly options: RaceScreenOptions) {
    const { pair, difficulty } = options;
    this.race = new Race(pair.start.title, pair.target.title);
    this.panes = [new RacerPane('player', 'left'), new RacerPane('spider', 'right')];
    for (const pane of this.panes) {
      pane.onLinkClick = (title, anchor) => this.onLinkClick(pane, title, anchor);
      pane.onBack = () => this.goBack();
      // Touch has no hover: start loading on touch down, the click follows.
      pane.scroller.addEventListener(
        'pointerdown',
        (event) => {
          const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a.wiki-link');
          if (anchor && pane.owner === 'player' && this.phase === 'racing') this.prefetch(anchor);
        },
        { passive: true },
      );
    }

    this.clockEl = h('span', { class: 'hud-clock', text: '00:00', attrs: { role: 'timer', 'aria-label': 'Race time' } });
    this.giveUpBtn = h('button', { class: 'btn btn-ghost hud-giveup', text: 'Give up', attrs: { type: 'button' }, on: { click: () => this.giveUp() } });
    this.giveUpBtn.disabled = true;
    this.overlay = h('div', { class: 'race-overlay' });
    this.liveEl = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });

    this.element = h(
      'main',
      { class: `screen screen-race is-${difficulty.id}` },
      h(
        'header',
        { class: 'race-hud' },
        logoMark('logo-small'),
        h(
          'div',
          { class: 'hud-target', attrs: { title: pair.target.extract || pair.target.title } },
          icon('flag', 20),
          h('span', { class: 'hud-target-label', text: 'Target' }),
          h('strong', { class: 'hud-target-title', text: pair.target.title }),
        ),
        h(
          'div',
          { class: 'hud-right' },
          this.clockEl,
          h('span', { class: `hud-difficulty is-${difficulty.id}`, text: difficulty.label, attrs: { title: difficulty.blurb } }),
          this.giveUpBtn,
        ),
      ),
      h('div', { class: 'race-panes' }, this.panes[0].element, this.panes[1].element),
      this.overlay,
      this.liveEl,
    );

    // The stage: one canvas over the whole screen.
    this.stage = new Stage(this.element);
    this.cursor = new VirtualCursor(this.stage);
    this.stage.add(this.cursor);
    this.stage.add(this.fragments);
    this.actor = new SpiderActor(this.stage, this.fragments, () => this.speeds());
    this.actor.onEat = (n) => this.spiderPane.setWordsEaten(n);
    this.actor.rig.rage = difficulty.rage === 'always';
    this.bubble = new SpeechBubble(
      () => (this.actor.visible ? this.actor.eyeOnStage() : null),
      () => ({ left: 0, top: 0, right: this.stage.width, bottom: this.stage.height }),
    );
    this.stage.add(this.bubble);
    this.taunts = new TauntPicker(difficulty.taunts);
    this.stage.add({ z: Z.links, draw: (ctx) => this.drawHover(ctx) });
    this.removeFrameHook = this.stage.onFrame(() => this.beforeFrame());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) this.panes.find((p) => p.scroller === entry.target)?.words.relayout();
      });
      for (const pane of this.panes) this.resizeObserver.observe(pane.scroller);
    }

    this.updateHeaders();
    this.spiderPane.setWordsEaten(0);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.element.addEventListener('click', this.onClickCapture, true);
    this.setTitle(`${pair.start.title} → ${pair.target.title}`);
  }

  // ------------------------------------------------------------- accessors

  private get playerPane(): RacerPane {
    return this.panes.find((p) => p.owner === 'player')!;
  }

  private get spiderPane(): RacerPane {
    return this.panes.find((p) => p.owner === 'spider')!;
  }

  private get rage(): boolean {
    const rule = this.options.difficulty.rage;
    return rule === 'always' || (rule === 'near-target' && this.playerNearTarget);
  }

  private speeds() {
    const d = this.options.difficulty;
    const k = this.rage ? RAGE.speed : 1;
    return {
      walk: d.walkSpeed * k,
      sprint: d.sprint,
      zip: d.zipSpeed * k,
      zipBeyond: d.zipBeyond,
      mischief: d.mischief,
      crush: d.crush,
      pace: d.id === 'hard' ? 1.8 : d.id === 'normal' ? 1.15 : 1,
    };
  }

  private isTarget(title: string): boolean {
    return title === this.race.targetTitle || (this.profile?.aliases.has(title) ?? false);
  }

  // ------------------------------------------------------------ lifecycle

  /** Loads everything both racers need, counts down, and starts the race. */
  async begin(): Promise<void> {
    const { client, store, pair, ranker, difficulty, embedder } = this.options;
    const checklist = new Checklist(['Start article', 'Target backlinks', "Spider's brain"]);
    this.showOverlay(checklist.element);

    try {
      const start = store.load(this.race.startTitle, { priority: true }).then((loaded) => {
        this.playerPane.showArticle(loaded);
        this.history = [loaded.title];
        this.updatePlayerNear(loaded);
        checklist.done(0, pair.start.title);
      });
      const target = buildTargetProfile(client, pair.target).then((p) => {
        checklist.done(1, p.backlinks.size ? `${p.backlinks.size} pages link to it` : 'unavailable, similarity only');
        return p;
      });
      [, this.profile] = await Promise.all([start, target]);
    } catch (error) {
      checklist.fail(0, errorMessage(error));
      this.showOverlay(
        h(
          'div',
          { class: 'panel overlay-card is-error' },
          h('p', { text: `Could not load the start article: ${errorMessage(error)}` }),
          h(
            'div',
            { class: 'overlay-actions' },
            h('button', { class: 'btn btn-primary', text: 'Retry', on: { click: () => void this.begin() } }),
            h('button', { class: 'btn btn-ghost', text: 'Back', on: { click: () => this.options.onExit() } }),
          ),
        ),
      );
      return;
    }
    if (this.destroyed) return;
    this.updatePlayerNear(this.playerPane.view.article);

    // The model has been loading since the game opened; give it a moment.
    if (embedder.status === 'loading' || embedder.status === 'idle') {
      const progress = () => checklist.pending(2, `loading model ${Math.round(embedder.progress * 100)}%`);
      progress();
      const stop = embedder.onChange(progress);
      await Promise.race([embedder.load().catch(() => {}), sleep(MODEL_GRACE_MS)]);
      stop();
    }
    checklist.done(2, embedder.status === 'ready' ? 'semantic ranking (MiniLM)' : embedder.status === 'failed' ? 'word matching (model unavailable)' : 'word matching until the model is ready');

    const profile = this.profile!;
    const agent = new SpiderAgent(new SpiderBrain(profile, ranker), createPageLoader(store, client));
    this.agent = agent;
    const runner = new SpiderRunner({
      actor: this.actor,
      agent,
      pane: () => this.spiderPane,
      thinkMs: () => difficulty.thinkMs * (this.rage ? RAGE.think : 1),
      scoreSeconds: difficulty.id === 'easy' ? 1.1 : 0.7,
      grabSeconds: difficulty.id === 'easy' ? 0.9 : difficulty.id === 'normal' ? 0.6 : 0.3,
      isMissing: (error) => error instanceof ArticleNotFoundError,
      onDecision: (decision, page) => this.showBrain(decision, page),
      onMove: (title, via, note) => this.onSpiderMove(title, via, note),
      onSwap: (target, formerTitle) => this.swapPanes(target, formerTitle),
      onSnatchStart: () => this.cancelNavigation(),
      onSnatch: (target) => this.say(this.isTarget(target.title) ? 'snatch-target' : 'snatch'),
      onArrive: () => void this.spiderWins(),
      onStuck: () => this.onSpiderStuck(),
    });
    this.runner = runner;
    const ctx: AttackContext = {
      stage: this.stage,
      actor: this.actor,
      cursor: this.cursor,
      fragments: this.fragments,
      difficulty,
      playerPane: () => this.playerPane,
      targetTitle: this.race.targetTitle,
      isTarget: (title) => this.isTarget(title),
      say: (event) => this.say(event),
    };
    this.attackCtx = ctx;
    this.director = new Director(ctx, runner, {
      active: () => this.phase === 'racing',
      rage: () => this.rage,
    });

    // The spider's copy of the start page loads behind the countdown.
    const prepared = runner.prepare(this.race.startTitle).catch(() => {});
    await this.countdown();
    await prepared;
    if (this.destroyed) return;

    this.phase = 'racing';
    this.race.clock.start();
    this.giveUpBtn.disabled = false;
    this.lastPlayerMove = this.stage.time;
    this.updateHeaders();
    void runner.run();
    void this.director.run();
    setTimeout(() => this.say('start'), 1200);
  }

  destroy(): void {
    this.destroyed = true;
    document.title = BASE_TITLE;
    this.director?.stop();
    void this.runner?.stop();
    this.cursor.release();
    this.removeFrameHook();
    this.resizeObserver?.disconnect();
    this.actor.destroy();
    this.stage.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.element.removeEventListener('click', this.onClickCapture, true);
  }

  private async countdown(): Promise<void> {
    this.phase = 'countdown';
    for (const step of ['3', '2', '1', 'GO']) {
      this.showOverlay(h('div', { class: `countdown ${step === 'GO' ? 'is-go' : ''}`, text: step }));
      await sleep(settings.duration(step === 'GO' ? 0.45 : 0.7) * 1000);
      if (this.destroyed) return;
    }
    this.hideOverlay();
  }

  // ------------------------------------------------------------ per frame

  private beforeFrame(): void {
    const root = this.stage.rootRect;
    for (const pane of this.panes) {
      pane.measure(root);
      pane.expireDamage(this.stage.time);
    }
    const shown = formatClock(this.race.clock.elapsed());
    if (shown !== this.clockText) {
      this.clockText = shown;
      this.clockEl.textContent = shown;
    }
    this.actor.rig.rage = this.rage && this.phase !== 'over';
    if (this.phase === 'racing' && this.stage.time - this.lastPlayerMove > SLOW_PLAYER) {
      this.lastPlayerMove = this.stage.time;
      this.say('player-slow');
    }
  }

  /** Amber dashed box and "hop N → Title" under the (possibly dragged) cursor. */
  private drawHover(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'racing' || this.navBusy) return;
    const cursor = this.cursor;
    if (!cursor.available && !cursor.harassed) return;
    const pane = this.playerPane;
    const p = cursor.position;
    if (!pane.containsStage(p)) return;
    const root = this.stage.rootRect;
    const el = document.elementFromPoint(p.x + root.left, p.y + root.top);
    const anchor = el?.closest<HTMLAnchorElement>('a.wiki-link');
    if (!anchor || !pane.scroller.contains(anchor)) {
      this.hovered = null;
      return;
    }
    this.prefetchHovered(anchor);
    const box = pane.boxToStage(pane.linkBox(anchor));
    const usable = pane.usable(anchor);
    strokeBox(ctx, box, usable ? AMBER : RED, { dash: [3, 3], pad: 3 });
    const label = usable ? `hop ${this.race.player.hops + 1} → ${anchor.dataset.title ?? anchor.textContent ?? ''}` : `blocked · ${pane.damageOf(anchor)}`;
    ctx.font = '500 13px "JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
    const w = ctx.measureText(label).width + 22;
    const x = Math.min(Math.max(pane.rect.left + 4, box.left), pane.rect.right - w - 4);
    const y = box.bottom + 8 + 34 > pane.rect.bottom ? box.top - 8 - 34 : box.bottom + 8;
    ctx.fillStyle = '#0B0E12';
    ctx.fillRect(x, y, w, 34);
    ctx.strokeStyle = usable ? AMBER : RED;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 33);
    ctx.fillStyle = '#F0F4F8';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 11, y + 17.5);
  }

  /**
   * Starts loading the article behind a link once the cursor has rested on
   * it briefly, so that the click itself feels instant. Decoys are skipped:
   * they lead nowhere.
   */
  private prefetchHovered(anchor: HTMLAnchorElement): void {
    if (this.hovered?.anchor !== anchor) {
      this.hovered = { anchor, since: this.stage.time, fetched: false };
      return;
    }
    if (this.hovered.fetched || this.stage.time - this.hovered.since < 0.08) return;
    this.hovered.fetched = true;
    this.prefetch(anchor);
  }

  private prefetch(anchor: HTMLAnchorElement): void {
    const title = anchor.dataset.title;
    if (!title || anchor.dataset.decoy || !this.playerPane.usable(anchor)) return;
    this.options.store.load(title, { priority: true }).catch(() => {});
  }

  /** While the cursor is dragged, clicks land where the dragged cursor is. */
  private retargetClick(event: MouseEvent): void {
    if (!this.cursor.harassed || !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    const p = this.cursor.position;
    const root = this.stage.rootRect;
    const el = document.elementFromPoint(p.x + root.left, p.y + root.top);
    const pane = this.playerPane;
    const anchor = el?.closest<HTMLAnchorElement>('a.wiki-link');
    if (anchor && pane.scroller.contains(anchor)) {
      this.onLinkClick(pane, anchor.dataset.title ?? '', anchor);
      return;
    }
    const button = el?.closest('button');
    if (button && this.element.contains(button)) button.click();
  }

  // --------------------------------------------------------------- player

  private onLinkClick(pane: RacerPane, title: string, anchor: HTMLAnchorElement): void {
    if (pane.owner !== 'player' || this.phase !== 'racing' || !title) return;
    // Mid-snatch, the spider owns the moment.
    if (this.runner?.snatching) return;
    if (!pane.usable(anchor)) {
      this.say('blocked-click');
      return;
    }
    if (anchor.dataset.decoy) {
      this.clickDecoy(pane, anchor);
      return;
    }
    if (!this.navBusy && this.trySnatch(pane, title, anchor)) return;
    void this.navigate(title, 'link');
  }

  /**
   * Hard: the spider may steal the link the player just clicked, when that
   * link would put the player ahead (rules in game/snatch.ts).
   */
  private trySnatch(pane: RacerPane, title: string, anchor: HTMLAnchorElement): boolean {
    const rule = this.options.difficulty.snatch;
    const { runner, agent, profile } = this;
    if (!rule || !runner?.canSnatch || !agent || !profile) return false;
    const lookup: Lookup = { isTarget: (t) => this.isTarget(t), isBridge: (t) => profile.backlinks.has(t) };
    const now = this.race.clock.elapsed() / 1000;
    const allowed = maySnatch(rule, {
      now,
      playerLinks: this.race.player.path.filter((step) => step.via === 'link').length,
      done: this.snatches,
      lastAt: this.lastSnatchAt,
      link: linkCloseness(title, lookup),
      spider: pageCloseness(agent.page.links, lookup),
      visited: agent.brain.hasVisited(title),
    });
    if (!allowed || !runner.requestSnatch({ pane, anchor, title })) return false;
    this.snatches++;
    this.lastSnatchAt = now;
    return true;
  }

  /** Forgets the player's pending click (the spider is stealing it). */
  private cancelNavigation(): void {
    this.navToken++;
    this.navBusy = false;
    this.playerPane.view.clearOverlay();
    this.updateHeaders();
  }

  private goBack(): void {
    if (this.history.length < 2) return;
    void this.navigate(this.history[this.history.length - 2], 'back');
  }

  private async navigate(title: string, via: 'link' | 'back'): Promise<void> {
    if (this.phase !== 'racing' || this.navBusy || this.race.isDone('player') || this.runner?.snatching) return;
    const pane = this.playerPane;
    const token = ++this.navToken;
    this.navBusy = true;
    this.updateHeaders();
    pane.view.showLoading(`Loading “${title}”…`);
    const slow = setTimeout(() => token === this.navToken && pane.view.showLoading(`Still loading “${title}”… Wikipedia may be busy, retrying.`), 4000);
    try {
      const loaded = await this.options.store.load(title, { priority: true });
      if (token !== this.navToken) return;
      if (this.phase !== 'racing' || pane.owner !== 'player') {
        pane.view.clearOverlay();
        return;
      }
      pane.showArticle(loaded);
      if (via === 'back') this.history.pop();
      else this.history.push(loaded.title);
      this.onPlayerMove(loaded, via);
    } catch (error) {
      if (token !== this.navToken) return;
      const message =
        error instanceof ArticleNotFoundError
          ? `“${title}” does not exist on Wikipedia (it may have been deleted). Pick another link.`
          : `Could not load “${title}”: ${errorMessage(error)}`;
      pane.view.showError(message, [
        { label: 'Retry', run: () => (pane.view.clearOverlay(), void this.navigate(title, via)) },
        { label: 'Dismiss', run: () => pane.view.clearOverlay() },
      ]);
    } finally {
      clearTimeout(slow);
      if (token === this.navToken) this.navBusy = false;
      this.updateHeaders();
    }
  }

  private onPlayerMove(loaded: LoadedArticle, via: 'link' | 'back'): void {
    this.lastPlayerMove = this.stage.time;
    const arrived = this.race.move('player', loaded.title, via);
    this.updateHeaders();
    if (arrived) {
      if (this.race.winner === 'player') void this.playerWins();
      return;
    }
    this.updatePlayerNear(loaded);
    if (this.playerNearTarget) this.say('player-near-target');
    else if (Math.random() < 0.3) this.say('player-hop');
  }

  /** Rage trigger on Normal: the player's page links to the target. */
  private updatePlayerNear(loaded: LoadedArticle | null): void {
    this.playerNearTarget = !!loaded && linksOfBody(loaded.article.body).some((l) => this.isTarget(l.title));
  }

  /** A fake link bursts open and lets out mini-spiders (no time lost, but they eat links). */
  private clickDecoy(pane: RacerPane, decoy: HTMLAnchorElement): void {
    const box = pane.linkBox(decoy);
    const at = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    this.fragments.burst(pane.toStage(at), { count: 30, colors: [RED, '#88A3E8', '#F0F4F8'], speed: [40, 160], life: [0.3, 0.6], gravity: 160 });
    decoy.replaceWith(document.createTextNode(''));
    pane.words.relayout();
    this.decoysClicked++;
    if (this.attackCtx) releaseMinis(this.attackCtx, pane, at, this.options.difficulty.decoyMinis);
    this.stage.shake(3);
    this.say('decoy-clicked');
    this.announce('Fake link! Mini-spiders are going for your links.');
  }

  private giveUp(): void {
    if (this.phase !== 'racing' || this.race.isDone('player')) return;
    this.gaveUp = true;
    this.race.retire('player');
    this.say('give-up', true);
    void this.spiderWins();
  }

  // --------------------------------------------------------------- spider

  private onSpiderMove(title: string, via: 'link' | 'back', note?: string): void {
    const arrived = this.race.move('spider', title, via, note);
    this.updateHeaders();
    if (arrived && this.race.winner === 'spider') {
      // Nobody else moves while it celebrates.
      this.phase = 'finishing';
      this.navToken++;
      this.navBusy = false;
      this.playerPane.view.clearOverlay();
      this.race.clock.pause();
      this.director?.stop(true);
      this.giveUpBtn.disabled = true;
    } else if (Math.random() < 0.25) {
      this.say('hop');
    }
  }

  private showBrain(decision: Decision, page: SpiderArticlePage): void {
    const method = this.options.embedder.status === 'ready' ? '' : ' · word matching';
    const head = `SPIDER.BRAIN · ${page.links.length} links scored · target = "${this.race.targetTitle}"${method}`;
    const rows: BrainRow[] = decision.shortlist.slice(0, 3).map(({ link, score }) => ({
      title: link.title,
      score,
      tag: this.isTarget(link.title) ? 'target ✓' : this.profile?.backlinks.has(link.title) ? 'backlink ✓' : undefined,
    }));
    this.brain = { head, rows };
    this.spiderPane.setBrain(head, rows);
  }

  /** The spider took the player's pane: owners swap, the player gets the spider's old page. */
  private swapPanes(target: SnatchTarget, formerTitle: string): void {
    const stolen = target.pane;
    const other = this.panes.find((p) => p !== stolen)!;
    this.navToken++;
    this.navBusy = false;
    stolen.view.clearOverlay();
    stolen.setOwner('spider');
    other.setOwner('player');
    this.race.teleport('player', formerTitle, 'swap');
    this.history.push(formerTitle);
    this.updatePlayerNear(other.view.article);
    for (const pane of this.panes) {
      pane.element.classList.remove('is-swapped');
      void pane.element.offsetWidth;
      pane.element.classList.add('is-swapped');
    }
    this.spiderPane.setBrain(this.brain.head, this.brain.rows);
    this.spiderPane.setWordsEaten(this.actor.wordsEaten);
    this.announce('The spider stole your link. The panes swapped: you continue from its page.');
    this.updateHeaders();
  }

  private onSpiderStuck(): void {
    this.race.retire('spider');
    this.director?.stop(true);
    this.say('spider-loses', true);
    this.announce('The spider gave up.');
  }

  // -------------------------------------------------------------- endings

  private async playerWins(): Promise<void> {
    if (this.phase === 'finishing' || this.phase === 'over') return;
    this.phase = 'finishing';
    this.race.clock.pause();
    this.giveUpBtn.disabled = true;
    this.director?.stop(true);
    const hard = this.options.difficulty.id === 'hard';
    if (hard) settings.recordHardWin();
    await this.runner?.stop();
    this.say('spider-loses', true);
    try {
      await this.actor.collapse(hard);
      await this.stage.wait(hard ? 1.1 : 0.7);
    } catch {
      return; // screen closed
    }
    this.finish();
  }

  /** The spider walks to the middle of the screen, eats the YOU badge and dances. */
  private async spiderWins(): Promise<void> {
    if (this.phase === 'over' || (this.phase === 'finishing' && this.race.winner !== 'spider' && !this.gaveUp)) return;
    this.phase = 'finishing';
    this.race.clock.pause();
    this.giveUpBtn.disabled = true;
    this.director?.stop(true);
    if (this.gaveUp) await this.runner?.stop();
    const badge = this.playerPane.badgeElement;
    try {
      await this.actor.walkOnStage({ x: this.stage.width / 2, y: this.stage.height * 0.52 }, settings.reduceMotion ? 900 : 520);
      await this.actor.reelIn(badge, 'YOU', AMBER);
      this.say(this.gaveUp ? 'give-up' : 'spider-wins', true);
      await this.actor.dance(settings.reduceMotion ? 1.4 : 2.6);
    } catch {
      return; // screen closed
    }
    this.finish();
  }

  private finish(): void {
    if (this.phase === 'over' || this.destroyed) return;
    this.phase = 'over';
    const agent = this.agent;
    const spiderOneAway = !!agent && agent.trail.length > 0 && agent.page.links.some((l) => this.isTarget(l.title) || this.isTarget(l.linkedTitle));
    this.options.onFinish({
      race: this.race,
      difficulty: this.options.difficulty,
      pair: this.options.pair,
      wordsEaten: this.actor.wordsEaten,
      spiderOneAway,
      gaveUp: this.gaveUp,
      decoysClicked: this.decoysClicked,
      snatched: this.snatches > 0,
      hardWins: settings.hardWins,
    });
  }

  private handleVisibility(): void {
    const live = this.phase === 'racing' || this.phase === 'finishing';
    if (!live) return;
    if (document.hidden) {
      this.race.clock.pause();
      this.stage.pause();
      return;
    }
    if (this.phase === 'racing') this.race.clock.start();
    this.stage.resume();
  }

  // ------------------------------------------------------------------- UI

  private say(event: TauntEvent, force = false): void {
    if (this.destroyed) return;
    const line = this.taunts.pick(event, this.stage.time, force);
    if (!line) return;
    this.bubble.show(line);
    this.announce(`Spider: ${line}`);
  }

  private announce(text: string): void {
    this.liveEl.textContent = text;
  }

  private updateHeaders(): void {
    const { player, spider } = this.race;
    const playerPane = this.playerPane;
    const spiderPane = this.spiderPane;
    playerPane.setHops(player.hops);
    playerPane.setCrumbs(player.path.map((s) => s.title));
    playerPane.setBackEnabled(this.phase === 'racing' && !this.navBusy && this.history.length >= 2);
    spiderPane.setHops(spider.hops);
    spiderPane.setCrumbs(spider.path.map((s) => s.title));
  }

  private showOverlay(content: HTMLElement): void {
    this.overlay.hidden = false;
    this.overlay.replaceChildren(content);
  }

  private hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private setTitle(text: string): void {
    document.title = `${text} · S.I.L.K`;
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
      { class: 'checklist panel overlay-card', attrs: { role: 'status' } },
      h('p', { class: 'kicker', text: 'crawler.boot()' }),
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
