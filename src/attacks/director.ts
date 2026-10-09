/**
 * The director decides when the spider attacks the player and with what.
 *
 *  - Attacks come every `cooldown` seconds with no warning. Rage shortens
 *    the wait when it is a reaction (Normal, near the target); on Hard the
 *    rage is always on and the cadence stays the table's.
 *  - On Hard an attack often chains straight into another one (web trap,
 *    then the fan laser, then a word bombardment...).
 *  - The cursor tug is rare: at least `harassGap` seconds between two.
 *
 * The link snatch is not the director's: it answers a click of the player's
 * (see game/snatch.ts and the race screen).
 */
import { RAGE, type AttackId } from '../game/difficulty';
import type { SpiderRunner } from '../spider/runner';
import { StageClosedError } from '../stage/stage';
import { bombard, fanLaser, harass, plantDecoys, webTrap } from './attacks';
import type { AttackContext } from './context';
import { clearMinis } from './minions';

type Attack = (ctx: AttackContext) => Promise<boolean>;

export const ATTACKS: Record<AttackId, Attack> = {
  web: webTrap,
  laser: fanLaser,
  bombard,
  decoy: plantDecoys,
  harass,
};

/** Natural follow-ups when attacks chain. */
const FOLLOW_UPS: Partial<Record<AttackId, AttackId[]>> = {
  web: ['laser', 'bombard'],
  laser: ['web', 'bombard'],
  bombard: ['laser', 'web'],
  decoy: ['web', 'bombard'],
  harass: ['laser', 'decoy'],
};

export interface DirectorOptions {
  /** True while the race is on and attacks make sense. */
  active: () => boolean;
  rage: () => boolean;
  random?: () => number;
}

export class Director {
  private stopped = false;
  private last: AttackId | null = null;
  /** Stage time of the last cursor tug (none in the first `harassGap` seconds either). */
  private lastHarass = 0;
  private readonly random: () => number;

  constructor(
    private readonly ctx: AttackContext,
    private readonly runner: SpiderRunner,
    private readonly options: DirectorOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  /** Stops attacking. With `clear`, ongoing effects end too (race over). */
  stop(clear = false): void {
    this.stopped = true;
    if (!clear) return;
    clearMinis(this.ctx.stage);
    this.ctx.cursor.release();
  }

  async run(): Promise<void> {
    const d = this.ctx.difficulty;
    if (!d.attacks.length) return;
    let wait = d.firstAttack;
    try {
      while (!this.stopped) {
        const dt = await this.ctx.stage.frame();
        if (!this.options.active()) continue;
        const faster = this.options.rage() && d.rage !== 'always';
        if (!this.runner.snatching) wait -= dt / (faster ? RAGE.cooldown : 1);
        if (wait > 0 || !this.ready()) continue;
        let chained = 0;
        let previous: AttackId | null = null;
        do {
          const id = this.pick(previous);
          if (!id || !this.ready()) break;
          if (await ATTACKS[id](this.ctx)) {
            previous = id;
            this.last = id;
            if (id === 'harass') this.lastHarass = this.ctx.stage.time;
            chained++;
          } else if (!previous) {
            // Nothing to hit with that one: try another next frame.
            break;
          }
          if (this.stopped || !this.options.active()) return;
        } while (chained < 3 && this.random() < d.chain);
        // Nothing could be hit (no link on screen...): look again shortly.
        wait = chained ? d.cooldown[0] + this.random() * (d.cooldown[1] - d.cooldown[0]) : 0.5;
      }
    } catch (error) {
      if (!(error instanceof StageClosedError)) throw error;
    }
  }

  /** The spider is on its page, standing, and free to attack. */
  private ready(): boolean {
    const { actor } = this.ctx;
    return actor.visible && actor.interruptible && actor.holds === 0 && !this.runner.snatching && actor.surface?.owner === 'spider';
  }

  private applicable(id: AttackId): boolean {
    const { ctx } = this;
    switch (id) {
      case 'decoy':
        return ctx.playerPane().decoys().length < ctx.difficulty.maxDecoys;
      case 'harass':
        return ctx.cursor.available && !ctx.cursor.harassed && ctx.stage.time - this.lastHarass >= ctx.difficulty.harassGap;
      default:
        return true;
    }
  }

  private pick(previous: AttackId | null): AttackId | null {
    const all = this.ctx.difficulty.attacks.filter((id) => this.applicable(id));
    if (previous) {
      const next = (FOLLOW_UPS[previous] ?? []).filter((id) => all.includes(id) && id !== previous);
      if (next.length) return next[Math.floor(this.random() * next.length)];
    }
    const fresh = all.filter((id) => id !== this.last);
    const pool = fresh.length ? fresh : all;
    return pool[Math.floor(this.random() * pool.length)] ?? null;
  }
}
