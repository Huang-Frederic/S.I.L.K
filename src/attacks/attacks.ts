/**
 * The spider's attacks on the player's pane. None of them is telegraphed:
 * they land the moment they start. Each returns false when it had nothing
 * to hit (so that the director can pick another one).
 *
 *  - web trap:      silk shot across, a web unfolds over the links near the
 *                   cursor; they cannot be clicked for a few seconds
 *  - fan laser:     a big beam from the eye sweeps a fan across the page and
 *                   burns every word and link it passes over
 *  - bombardment:   words plucked from the spider's page are thrown across
 *                   and land on links, covering them
 *  - decoys:        fake links to the target appear in the text; clicking
 *                   one lets out mini-spiders (see minions.ts)
 *  - harassment:    silk sticks to the cursor and the spider tugs it
 */
import { AMBER, CYAN, drawLabel, drawSilk, drawWeb, flyWord, LINE, RED } from '../fx/fx';
import { segmentHitsBox } from '../spider/actor';
import { drawWordTag } from '../spider/rig';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Box, type Point, type Stage } from '../stage/stage';
import { circleHitsBox, center, focusPoint, rankLinks, type AttackContext } from './context';

const FILLER_WORDS = ['nope', 'mine', 'lol', 'web', 'nom', 'denied', 'no'];

/** A silk line shooting from the spider to a moving point. */
function shootSilk(stage: Stage, from: () => Point, to: () => Point, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let t = 0;
    stage.add({
      z: Z.silk,
      update(dt) {
        t += dt / seconds;
        if (t >= 1) resolve();
        return t < 1.25;
      },
      draw(ctx) {
        const a = from();
        const b = to();
        const u = Math.min(1, t);
        ctx.globalAlpha = t > 1 ? Math.max(0, 1 - (t - 1) * 4) : 1;
        drawSilk(ctx, [a, { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }], 0.95);
      },
    });
  });
}

// ------------------------------------------------------------- web trap

class WebTrap {
  readonly z = Z.traps;
  private t = 0;

  constructor(
    private readonly pane: RacerPane,
    private readonly c: Point,
    private readonly radius: number,
    private readonly seconds: number,
    private readonly generation: number,
  ) {}

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.seconds + 0.5 && this.pane.generation === this.generation;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const build = Math.min(1, this.t / 0.3);
    const fade = this.t > this.seconds ? 1 - (this.t - this.seconds) / 0.5 : 1;
    ctx.save();
    this.pane.enterContent(ctx);
    drawWeb(ctx, this.c, this.radius, 0.9 * fade, build);
    ctx.restore();
    // How long the links stay stuck (kept inside the pane).
    if (build >= 1 && this.t < this.seconds) {
      const r = this.pane.rect;
      const at = this.pane.toStage({ x: this.c.x - this.radius * 0.5, y: this.c.y - this.radius * 0.96 });
      const x = Math.min(Math.max(at.x, r.left + 10), r.right - 150);
      const y = Math.min(Math.max(at.y, r.top + 16), r.bottom - 16);
      drawLabel(ctx, `web.trap · ${(this.seconds - this.t).toFixed(1)}s`, x, y, LINE);
    }
  }
}

export async function webTrap(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  const links = rankLinks(ctx);
  if (!links.length) return false;
  const c = center(links[0].box);
  const radius = ctx.difficulty.id === 'hard' ? 125 : 95;
  ctx.actor.holds++;
  try {
    ctx.actor.status = 'web.shoot(player) · trap';
    await shootSilk(ctx.stage, () => ctx.actor.spinneretOnStage(), () => pane.toStage(c), 0.16);
    const until = ctx.stage.time + ctx.difficulty.webSeconds;
    ctx.stage.add(new WebTrap(pane, c, radius, ctx.difficulty.webSeconds, pane.generation));
    for (const link of pane.visibleLinks((a) => pane.usable(a))) {
      if (circleHitsBox(c, radius * 0.92, link.box)) pane.damageLink(link.el, 'webbed', until);
    }
    ctx.fragments.burst(pane.toStage(c), { count: 14, colors: [LINE], speed: [30, 90], life: [0.2, 0.4], gravity: 20 });
    ctx.say('web');
    await ctx.stage.wait(0.2);
  } finally {
    ctx.actor.holds--;
  }
  return true;
}

