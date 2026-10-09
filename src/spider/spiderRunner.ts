/**
 * Drives the spider during a race: asks the agent (pure AI) what to do and
 * plays it out on the pane (animation), prefetching the next article while
 * the spider walks to its link.
 */
import type { Difficulty } from '../game/difficulty';
import type { SpiderAgent } from './ai/agent';
import type { Decision } from './ai/types';
import { PaneClosedError, type SpiderPane } from './spiderPane';
import type { SpiderArticlePage } from './world';

export interface SpiderRunnerOptions {
  pane: SpiderPane;
  agent: SpiderAgent<SpiderArticlePage>;
  difficulty: Difficulty;
  /** True when a load error means the article does not exist. */
  isMissing: (error: unknown) => boolean;
  /** The spider moved to a new page; `reason` says why it chose the link. */
  onMove: (title: string, via: 'link' | 'back', reason?: Decision['reason']) => void;
  /** The spider is on the target page (called after its celebration). */
  onArrive?: () => void;
  onStuck?: (reason: string) => void;
}

/** Label shown next to the link the spider locks onto. */
export function decisionLabel(decision: Decision): string {
  switch (decision.reason) {
    case 'target':
      return 'TARGET FOUND';
    case 'backlink':
      return 'LINKS TO TARGET';
    case 'semantic':
      return `SIMILARITY ${decision.score.toFixed(2)}`;
    case 'lexical':
      return 'WORD MATCH';
    default:
      return '';
  }
}

const REASON_TEXT: Record<Decision['reason'], string> = {
  target: 'the target is right here!',
  backlink: 'this page links to the target',
  semantic: 'closest in meaning',
  lexical: 'best word match',
  'dead-end': '',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SpiderRunner {
  private stopped = false;
  private prepared = false;

  constructor(private readonly options: SpiderRunnerOptions) {}

  stop(): void {
    this.stopped = true;
  }

  /**
   * Loads the start page (with its link data) and shows it with the spider
   * dropping in, so that the race can start the moment the countdown ends.
   */
  async prepare(startTitle: string): Promise<void> {
    const { pane, agent } = this.options;
    pane.setStatus('Spinning up…');
    const start = await this.retrying(() => agent.start(startTitle));
    if (this.stopped) return;
    await pane.enter(start.loaded);
    this.prepared = true;
  }

  /** Runs until the spider arrives, gets stuck, or the runner is stopped. */
  async run(startTitle: string): Promise<void> {
    try {
      if (!this.prepared) await this.prepare(startTitle);
      await this.loop();
    } catch (error) {
      if (error instanceof PaneClosedError || this.stopped) return;
      this.options.pane.setStatus('Crashed into a network error');
      this.options.onStuck?.(String(error));
    }
  }

  private async loop(): Promise<void> {
    const { pane, agent, difficulty } = this.options;
    while (!this.stopped) {
      pane.setStatus('Indexing links…');
      const move = await pane.think(difficulty.thinkMs, agent.think());
      if (this.stopped) return;

      if (move.kind === 'arrived') {
        pane.setStatus('Target reached!');
        await pane.celebrate();
        this.options.onArrive?.();
        return;
      }
      if (move.kind === 'stuck') {
        pane.setStatus(move.why === 'max-hops' ? 'Exhausted: too many hops' : 'Trapped: no way out of this page');
        this.options.onStuck?.(move.why);
        return;
      }
      if (move.kind === 'retreat') {
        pane.setStatus('Dead end: climbing back up the thread');
        const hole = await pane.retreat();
        const page = agent.retreat();
        this.options.onMove(page.title, 'back', 'dead-end');
        await pane.enter(page.loaded, hole);
        continue;
      }

      const { link, decision } = move;
      pane.setStatus(`→ ${link.title} · ${REASON_TEXT[decision.reason]}`);
      const next = this.fetch(link);
      await pane.crawlTo(link, decisionLabel(decision));
      let page: SpiderArticlePage;
      try {
        page = await next;
      } catch (error) {
        if (!this.options.isMissing(error)) throw error;
        // Deleted since the page was rendered: forget it and think again.
        agent.discard(link);
        pane.setStatus(`“${link.title}” is gone. Rethinking…`);
        continue;
      }
      if (this.stopped) return;
      const hole = await pane.dive();
      agent.follow(link, page);
      this.options.onMove(page.title, 'link', decision.reason);
      await pane.enter(page.loaded, hole);
    }
  }

  /** Prefetches the next page, retrying transient network failures. */
  private fetch(link: Parameters<SpiderAgent<SpiderArticlePage>['fetch']>[0]): Promise<SpiderArticlePage> {
    const promise = this.retrying(() => this.options.agent.fetch(link));
    promise.catch(() => {}); // handled when awaited
    return promise;
  }

  private async retrying<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (this.options.isMissing(error) || attempt >= attempts || this.stopped) throw error;
        this.options.pane.setStatus('Network hiccup, retrying…');
        await sleep(2500 * attempt);
      }
    }
  }
}
