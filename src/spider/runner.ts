/**
 * Drives the spider during a race: asks the agent (pure AI) what to do and
 * plays it out with the actor, one hop at a time:
 *
 *   scan -> lock -> crawl & eat -> grab -> hop
 *
 * The next article is prefetched while the spider crawls. On Hard the loop
 * can be cut short by a link snatch: the spider leaps into the player's
 * pane, eats the link the player was reaching for, dives into it, and the
 * panes swap owners.
 */
import { StageClosedError } from '../stage/stage';
import type { RacerPane } from '../stage/racerPane';
import { Interrupted, type ScoreTag, type SpiderActor } from './actor';
import type { SpiderAgent } from './ai/agent';
import type { CandidateLink, Decision } from './ai/types';
import type { SpiderArticlePage } from './world';

export interface SnatchTarget {
  /** The player's pane, where the link is. */
  pane: RacerPane;
  anchor: HTMLAnchorElement;
  /** Title as linked (the anchor's data-title). */
  title: string;
}

export interface RunnerOptions {
  actor: SpiderActor;
  agent: SpiderAgent<SpiderArticlePage>;
  /** The pane the spider currently owns. */
  pane: () => RacerPane;
  /** Minimum scan time per page (ms, rage included). */
  thinkMs: () => number;
  /** How long score labels and the grab last (s). */
  scoreSeconds: number;
  grabSeconds: number;
  /** Chance that it heads for another link first, then thinks better of it. */
  hesitate: number;
  isMissing: (error: unknown) => boolean;
  onDecision?: (decision: Decision, page: SpiderArticlePage) => void;
  /** The spider moved to a new page. */
  onMove: (title: string, via: 'link' | 'back', note?: string) => void;
  /** A snatch worked: swap the panes' owners (before the new page glitches in). */
  onSwap: (target: SnatchTarget, formerTitle: string) => void;
  /** The spider leaps for the player's link (the player's pending click is void). */
  onSnatchStart?: (target: SnatchTarget) => void;
  /** The spider just ate the player's link. */
  onSnatch?: (target: SnatchTarget) => void;
  /** The spider stands on the target page. */
  onArrive: () => void;
  onStuck: (why: string) => void;
}

