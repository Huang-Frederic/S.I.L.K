/**
 * What an attack needs to know about the race, and helpers to pick its
 * victims: the links the player is most likely to click next (the target
 * link first when it is on screen, then the links nearest to the cursor).
 */
import type { Fragments } from '../fx/fx';
import type { TauntEvent } from '../game/comedy';
import type { Difficulty } from '../game/difficulty';
import type { SpiderActor } from '../spider/actor';
import type { VirtualCursor } from '../stage/cursor';
import type { RacerPane } from '../stage/racerPane';
import type { Box, Point, Stage } from '../stage/stage';

export interface AttackContext {
  stage: Stage;
  actor: SpiderActor;
  cursor: VirtualCursor;
  fragments: Fragments;
  difficulty: Difficulty;
  /** The pane the player currently owns. */
  playerPane(): RacerPane;
  targetTitle: string;
  /** True for the target's title or one of its redirects. */
  isTarget(title: string): boolean;
  say(event: TauntEvent): void;
}

export interface LinkChoice {
  el: HTMLAnchorElement;
  /** Content coordinates of the pane. */
  box: Box;
}

export const center = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

export function distanceToBox(p: Point, b: Box): number {
  const dx = Math.max(b.left - p.x, 0, p.x - b.right);
  const dy = Math.max(b.top - p.y, 0, p.y - b.bottom);
  return Math.hypot(dx, dy);
}

/** Where the player is looking, in the pane's content coordinates. */
export function focusPoint(ctx: AttackContext, pane: RacerPane = ctx.playerPane()): Point {
  const c = ctx.cursor.position;
  if (ctx.cursor.available && pane.containsStage(c)) return pane.fromStage(c);
  const view = pane.visibleContent();
  return { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
}

/**
 * Usable links on screen in the player's pane, the most dangerous first: the
 * target link, then by distance to the cursor.
 */
export function rankLinks(ctx: AttackContext, exclude: ReadonlySet<HTMLAnchorElement> = new Set()): LinkChoice[] {
  const pane = ctx.playerPane();
  const focus = focusPoint(ctx, pane);
  const links = pane.visibleLinks((a) => pane.usable(a) && !a.dataset.decoy && !exclude.has(a));
  const isTarget = (l: LinkChoice) => ctx.isTarget(l.el.dataset.title ?? '');
  return links.sort((a, b) => Number(isTarget(b)) - Number(isTarget(a)) || distanceToBox(focus, a.box) - distanceToBox(focus, b.box));
}

export function circleHitsBox(c: Point, r: number, b: Box): boolean {
  return distanceToBox(c, b) <= r;
}
