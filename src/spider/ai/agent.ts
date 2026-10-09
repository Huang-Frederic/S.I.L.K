/**
 * The spider as a step-by-step agent. It owns the brain, the trail of pages
 * it is standing on (like a silk thread back to the start) and the hop count,
 * but knows nothing about rendering: the game animates between steps, while
 * tests (or a headless run) simply call the steps in a loop.
 *
 * "Never revisit a page": links to visited pages are never chosen. The only
 * exception is a dead end, where the spider climbs back along its thread to
 * the previous page and tries its next best link from there.
 */
import type { SpiderBrain } from './brain';
import type { CandidateLink, Decision } from './types';

export interface SpiderPage {
  /** Canonical title. */
  title: string;
  links: CandidateLink[];
}

export type PageLoader<P extends SpiderPage> = (title: string) => Promise<P>;

export type SpiderMove =
  | { kind: 'arrived' }
  | { kind: 'follow'; link: CandidateLink; decision: Decision }
  | { kind: 'retreat'; to: string }
  | { kind: 'stuck'; why: 'max-hops' | 'no-links' };

export class SpiderAgent<P extends SpiderPage = SpiderPage> {
  /** Pages from the start to the current one (dead ends are popped off). */
  readonly trail: P[] = [];
  hops = 0;

  constructor(
    readonly brain: SpiderBrain,
    private readonly loadPage: PageLoader<P>,
    readonly maxHops = 60,
  ) {}

  get page(): P {
    const page = this.trail[this.trail.length - 1];
    if (!page) throw new Error('The spider has not started yet');
    return page;
  }

  async start(title: string): Promise<P> {
    const page = await this.loadPage(title);
    this.trail.length = 0;
    this.hops = 0;
    this.land(page);
    return page;
  }

  /** Decides what to do on the current page. */
  async think(): Promise<SpiderMove> {
    const page = this.page;
    if (this.brain.isTarget(page.title)) return { kind: 'arrived' };
    if (this.hops >= this.maxHops) return { kind: 'stuck', why: 'max-hops' };
    const decision = await this.brain.decide(page.links);
    if (decision.link) return { kind: 'follow', link: decision.link, decision };
    if (this.trail.length >= 2) return { kind: 'retreat', to: this.trail[this.trail.length - 2].title };
    return { kind: 'stuck', why: 'no-links' };
  }

  /** Loads the page behind a link without moving yet (lets the game prefetch while animating). */
  fetch(link: CandidateLink): Promise<P> {
    return this.loadPage(link.title);
  }

  /** Moves onto a page fetched for `link`. */
  follow(link: CandidateLink, page: P): void {
    this.brain.visit(link.title);
    this.brain.visit(link.linkedTitle);
    this.hops++;
    this.land(page);
  }

  /** Climbs back to the previous page (dead end). */
  retreat(): P {
    if (this.trail.length < 2) throw new Error('Nowhere to retreat to');
    this.trail.pop();
    this.hops++;
    return this.page;
  }

  /** Forgets a link that turned out to be unusable (e.g. the article was deleted). */
  discard(link: CandidateLink): void {
    this.brain.visit(link.title);
    this.brain.visit(link.linkedTitle);
  }

  private land(page: P): void {
    this.brain.visit(page.title);
    this.trail.push(page);
  }
}

export interface SearchStep {
  title: string;
  via: 'start' | 'link' | 'back';
  decision?: Decision;
}

export interface SearchOutcome {
  found: boolean;
  steps: SearchStep[];
  hops: number;
}

/**
 * Runs the spider without any animation until it reaches the target or gives
 * up. `isMissing` tells whether a load error means "this article does not
 * exist" (skip the link) rather than a real failure.
 */
export async function runSpiderSearch<P extends SpiderPage>(
  agent: SpiderAgent<P>,
  start: string,
  isMissing: (error: unknown) => boolean = () => false,
): Promise<SearchOutcome> {
  await agent.start(start);
  const steps: SearchStep[] = [{ title: agent.page.title, via: 'start' }];
  for (;;) {
    const move = await agent.think();
    switch (move.kind) {
      case 'arrived':
        return { found: true, steps, hops: agent.hops };
      case 'stuck':
        return { found: false, steps, hops: agent.hops };
      case 'retreat':
        steps.push({ title: agent.retreat().title, via: 'back' });
        break;
      case 'follow':
        try {
          const page = await agent.fetch(move.link);
          agent.follow(move.link, page);
          steps.push({ title: page.title, via: 'link', decision: move.decision });
        } catch (error) {
          if (!isMissing(error)) throw error;
          agent.discard(move.link);
        }
        break;
    }
  }
}
