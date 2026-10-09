/**
 * The spider's decision rules, applied on every page:
 *
 *   1. If the target is linked from this page, take it.
 *   2. Otherwise, if some links lead to pages known to link to the target
 *      (its backlinks, fetched once at race start), take the most relevant.
 *   3. Otherwise rank every link by semantic similarity to the target's title
 *      and summary (sentence embeddings), falling back to a lexical score when
 *      the model is unavailable, and take the best one.
 *
 * Pages already visited are never chosen again.
 */
import type { CandidateLink, Decision, Ranker, ScoredLink, TargetProfile } from './types';

const SHORTLIST_SIZE = 5;

export class SpiderBrain {
  private readonly visited = new Set<string>();

  constructor(
    readonly target: TargetProfile,
    private readonly ranker: Ranker,
  ) {}

  /** Remembers a page as visited (call it for every page the spider lands on). */
  visit(title: string): void {
    this.visited.add(title);
  }

  hasVisited(title: string): boolean {
    return this.visited.has(title);
  }

  /** True when `title` is the target or one of its redirect aliases. */
  isTarget(title: string): boolean {
    return title === this.target.title || this.target.aliases.has(title);
  }

  /** Links worth considering: one per destination, never a visited page. */
  freshLinks(links: readonly CandidateLink[]): CandidateLink[] {
    const seen = new Set<string>();
    const fresh: CandidateLink[] = [];
    for (const link of links) {
      if (seen.has(link.title) || this.visited.has(link.title) || this.visited.has(link.linkedTitle)) continue;
      seen.add(link.title);
      fresh.push(link);
    }
    return fresh;
  }

  async decide(links: readonly CandidateLink[]): Promise<Decision> {
    const fresh = this.freshLinks(links);
    if (fresh.length === 0) return { reason: 'dead-end', link: null, score: 0, shortlist: [] };

    // 1. The target is right here.
    const direct = fresh.find((link) => this.isTarget(link.title) || this.isTarget(link.linkedTitle));
    if (direct) return { reason: 'target', link: direct, score: 1, shortlist: [{ link: direct, score: 1 }] };

    // 2. One hop away from the target, according to its backlinks.
    const bridges = fresh.filter((link) => this.target.backlinks.has(link.title));
    if (bridges.length) {
      const { scored } = await this.ranker.rank(this.target, bridges);
      return this.pick('backlink', scored);
    }

    // 3. Best guess by similarity.
    const { scored, method } = await this.ranker.rank(this.target, fresh);
    return this.pick(method, scored);
  }

  private pick(reason: Decision['reason'], scored: ScoredLink[]): Decision {
    const best = scored[0];
    if (!best) return { reason: 'dead-end', link: null, score: 0, shortlist: [] };
    return { reason, link: best.link, score: best.score, shortlist: scored.slice(0, SHORTLIST_SIZE) };
  }
}
