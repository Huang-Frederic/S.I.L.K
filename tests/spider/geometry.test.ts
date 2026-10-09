import { describe, expect, it } from 'vitest';
import { inTriangle, rayExit } from '../../src/attacks/attacks';
import type { Box } from '../../src/stage/stage';
import { segmentHitsBox } from '../../src/spider/actor';
import { legBend } from '../../src/spider/rig';
import { approach, cameraTarget, serpentine } from '../../src/spider/route';

const box = (left: number, top: number, right: number, bottom = top + 20): Box => ({ left, top, right, bottom });

describe('approach', () => {
  const link = box(400, 300, 480);

  it('comes at the link along its line, from the side the spider is on', () => {
    const fromLeft = approach(link, { x: 100, y: 120 }, 15);
    expect(fromLeft.end).toEqual({ x: 387, y: 310 });
    expect(fromLeft.runIn).toEqual({ x: 317, y: 310 });
    const fromRight = approach(link, { x: 900, y: 600 }, 15);
    expect(fromRight.end).toEqual({ x: 493, y: 310 });
    expect(fromRight.runIn).toEqual({ x: 563, y: 310 });
  });

  it('does not hug the left margin: the run along the line is short', () => {
    const { runIn, end } = approach(link, { x: 10, y: 900 }, 15);
    expect(end.x - runIn.x).toBeLessThanOrEqual(70);
  });

  it('just walks on when already on the line', () => {
    expect(approach(link, { x: 200, y: 312 }, 15).runIn).toEqual({ x: 200, y: 312 });
  });
});

describe('serpentine', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 600 };

  it('ends exactly where it is going, in small steps', () => {
    const path = serpentine(a, b);
    expect(path[path.length - 1]).toEqual(b);
    for (let i = 1; i < path.length; i++) expect(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)).toBeLessThan(12);
  });

  it('swings from side to side like a snake, within bounds', () => {
    const xs = serpentine(a, b).map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(30);
    expect(Math.min(...xs)).toBeLessThan(-30);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(56);
  });

  it('starts and arrives straight', () => {
    const path = serpentine(a, b);
    expect(Math.abs(path[0].x)).toBeLessThan(1);
    expect(Math.abs(path[path.length - 2].x)).toBeLessThan(1);
  });

  it('walks short trips straight', () => {
    expect(serpentine(a, { x: 0, y: 50 }).every((p) => p.x === 0)).toBe(true);
  });

  it('can swing to either side first', () => {
    const left = serpentine(a, { x: 0, y: 200 }, { side: 1 });
    const right = serpentine(a, { x: 0, y: 200 }, { side: -1 });
    expect(Math.sign(left[10].x)).toBe(-Math.sign(right[10].x));
  });
});

describe('cameraTarget', () => {
  it('keeps the camera inside the content', () => {
    expect(cameraTarget(50, 800, 5000)).toBe(0);
    expect(cameraTarget(2000, 800, 5000)).toBeCloseTo(2000 - 800 * 0.42);
    expect(cameraTarget(4990, 800, 5000)).toBe(4200);
  });
});

describe('legBend (two-bone IK)', () => {
  const hip = { x: 0, y: 0 };

  it('puts the knee over the hip-foot line where both segments meet', () => {
    const { base, height } = legBend(hip, { x: 60, y: 0 }, 40, 40);
    expect(base.x).toBeCloseTo(30);
    expect(base.y).toBeCloseTo(0);
    // The knee stands off the line so that both segments keep their length.
    expect(Math.hypot(base.x - hip.x, height)).toBeCloseTo(40);
  });

  it('stretches straight towards an unreachable foot', () => {
    expect(legBend(hip, { x: 200, y: 0 }, 40, 40)).toMatchObject({ base: { x: 40, y: 0 }, height: 0 });
  });

  it('bends more as the foot comes closer', () => {
    expect(legBend(hip, { x: 30, y: 0 }, 40, 40).height).toBeGreaterThan(legBend(hip, { x: 70, y: 0 }, 40, 40).height);
  });
});

describe('segmentHitsBox (eye laser cuts)', () => {
  const word = { left: 100, top: 100, right: 140, bottom: 120 };

  it('hits words crossed by the beam', () => {
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 200, y: 220 }, word)).toBe(true);
    expect(segmentHitsBox({ x: 120, y: 0 }, { x: 120, y: 300 }, word)).toBe(true);
  });

  it('misses words beside the beam or beyond its end', () => {
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 300, y: 0 }, word)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 80, y: 90 }, word)).toBe(false);
  });
});

describe('fan laser geometry', () => {
  const pane = { left: 0, top: 0, right: 600, bottom: 800 };

  it('runs the beam to the far side of the player pane', () => {
    // From the spider's pane on the right, straight left: it leaves the pane at x = 0.
    expect(rayExit({ x: 900, y: 400 }, { x: -1, y: 0 }, pane)).toBeCloseTo(900);
    // Steeply downwards: it leaves through the bottom edge.
    const dir = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    const t = rayExit({ x: 700, y: 500 }, dir, pane)!;
    expect(500 + dir.y * t).toBeCloseTo(800);
    // Pointing away from the pane: no hit.
    expect(rayExit({ x: 900, y: 400 }, { x: 1, y: 0 }, pane)).toBeNull();
  });

  it('burns what the sweep passes over', () => {
    const eye = { x: 900, y: 400 };
    const a = { x: 0, y: 300 };
    const b = { x: 0, y: 500 };
    expect(inTriangle({ x: 300, y: 400 }, eye, a, b)).toBe(true);
    expect(inTriangle({ x: 300, y: 400 }, eye, b, a)).toBe(true);
    expect(inTriangle({ x: 300, y: 200 }, eye, a, b)).toBe(false);
    expect(inTriangle({ x: 950, y: 400 }, eye, a, b)).toBe(false);
  });
});
