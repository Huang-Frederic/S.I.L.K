/**
 * Mini-spiders (Hard): they burst out of a fake link when the player clicks
 * it, scatter, then wander about the player's page, slowly, breaking every
 * word they walk over (links included, which can no longer be clicked),
 * until they die of old age (or the page changes under their feet).
 */
import { OPEN_GROUND, SpiderRig } from '../spider/rig';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Point, type Stage } from '../stage/stage';
import { center, type AttackContext } from './context';

interface Mini {
  rig: SpiderRig;
  /** Where it scatters to first, out of the fake link. */
  scatter: Point | null;
  /** Where it wanders to next. */
  goal: Point | null;
  /** Seconds until it breaks the next word under it. */
  chew: number;
  age: number;
  dying: number;
}

/** Wandering speed (px/s): they take their time. */
const MINI_SPEED = 42;
const MINI_LIFE = 16;
/** Seconds between two words broken by one mini-spider. */
const CHEW: readonly [number, number] = [0.45, 0.9];
/** How long a mini-spider takes to pop out to full size (s). */
const POP = 0.25;

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

/** The mini-spiders living in one pane (content coordinates). */
class Brood {
  readonly z = Z.minions;
  readonly minis: Mini[] = [];
  private readonly generation: number;

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
    const speed = MINI_SPEED * (ctx.difficulty.id === 'hard' ? 1 : 0.75);

    for (const mini of [...this.minis]) {
      mini.age += dt;
      const rig = mini.rig;
      if (orphaned || mini.age > MINI_LIFE) mini.dying += dt;
      if (mini.dying > 0) {
        rig.scale = Math.min(rig.scale, Math.max(0, 1 - mini.dying / 0.4));
        rig.update(dt, OPEN_GROUND);
        if (mini.dying >= 0.4) this.minis.splice(this.minis.indexOf(mini), 1);
        continue;
      }
      rig.scale = Math.min(1, mini.age / POP);
      const goal = mini.scatter ?? (mini.goal ??= this.wanderFrom(rig));
      const dx = goal.x - rig.x;
      const dy = goal.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) {
        if (mini.scatter) mini.scatter = null;
        else mini.goal = null;
      } else {
        const step = Math.min(d, speed * (mini.scatter ? 2.5 : 1) * dt);
        rig.x += (dx / d) * step;
        rig.y += (dy / d) * step;
        rig.face({ x: dx, y: dy });
        rig.lookAt = goal;
      }
      // It breaks whatever word it is walking on, one at a time.
      if (!mini.scatter && (mini.chew -= dt) <= 0) {
        mini.chew = between(CHEW);
        this.chew(mini);
      }
      rig.update(dt, OPEN_GROUND);
    }
    return this.alive;
  }

  /** Somewhere nearby on the visible text with words left to break, to wander to. */
  private wanderFrom(from: Point): Point {
    const view = this.pane.visibleContent();
    const article = this.pane.articleBox() ?? view;
    const left = Math.max(view.left, article.left) + 20;
    const right = Math.max(left, Math.min(view.right, article.right) - 20);
    const top = Math.max(view.top, article.top) + 30;
    const bottom = Math.max(top, Math.min(view.bottom, article.bottom) - 30);
    const area = { left: Math.max(left, from.x - 220), right: Math.min(right, from.x + 220), top: Math.max(top, from.y - 140), bottom: Math.min(bottom, from.y + 140) };
    this.pane.words.ensure(area);
    const intact = this.pane.words.inside(area, (w) => !w.gone && !w.link?.dataset.decoy && Math.abs(w.box.left - from.x) + Math.abs(w.box.top - from.y) > 40);
    if (intact.length) return center(intact[Math.floor(Math.random() * intact.length)].box);
    const angle = Math.random() * Math.PI * 2;
    const reach = 50 + Math.random() * 110;
    return {
      x: Math.min(Math.max(from.x + Math.cos(angle) * reach, left), right),
      y: Math.min(Math.max(from.y + Math.sin(angle) * reach * 0.6, top), bottom),
    };
  }

  /** Breaks the word under a mini-spider (and with it, the link it belongs to). */
  private chew(mini: Mini): void {
    const { pane, ctx } = this;
    const at = { x: mini.rig.x, y: mini.rig.y };
    pane.words.ensure({ left: at.x - 40, right: at.x + 40, top: at.y - 30, bottom: at.y + 30 });
    const word = pane.words.nearest(at, 26, (w) => !w.gone && !w.link?.dataset.decoy);
    if (!word) return;
    ctx.actor.crumbleWord(word, pane);
    mini.rig.wiggle(0.15);
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
 * they scatter around it, then wander off, breaking words as they go.
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
    rig.heading = rig.targetHeading;
    brood.minis.push({ rig, scatter, goal: null, chew: between(CHEW), age: 0, dying: 0 });
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
