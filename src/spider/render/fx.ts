/**
 * Neon effects drawn on the overlay canvas, in content coordinates:
 * data shards (debris of eaten words), bite marks, link marks (links indexed
 * by the scan or touched by a foot, and the locked target), and HUD labels.
 */
import type { Box, Point } from './canvas';

export const NEON = {
  cyan: '#5ee6ff',
  cyanSoft: 'rgba(94, 230, 255, 0.35)',
  pink: '#ff3d7f',
  pinkSoft: 'rgba(255, 61, 127, 0.22)',
  white: '#f2fbff',
  ink: '#c9d1da',
  link: '#7aa2ff',
};

const LABEL_FONT = '600 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ------------------------------------------------------------------ shards

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  angle: number;
  spin: number;
  life: number;
  maxLife: number;
  color: string;
  gravity: number;
}

export interface BurstOptions {
  count: number;
  colors: string[];
  speed?: [number, number];
  spread?: number;
  angle?: number;
  gravity?: number;
  life?: [number, number];
}

/** Short glowing line fragments that fly off, spin and fade. */
export class Shards {
  private list: Shard[] = [];

  burst(x: number, y: number, options: BurstOptions): void {
    const [minSpeed, maxSpeed] = options.speed ?? [30, 110];
    const [minLife, maxLife] = options.life ?? [0.35, 0.8];
    const spread = options.spread ?? Math.PI * 1.1;
    const angle = options.angle ?? -Math.PI / 2;
    for (let i = 0; i < options.count && this.list.length < 900; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = minSpeed + Math.random() * (maxSpeed - minSpeed);
      const life = minLife + Math.random() * (maxLife - minLife);
      this.list.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        length: 2 + Math.random() * 5,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 14,
        life,
        maxLife: life,
        color: options.colors[Math.floor(Math.random() * options.colors.length)],
        gravity: options.gravity ?? 160,
      });
    }
  }

  update(dt: number): void {
    for (const s of this.list) {
      s.vy += s.gravity * dt;
      s.vx *= 1 - 2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
      s.life -= dt;
    }
    this.list = this.list.filter((s) => s.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const s of this.list) {
      ctx.globalAlpha = Math.min(1, (s.life / s.maxLife) * 1.6);
      ctx.strokeStyle = s.color;
      const dx = (Math.cos(s.angle) * s.length) / 2;
      const dy = (Math.sin(s.angle) * s.length) / 2;
      ctx.beginPath();
      ctx.moveTo(s.x - dx, s.y - dy);
      ctx.lineTo(s.x + dx, s.y + dy);
      ctx.stroke();
    }
    ctx.restore();
  }

  clear(): void {
    this.list = [];
  }
}

// ------------------------------------------------------------- bite marks

interface Bite {
  box: Box;
  seed: number;
  age: number;
}

/** Bitten-out words: the word's box with tooth notches, outlined in neon. */
export class BiteMarks {
  private bites: Bite[] = [];

  add(box: Box, seed: number): void {
    this.bites.push({ box, seed, age: 0 });
  }

  update(dt: number): void {
    for (const bite of this.bites) bite.age += dt;
  }

  clear(): void {
    this.bites = [];
  }

  get boxes(): Box[] {
    return this.bites.map((b) => b.box);
  }

