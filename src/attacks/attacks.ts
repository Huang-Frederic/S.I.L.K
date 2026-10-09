/**
 * The spider's attacks on the player's pane. None of them is telegraphed:
 * they land the moment they start. Each returns false when it had nothing
 * to hit (so that the director can pick another one).
 *
 *  - web trap:      silk shot across, a web unfolds over the links near the
 *                   cursor; they cannot be clicked for a few seconds
 *  - laser snipe:   the eye laser burns the link the player is reaching for
 *  - bombardment:   words plucked from the spider's page are thrown across
 *                   and land on links, covering them
 *  - decoys:        fake links to the target appear in the text (+15 s)
 *  - blackout:      the pane goes dark but for a shrinking flashlight circle
 *  - harassment:    silk sticks to the cursor and the spider tugs it
 *  - eggs:          see minions.ts
 */
import { AMBER, CYAN, drawLabel, drawLaser, drawSilk, drawWeb, flyWord, LINE, RED } from '../fx/fx';
import { drawWordTag } from '../spider/rig';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Point, type Stage } from '../stage/stage';
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

// ---------------------------------------------------------- laser snipe

export async function laserSnipe(ctx: AttackContext): Promise<boolean> {
  const pane = ctx.playerPane();
  const victim = rankLinks(ctx)[0];
  if (!victim) return false;
  const el = victim.el;
  const at = () => pane.toStage(center(pane.linkBox(el)));
  ctx.actor.holds++;
  try {
    ctx.actor.status = 'eye.laser(player.link) → burn';
    let t = 0;
    const seconds = 0.42;
    ctx.stage.add({
      z: Z.projectiles,
      update(dt) {
        t += dt / seconds;
        return t < 1;
      },
      draw: (c) => drawLaser(c, ctx.actor.eyeOnStage(), at(), 1 - t * t, 2.5),
    });
    await ctx.stage.wait(0.05);
    pane.damageLink(el, 'burned');
    ctx.fragments.burst(at(), { count: 24, colors: [RED, '#FFD6DA', AMBER], speed: [40, 160], life: [0.2, 0.45], gravity: 150 });
    ctx.stage.shake(2.5);
    ctx.say('laser');
    await ctx.stage.wait(0.3);
  } finally {
    ctx.actor.holds--;
  }
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

// ------------------------------------------------------------ blackout

class Blackout {
  readonly z = Z.blackout;
  private t = 0;
  private last: Point | null = null;

  constructor(
    private readonly ctx: AttackContext,
    private readonly seconds: number,
  ) {}

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.seconds + 0.3;
  }

  draw(c: CanvasRenderingContext2D): void {
    const pane = this.ctx.playerPane();
    const r = pane.rect;
    const cursor = this.ctx.cursor;
    if (cursor.available && pane.containsStage(cursor.position)) this.last = cursor.position;
    const at = this.last ?? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    const alpha = Math.min(1, this.t / 0.1) * (this.t > this.seconds ? Math.max(0, 1 - (this.t - this.seconds) / 0.3) : 1);
    // The flashlight shrinks over time.
    const radius = 175 - 120 * Math.min(1, this.t / this.seconds);
    c.beginPath();
    c.rect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    c.clip();
    const g = c.createRadialGradient(at.x, at.y, radius * 0.55, at.x, at.y, radius);
    g.addColorStop(0, 'rgba(4, 5, 7, 0)');
    g.addColorStop(1, `rgba(4, 5, 7, ${0.975 * alpha})`);
    c.fillStyle = g;
    c.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    c.globalAlpha = 0.25 * alpha;
    c.strokeStyle = LINE;
    c.beginPath();
    c.arc(at.x, at.y, radius * 0.96, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = alpha;
    drawLabel(c, `LIGHTS OUT · ${Math.max(0, this.seconds - this.t).toFixed(1)}s`, r.left + 18, r.top + 20, RED, { boxed: false });
  }

  get active(): boolean {
    return this.t < this.seconds;
  }

  /** Lights back on (fades out now). */
  end(): void {
    this.t = Math.max(this.t, this.seconds);
  }
}

/** One blackout at a time per race (stage). */
const blackouts = new WeakMap<Stage, Blackout>();

export async function blackout(ctx: AttackContext): Promise<boolean> {
  if (blackouts.get(ctx.stage)?.active) return false;
  const dark = new Blackout(ctx, ctx.difficulty.blackoutSeconds);
  blackouts.set(ctx.stage, dark);
  ctx.stage.add(dark);
  ctx.actor.status = 'lights.off()';
  ctx.stage.shake(2);
  ctx.say('blackout');
  await ctx.stage.wait(0.2);
  return true;
}

export function blackoutActive(stage: Stage): boolean {
  return blackouts.get(stage)?.active ?? false;
}

export function endBlackout(stage: Stage): void {
  blackouts.get(stage)?.end();
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
