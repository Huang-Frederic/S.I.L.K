/**
 * Visual effects drawn on the stage, in the style of the mockups: thin
 * white lines, cyan for what the spider holds or scans, red (#FF2B3A) for its
 * rays, lasers and everything it destroys, monospace labels.
 */
import { COLORS, drawWordTag } from '../spider/rig';
import type { Box, Drawable, Point, Stage } from '../stage/stage';
import { Z } from '../stage/stage';

export const RED = COLORS.eye;
export const CYAN = COLORS.footBox;
export const AMBER = COLORS.player;
export const LINE = COLORS.line;
export const PAGE = COLORS.page;
export const MONO = '500 11px "JetBrains Mono", "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const SERIF = '"Source Serif 4", "Source Serif Pro", Charter, "Iowan Old Style", Georgia, serif';

/** `Raster graphics` -> `raster_graphics` (how the spider names links). */
export function snakeCase(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
}

// ------------------------------------------------------------- primitives

/** Monospace label on a dark plate (e.g. `LOCK raster_graphics`). */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = RED, options: { boxed?: boolean; fill?: boolean } = {}): void {
  ctx.save();
  ctx.font = MONO;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  if (options.fill) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 6, y - 10, w + 12, 20);
    ctx.fillStyle = PAGE;
  } else {
    ctx.fillStyle = 'rgba(16, 20, 24, 0.92)';
    ctx.fillRect(x - 6, y - 10, w + 12, 20);
    if (options.boxed !== false) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 5.5, y - 9.5, w + 11, 19);
    }
    ctx.fillStyle = color;
  }
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/** The eye laser: a 2 px red line with a glow. */
export function drawLaser(ctx: CanvasRenderingContext2D, from: Point, to: Point, strength = 1, width = 2): void {
  if (strength <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, strength);
  ctx.strokeStyle = RED;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 43, 58, 0.95)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** A white silk line through some points. */