// ------------------------------------------------------------ fan laser

/** Half the width of the strip the fan laser burns (px). */
const BEAM_HALF = 7;

/** How far along `dir` (a unit vector) a ray from `from` leaves `box`, or null if it misses it. */
export function rayExit(from: Point, dir: Point, box: Box): number | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [from.x, dir.x, box.left, box.right],
    [from.y, dir.y, box.top, box.bottom],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= Math.max(0, t0) ? t1 : null;
}

/** True when `p` lies inside the triangle a-b-c (either winding). */
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return !((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0));
}

const grow = (b: Box, by: number): Box => ({ left: b.left - by, top: b.top - by, right: b.right + by, bottom: b.bottom + by });

/**
 * Burns everything the beam swept over during one frame (the triangle
 * between the eye and the beam's last two ends) in one pane: every visible
 * word, and with it every link. Returns how many words burned.
 */
function burnSwept(ctx: AttackContext, pane: RacerPane, eye: Point, from: Point, to: Point): number {
  const view = pane.visibleContent();
  const e = pane.fromStage(eye);
  const a = pane.fromStage(from);
  const b = pane.fromStage(to);
  const box = {
    left: Math.max(view.left, Math.min(e.x, a.x, b.x) - BEAM_HALF),
    right: Math.min(view.right, Math.max(e.x, a.x, b.x) + BEAM_HALF),
    top: Math.max(view.top, Math.min(e.y, a.y, b.y) - BEAM_HALF),
    bottom: Math.min(view.bottom, Math.max(e.y, a.y, b.y) + BEAM_HALF),
  };
  if (box.left >= box.right || box.top >= box.bottom) return 0;
  pane.words.ensure(box);
  let burned = 0;
  for (const word of pane.words.inside(grow(box, 30))) {
    const c = center(word.box);
    if (!inTriangle(c, e, a, b) && !segmentHitsBox(e, b, grow(word.box, BEAM_HALF))) continue;
    if (!ctx.actor.burnWord(pane, word)) continue;
    burned++;
    if (Math.random() < 0.6) ctx.fragments.burst(pane.toStage(c), { count: 2, colors: [RED, '#FFD6DA', AMBER], speed: [30, 120], life: [0.2, 0.45], gravity: 160 });
  }
  // Fake links are not part of the word index: burn them by their box.
  if (pane.owner === 'player') {
    for (const decoy of pane.decoys()) {
      const d = pane.linkBox(decoy);
      if (pane.usable(decoy) && (inTriangle(center(d), e, a, b) || segmentHitsBox(e, b, grow(d, BEAM_HALF)))) pane.damageLink(decoy, 'burned');
    }
  }
  return burned;
}

