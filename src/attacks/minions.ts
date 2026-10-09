/**
 * Mini-spiders (Hard): they burst out of a fake link when the player clicks
 * it. Each one scatters, then runs for the link nearest to the cursor and
 * eats it, then goes for the next one, until it has eaten its fill or dies
 * of old age (or the page changes under its feet).
 */
import { LINE, RED } from '../fx/fx';
import { OPEN_GROUND, SpiderRig } from '../spider/rig';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Point, type Stage } from '../stage/stage';
import { center, distanceToBox, focusPoint, type AttackContext } from './context';

interface Mini {
  rig: SpiderRig;
  target: HTMLAnchorElement | null;
  /** Where it scatters to first, out of the fake link. */
  scatter: Point | null;
  eaten: number;
  age: number;
  dying: number;
}

const MINI_SPEED = 130;
const MINI_LIFE = 11;
const MINI_MEALS = 2;
/** How long a mini-spider takes to pop out to full size (s). */
const POP = 0.25;

/** The mini-spiders living in one pane (content coordinates). */
class Brood {
  readonly z = Z.minions;
  readonly minis: Mini[] = [];
  private readonly generation: number;
  private retarget = 0;

  constructor(
    private readonly ctx: AttackContext,
    readonly pane: RacerPane,
  ) {
    this.generation = pane.generation;
  }

  /** Still on the same page, with someone in it. */
  get alive(): boolean {
    return this.pane.generation === this.generation && this.minis.length > 0;
  }

  update(dt: number): boolean {
    if (!this.alive) return false;
    const { ctx, pane } = this;
    // The pane was stolen by the spider: the babies give up.
    const orphaned = pane.owner !== 'player';
    this.retarget -= dt;
    const pickTargets = this.retarget <= 0;
    if (pickTargets) this.retarget = 0.25;
    const links = pickTargets ? pane.visibleLinks((a) => pane.usable(a) && !a.dataset.decoy) : [];
    const focus = focusPoint(ctx, pane);
    const speed = MINI_SPEED * (ctx.difficulty.id === 'hard' ? 1 : 0.7);

    for (const mini of [...this.minis]) {
      mini.age += dt;
      const rig = mini.rig;
      if (orphaned || mini.age > MINI_LIFE || mini.eaten >= MINI_MEALS) mini.dying += dt;
      if (mini.dying > 0) {
        rig.scale = Math.min(rig.scale, Math.max(0, 1 - mini.dying / 0.4));
        rig.update(dt, OPEN_GROUND);
        if (mini.dying >= 0.4) this.minis.splice(this.minis.indexOf(mini), 1);
        continue;
      }
      rig.scale = Math.min(1, mini.age / POP);
      // Always the link nearest to where the player is looking.
      if (pickTargets && links.length) {
        mini.target = links.reduce((best, l) => (distanceToBox(focus, l.box) < distanceToBox(focus, pane.linkBox(best)) ? l.el : best), links[0].el);
      }
      if (mini.target && !pane.usable(mini.target)) mini.target = null;
      const goal = mini.scatter ?? (mini.target ? center(pane.linkBox(mini.target)) : null);
      if (!goal) {
        rig.update(dt, OPEN_GROUND);
        continue;
      }
      const dx = goal.x - rig.x;
      const dy = goal.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        if (mini.scatter) mini.scatter = null;
        else if (mini.target) {
          this.eat(mini, mini.target);
          mini.target = null;
        }
      } else {
        const step = Math.min(d, speed * (mini.scatter ? 1.4 : 1) * dt);
        rig.x += (dx / d) * step;
        rig.y += (dy / d) * step;
        rig.face({ x: dx, y: dy });
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
    for (const mini of this.minis) mini.rig.draw(c);
  }
}

/** Every brood of a race (stage), so that they can all be cleared at the end. */
const broods = new WeakMap<Stage, Set<Brood>>();

/** Race over: the mini-spiders curl up and vanish. */
export function clearMinis(stage: Stage): void {
  for (const brood of broods.get(stage) ?? []) {
    for (const mini of brood.minis) mini.dying = Math.max(mini.dying, 0.01);
  }
}

/**
 * Lets `count` mini-spiders out at `at` (content coordinates of `pane`):
 * they scatter around it, then go for the player's links.
 */
export function releaseMinis(ctx: AttackContext, pane: RacerPane, at: Point, count: number): void {
  if (count <= 0) return;
  const brood = new Brood(ctx, pane);
  for (let i = 0; i < count; i++) {
    const rig = new SpiderRig(0.3);
    rig.x = at.x;
    rig.y = at.y;
    rig.visible = true;
    rig.rage = true;
    rig.scale = 0;
    rig.plantAll(OPEN_GROUND);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
    const scatter = { x: at.x + Math.cos(angle) * (40 + Math.random() * 30), y: at.y + Math.sin(angle) * (26 + Math.random() * 20) };
    rig.face({ x: scatter.x - at.x, y: scatter.y - at.y });
    rig.tilt = rig.targetTilt;
    brood.minis.push({ rig, target: null, scatter, eaten: 0, age: 0, dying: 0 });
  }
  let all = broods.get(ctx.stage);
  if (!all) broods.set(ctx.stage, (all = new Set()));
  all.add(brood);
  const set = all;
  ctx.stage.add({
    z: brood.z,
    update: (dt) => {
      const alive = brood.update(dt);
      if (!alive) set.delete(brood);
      return alive;
    },
    draw: (c) => brood.draw(c),
  });
}
