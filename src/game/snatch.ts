/**
 * When may the spider steal the link the player just clicked (Hard)?
 *
 * Only when the player is winning: the link takes the player closer to the
 * target and leaves the player closer to it than the spider is. Never the
 * last two links of a path (the target itself, or a page that links to it),
 * never on the player's first links, and never twice within `cooldown`
 * seconds. Pure, so the rules are easy to test.
 *
 * "Closer" is the spider's own estimate: first the hops left (1 from a page
 * that links to the target, 2 from a page that links to one of those, 3
 * otherwise), then, between two pages with as many hops left, how close
 * their titles are to the target in meaning (the ranker's score).
 */
import type { SnatchRule } from './difficulty';

/** Estimated hops left to the target. */
export type Hops = 0 | 1 | 2 | 3;

export interface Lookup {
  /** The target or one of its redirects. */
  isTarget(title: string): boolean;
  /** A page known to link to the target (one of its backlinks). */
  isBridge(title: string): boolean;
}

/** A link as written in a page (`linkedTitle`: before redirects, when known). */
export interface LinkLike {
  title: string;
  linkedTitle?: string;
}

/** Hops left from a page, judging by its title and its links. */
export function hopsLeft(title: string, links: readonly LinkLike[], lookup: Lookup): Hops {
  if (lookup.isTarget(title)) return 0;
  const titles = links.flatMap((l) => (l.linkedTitle && l.linkedTitle !== l.title ? [l.title, l.linkedTitle] : [l.title]));
  if (lookup.isBridge(title) || titles.some((t) => lookup.isTarget(t))) return 1;
  if (titles.some((t) => lookup.isBridge(t))) return 2;
  return 3;
}

/** Where a racer stands (or would stand), as far as the spider can tell. */
export interface Standing {
  hops: Hops;
  /** How close the page's title is to the target in meaning; null when unknown. */
  similarity: number | null;
}

/** Similarity scores closer than this are a tie. */
export const SIMILARITY_MARGIN = 0.02;

/** True when `a` is strictly closer to the target than `b`. */
export function closer(a: Standing, b: Standing): boolean {
  if (a.hops !== b.hops) return a.hops < b.hops;
  return a.similarity !== null && b.similarity !== null && a.similarity > b.similarity + SIMILARITY_MARGIN;
}

export interface SnatchFacts {
  /** Race time (s). */
  now: number;
  /** Links the player has followed so far (this click would be the next one). */
  playerLinks: number;
  /** Race time of the last snatch (s), if any. */
  lastAt: number | null;
  /** Where the player stands, where the clicked link leads, where the spider stands. */
  player: Standing;
  link: Standing;
  spider: Standing;
  /** The spider has already been on that page (it never goes back). */
  visited: boolean;
}

/** The rules that do not depend on where anyone stands: the first links are safe, then a cooldown. */
export function snatchOpen(rule: SnatchRule | null, facts: Pick<SnatchFacts, 'now' | 'playerLinks' | 'lastAt'>): boolean {
  if (!rule || facts.playerLinks < rule.safeHops) return false;
  return facts.lastAt === null || facts.now - facts.lastAt >= rule.cooldown;
}

export function maySnatch(rule: SnatchRule | null, facts: SnatchFacts): boolean {
  if (!snatchOpen(rule, facts)) return false;
  // Never the last two links: the target itself, or a page that links to it.
  if (facts.link.hops <= 1) return false;
  if (facts.visited) return false;
  // A good link (it takes the player closer) that puts the player ahead of the spider.
  return closer(facts.link, facts.player) && closer(facts.link, facts.spider);
}
