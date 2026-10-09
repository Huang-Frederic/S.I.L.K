/**
 * Pure geometry for the spider's walk to a link (no DOM, unit tested).
 *
 * The spider weaves its way to the link like a snake, swinging from side to
 * side, then straightens out for a short run along the link's line, from
 * whichever side it comes, eating the words next to the link, and stops with
 * its mouth at the link.
 */
import type { Box, Point } from '../stage/stage';

export type { Point };

export const centerX = (box: Box) => (box.left + box.right) / 2;
export const centerY = (box: Box) => (box.top + box.bottom) / 2;

export interface Approach {
  /** Where the run along the link's line starts (the weave ends here). */
  runIn: Point;
  /** Body centre at the end, mouth touching the link. */
  end: Point;
}

/**
 * How the spider comes at a link from `from`: along the link's line, from
 * the side it is on, for at most `run` px.
 */
export function approach(link: Box, from: Point, mouth: number, run = 70): Approach {
  const y = centerY(link);
  const fromLeft = from.x <= centerX(link);
  const end = { x: fromLeft ? link.left - mouth + 2 : link.right + mouth - 2, y };
  // Already on that line: it just walks on.
  if (Math.abs(from.y - y) < 8) return { runIn: { ...from }, end };
  const length = Math.min(run, Math.abs(from.x - end.x));
  return { runIn: { x: end.x + (fromLeft ? -length : length), y }, end };
}

export interface WeaveOptions {
  /** Which way it swings first: 1 or -1. */
  side?: 1 | -1;
  /** Distance between two points of the path (px). */
  step?: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A wavy path from `a` to `b` (as points every `step` px, `b` last): the
 * spider swings from side to side like a snake, about once every 110 px and
 * up to 56 px out, easing into the weave and straightening out to arrive.
 * Short trips are walked straight.
 */
export function serpentine(a: Point, b: Point, options: WeaveOptions = {}): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [{ ...b }];
  const step = options.step ?? 6;
  const count = Math.max(1, Math.ceil(length / step));
  const swings = Math.max(1, Math.round(length / 110));
  const amplitude = length < 60 ? 0 : Math.min(56, length * 0.14) * (options.side ?? 1);
  const nx = -dy / length;
  const ny = dx / length;
  const points: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const s = i / count;
    const ease = smooth(Math.min(1, s / 0.15)) * smooth(Math.min(1, (1 - s) / 0.15));
    const off = Math.sin(Math.PI * swings * s) * amplitude * ease;
    points.push({ x: a.x + dx * s + nx * off, y: a.y + dy * s + ny * off });
  }
  points[points.length - 1] = { ...b };
  return points;
}

/** Where the camera should scroll so that `y` sits at `ratio` of the viewport. */
export function cameraTarget(y: number, viewHeight: number, contentHeight: number, ratio = 0.42): number {
  const max = Math.max(0, contentHeight - viewHeight);
  return Math.min(max, Math.max(0, y - viewHeight * ratio));
}
