/**
 * Pure geometry for the spider's walk to a link (no DOM, unit tested).
 *
 * The spider weaves its way to the link like a snake, swinging from side to
 * side (a long way, across most of the text column), then straightens out
 * for a short run along the link's line, from whichever side it comes,
 * eating the words next to the link, and stops with its mouth at the link.
 */
import type { Box, Point } from '../stage/stage';

export type { Point };

/** The text column, in content x: the spider's feet need words under them. */
export interface Column {
  left: number;
  right: number;
}

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
 * the side it is on, for at most `run` px. Inside a column, it comes from
 * the other side rather than from the margin when the link starts (or ends)
 * a line.
 */
export function approach(link: Box, from: Point, mouth: number, run = 70, column?: Column): Approach {
  const y = centerY(link);
  const onLine = Math.abs(from.y - y) < 8;
  let fromLeft = from.x <= centerX(link);
  if (column && !onLine) {
    const roomLeft = link.left - mouth - column.left;
    const roomRight = column.right - link.right - mouth;
    if (fromLeft && roomLeft < 24 && roomRight > roomLeft) fromLeft = false;
    else if (!fromLeft && roomRight < 24 && roomLeft > roomRight) fromLeft = true;
  }
  const end = { x: fromLeft ? link.left - mouth + 2 : link.right + mouth - 2, y };
  // Already on that line: it just walks on.
  if (onLine) return { runIn: { ...from }, end };
  let length = Math.min(run, Math.abs(from.x - end.x));
  if (column) length = Math.min(length, Math.max(0, fromLeft ? end.x - column.left : column.right - end.x));
  return { runIn: { x: end.x + (fromLeft ? -length : length), y }, end };
}

export interface WeaveOptions {
  /** Which way it swings first: 1 or -1. */
  side?: 1 | -1;
  /** Distance between two points of the path (px). */
  step?: number;
  /** The text column: the swings stay inside it, and a long way they use most of it. */
  column?: Column;
  /** Random numbers in [0, 1), for the size of each swing. */
  random?: () => number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A wavy path from `a` to `b` (as points every `step` px, `b` last): the
 * spider swings from side to side like a snake, easing into the weave and
 * straightening out to arrive. Short trips are walked straight; a short way
 * it swings about once every 110 px and up to 56 px out. The longer the
 * way, the longer and wider the swings (up to across most of the column,
 * away from its edges), each one a little different.
 */
export function serpentine(a: Point, b: Point, options: WeaveOptions = {}): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [{ ...b }];
  const step = options.step ?? 6;
  const random = options.random ?? Math.random;
  const side = options.side ?? 1;
  const column = options.column;
  const count = Math.max(1, Math.ceil(length / step));
  // 0 up to 400 px, 1 from 2000 px on.
  const long = clamp((length - 400) / 1600, 0, 1);
  const swings = Math.max(1, Math.round(length / (110 + 210 * long)));
  const width = column ? column.right - column.left : 0;
  const reach = length < 60 ? 0 : Math.max(Math.min(56, length * 0.14), long * width * 0.3);
  const nx = -dy / length;
  const ny = dx / length;
  // A long way, it drifts towards the middle of the column rather than hug an edge.
  const middle = column ? (column.left + column.right) / 2 : 0;
  const centre = (s: number) => {
    const x = a.x + dx * s;
    return { x: column ? x + (middle - x) * 0.6 * long * Math.sin(Math.PI * s) : x, y: a.y + dy * s };
  };
  const sizes = Array.from({ length: swings }, (_, k) => {
    let size = reach * (0.65 + 0.35 * random());
    if (column && Math.abs(nx) > 0.05) {
      // Each swing peaks inside the column.
      const peak = centre((k + 0.5) / swings);
      const towards = (k % 2 === 0 ? 1 : -1) * side * nx;
      const room = towards > 0 ? (column.right - peak.x) / towards : (peak.x - column.left) / -towards;
      size = Math.min(size, Math.max(0, room));
    }
    return size;
  });
  const points: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const s = i / count;
    const ease = smooth(Math.min(1, s / 0.15)) * smooth(Math.min(1, (1 - s) / 0.15));
    const k = Math.min(swings - 1, Math.floor(s * swings));
    const off = Math.sin(Math.PI * swings * s) * sizes[k] * side * ease;
    const c = centre(s);
    const x = c.x + nx * off;
    points.push({ x: column ? clamp(x, Math.min(column.left, a.x, b.x), Math.max(column.right, a.x, b.x)) : x, y: c.y + ny * off });
  }
  points[points.length - 1] = { ...b };
  return points;
}

/** Where the camera should scroll so that `y` sits at `ratio` of the viewport. */
export function cameraTarget(y: number, viewHeight: number, contentHeight: number, ratio = 0.42): number {
  const max = Math.max(0, contentHeight - viewHeight);
  return Math.min(max, Math.max(0, y - viewHeight * ratio));
}
