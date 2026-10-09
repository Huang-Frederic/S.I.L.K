import { describe, expect, it } from 'vitest';
import type { Box } from '../../src/stage/stage';
import { segmentHitsBox } from '../../src/spider/actor';
import { solveKnee } from '../../src/spider/rig';
import { cameraTarget, planWalk, wordsAroundLink } from '../../src/spider/route';

const box = (left: number, top: number, right: number, bottom = top + 20): Box => ({ left, top, right, bottom });

describe('wordsAroundLink', () => {
  it('keeps only the words of the link line, split left and right', () => {
    const link = box(200, 100, 260);
    const words = [box(10, 100, 50), box(60, 100, 120), box(270, 100, 300), box(10, 130, 50), box(130, 101, 190)];
    expect(wordsAroundLink(link, words)).toEqual({ before: [0, 1, 4], after: [2] });
  });
});

describe('planWalk', () => {
  const mouth = 18;

  it('walks rightwards through the words before the link, eating them in order', () => {
    const link = box(200, 100, 260);
    const before = [box(10, 100, 50), box(60, 100, 120), box(130, 100, 190)];
    const plan = planWalk(link, before, [box(270, 100, 300)], mouth);
    expect(plan.direction).toBe(1);
    expect(plan.start.x).toBeLessThan(10);
    expect(plan.end.x + mouth).toBeCloseTo(202);
    expect(plan.start.y).toBe(110);
    expect(plan.eats.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(plan.eats.every((e) => e.side === 'before')).toBe(true);
  });

  it('walks leftwards when the link starts its line', () => {
    const link = box(10, 100, 60);
    const after = [box(70, 100, 100), box(110, 100, 150)];
    const plan = planWalk(link, [], after, mouth);
    expect(plan.direction).toBe(-1);
    expect(plan.start.x).toBeGreaterThan(150);
    expect(plan.end.x - mouth).toBeCloseTo(58);
    // The farthest word is met first.
    expect(plan.eats.map((e) => e.index)).toEqual([1, 0]);
  });

  it('eats at most maxWords, the closest to the link', () => {
    const link = box(500, 0, 540);
    const before = Array.from({ length: 12 }, (_, i) => box(i * 40, 0, i * 40 + 30));
    const plan = planWalk(link, before, [], mouth, 4);
    expect(plan.eats.map((e) => e.index)).toEqual([8, 9, 10, 11]);
    expect(plan.start.x).toBeLessThan(320);
  });

  it('still produces a short walk when the line has no other word', () => {
    const plan = planWalk(box(100, 0, 150), [], [], mouth);
    expect(plan.eats).toEqual([]);
    expect(plan.end.x - plan.start.x).toBeGreaterThanOrEqual(mouth);
  });
});

describe('cameraTarget', () => {
  it('keeps the camera inside the content', () => {
    expect(cameraTarget(50, 800, 5000)).toBe(0);
    expect(cameraTarget(2000, 800, 5000)).toBeCloseTo(2000 - 800 * 0.42);
    expect(cameraTarget(4990, 800, 5000)).toBe(4200);
  });
});

describe('solveKnee (two-bone IK)', () => {
  const hip = { x: 0, y: 0 };

  it('keeps both segment lengths', () => {
    const foot = { x: 60, y: 20 };
    const knee = solveKnee(hip, foot, 40, 40, { x: -10, y: -10 });
    expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(40);
    expect(Math.hypot(foot.x - knee.x, foot.y - knee.y)).toBeCloseTo(40);
  });

  it('bends away from the body', () => {
    const foot = { x: 60, y: 0 };
    expect(solveKnee(hip, foot, 40, 40, { x: 30, y: 10 }).y).toBeLessThan(0);
    expect(solveKnee(hip, foot, 40, 40, { x: 30, y: -10 }).y).toBeGreaterThan(0);
  });

  it('stretches straight towards an unreachable foot', () => {
    const knee = solveKnee(hip, { x: 200, y: 0 }, 40, 40, { x: 0, y: 10 });
    expect(knee).toEqual({ x: 40, y: 0 });
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
