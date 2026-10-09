import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/stage/stage';
import { OPEN_GROUND, SpiderRig } from '../../src/spider/rig';

/** Runs the rig along a path (facing where it goes) and calls `check` every frame. */
function walk(path: (t: number) => Point, seconds: number, check: (rig: SpiderRig) => void): void {
  const rig = new SpiderRig();
  const start = path(0);
  const next = path(0.05);
  rig.x = start.x;
  rig.y = start.y;
  // Already facing the way it goes.
  rig.face({ x: next.x - start.x, y: next.y - start.y });
  rig.tilt = rig.targetTilt;
  rig.visible = true;
  rig.plantAll(OPEN_GROUND);
  const dt = 1 / 60;
  for (let t = dt; t < seconds; t += dt) {
    const p = path(t);
    rig.face({ x: p.x - rig.x, y: p.y - rig.y });
    rig.x = p.x;
    rig.y = p.y;
    rig.update(dt, OPEN_GROUND);
    check(rig);
  }
}

/** Angles of the drawn feet around the body, per side, in body space (front to back). */
function footAngles(rig: SpiderRig): { right: number[]; left: number[] } {
  const feet = rig.feet();
  const c = Math.cos(-rig.tilt);
  const s = Math.sin(-rig.tilt);
  const angle = (p: Point, side: 1 | -1) => {
    const dx = p.x - rig.x;
    const dy = p.y - rig.y;
    return Math.atan2(dx * s + dy * c, (dx * c - dy * s) * side);
  };
  return { right: feet.slice(0, 4).map((p) => angle(p, 1)), left: feet.slice(4).map((p) => angle(p, -1)) };
}

const ordered = (angles: number[]) => angles.every((a, i) => i === 0 || a > angles[i - 1]);

describe('gait', () => {
  it('keeps its feet within reach while walking', () => {
    let worst = 0;
    walk((t) => ({ x: t * 120, y: t * 36 }), 4, (rig) => (worst = Math.max(worst, rig.maxStretch())));
    expect(worst).toBeLessThan(1.05);
  });

  it('keeps up when it breaks into a run', () => {
    for (const [speed, limit] of [
      [300, 1.25],
      [900, 1.4],
    ]) {
      let worst = 0;
      walk((t) => ({ x: t * speed, y: t * speed * 0.3 }), 4, (rig) => (worst = Math.max(worst, rig.maxStretch())));
      expect(worst).toBeLessThan(limit);
    }
  });

  it('never crosses its legs, even through sharp turns', () => {
    // A zigzag with U-turns, at walking and running speed.
    for (const speed of [120, 500]) {
      const path = (t: number) => {
        const leg = Math.floor(t);
        const u = t - leg;
        const dir = leg % 2 === 0 ? 1 : -1;
        return { x: (dir > 0 ? u : 1 - u) * speed, y: t * 60 };
      };
      walk(path, 6, (rig) => {
        const { right, left } = footAngles(rig);
        expect(ordered(right)).toBe(true);
        expect(ordered(left)).toBe(true);
      });
    }
  });

  it('turns to face where it goes', () => {
    walk((t) => ({ x: 0, y: t * 150 }), 1.5, () => {});
    const rig = new SpiderRig();
    rig.face({ x: 0, y: 1 }); // going down: the eye leads, head down
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(Math.abs(Math.abs(rig.tilt) - Math.PI)).toBeLessThan(0.01);
    expect(rig.eye().y).toBeGreaterThan(rig.y);
  });

  it('tucks its feet under the body when it lifts them', () => {
    const rig = new SpiderRig();
    rig.plantAll(OPEN_GROUND);
    rig.x = 5000;
    rig.liftAll();
    expect(rig.maxStretch()).toBeLessThan(1);
  });

  it('lets a foot crush the word it lands on', () => {
    const rig = new SpiderRig();
    const word = { el: {} as HTMLElement, box: { left: 0, top: 0, right: 10, bottom: 10 }, link: null, gone: false };
    const ground = { hold: (point: Point) => ({ point, word }) };
    rig.plantAll(ground);
    let crushed = 0;
    rig.onPlant = (w) => {
      w.gone = true;
      crushed++;
      return true;
    };
    for (let i = 0; i < 120; i++) {
      rig.x += 3;
      rig.update(1 / 60, ground);
      word.gone = false;
    }
    expect(crushed).toBeGreaterThan(0);
    expect(rig.heldWords().length).toBeLessThan(8);
  });
});
