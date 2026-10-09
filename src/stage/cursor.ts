/**
 * The cursor as the game sees it. Normally it is exactly the real pointer.
 * During cursor harassment a silk line sticks to it and the spider tugs: the
 * game's cursor lags and drags behind the real one for a couple of seconds.
 *
 * The real OS cursor is never moved or locked: inside the race screen it is
 * hidden for the duration and this lagging cursor is drawn instead; every
 * cursor-driven effect (link hover box, tooltip, clicks) follows it.
 */
import { drawSilk } from '../fx/fx';
import type { Drawable, Point, Stage } from './stage';
import { Z } from './stage';

export class VirtualCursor implements Drawable {
  readonly z = Z.cursor;
  x = -1e4;
  y = -1e4;
  private vx = 0;
  private vy = 0;
  private harassUntil = 0;
  private pull: (() => Point) | null = null;
  private nextTug = 0;
  private time = 0;

  constructor(private readonly stage: Stage) {}

  /** True while a mouse (or pen) pointer is over the stage. */
  get available(): boolean {
    return this.stage.pointer.inside && this.stage.pointer.type !== 'touch';
  }

  get harassed(): boolean {
    return this.time < this.harassUntil;
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  /** Sticks silk to the cursor for `seconds`, tugging it towards `pull()`. */
  harass(seconds: number, pull: () => Point): void {
    this.harassUntil = this.time + seconds;
    this.pull = pull;
    this.nextTug = this.time + 0.15;
    this.stage.root.classList.add('is-harassed');
  }

  /** Ends any harassment (race over). */
  release(): void {
    this.harassUntil = 0;
    this.stage.root.classList.remove('is-harassed');
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.stage.pointer;
    if (!this.harassed) {
      if (this.pull) this.release();
      this.pull = null;
      this.x = p.x;
      this.y = p.y;
      this.vx = this.vy = 0;
      return;
    }
    // A sluggish spring towards the real pointer...
    const k = 22;
    const damping = 7;
    this.vx += ((p.x - this.x) * k - this.vx * damping) * dt;
    this.vy += ((p.y - this.y) * k - this.vy * damping) * dt;
    // ...and sharp tugs towards the spider.
    if (this.pull && this.time >= this.nextTug) {
      const to = this.pull();
      const dx = to.x - this.x;
      const dy = to.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const strength = Math.min(420, d * 1.4);
      this.vx += (dx / d) * strength;
      this.vy += (dy / d) * strength;
      this.nextTug = this.time + 0.32 + Math.random() * 0.25;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.harassed || !this.pull) return;
    drawSilk(ctx, [this.pull(), { x: this.x, y: this.y }], 0.9);
    // A plain arrow cursor.
    ctx.translate(this.x, this.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.5, 13);
    ctx.lineTo(7.5, 20);
    ctx.lineTo(10.5, 18.6);
    ctx.lineTo(7.6, 12);
    ctx.lineTo(13, 12);
    ctx.closePath();
    ctx.fillStyle = '#F0F4F8';
    ctx.strokeStyle = '#101418';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }
}
