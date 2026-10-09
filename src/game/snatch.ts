/**
 * When may the spider steal the link the player just clicked (Hard)?
 *
 * Only when the player is winning: the link is an interesting one (the
 * target, or a page that links to it) and would leave the player strictly
 * closer to the target than the spider. Never on the player's first links,
 * at most `perRace` times a race, and never within `cooldown` seconds of the
 * start of the race or of the last snatch. Pure, so the rules are easy to
 * test.
 */
import type { SnatchRule } from './difficulty';

/**
 * Estimated hops left to the target: 0 on it, 1 from a page that links to
 * it, 2 from a page that links to such a page, 3 for anything else.
 */
export type Closeness = 0 | 1 | 2 | 3;

export interface Lookup {
  /** The target or one of its redirects. */
  isTarget(title: string): boolean;
  /** A page that links to the target (one of its backlinks). */
  isBridge(title: string): boolean;
}

/** How close a link takes the player (only its title is known before it loads). */
export function linkCloseness(title: string, lookup: Lookup): Closeness {
  if (lookup.isTarget(title)) return 0;
  return lookup.isBridge(title) ? 1 : 3;
}

/** How close a page is, from the links it has. */
export function pageCloseness(links: ReadonlyArray<{ title: string; linkedTitle?: string }>, lookup: Lookup): Closeness {
  const titles = (l: { title: string; linkedTitle?: string }) => (l.linkedTitle ? [l.title, l.linkedTitle] : [l.title]);
  if (links.some((l) => titles(l).some((t) => lookup.isTarget(t)))) return 1;
  if (links.some((l) => titles(l).some((t) => lookup.isBridge(t)))) return 2;
  return 3;
}

export interface SnatchFacts {
  /** Race time (s). */
  now: number;
  /** Links the player has followed so far (this click would be the next one). */
  playerLinks: number;
  /** Snatches so far, and the race time of the last one (s). */
  done: number;
  lastAt: number | null;
  /** Where the clicked link takes the player, and where the spider stands. */
  link: Closeness;
  spider: Closeness;
  /** The spider has already been on that page (it never goes back). */
  visited: boolean;
}

export function maySnatch(rule: SnatchRule | null, facts: SnatchFacts): boolean {
  if (!rule) return false;
  if (facts.playerLinks < rule.safeHops) return false;
  if (facts.done >= rule.perRace) return false;
  if (facts.now - (facts.lastAt ?? 0) < rule.cooldown) return false;
  if (facts.visited) return false;
  // An interesting link that puts the player ahead.
  return facts.link <= 1 && facts.link < facts.spider;
}