/** The big beam: a red haze, a thick red line and a white-hot core. */
function drawFanBeam(c: CanvasRenderingContext2D, from: Point, to: Point, strength: number, time: number): void {
  if (strength <= 0) return;
  const line = () => {
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
  };
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = RED;
  c.shadowColor = 'rgba(255, 43, 58, 0.95)';
  c.globalAlpha = 0.2 * strength;
  c.lineWidth = 30;
  c.shadowBlur = 28;
  line();
  c.globalAlpha = 0.85 * strength;
  c.lineWidth = 10;
  c.shadowBlur = 14;
  line();
  c.shadowBlur = 0;
  c.globalAlpha = strength;
  c.strokeStyle = '#FFE9EC';
  c.lineWidth = 3.2 + Math.sin(time * 80) * 0.8;
  line();
  // Flare at the eye.
  const flare = c.createRadialGradient(from.x, from.y, 0, from.x, from.y, 22);
  flare.addColorStop(0, `rgba(255, 233, 236, ${strength})`);
  flare.addColorStop(0.35, `rgba(255, 43, 58, ${0.8 * strength})`);
  flare.addColorStop(1, 'rgba(255, 43, 58, 0)');
  c.fillStyle = flare;
  c.beginPath();
  c.arc(from.x, from.y, 22, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * eye.laser.fan(): a big beam from the eye sweeps across the player's pane
 * in a fan centred on where the player is looking, and burns every word and
 * every link it passes over, in both panes (the spider's own page included,
 * but for the link it is heading to).
 */
export async function fanLaser(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  const home = ctx.actor.surface;
  // Nothing left to burn on screen: another attack will do.
  if (!home || home === pane || !rankLinks(ctx).length) return false;
  const focus = pane.toStage(focusPoint(ctx, pane));
  const span = (ctx.difficulty.laserFan * Math.PI) / 180;
  const start = ctx.actor.eyeOnStage();
  const middle = Math.atan2(focus.y - start.y, focus.x - start.x);
  const turn = Math.random() < 0.5 ? 1 : -1;
  const seconds = ctx.difficulty.id === 'hard' ? 0.75 : 0.95;
  const rig = ctx.actor.rig;
  // The beam reaches the far side of the player's pane.
  const endOf = (eye: Point, angle: number): Point => {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const length = rayExit(eye, dir, pane.rect) ?? Math.hypot(focus.x - eye.x, focus.y - eye.y);
    return { x: eye.x + dir.x * length, y: eye.y + dir.y * length };
  };
  let angle = middle - (turn * span) / 2;
  let strength = 0;
  let live = true;
  ctx.stage.add({
    z: Z.projectiles,
    update: () => live || (strength -= 0.08) > 0,
    draw: (c, stage) => {
      const eye = ctx.actor.eyeOnStage();
      drawFanBeam(c, eye, endOf(eye, angle), strength, stage.time);
    },
  });
  ctx.actor.holds++;
  ctx.actor.status = 'eye.laser.fan() → burn';
  ctx.say('laser');
  let burned = 0;
  try {
    let last = endOf(ctx.actor.eyeOnStage(), angle);
    let shook = 0;
    await ctx.stage.tween(seconds, (t) => {
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      angle = middle + turn * span * (e - 0.5);
      strength = Math.min(1, t * 10);
      const eye = ctx.actor.eyeOnStage();
      const end = endOf(eye, angle);
      // The eye leads the beam.
      rig.face({ x: end.x - eye.x, y: end.y - eye.y });
      rig.lookAt = home.fromStage(end);
      burned += burnSwept(ctx, pane, eye, last, end) + burnSwept(ctx, home, eye, last, end);
      last = end;
      if (t - shook > 0.12) {
        shook = t;
        ctx.stage.shake(1.6);
      }
    });
  } finally {
    live = false;
    ctx.actor.holds--;
  }
  ctx.actor.status = `eye.laser.fan() · ${burned} words burned`;
  await ctx.stage.wait(0.15);
  return true;
}

// --------------------------------------------------------- bombardment

/** A thrown word sitting on top of a link. */
class CoverTag {
  readonly z = Z.traps;
  private t = 0;
  private readonly tilt = (Math.random() - 0.5) * 0.35;

  constructor(
    private readonly pane: RacerPane,
    private readonly el: HTMLAnchorElement,
    private readonly text: string,
    private readonly seconds: number,
    private readonly generation: number,
  ) {}

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.seconds && this.pane.generation === this.generation && this.el.isConnected;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const box = this.pane.boxToStage(this.pane.linkBox(this.el));
    const fade = Math.min(1, (this.seconds - this.t) / 0.3);
    ctx.beginPath();
    const r = this.pane.rect;
    ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    ctx.clip();
    drawWordTag(ctx, this.text, (box.left + box.right) / 2, (box.top + box.bottom) / 2, this.tilt, fade);
  }
}

export async function bombard(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  const targets = rankLinks(ctx).slice(0, ctx.difficulty.id === 'hard' ? 4 : 3);
  if (!targets.length) return false;
  ctx.actor.holds++;
  ctx.say('bombard');
  ctx.actor.status = 'grab(words).throw(player)';
  const landings: Promise<void>[] = [];
  try {
    for (const target of targets) {
      const text = ctx.actor.pluckWord() ?? FILLER_WORDS[Math.floor(Math.random() * FILLER_WORDS.length)];
      const from = ctx.actor.eyeOnStage();
      const to = () => pane.toStage(center(pane.linkBox(target.el)));
      const generation = pane.generation;
      landings.push(
        flyWord(ctx.stage, { text, from: () => from, to, duration: 0.42, arc: 110, spin: 5 }).then(() => {
          if (pane.generation !== generation || !target.el.isConnected) return;
          pane.damageLink(target.el, 'covered', ctx.stage.time + ctx.difficulty.coverSeconds);
          ctx.stage.add(new CoverTag(pane, target.el, text, ctx.difficulty.coverSeconds, generation));
          ctx.fragments.burst(to(), { count: 8, colors: [CYAN, LINE], speed: [30, 80], life: [0.15, 0.3], gravity: 80 });
          ctx.stage.shake(1.5);
        }),
      );
      await ctx.stage.wait(0.14);
    }
    await Promise.all(landings);
  } finally {
    ctx.actor.holds--;
  }
  return true;
}

// -------------------------------------------------------------- decoys

export async function plantDecoys(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  const room = ctx.difficulty.maxDecoys - pane.decoys().length;
  if (room <= 0) return false;
  const focus = pane.toStage(focusPoint(ctx, pane));
  const r = pane.rect;
  const planted: HTMLAnchorElement[] = [];
  for (let attempt = 0; attempt < 24 && planted.length < Math.min(room, 2); attempt++) {
    const p = {
      x: Math.min(r.right - 20, Math.max(r.left + 20, focus.x + (Math.random() - 0.5) * 420)),
      y: Math.min(r.bottom - 20, Math.max(r.top + 20, focus.y + (Math.random() - 0.5) * 300)),
    };
    const decoy = pane.plantDecoyAt(p, ctx.targetTitle);
    if (decoy) planted.push(decoy);
  }
  if (!planted.length) return false;
  ctx.actor.status = 'plant(decoy) · trust me';
  for (const decoy of planted) {
    const box = () => pane.boxToStage(pane.linkBox(decoy));
    const generation = pane.generation;
    let t = 0;
    ctx.stage.add({
      z: Z.traps,
      update(dt) {
        t += dt;
        return t < 0.35 && pane.generation === generation;
      },
      draw(c) {
        // A short RGB flicker where the fake link materialises.
        const b = box();
        c.globalAlpha = 1 - t / 0.35;
        c.fillStyle = RED;
        c.fillRect(b.left - 3, b.top, b.right - b.left, b.bottom - b.top);
        c.fillStyle = CYAN;
        c.fillRect(b.left + 3, b.top + 2, b.right - b.left, b.bottom - b.top - 4);
      },
    });
  }
  ctx.say('decoy-planted');
  await ctx.stage.wait(0.15);
  return true;
}

// ---------------------------------------------------------- harassment

export async function harass(ctx: AttackContext): Promise<boolean> {
  if (!ctx.cursor.available || ctx.cursor.harassed) return false;
  ctx.actor.holds++;
  try {
    ctx.actor.status = 'silk.stick(cursor).tug()';
    const cursor = ctx.cursor;
    await shootSilk(ctx.stage, () => ctx.actor.spinneretOnStage(), () => cursor.position, 0.12);
    cursor.harass(ctx.difficulty.harassSeconds, () => ctx.actor.spinneretOnStage());
    ctx.say('harass');
  } finally {
    ctx.actor.holds--;
  }
  return true;
}