const REASON_TAGS: Record<Decision['reason'], string | undefined> = {
  target: 'direct hit',
  backlink: 'backlink',
  semantic: 'closest',
  lexical: 'words',
  'dead-end': undefined,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The anchor of a candidate link in a rendered article (decoys ignored). */
export function findAnchor(pane: RacerPane, link: CandidateLink): HTMLAnchorElement | null {
  const links = pane.links().filter((a) => !a.dataset.decoy);
  const byOrder = links[link.order];
  if (byOrder && byOrder.dataset.title === link.linkedTitle) return byOrder;
  return links.find((a) => a.dataset.title === link.linkedTitle) ?? links.find((a) => a.dataset.title === link.title) ?? null;
}

export class SpiderRunner {
  /** The decision being carried out (null while scanning or between pages). */
  current: Decision | null = null;
  snatching = false;
  private started = false;
  private stopped = false;
  private pendingSnatch: SnatchTarget | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly o: RunnerOptions) {}

  /** True when a snatch could start right now. */
  get canSnatch(): boolean {
    const { actor } = this.o;
    return this.started && !this.stopped && !this.snatching && !this.pendingSnatch && actor.interruptible && actor.visible && actor.holds === 0;
  }

  requestSnatch(target: SnatchTarget): boolean {
    if (!this.canSnatch) return false;
    this.pendingSnatch = target;
    this.o.actor.interrupt('snatch');
    return true;
  }

  /** Stops the spider; resolves once the current move has wound down. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.o.actor.interrupt('stop');
    await this.loop?.catch(() => {});
    this.o.actor.clearInterrupt();
  }

  /** Loads the start page and shows it in the spider's pane (before the countdown ends). */
  async prepare(startTitle: string): Promise<void> {
    const page = await this.retrying(() => this.o.agent.start(startTitle));
    if (!this.stopped) this.o.pane().showArticle(page.loaded);
  }

  run(): Promise<void> {
    this.loop ??= this.main();
    return this.loop;
  }

  private async main(): Promise<void> {
    const { actor } = this.o;
    try {
      await actor.dropIn(this.o.pane());
      this.started = true;
      while (!this.stopped) {
        try {
          if (await this.hop()) return;
        } catch (error) {
          if (!(error instanceof Interrupted)) throw error;
          actor.resetPose();
          const target = this.pendingSnatch;
          this.pendingSnatch = null;
          if (this.stopped) return;
          if (target && (await this.snatch(target))) return;
        }
      }
    } catch (error) {
      if (error instanceof StageClosedError || error instanceof Interrupted || this.stopped) return;
      actor.status = 'crashed into a network error';
      this.o.onStuck(String(error));
    } finally {
      this.started = false;
    }
  }

  /** One hop. Returns true when the spider is done (arrived or stuck). */
  private async hop(): Promise<boolean> {
    const { actor, agent } = this.o;
    const pane = this.o.pane();
    const page = agent.page;
    this.current = null;
    const move = await actor.scan(agent.think(), this.o.thinkMs() / 1000, page.links.length);

    if (move.kind === 'arrived') {
      this.o.onArrive();
      return true;
    }
    if (move.kind === 'stuck') {
      actor.status = move.why === 'max-hops' ? 'exhausted: too many hops' : 'trapped: no way out of this page';
      this.o.onStuck(move.why);
      return true;
    }
    if (move.kind === 'retreat') {
      actor.status = 'dead_end · climbing back up the thread';
      actor.interruptible = false;
      try {
        await actor.climbOut();
        const back = agent.retreat();
        this.o.onMove(back.title, 'back', 'dead-end');
        await actor.enterPage(pane, back.loaded);
        return this.arrived(back);
      } finally {
        actor.interruptible = true;
      }
    }

    const { link, decision } = move;
    this.current = decision;
    this.o.onDecision?.(decision, page);
    const next = this.fetch(link);
    const anchor = findAnchor(pane, link);
    if (anchor) {
      const tags: ScoreTag[] = [];
      decision.shortlist.slice(0, 4).forEach(({ link: l, score }, i) => {
        const a = findAnchor(pane, l);
        if (a) tags.push({ anchor: a, score, best: i === 0, tag: i === 0 ? REASON_TAGS[decision.reason] : undefined });
      });
      await actor.showScores(tags, this.o.scoreSeconds);
      // Now and then it goes the wrong way first (never with the target in sight).
      if (decision.reason !== 'target' && Math.random() < this.o.hesitate) {
        const other = decision.shortlist
          .slice(1, 4)
          .map(({ link: l }) => ({ title: l.title, anchor: findAnchor(pane, l) }))
          .find((o) => o.anchor && o.anchor !== anchor);
        if (other?.anchor) await actor.feint(other.anchor, other.title);
      }
      await actor.lock(anchor, link.title);
      await actor.crawlTo(anchor);
      await actor.grab(anchor, link.title, this.o.grabSeconds, next.catch(() => null));
    }

    let nextPage: SpiderArticlePage;
    try {
      nextPage = await actor.until(next);
    } catch (error) {
      if (!this.o.isMissing(error)) throw error;
      // Deleted since the page was rendered: forget it and think again.
      agent.discard(link);
      actor.resetPose();
      actor.status = `"${link.title}" is gone · rethinking`;
      return false;
    }

    actor.interruptible = false;
    try {
      await actor.dive(anchor);
      agent.follow(link, nextPage);
      this.current = null;
      this.o.onMove(nextPage.title, 'link', decision.reason);
      await actor.enterPage(pane, nextPage.loaded);
      actor.flashStatus(`+1 HOP · hops: ${agent.hops}`);
    } finally {
      actor.interruptible = true;
    }
    return this.arrived(nextPage);
  }

  /** Leap across, eat the player's link, wiggle, dive in, swap panes. */
  private async snatch(target: SnatchTarget): Promise<boolean> {
    const { actor, agent } = this.o;
    // The player got there first (the page changed under the cursor).
    if (!target.anchor.isConnected || target.pane.owner !== 'player') return false;
    const home = this.o.pane();
    const formerTitle = agent.page.title;
    const link: CandidateLink = { title: target.title, linkedTitle: target.title, text: target.anchor.textContent ?? target.title, order: -1 };
    const next = this.fetch(link);
    this.snatching = true;
    this.current = null;
    actor.interruptible = false;
    this.o.onSnatchStart?.(target);
    try {
      const spot = () => {
        const b = target.pane.linkBox(target.anchor);
        return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      };
      await actor.leapTo(target.pane, spot, 0.38);
      actor.hug(target.anchor);
      actor.chompLink(target.anchor);
      actor.status = 'snatch(link) · nom';
      this.o.onSnatch?.(target);
      await actor.wiggle(0.5);

      let page: SpiderArticlePage;
      try {
        page = await actor.until(next);
      } catch (error) {
        if (!this.o.isMissing(error)) throw error;
        // Nothing behind that link: hop back home.
        agent.discard(link);
        await actor.leapTo(home, () => ({ x: actor.rig.x, y: home.visibleContent().top + 160 }), 0.4);
        actor.land();
        return false;
      }

      await actor.dive(target.anchor);
      this.o.onSwap(target, formerTitle);
      agent.follow(link, page);
      this.o.onMove(page.title, 'link', 'snatch');
      await actor.enterPage(target.pane, page.loaded);
      actor.flashStatus(`+1 HOP · hops: ${agent.hops}`);
      return this.arrived(page);
    } finally {
      this.snatching = false;
      actor.interruptible = true;
    }
  }

  private arrived(page: SpiderArticlePage): boolean {
    if (!this.o.agent.brain.isTarget(page.title)) return false;
    this.o.onArrive();
    return true;
  }

  /** Prefetches a page, retrying transient network failures. */
  private fetch(link: CandidateLink): Promise<SpiderArticlePage> {
    const promise = this.retrying(() => this.o.agent.fetch(link));
    promise.catch(() => {}); // handled when awaited
    return promise;
  }

  private async retrying<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (this.o.isMissing(error) || attempt >= attempts || this.stopped) throw error;
        this.o.actor.status = 'network hiccup · retrying';
        await sleep(2500 * attempt);
      }
    }
  }
}
