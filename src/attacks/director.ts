/**
 * The director decides when the spider attacks the player and with what.
 *
 *  - Attacks come every `cooldown` seconds (halved in rage), with no
 *    warning. On Hard an attack often chains straight into another one
 *    (web trap, then laser the only free link, then eggs...).
 *  - Link snatch (Hard): whenever it is off cooldown and the cursor gets
 *    within ~120 px of a link, the spider leaps across and steals it. It
 *    goes for the target link first, then for a link to a page that links to
 *    the target, and otherwise for the link nearest to the cursor, unless it
 *    is itself one hop from the target. It never snatches a link to a page
 *    it has already visited.
 */
import { RAGE, type AttackId } from '../game/difficulty';
import type { SpiderRunner } from '../spider/runner';
import { StageClosedError } from '../stage/stage';
import { blackout, blackoutActive, bombard, endBlackout, harass, laserSnipe, plantDecoys, webTrap } from './attacks';
import { distanceToBox, type AttackContext } from './context';
import { clearBrood, layEggs } from './minions';

type Attack = (ctx: AttackContext) => Promise<boolean>;

export const ATTACKS: Record<AttackId, Attack> = {
  web: webTrap,
  laser: laserSnipe,
  bombard,
  decoy: plantDecoys,
  eggs: layEggs,
  blackout,
  harass,
};

/** Natural follow-ups when attacks chain. */
const FOLLOW_UPS: Partial<Record<AttackId, AttackId[]>> = {
  web: ['laser', 'eggs'],
  laser: ['eggs', 'bombard'],
  bombard: ['laser', 'web'],
  decoy: ['blackout', 'harass'],
  blackout: ['eggs', 'decoy'],
  eggs: ['web', 'blackout'],
  harass: ['laser', 'decoy'],
};

export interface DirectorOptions {
  /** True while the race is on and attacks make sense. */
  active: () => boolean;
  rage: () => boolean;
  /** Canonical-or-linked title already visited by the spider. */
  visited: (title: string) => boolean;
  /** The page links to the target (it is one of the target's backlinks). */
  isBridge: (title: string) => boolean;
  random?: () => number;
}

export class Director {
  private stopped = false;
  private snatchCooldown = 5;
  private sinceSnatchCheck = 0;
  private last: AttackId | null = null;
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
    endBlackout(this.ctx.stage);
    clearBrood(this.ctx.playerPane());
    this.ctx.cursor.release();
  }

  async run(): Promise<void> {
    const d = this.ctx.difficulty;
    if (!d.attacks.length && !d.snatch) return;
    let wait = d.firstAttack;
    try {
      while (!this.stopped) {
        const dt = await this.ctx.stage.frame();
        if (!this.options.active()) continue;
        const rage = this.options.rage();
        if (!this.runner.snatching) {
          this.snatchCooldown -= dt;
          wait -= dt / (rage ? RAGE.cooldown : 1);
        }
        if (this.trySnatch(dt)) continue;
        if (wait > 0 || !this.ready()) continue;
        let chained = 0;
        let previous: AttackId | null = null;
        do {
          const id = this.pick(previous);
          if (!id || !this.ready()) break;
          if (await ATTACKS[id](this.ctx)) {
            previous = id;
            this.last = id;
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
    const pane = this.ctx.playerPane();
    switch (id) {
      case 'decoy':
        return pane.decoys().length < this.ctx.difficulty.maxDecoys;
      case 'blackout':
        return !blackoutActive(this.ctx.stage);
      case 'harass':
        return this.ctx.cursor.available && !this.ctx.cursor.harassed;
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

  /** Link snatch: steal the link the cursor is closing in on. */
  private trySnatch(dt: number): boolean {
    const snatch = this.ctx.difficulty.snatch;
    if (!snatch || this.snatchCooldown > 0 || !this.runner.canSnatch || !this.ready()) return false;
    this.sinceSnatchCheck += dt;
    if (this.sinceSnatchCheck < 0.08) return false;
    this.sinceSnatchCheck = 0;
    const pointer = this.ctx.stage.pointer;
    const pane = this.ctx.playerPane();
    if (!pointer.inside || !pane.containsStage(pointer)) return false;
    const local = pane.fromStage(pointer);
    const near = pane
      .visibleLinks((a) => pane.usable(a) && !a.dataset.decoy)
      .map((l) => ({ ...l, title: l.el.dataset.title ?? '', distance: distanceToBox(local, l.box) }))
      .filter((l) => l.title && l.distance <= snatch.radius && !this.options.visited(l.title))
      .sort((a, b) => a.distance - b.distance);
    if (!near.length) return false;
    const choice =
      near.find((l) => this.ctx.isTarget(l.title)) ??
      near.find((l) => this.options.isBridge(l.title)) ??
      (this.runner.oneHopAway ? undefined : near[0]);
    if (!choice) return false;
    if (!this.runner.requestSnatch({ pane, anchor: choice.el, title: choice.title })) return false;
    this.snatchCooldown = snatch.cooldown;
    return true;
  }
}
