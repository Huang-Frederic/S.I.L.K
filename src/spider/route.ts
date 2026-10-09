/**
 * Pure geometry for the spider's walk to a link (no DOM, unit tested).
 *
 * The spider walks along the link's line of text: it lands a few words away
 * from the link (preferably on its left, reading direction), then crawls
 * towards it, eating every word its mouth passes over, and stops with its
 * mouth at the link.
 */
import type { Box, Point } from '../stage/stage';

export type { Point };

export interface WalkPlan {
  /** Body centre where the walk along the line starts. */
  start: Point;
  /** Body centre where the walk ends (mouth touching the link). */
  end: Point;
  /** +1 walking to the right, -1 walking to the left. */
  direction: 1 | -1;
  /**
   * Words eaten on the way, in the order the mouth reaches them. `side` and
   * `index` point into the `before` / `after` arrays given to planWalk.
   */
  eats: Array<{ side: 'before' | 'after'; index: number; atX: number }>;
}

export const centerX = (box: Box) => (box.left + box.right) / 2;
export const centerY = (box: Box) => (box.top + box.bottom) / 2;

/**
 * @param link   first line box of the link
 * @param before words on the same line, left of the link, in reading order
 * @param after  words on the same line, right of the link, in reading order
 * @param mouth  distance from the body centre to the mouth
 * @param maxWords at most this many words are eaten on the way
 */
export function planWalk(link: Box, before: readonly Box[], after: readonly Box[], mouth: number, maxWords = 8): WalkPlan {
  const y = centerY(link);
  const fromLeft = before.length >= 2 || after.length === 0 || before.length >= after.length;

  if (fromLeft) {
    const first = Math.max(0, before.length - maxWords);
    const eaten = before.slice(first);
    const end = { x: link.left - mouth + 2, y };
    let startX = eaten.length ? eaten[0].left - mouth * 1.25 : end.x - mouth * 2;
    startX = Math.min(startX, end.x - mouth);
    return {
      start: { x: startX, y },
      end,
      direction: 1,
      eats: eaten.map((box, i) => ({ side: 'before' as const, index: first + i, atX: centerX(box) })),
    };
  }

  const eaten = after.slice(0, maxWords);
  const end = { x: link.right + mouth - 2, y };
  let startX = eaten.length ? eaten[eaten.length - 1].right + mouth * 1.25 : end.x + mouth * 2;
  startX = Math.max(startX, end.x + mouth);
  return {
    start: { x: startX, y },
    end,
    direction: -1,
    // Walking leftwards, the farthest word is met first.
    eats: eaten.map((box, i) => ({ side: 'after' as const, index: i, atX: centerX(box) })).reverse(),
  };
}

/** Splits words into those on the link's line, left and right of it. */
export function wordsAroundLink(link: Box, words: readonly Box[]): { before: number[]; after: number[] } {
  const y = centerY(link);
  const tolerance = Math.max(6, (link.bottom - link.top) * 0.5);
  const before: number[] = [];
  const after: number[] = [];
  words.forEach((box, i) => {
    if (Math.abs(centerY(box) - y) > tolerance) return;
    if (box.right <= link.left + 1) before.push(i);
    else if (box.left >= link.right - 1) after.push(i);
  });
  before.sort((a, b) => words[a].left - words[b].left);
  after.sort((a, b) => words[a].left - words[b].left);
  return { before, after };
}

/** Where the camera should scroll so that `y` sits at `ratio` of the viewport. */
export function cameraTarget(y: number, viewHeight: number, contentHeight: number, ratio = 0.42): number {
  const max = Math.max(0, contentHeight - viewHeight);
  return Math.min(max, Math.max(0, y - viewHeight * ratio));
}