  draw(ctx: CanvasRenderingContext2D, view: Box): void {
    ctx.save();
    for (const bite of this.bites) {
      const { box } = bite;
      if (box.bottom < view.top || box.top > view.bottom) continue;
      const h = box.bottom - box.top;
      const top = box.top + h * 0.18;
      const bottom = box.bottom - h * 0.14;
      const flash = Math.max(0, 1 - bite.age * 3);
      ctx.beginPath();
      biteOutline(ctx, box.left - 1, top, box.right + 1, bottom, bite.seed);
      ctx.fillStyle = `rgba(255, 61, 127, ${0.07 + 0.25 * flash})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 61, 127, ${0.55 + 0.45 * flash})`;
      ctx.lineWidth = 1;
      ctx.shadowColor = NEON.pink;
      ctx.shadowBlur = 4 + 8 * flash;
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Rectangle whose top and bottom edges have semicircular tooth bites. */
function biteOutline(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const w = x1 - x0;
  const r = Math.min(4, (y1 - y0) / 3);
  const bitesTop = Math.max(1, Math.round(w / 18));
  const bitesBottom = Math.max(1, Math.round(w / 26));
  const jitter = (i: number) => ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
  ctx.moveTo(x0, y0);
  for (let i = 0; i < bitesTop; i++) {
    const cx = x0 + (w * (i + 0.5)) / bitesTop + (jitter(i) - 0.5) * 4;
    ctx.lineTo(cx - r, y0);
    ctx.arc(cx, y0, r, Math.PI, 0, true);
  }
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y1);
  for (let i = bitesBottom - 1; i >= 0; i--) {
    const cx = x0 + (w * (i + 0.5)) / bitesBottom + (jitter(i + 9) - 0.5) * 4;
    ctx.lineTo(cx + r, y1);
    ctx.arc(cx, y1, r, 0, Math.PI, true);
  }
  ctx.lineTo(x0, y1);
  ctx.closePath();
}

// -------------------------------------------------------------- link marks

/** A rectangle around a link, fading over time. */
interface Mark {
  box: Box;
  /** 1 when fresh, decays to 0. */
  strength: number;
  /** Seconds it takes to fade. */
  fade: number;
}

/**
 * Cyan boxes around links: links "indexed" by the scan (with an edge back to
 * the spider, like a crawler graph) and links under the spider's feet.
 */
export class LinkMarks {
  private readonly marks = new Map<number, Mark>();

  touch(index: number, box: Box, fade = 1.2): void {
    const mark = this.marks.get(index);
    if (mark) {
      mark.strength = 1;
      mark.fade = fade;
      mark.box = box;
    } else {
      this.marks.set(index, { box, strength: 1, fade });
    }
  }

  update(dt: number): void {
    for (const [index, mark] of this.marks) {
      mark.strength -= dt / mark.fade;
      if (mark.strength <= 0) this.marks.delete(index);
    }
  }

  clear(): void {
    this.marks.clear();
  }

  draw(ctx: CanvasRenderingContext2D, from: Point | null, view: Box): void {
    if (!this.marks.size) return;
    ctx.save();
    ctx.lineWidth = 1;
    // Edges from the spider to recently indexed links.
    if (from) {
      ctx.beginPath();
      for (const mark of this.marks.values()) {
        if (mark.strength < 0.35) continue;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo((mark.box.left + mark.box.right) / 2, (mark.box.top + mark.box.bottom) / 2);
      }
      ctx.strokeStyle = 'rgba(94, 230, 255, 0.18)';
      ctx.stroke();
    }
    ctx.shadowColor = NEON.cyan;
    ctx.shadowBlur = 6;
    for (const mark of this.marks.values()) {
      const { box } = mark;
      if (box.bottom < view.top - 4 || box.top > view.bottom + 4) continue;
      ctx.globalAlpha = Math.min(1, mark.strength * 1.4);
      ctx.strokeStyle = NEON.cyan;
      ctx.strokeRect(box.left - 2.5, box.top - 0.5, box.right - box.left + 5, box.bottom - box.top + 1);
    }
    ctx.restore();
  }
}

/** The link the spider decided to follow: pink box with closing-in corners. */
export function drawTargetLock(ctx: CanvasRenderingContext2D, box: Box, age: number, label: string): void {
  const grow = Math.max(0, 1 - age / 0.3);
  const pad = 3 + grow * 18;
  const x0 = box.left - pad;
  const y0 = box.top - pad * 0.6;
  const x1 = box.right + pad;
  const y1 = box.bottom + pad * 0.6;
  const blink = age < 0.6 ? 0.55 + 0.45 * Math.round((Math.sin(age * 40) + 1) / 2) : 1;
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.fillStyle = NEON.pinkSoft;
  ctx.fillRect(box.left - 3, box.top - 1, box.right - box.left + 6, box.bottom - box.top + 2);
  ctx.strokeStyle = NEON.pink;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = NEON.pink;
  ctx.shadowBlur = 10;
  const c = 6;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + c);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + c, y0);
  ctx.moveTo(x1 - c, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + c);
  ctx.moveTo(x1, y1 - c);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - c, y1);
  ctx.moveTo(x0 + c, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - c);
  ctx.stroke();
  ctx.restore();
  if (label) drawLabel(ctx, label, box.left - 3, box.top - 7, NEON.pink);
}

/** Wide translucent beam from the spider to its target (like a tracking laser). */
export function drawBeam(ctx: CanvasRenderingContext2D, from: Point, to: Point, strength: number): void {
  if (strength <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255, 61, 127, ${0.22 * strength})`;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 140, 180, ${0.7 * strength})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Small monospace HUD label with a dark backing plate. */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(3, 5, 8, 0.82)';
  ctx.fillRect(x - 3, y - 10, w + 6, 13);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The silk dragline through a list of points. */
export function drawSilk(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 246, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.shadowColor = NEON.cyan;
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

/** Horizontal scanning band (the spider "indexing" the visible page). */
export function drawScan(ctx: CanvasRenderingContext2D, view: Box, y: number): void {
  ctx.save();
  const gradient = ctx.createLinearGradient(0, y - 40, 0, y);
  gradient.addColorStop(0, 'rgba(94, 230, 255, 0)');
  gradient.addColorStop(1, 'rgba(94, 230, 255, 0.12)');
  ctx.fillStyle = gradient;
  ctx.fillRect(view.left, y - 40, view.right - view.left, 40);
  ctx.strokeStyle = 'rgba(94, 230, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.shadowColor = NEON.cyan;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(view.left, y);
  ctx.lineTo(view.right, y);
  ctx.stroke();
  ctx.restore();
}
