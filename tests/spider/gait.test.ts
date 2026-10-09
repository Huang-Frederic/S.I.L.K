/**
 * The spider's walk on text: its legs never cross, its feet only ever stand
 * on words, it never spins round, and it walks in rhythm.
 */
import { describe, expect, it } from 'vitest';
import { OPEN_GROUND, SpiderRig, type Foothold, type Ground, type LegShape } from '../../src/spider/rig';
import type { Box, Point } from '../../src/stage/stage';
import type { Word } from '../../src/stage/wordIndex';

const LINE = 32;

/** Lines of words like a page of text, with an optional blank area (no words at all). */
function textGround(blank?: Box): Ground & { words: Word[] } {
  const byLine = new Map<number, Word[]>();
  const words: Word[] = [];
  for (let line = -80; line <= 80; line++) {
    const top = line * LINE;
    const row: Word[] = [];
    let x = -4000 + ((line * 37) % 23);
    let n = line * 7;
    while (x < 4000) {
      const w = 26 + ((n++ * 29) % 61);
      const box = { left: x, right: x + w, top, bottom: top + 22 };
      const inBlank = blank && box.right > blank.left && box.left < blank.right && box.bottom > blank.top && box.top < blank.bottom;
      if (!inBlank) {
        const word = { el: null as unknown as HTMLElement, box, link: null, gone: false };
        row.push(word);
        words.push(word);
      }
      x += w + 8;
    }
    byLine.set(line, row);
  }
  return {
    words,
    hold(desired: Point, accept?: (p: Point) => boolean): Foothold | null {
      let best: Foothold | null = null;
      let bestD = 60;
      const first = Math.floor((desired.y - 60) / LINE);
      for (let line = first; line <= first + Math.ceil(120 / LINE) + 1; line++) {
        for (const word of byLine.get(line) ?? []) {
          if (word.gone) continue;
          const b = word.box;
          const p = { x: Math.min(Math.max(desired.x, b.left + 3), b.right - 3), y: b.top + 14 };
          const d = Math.hypot(p.x - desired.x, p.y - desired.y);
          if (d < bestD && (!accept || accept(p))) {
            best = { point: p, word };
            bestD = d;
          }
        }
      }
      return best;
    },
  };
}

function cross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when any two legs (hip-knee-foot polylines) cross. */
function legsCross(legs: LegShape[]): boolean {
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = [legs[i].hip, legs[i].knee, legs[i].foot];
      const b = [legs[j].hip, legs[j].knee, legs[j].foot];
      for (let s = 0; s < 2; s++) for (let t = 0; t < 2; t++) if (cross(a[s], a[s + 1], b[t], b[t + 1])) return true;
    }
  }
  return false;
}

/**
 * Walks the rig along `path` at `speed` (px/s), 60 frames a second,
 * accelerating like the actor does, and calls `check` every frame.
 */
function walk(rig: SpiderRig, ground: Ground, path: Point[], speed: number, check: (rig: SpiderRig) => void): void {
  const dt = 1 / 60;
  let v = 0;
  for (const to of path) {
    for (let guard = 0; guard < 20_000; guard++) {
      const dx = to.x - rig.x;
      const dy = to.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.6) break;
      v = Math.min(speed, v + speed * dt * 6, Math.max(speed * 0.3, d * 5));
      const step = Math.min(d, v * dt);
      rig.x += (dx / d) * step;
      rig.y += (dy / d) * step;
      rig.face({ x: dx, y: dy });
      rig.update(dt, ground);
      check(rig);
    }
  }
}

function standing(at: Point, ground: Ground): SpiderRig {
  const rig = new SpiderRig(1);
  rig.x = at.x;
  rig.y = at.y;
  rig.visible = true;
  rig.plantAll(ground);
  return rig;
}

const ZIGZAG: Point[] = [
  { x: 300, y: 0 },
  { x: -200, y: 40 },
  { x: 250, y: -260 },
  { x: 250, y: 300 },
  { x: -300, y: 300 },
  { x: -300, y: -300 },
  { x: 120, y: 90 },
  { x: -100, y: 60 },
];

