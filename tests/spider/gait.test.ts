import { describe, expect, it } from 'vitest';
import { OPEN_GROUND, SpiderRig } from '../../src/spider/rig';

/** Runs the rig in a straight line and returns the worst leg stretch seen. */
function run(speed: number, seconds = 4): number {
  const rig = new SpiderRig();
  rig.visible = true;
  rig.plantAll(OPEN_GROUND);
  const dt = 1 / 60;
  let worst = 0;
  for (let t = 0; t < seconds; t += dt) {
    rig.x += speed * dt;
    rig.y += speed * 0.3 * dt;
    rig.update(dt, OPEN_GROUND);
    worst = Math.max(worst, rig.maxStretch());
  }
  return worst;
}

describe('gait', () => {
  it('keeps its feet within reach while walking', () => {
    expect(run(120)).toBeLessThan(1);
  });

  it('keeps up when it breaks into a run', () => {
    expect(run(300)).toBeLessThan(1.2);
    expect(run(900)).toBeLessThan(1.35);
  });

  it('tucks its feet under the body when it lifts them', () => {
    const rig = new SpiderRig();
    rig.plantAll(OPEN_GROUND);
    rig.x = 5000;
    rig.liftAll();
    expect(rig.maxStretch()).toBeLessThan(1);
  });
});