export function drawSilk(ctx: CanvasRenderingContext2D, points: Point[], alpha = 0.75): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = `rgba(240, 244, 248, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

export function strokeBox(ctx: CanvasRenderingContext2D, box: Box, color: string, options: { dash?: number[]; pad?: number; width?: number; glow?: boolean } = {}): void {
  const pad = options.pad ?? 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width ?? 1;
  if (options.dash) ctx.setLineDash(options.dash);
  if (options.glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }
  ctx.strokeRect(Math.round(box.left - pad) + 0.5, Math.round(box.top) + 0.5, Math.round(box.right - box.left + pad * 2), Math.round(box.bottom - box.top));
  ctx.restore();
}

/** A spider web: spokes and a spiral, centred on `c`. */
export function drawWeb(ctx: CanvasRenderingContext2D, c: Point, radius: number, alpha: number, seed = 1): void {
  if (alpha <= 0) return;
  const spokes = 11;
  const rings = 6;
  const angle = (i: number) => (i / spokes) * Math.PI * 2 + Math.sin(seed + i) * 0.12;
  const radiusAt = (i: number) => radius * (0.86 + 0.14 * Math.sin(seed * 3 + i * 1.7));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(240, 244, 248, 0.05)';
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) ctx.lineTo(c.x + Math.cos(angle(i)) * radiusAt(i), c.y + Math.sin(angle(i)) * radiusAt(i));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) {
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(angle(i)) * radiusAt(i), c.y + Math.sin(angle(i)) * radiusAt(i));
  }
  for (let r = 1; r <= rings; r++) {
    const f = r / (rings + 0.4);
    for (let i = 0; i <= spokes; i++) {
      const a = angle(i % spokes);
      const p = { x: c.x + Math.cos(a) * radiusAt(i % spokes) * f, y: c.y + Math.sin(a) * radiusAt(i % spokes) * f };
      if (i === 0) ctx.moveTo(p.x, p.y);
      // Sagging threads between spokes.
      else {
        const pa = angle((i - 1) % spokes);
        const mid = (pa + a) / 2;
        const sag = radiusAt(i % spokes) * f * 0.9;
        ctx.quadraticCurveTo(c.x + Math.cos(mid) * sag, c.y + Math.sin(mid) * sag, p.x, p.y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** A monospace speech bubble whose tail points at `to` (the spider's eye). */
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, to: Point, alpha: number, bounds: Box): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 14px "JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
  const w = ctx.measureText(text).width + 22;
  const h = 32;
  let x = to.x + 18;
  let y = to.y - 58;
  if (x + w > bounds.right - 6) x = to.x - 18 - w;
  x = Math.max(bounds.left + 6, x);
  y = Math.max(bounds.top + 6, y);
  ctx.fillStyle = PAGE;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  // Tail towards the eye.
  const tx = Math.min(Math.max(to.x, x + 10), x + w - 10);
  ctx.beginPath();
  ctx.moveTo(tx - 6, y + h);
  ctx.lineTo(to.x, to.y - 8);
  ctx.lineTo(tx + 6, y + h);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx - 6, y + h);
  ctx.lineTo(to.x, to.y - 8);
  ctx.lineTo(tx + 6, y + h);
  ctx.stroke();
  ctx.fillStyle = LINE;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 11, y + h / 2 + 1);
  ctx.restore();
}

// -------------------------------------------------------------- particles

interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  len: number;
  angle: number;
  spin: number;
  color: string;
  gravity: number;
}

/** Short line fragments (word debris, laser sparks) in stage coordinates. */
export class Fragments implements Drawable {
  readonly z = Z.projectiles;
  private list: Fragment[] = [];

  burst(at: Point, options: { count: number; colors: string[]; speed?: [number, number]; life?: [number, number]; spread?: number; angle?: number; gravity?: number }): void {
    const [s0, s1] = options.speed ?? [20, 70];
    const [l0, l1] = options.life ?? [0.22, 0.38];
    const spread = options.spread ?? Math.PI * 2;
    const base = options.angle ?? -Math.PI / 2;
    for (let i = 0; i < options.count && this.list.length < 1200; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const v = s0 + Math.random() * (s1 - s0);
      const life = l0 + Math.random() * (l1 - l0);
      this.list.push({
        x: at.x + (Math.random() - 0.5) * 10,
        y: at.y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        max: life,
        len: 2 + Math.random() * 5,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        color: options.colors[Math.floor(Math.random() * options.colors.length)],
        gravity: options.gravity ?? 60,
      });
    }
  }

  update(dt: number): void {
    for (const f of this.list) {
      f.vy += f.gravity * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
      f.life -= dt;
    }
    this.list = this.list.filter((f) => f.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const f of this.list) {
      ctx.globalAlpha = Math.min(1, (f.life / f.max) * 1.5);
      ctx.strokeStyle = f.color;
      const dx = (Math.cos(f.angle) * f.len) / 2;
      const dy = (Math.sin(f.angle) * f.len) / 2;
      ctx.beginPath();
      ctx.moveTo(f.x - dx, f.y - dy);
      ctx.lineTo(f.x + dx, f.y + dy);
      ctx.stroke();
    }
  }

  clear(): void {
    this.list = [];
  }
}

// ------------------------------------------------------------ one-shots

/** Expanding impact rings (stomp). */
export function shockwave(stage: Stage, at: () => Point, color = LINE, label = 'THUD'): void {
  let t = 0;
  stage.add({
    z: Z.projectiles,
    update(dt) {
      t += dt;
      return t < 0.7;
    },
    draw(ctx) {
      const p = at();
      ctx.strokeStyle = color;
      for (const k of [0, 0.12, 0.24]) {
        const u = Math.max(0, Math.min(1, (t - k) / 0.5));
        if (u <= 0 || u >= 1) continue;
        ctx.globalAlpha = 1 - u;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + u * 34, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (label && t < 0.6) {
        ctx.globalAlpha = 1;
        drawLabel(ctx, label, p.x + 26, p.y - 26, LINE, { boxed: false });
      }
    },
  });
}

/** A word tag flying along a path (thrown words, bombardment). */
export interface Flight {
  text: string;
  from: () => Point;
  to: () => Point;
  duration: number;
  /** Height of the arc (px, positive = upwards). */
  arc?: number;
  spin?: number;
  /** Keeps going past `to` and fades (thrown off the page). */
  away?: boolean;
}

export function flyWord(stage: Stage, flight: Flight): Promise<void> {
  return new Promise((resolve) => {
    let t = 0;
    const spin = flight.spin ?? 6;
    stage.add({
      z: Z.projectiles,
      update(dt) {
        t += dt / flight.duration;
        if (t >= 1) resolve();
        return t < (flight.away ? 1.6 : 1);
      },
      draw(ctx) {
        const a = flight.from();
        const b = flight.to();
        const u = Math.min(t, 1.6);
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u - Math.sin(Math.min(1, u) * Math.PI) * (flight.arc ?? 60);
        const alpha = flight.away && u > 1 ? Math.max(0, 1 - (u - 1) / 0.6) : 1;
        // Speed lines behind the word.
        ctx.strokeStyle = 'rgba(240, 244, 248, 0.35)';
        ctx.lineWidth = 1;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        for (const off of [-8, 0, 8]) {
          ctx.beginPath();
          ctx.moveTo(x - (dx / d) * 30 - (dy / d) * off, y - (dy / d) * 30 + (dx / d) * off);
          ctx.lineTo(x - (dx / d) * 52 - (dy / d) * off, y - (dy / d) * 52 + (dx / d) * off);
          ctx.stroke();
        }
        drawWordTag(ctx, flight.text, x, y, u * spin, alpha);
      },
    });
  });
}
