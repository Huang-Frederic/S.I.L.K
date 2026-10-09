/**
 * The director's pacing, with a fake stage clock and fake attacks: Hard keeps
 * its 4-8 s cadence even though its rage is always on, Normal's rage (a
 * reaction) still speeds attacks up, and the cursor tug stays rare.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AttackContext } from '../src/attacks/context';
import { ATTACKS, Director } from '../src/attacks/director';
import { DIFFICULTIES, type AttackId, type Difficulty } from '../src/game/difficulty';
import type { SpiderRunner } from '../src/spider/runner';

class FakeStage {
  time = 0;
  private waiters: Array<(dt: number) => void> = [];

  frame(): Promise<number> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Runs `seconds` of frames, letting the director's coroutine catch up after each. */
  async run(seconds: number, dt = 0.05): Promise<void> {
    for (let t = 0; t < seconds; t += dt) {
      this.time += dt;
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve(dt);
      for (let i = 0; i < 6; i++) await Promise.resolve();
    }
  }
}

const original = { ...ATTACKS };
afterEach(() => Object.assign(ATTACKS, original));

/** Plays `seconds` of a race and returns when each attack landed. */
async function play(difficulty: Difficulty, rage: boolean, seconds: number): Promise<Array<{ id: AttackId; at: number }>> {
  const stage = new FakeStage();
  const log: Array<{ id: AttackId; at: number }> = [];
  for (const id of Object.keys(ATTACKS) as AttackId[]) {
    ATTACKS[id] = async () => {
      log.push({ id, at: stage.time });
      return true;
    };
  }
  const ctx = {
    stage,
    difficulty,
    actor: { visible: true, interruptible: true, holds: 0, surface: { owner: 'spider' } },
    cursor: { available: true, harassed: false, release() {} },
    playerPane: () => ({ decoys: () => [] }),
  } as unknown as AttackContext;
  const director = new Director(ctx, { snatching: false } as SpiderRunner, { active: () => true, rage: () => rage, random: () => 0 });
  void director.run();
  await stage.run(seconds);
  director.stop();
  return log;
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

describe('Director pacing', () => {
  it('keeps Hard at one attack every 4-8 s, rage or not', async () => {
    const log = await play({ ...DIFFICULTIES.hard, chain: 0 }, true, 60);
    expect(log.length).toBeGreaterThan(8);
    for (const gap of gaps(log.map((l) => l.at))) expect(gap).toBeGreaterThanOrEqual(3.95);
  });

  it('attacks twice as often on Normal once the rage kicks in', async () => {
    const calm = await play(DIFFICULTIES.normal, false, 80);
    const angry = await play(DIFFICULTIES.normal, true, 80);
    expect(gaps(calm.map((l) => l.at))[0]).toBeCloseTo(22, 0);
    expect(gaps(angry.map((l) => l.at))[0]).toBeCloseTo(11, 0);
  });

  it('tugs the cursor rarely', async () => {
    const hard = DIFFICULTIES.hard;
    const log = await play({ ...hard, attacks: ['harass', 'web'], chain: 0 }, true, 200);
    const tugs = log.filter((l) => l.id === 'harass').map((l) => l.at);
    expect(tugs.length).toBeGreaterThan(0);
    expect(tugs[0]).toBeGreaterThanOrEqual(hard.harassGap);
    for (const gap of gaps(tugs)) expect(gap).toBeGreaterThanOrEqual(hard.harassGap);
  });
});