describe('SpiderRig walking on text', () => {
  for (const speed of [70, 125, 300, 900]) {
    it(`never crosses its legs, feet always on words (${speed} px/s, U-turns included)`, () => {
      const ground = textGround();
      const rig = standing({ x: 0, y: 11 }, ground);
      let frames = 0;
      let crossings = 0;
      let offWord = 0;
      walk(rig, ground, ZIGZAG, speed, () => {
        frames++;
        const legs = rig.legGeometry();
        if (legsCross(legs)) crossings++;
        for (const leg of legs) {
          if (!leg.planted) continue;
          const b = leg.word?.box;
          if (!b || leg.foot.x < b.left - 0.5 || leg.foot.x > b.right + 0.5 || leg.foot.y < b.top - 0.5 || leg.foot.y > b.bottom + 0.5) offWord++;
        }
      });
      expect(frames).toBeGreaterThan(100);
      expect(crossings).toBe(0);
      expect(offWord).toBe(0);
    });
  }

  it('keeps planted legs within reach, walking or running', () => {
    for (const speed of [125, 300, 900]) {
      const ground = textGround();
      const rig = standing({ x: 0, y: 11 }, ground);
      let worst = 0;
      walk(rig, ground, ZIGZAG, speed, () => (worst = Math.max(worst, rig.maxStretch())));
      expect(worst).toBeLessThanOrEqual(0.98);
    }
  });

  for (const [name, to] of [
    ['across', { x: 900, y: 11 }],
    ['down', { x: 0, y: 30 * LINE + 11 }],
  ] as const) {
    it(`walks in rhythm (${name}): one group of four legs in the air at a time`, () => {
      const ground = textGround();
      const rig = standing({ x: 0, y: 11 }, ground);
      let frames = 0;
      let mixed = 0;
      let stepping = 0;
      walk(rig, ground, [to], 125, () => {
        frames++;
        // Legs 0-3 are the right side, 4-7 the left; tetrapod groups: R1 R3 L2 L4 / R2 R4 L1 L3.
        const up = rig.legGeometry().map((l) => !l.planted);
        const a = [0, 2, 5, 7].some((i) => up[i]);
        const b = [1, 3, 4, 6].some((i) => up[i]);
        if (a || b) stepping++;
        if (a && b) mixed++;
      });
      expect(stepping / frames).toBeGreaterThan(0.3);
      expect(mixed / frames).toBeLessThan(0.12);
    });
  }

  it('never spins round: the body stays upright, the eye looks where it goes', () => {
    const ground = textGround();
    const rig = standing({ x: 0, y: 11 }, ground);
    let tilted = 0;
    walk(rig, ground, ZIGZAG, 300, () => (tilted = Math.max(tilted, Math.abs(rig.tilt))));
    expect(tilted).toBe(0);
    walk(rig, ground, [{ x: -100, y: 500 }], 125, () => {});
    for (let i = 0; i < 30; i++) rig.update(1 / 60, ground);
    expect(rig.eye().y).toBeGreaterThan(rig.y + 8);
    walk(rig, ground, [{ x: 300, y: 500 }], 125, () => {});
    expect(rig.eye().x).toBeGreaterThan(rig.x + 4);
  });

  it('holds a leg up rather than grip thin air, and puts it down again on words', () => {
    // A blank band, two lines high, across the page.
    const ground = textGround({ left: -4000, right: 4000, top: 4 * LINE - 4, bottom: 6 * LINE + 26 });
    const rig = standing({ x: 0, y: 11 }, ground);
    let lifted = 0;
    let onAir = 0;
    walk(rig, ground, [{ x: 0, y: 5 * LINE + 11 }, { x: 0, y: 11 * LINE + 11 }], 125, () => {
      for (const leg of rig.legGeometry()) {
        if (!leg.planted) lifted++;
        else if (!leg.word) onAir++;
      }
    });
    expect(lifted).toBeGreaterThan(0);
    expect(onAir).toBe(0);
    // Past the gap, every foot is down on a word again.
    for (let i = 0; i < 60; i++) rig.update(1 / 60, ground);
    expect(rig.legGeometry().every((l) => l.planted && l.word)).toBe(true);
  });

  it('settles back on its resting spots when it stops', () => {
    const ground = textGround();
    const rig = standing({ x: 0, y: 11 }, ground);
    walk(rig, ground, [{ x: 400, y: 11 }], 300, () => {});
    for (let i = 0; i < 120; i++) rig.update(1 / 60, ground);
    const settled = standing({ x: rig.x, y: rig.y }, ground);
    const now = rig.feet();
    const rest = settled.feet();
    for (let i = 0; i < now.length; i++) expect(Math.hypot(now[i].x - rest[i].x, now[i].y - rest[i].y)).toBeLessThan(rig.reach * 0.35);
    expect(rig.legGeometry().every((l) => l.planted)).toBe(true);
  });

  it('tucks its feet in when lifted', () => {
    const rig = standing({ x: 0, y: 0 }, OPEN_GROUND);
    rig.x += 400;
    rig.liftAll();
    rig.update(1 / 60);
    for (const leg of rig.legGeometry()) {
      expect(leg.planted).toBe(false);
      expect(Math.hypot(leg.foot.x - leg.hip.x, leg.foot.y - leg.hip.y)).toBeLessThan(rig.reach);
    }
  });

  it('may crush the words it steps on', () => {
    const ground = textGround();
    const rig = standing({ x: 0, y: 11 }, ground);
    const crushed: Word[] = [];
    rig.onPlant = (word) => {
      crushed.push(word);
      word.gone = true;
      return true;
    };
    walk(rig, ground, [{ x: 600, y: 11 }], 125, () => {});
    expect(crushed.length).toBeGreaterThan(4);
    expect(rig.heldWords().every((w) => !w.gone)).toBe(true);
  });
});
