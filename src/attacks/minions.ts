/**
 * Eggs (Hard): the spider spits egg sacs into the player's pane. They hatch
 * after a few seconds, and each mini-spider runs for the link nearest to the
 * cursor and eats it, then goes for the next one, until it dies of old age
 * (or the page changes under its feet).
 */
import { LINE, RED } from '../fx/fx';
import { OPEN_GROUND, SpiderRig } from '../spider/rig';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Point } from '../stage/stage';
import { center, distanceToBox, focusPoint, type AttackContext } from './context';

interface Egg {
  p: Point;
  age: number;
}

interface Mini {
  rig: SpiderRig;
  target: HTMLAnchorElement | null;
  eaten: number;
  age: number;
  dying: number;
}

const MINI_SPEED = 130;
const MINI_LIFE = 11;
const MINI_MEALS = 2;

/** All eggs and mini-spiders living in one pane (content coordinates). */
class Brood {
  readonly z = Z.minions;
  readonly eggs: Egg[] = [];
  readonly minis: Mini[] = [];
  /** Eggs still flying towards the pane. */
  pending = 0;
  private readonly generation: number;
  private retarget = 0;

  constructor(
    private readonly ctx: AttackContext,
    readonly pane: RacerPane,
  ) {
    this.generation = pane.generation;
  }

  /** Still on the same page, with something in it (or on its way). */
  get alive(): boolean {
    return this.pane.generation === this.generation && (this.pending > 0 || this.eggs.length > 0 || this.minis.length > 0);
  }

