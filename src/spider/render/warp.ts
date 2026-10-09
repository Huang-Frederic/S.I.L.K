/**
 * The link-dive transition.
 *
 * The visible text is captured as line fragments ("data streaks") from the
 * real layout, the DOM copy is hidden, and every fragment is pulled into the
 * link along a spiral, leaving light trails, closest fragments first. The
 * next article streams out of the same point the opposite way and settles
 * into place before the real text fades back in.
 */
import type { Box, OverlayCanvas, Point } from './canvas';
import { EATEN_CLASS } from './words';

export interface Streak {
  /** Centre of the fragment (content coordinates). */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

const TEXT = 'rgba(214, 222, 232, 0.75)';
const LINK = 'rgba(122, 162, 255, 0.9)';
const HEADING = 'rgba(255, 255, 255, 0.85)';
const PIECE = 34;
const MAX_STREAKS = 1600;

/** Captures the visible text of an article as horizontal fragments. */
export function captureText(article: HTMLElement, canvas: OverlayCanvas): Streak[] {
  const view = canvas.view;
  const inView = (box: Box) => box.bottom > view.top && box.top < view.bottom;
  const streaks: Streak[] = [];
  const range = document.createRange();
  const parentVisible = new Map<Element, boolean>();
  const walker = document.createTreeWalker(article, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node && streaks.length < MAX_STREAKS; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim() || parent.classList.contains(EATEN_CLASS)) continue;
    let visible = parentVisible.get(parent);
    if (visible === undefined) {
      visible = inView(canvas.contentBox(parent));
      parentVisible.set(parent, visible);
    }
    if (!visible) continue;
    const color = parent.closest('a') ? LINK : parent.closest('h1, h2, h3, h4') ? HEADING : TEXT;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      const box = canvas.toContent(rect);
      if (!inView(box) || box.right - box.left < 1) continue;
      const h = Math.max(1.5, (box.bottom - box.top) * 0.26);
      const y = (box.top + box.bottom) / 2;
      for (let x = box.left; x < box.right; x += PIECE) {
        const w = Math.min(PIECE - 4, box.right - x);
        if (w > 1) streaks.push({ x: x + w / 2, y, w, h, color });
      }
    }
  }
  return streaks;
}

interface Item {
  streak: Streak;
  radius: number;
  angle: number;
  delay: number;
}

export type WarpMode = 'in' | 'out';

const MAX_DELAY = 0.45;
const SPIN = 2.2;

export class Warp {
  private elapsed = 0;
  private readonly items: Item[];

  constructor(
    streaks: Streak[],
    private readonly center: Point,
    readonly mode: WarpMode,
    readonly duration: number,
  ) {
    let maxRadius = 1;
    this.items = streaks.map((streak) => {
      const radius = Math.hypot(streak.x - center.x, streak.y - center.y);
      maxRadius = Math.max(maxRadius, radius);
      return { streak, radius, angle: Math.atan2(streak.y - center.y, streak.x - center.x), delay: 0 };
    });
    for (const item of this.items) {
      item.delay = Math.min(1, item.radius / maxRadius + (Math.random() - 0.5) * 0.1) * MAX_DELAY;
    }
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  get progress(): number {
    return Math.min(1, this.elapsed / this.duration);
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  /** Point on the spiral for an item at pull amount e (0 = home, 1 = centre). */
  private at(item: Item, e: number): Point {
    const r = item.radius * (1 - e);
    const a = item.angle + e * SPIN * (this.mode === 'in' ? 1 : -1);
    return { x: this.center.x + Math.cos(a) * r, y: this.center.y + Math.sin(a) * r };
  }

  draw(ctx: CanvasRenderingContext2D, view: Box): void {
    const T = this.progress;
    const span = 1 - MAX_DELAY;
    ctx.save();
    this.drawTunnel(ctx, view, T);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const item of this.items) {
      const t = Math.min(1, Math.max(0, (T - item.delay) / span));
      // e: how far the fragment has been pulled towards the centre.
      const e = this.mode === 'in' ? t * t : 1 - (1 - (1 - t) * (1 - t));
      if (this.mode === 'in' ? t >= 1 : t <= 0) continue;
      const { streak } = item;
      ctx.strokeStyle = streak.color;
      if (e < 0.02) {
        // At rest: the fragment is a horizontal bar where the text was.
        ctx.globalAlpha = this.mode === 'out' ? Math.min(1, t * 4) : 1;
        ctx.lineCap = 'butt';
        ctx.lineWidth = streak.h;
        ctx.beginPath();
        ctx.moveTo(streak.x - streak.w / 2, streak.y);
        ctx.lineTo(streak.x + streak.w / 2, streak.y);
        ctx.stroke();
        ctx.lineCap = 'round';
        continue;
      }
      // In motion: a trail from a slightly earlier position to the head.
      const head = this.at(item, e);
      const tail = this.at(item, Math.max(0, e - 0.12));
      ctx.globalAlpha = this.mode === 'in' ? 0.9 - e * 0.55 : 0.4 + 0.5 * (1 - e);
      ctx.lineWidth = Math.max(0.5, streak.h * (1 - e * 0.8));
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
    }
    ctx.restore();
    this.drawCore(ctx, T);
  }

  /** Faint converging lines, like a tunnel into the link. */
  private drawTunnel(ctx: CanvasRenderingContext2D, view: Box, T: number): void {
    const strength = Math.sin(Math.PI * T);
    if (strength <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = `rgba(94, 230, 255, ${0.07 * strength})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const reach = Math.hypot(view.right - view.left, view.bottom - view.top);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + T * (this.mode === 'in' ? 1.2 : -1.2);
      ctx.moveTo(this.center.x + Math.cos(a) * 14, this.center.y + Math.sin(a) * 14);
      ctx.lineTo(this.center.x + Math.cos(a) * reach, this.center.y + Math.sin(a) * reach);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Glowing core where the page disappears into (or comes out of) the link. */
  private drawCore(ctx: CanvasRenderingContext2D, T: number): void {
    const strength = Math.sin(Math.PI * Math.min(1, T * 1.1));
    if (strength <= 0.01) return;
    const r = 6 + 22 * strength;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(this.center.x, this.center.y, 0, this.center.x, this.center.y, r);
    gradient.addColorStop(0, `rgba(255, 220, 235, ${0.9 * strength})`);
    gradient.addColorStop(0.35, `rgba(255, 61, 127, ${0.55 * strength})`);
    gradient.addColorStop(1, 'rgba(255, 61, 127, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.center.x, this.center.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(94, 230, 255, ${0.8 * strength})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.center.x, this.center.y, r * 0.75 + 4 * Math.sin(T * 30), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