  update(dt: number): boolean {
    if (!this.alive) return false;
    const { ctx, pane } = this;
    // The pane was stolen by the spider: the babies give up.
    const orphaned = pane.owner !== 'player';
    for (const egg of [...this.eggs]) {
      egg.age += dt;
      if (egg.age < ctx.difficulty.hatchSeconds && !orphaned) continue;
      this.eggs.splice(this.eggs.indexOf(egg), 1);
      if (orphaned) continue;
      ctx.fragments.burst(pane.toStage(egg.p), { count: 10, colors: [LINE], speed: [20, 70], life: [0.2, 0.35], gravity: 90 });
      const rig = new SpiderRig(0.3);
      rig.x = egg.p.x;
      rig.y = egg.p.y;
      rig.visible = true;
      rig.rage = true;
      rig.plantAll(OPEN_GROUND);
      this.minis.push({ rig, target: null, eaten: 0, age: 0, dying: 0 });
      ctx.say('hatch');
    }

    this.retarget -= dt;
    const pickTargets = this.retarget <= 0;
    if (pickTargets) this.retarget = 0.25;
    const links = pickTargets ? pane.visibleLinks((a) => pane.usable(a) && !a.dataset.decoy) : [];
    const focus = focusPoint(ctx, pane);

    for (const mini of [...this.minis]) {
      mini.age += dt;
      const rig = mini.rig;
      if (orphaned || mini.age > MINI_LIFE || mini.eaten >= MINI_MEALS) mini.dying += dt;
      if (mini.dying > 0) {
        rig.scale = Math.max(0, 1 - mini.dying / 0.4);
        rig.update(dt, OPEN_GROUND);
        if (mini.dying >= 0.4) this.minis.splice(this.minis.indexOf(mini), 1);
        continue;
      }
      // Always the link nearest to where the player is looking.
      if (pickTargets && links.length) {
        mini.target = links.reduce((best, l) => (distanceToBox(focus, l.box) < distanceToBox(focus, pane.linkBox(best)) ? l.el : best), links[0].el);
      }
      if (mini.target && !pane.usable(mini.target)) mini.target = null;
      if (!mini.target) {
        rig.update(dt, OPEN_GROUND);
        continue;
      }
      const goal = center(pane.linkBox(mini.target));
      const dx = goal.x - rig.x;
      const dy = goal.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        this.eat(mini, mini.target);
        mini.target = null;
      } else {
        const step = Math.min(d, MINI_SPEED * (ctx.difficulty.id === 'hard' ? 1 : 0.7) * dt);
        rig.x += (dx / d) * step;
        rig.y += (dy / d) * step;
        rig.lookAt = goal;
      }
      rig.update(dt, OPEN_GROUND);
    }
    return this.alive;
  }

  private eat(mini: Mini, link: HTMLAnchorElement): void {
    const { ctx, pane } = this;
    pane.damageLink(link, 'eaten');
    mini.eaten++;
    mini.rig.wiggle(0.3);
    const words = (link.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
    ctx.actor.countEaten(words);
    ctx.fragments.burst(pane.toStage(center(pane.linkBox(link))), { count: 16, colors: [RED, LINE, '#88A3E8'], speed: [30, 110], life: [0.2, 0.4], gravity: 120 });
  }

  draw(c: CanvasRenderingContext2D): void {
    this.pane.enterContent(c);
    for (const egg of this.eggs) {
      const hatchIn = this.ctx.difficulty.hatchSeconds - egg.age;
      // Shakes harder and pulses faster as it gets ready to hatch.
      const shake = hatchIn < 1 ? Math.sin(egg.age * 60) * (1 - hatchIn) * 2 : 0;
      c.save();
      c.translate(egg.p.x + shake, egg.p.y);
      c.fillStyle = '#101418';
      c.strokeStyle = LINE;
      c.lineWidth = 1.3;
      c.beginPath();
      c.ellipse(0, 0, 7, 9, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = RED;
      c.globalAlpha = 0.5 + 0.5 * Math.sin(egg.age * (6 + 10 * (1 - Math.max(0, hatchIn) / 3)));
      c.beginPath();
      c.arc(0, -1, 2, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    for (const mini of this.minis) mini.rig.draw(c);
  }
}

const broods = new WeakMap<RacerPane, Brood>();

/** Race over: eggs vanish, mini-spiders curl up. */
export function clearBrood(pane: RacerPane): void {
  const brood = broods.get(pane);
  if (!brood) return;
  brood.eggs.length = 0;
  for (const mini of brood.minis) mini.dying = Math.max(mini.dying, 0.01);
}

/** Spits egg sacs around the cursor in the player's pane. */
export async function layEggs(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  let brood = broods.get(pane);
  if (brood?.alive && brood.minis.length + brood.eggs.length + brood.pending >= 6) return false;
  if (!brood?.alive) {
    brood = new Brood(ctx, pane);
    broods.set(pane, brood);
  }
  const target = brood;
  target.pending += 3;
  ctx.stage.add(target);
  const view = pane.visibleContent();
  const focus = focusPoint(ctx, pane);
  ctx.actor.holds++;
  ctx.actor.status = 'lay(eggs) · 3s';
  try {
    const flights: Promise<void>[] = [];
    for (let i = 0; i < 3; i++) {
      const spot = {
        x: Math.min(view.right - 30, Math.max(view.left + 30, focus.x + (Math.random() - 0.5) * 300)),
        y: Math.min(view.bottom - 30, Math.max(view.top + 30, focus.y + (Math.random() - 0.5) * 200)),
      };
      const from = ctx.actor.spinneretOnStage();
      flights.push(
        new Promise<void>((resolve) => {
          let t = 0;
          ctx.stage.add({
            z: Z.projectiles,
            update(dt) {
              t += dt / 0.36;
              if (t >= 1) {
                target.pending--;
                target.eggs.push({ p: spot, age: 0 });
                resolve();
                return false;
              }
              return true;
            },
            draw(c) {
              const to = pane.toStage(spot);
              const x = from.x + (to.x - from.x) * t;
              const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * 80;
              c.fillStyle = '#101418';
              c.strokeStyle = LINE;
              c.beginPath();
              c.ellipse(x, y, 6, 8, t * 8, 0, Math.PI * 2);
              c.fill();
              c.stroke();
            },
          });
        }),
      );
      await ctx.stage.wait(0.09);
    }
    await Promise.all(flights);
    ctx.say('eggs');
  } finally {
    ctx.actor.holds--;
  }
  return true;
}
