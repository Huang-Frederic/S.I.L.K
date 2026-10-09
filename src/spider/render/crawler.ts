/**
 * The spider: a glowing line-art "web crawler" with eight long legs.
 *
 * Legs use procedural locomotion rather than canned frames. Each foot stays
 * planted on the page (preferably on a hyperlink, the crawler walks on the
 * web's edges) until the body has moved too far from it; then it steps to a
 * new hold ahead of the body. Legs belong to two alternating groups
 * (L1 R2 L3 R4 / R1 L2 R3 L4) and a group only lifts while the other one is
 * planted, which gives the classic eight-legged gait. Knees come from
 * two-bone inverse kinematics, bent away from the body.
 */
import type { Point } from './canvas';

/** Where a foot can land: the pane snaps holds onto nearby links. */
export interface FootHold {
  point: Point;
  /** Index of the link the foot stands on, if any. */
  link: number | null;
}

export interface Ground {
  hold(desired: Point): FootHold;
}

interface Leg {
  side: 1 | -1;
  group: 0 | 1;
  /** Hip and resting foot, in the body's local frame (x forward, y right). */
  hip: Point;
  rest: Point;
  upper: number;
  lower: number;
  /** Current foot position (content coordinates). */
  foot: Point;
  from: Point;
  to: Point;
  /** Step progress: 1 when planted. */
  t: number;
  duration: number;
  link: number | null;
}

// Right side, front to back. The left side mirrors y.
const HIPS: ReadonlyArray<readonly [number, number]> = [
  [8, 3.6],
  [5, 5.2],
  [1.5, 5.6],
  [-2, 4.6],
];
const REST_ANGLES = [36, 76, 110, 148];
const REST_RADIUS = [96, 86, 86, 100];

const COLORS = {
  leg: 'rgba(232, 246, 255, 0.95)',
  legGlow: 'rgba(64, 224, 255, 0.85)',
  joint: '#ffffff',
  foot: '#5ee6ff',
  shell: '#05070b',
  outline: '#e8f6ff',
  core: '#ff3d7f',
  eye: '#5ee6ff',
};

export class Crawler {
  x = 0;
  y = 0;
  /** Facing direction in radians (0 = right). */
  heading = 0;
  /** Overall size (adapts to the pane width). */
  size = 1;
  /** Animation scale (shrinks when diving into a link). */
  scale = 1;
  /** 0 = legs spread, 1 = legs folded (hanging on silk). */
  tuck = 0;
  visible = true;
  /** Feet planted on the page (false while hanging on a thread). */
  grounded = false;
  /** Current speed in CSS px/s, set by whoever moves the body. */
  speed = 0;

  private readonly legs: Leg[] = [];
  private time = 0;
  private lastX = 0;
  private lastY = 0;
  private vx = 0;
  private vy = 0;

  /** Body centre to mouth / to spinnerets, in CSS px at scale 1. */
  static readonly MOUTH = 18;
  static readonly SPINNERET = 28;

  constructor() {
    for (const side of [1, -1] as const) {
      HIPS.forEach(([hx, hy], i) => {
        const angle = (REST_ANGLES[i] * Math.PI) / 180;
        const radius = REST_RADIUS[i];
        this.legs.push({
          side,
          group: (side === 1 ? i % 2 : (i + 1) % 2) as 0 | 1,
          hip: { x: hx, y: hy * side },
          rest: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * side },
          upper: radius * 0.62,
          lower: radius * 0.7,
          foot: { x: 0, y: 0 },
          from: { x: 0, y: 0 },
          to: { x: 0, y: 0 },
          t: 1,
          duration: 0.12,
          link: null,
        });
      });
    }
  }

  /** Links currently under a planted foot. */
  footLinks(): number[] {
    return this.legs.filter((leg) => leg.t >= 1 && leg.link !== null).map((leg) => leg.link!);
  }

  mouth(): Point {
    const d = Crawler.MOUTH * this.size * this.scale;
    return { x: this.x + Math.cos(this.heading) * d, y: this.y + Math.sin(this.heading) * d };
  }

  spinneret(): Point {
    const d = Crawler.SPINNERET * this.size * this.scale;
    return { x: this.x - Math.cos(this.heading) * d, y: this.y - Math.sin(this.heading) * d };
  }

  turnTowards(angle: number, maxStep: number): void {
    const delta = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
    this.heading += Math.max(-maxStep, Math.min(maxStep, delta));
  }

  /** Puts every foot down at once (after landing). */
  plantAll(ground: Ground): void {
    this.grounded = true;
    for (const leg of this.legs) {
      const hold = ground.hold(this.restFoot(leg, { x: 0, y: 0 }));
      leg.foot = leg.from = leg.to = hold.point;
      leg.link = hold.link;
      leg.t = 1;
    }
    this.lastX = this.x;
    this.lastY = this.y;
  }

  /** Lifts every foot (hanging on silk, diving): legs then follow the body. */
  liftAll(): void {
    this.grounded = false;
    for (const leg of this.legs) leg.link = null;
  }

  update(dt: number, ground: Ground): void {
    this.time += dt;
    if (dt > 0) {
      // Smoothed velocity, used to place the next steps ahead of the body.
      const k = Math.min(1, dt * 10);
      this.vx += ((this.x - this.lastX) / dt - this.vx) * k;
      this.vy += ((this.y - this.lastY) / dt - this.vy) * k;
    }
    this.lastX = this.x;
    this.lastY = this.y;

    if (!this.grounded) {
      // Hanging on silk: feet follow the body, with a slow, uneven wiggle.
      this.legs.forEach((leg, i) => {
        const rest = this.restFoot(leg, { x: 0, y: 0 });
        const w = 2.4 * this.size * Math.sin(this.time * 2.4 + i * 1.7);
        leg.foot = { x: rest.x + w, y: rest.y - w * 0.5 };
        leg.t = 1;
      });
      return;
    }

    // Finish steps in progress.
    for (const leg of this.legs) {
      if (leg.t >= 1) continue;
      leg.t = Math.min(1, leg.t + dt / leg.duration);
      const e = leg.t * leg.t * (3 - 2 * leg.t);
      leg.foot = { x: leg.from.x + (leg.to.x - leg.from.x) * e, y: leg.from.y + (leg.to.y - leg.from.y) * e };
    }

    // Start new steps for feet left too far behind, furthest first.
    const v = Math.hypot(this.vx, this.vy);
    const leadLength = Math.min(30, v * 0.28) * this.size;
    const lead = v > 1 ? { x: (this.vx / v) * leadLength, y: (this.vy / v) * leadLength } : { x: 0, y: 0 };
    const stepping = [false, false];
    for (const leg of this.legs) if (leg.t < 1) stepping[leg.group] = true;
    const candidates = this.legs
      .filter((leg) => leg.t >= 1)
      .map((leg) => {
        const ideal = this.restFoot(leg, lead);
        return { leg, ideal, distance: Math.hypot(leg.foot.x - ideal.x, leg.foot.y - ideal.y) };
      })
      .sort((a, b) => b.distance - a.distance);
    for (const { leg, ideal, distance } of candidates) {
      const threshold = REST_RADIUS[0] * 0.36 * this.size * this.scale;
      if (distance < threshold || stepping[1 - leg.group]) continue;
      const hold = ground.hold(ideal);
      leg.from = { ...leg.foot };
      leg.to = hold.point;
      leg.link = hold.link;
      leg.duration = Math.max(0.07, Math.min(0.2, distance / Math.max(140, v * 2.4)));
      leg.t = 0;
      stepping[leg.group] = true;
    }
  }

  /** Resting position of a foot in content coordinates, shifted by `lead`. */
  private restFoot(leg: Leg, lead: Point): Point {
    const k = this.size * this.scale * (1 - 0.6 * this.tuck);
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return {
      x: this.x + (leg.rest.x * c - leg.rest.y * s) * k + lead.x,
      y: this.y + (leg.rest.x * s + leg.rest.y * c) * k + lead.y,
    };
  }

  private toWorld(local: Point): Point {
    const k = this.size * this.scale;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return { x: this.x + (local.x * c - local.y * s) * k, y: this.y + (local.x * s + local.y * c) * k };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || this.scale < 0.04) return;
    const k = this.size * this.scale;

    // Legs: hip -> knee (IK) -> foot, one glowing path for all of them.
    const joints: Point[] = [];
    const feet: Point[] = [];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.leg;
    ctx.lineWidth = Math.max(0.8, 1.3 * k);
    ctx.shadowColor = COLORS.legGlow;
    ctx.shadowBlur = 7 * k;
    ctx.beginPath();
    for (const leg of this.legs) {
      const hip = this.toWorld(leg.hip);
      // A lifted foot raises its knee: the leg looks shorter from above.
      const lifting = leg.t < 1 ? Math.sin(leg.t * Math.PI) : 0;
      const shrink = 1 - 0.12 * lifting - 0.25 * this.tuck;
      const knee = solveKnee(hip, leg.foot, leg.upper * k * shrink, leg.lower * k * shrink, { x: this.x, y: this.y });
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(leg.foot.x, leg.foot.y);
      joints.push(knee);
      feet.push(leg.foot);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.joint;
    for (const j of joints) dot(ctx, j, 1.7 * k);
    ctx.fillStyle = COLORS.foot;
    for (const f of feet) dot(ctx, f, 1.5 * k);
    ctx.restore();

    // Body (drawn in the local frame): dark shell with a neon outline, a
    // pulsing core and cyan eyes.
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    ctx.scale(k, k);
    ctx.lineWidth = 1.4 / Math.max(0.3, k);
    ctx.strokeStyle = COLORS.outline;
    ctx.fillStyle = COLORS.shell;
    ctx.shadowColor = COLORS.legGlow;
    ctx.shadowBlur = 10 * k;
    ellipse(ctx, -14, 0, 15, 11);
    ellipse(ctx, 5, 0, 9, 7.4);
    ctx.shadowBlur = 0;
    // Circuit traces on the abdomen.
    ctx.strokeStyle = 'rgba(255, 61, 127, 0.75)';
    ctx.lineWidth = 1 / Math.max(0.3, k);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-11, 0);
    ctx.moveTo(-17, 0);
    ctx.lineTo(-24, 0);
    ctx.moveTo(-14, -3);
    ctx.lineTo(-14, -7);
    ctx.lineTo(-19, -7);
    ctx.moveTo(-14, 3);
    ctx.lineTo(-14, 7);
    ctx.lineTo(-19, 7);
    ctx.stroke();
    // Pulsing core.
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 5);
    ctx.fillStyle = COLORS.core;
    ctx.shadowColor = COLORS.core;
    ctx.shadowBlur = 12 * pulse * k;
    ctx.globalAlpha = 0.7 + 0.3 * pulse;
    dot(ctx, { x: -14, y: 0 }, 3.2);
    ctx.globalAlpha = 1;
    // Eyes and fangs.
    ctx.fillStyle = COLORS.eye;
    ctx.shadowColor = COLORS.eye;
    ctx.shadowBlur = 6 * k;
    dot(ctx, { x: 10, y: -2.4 }, 1.6);
    dot(ctx, { x: 10, y: 2.4 }, 1.6);
    dot(ctx, { x: 8, y: -4.6 }, 1);
    dot(ctx, { x: 8, y: 4.6 }, 1);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.outline;
    ctx.beginPath();
    ctx.moveTo(13.5, -2);
    ctx.lineTo(17, -1);
    ctx.moveTo(13.5, 2);
    ctx.lineTo(17, 1);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Two-bone IK: the knee joining segments of length a (from the hip) and b
 * (to the foot), on the side away from `away` (the body centre).
 */
export function solveKnee(hip: Point, foot: Point, a: number, b: number, away: Point): Point {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: hip.x + a, y: hip.y };
  const ux = dx / d;
  const uy = dy / d;
  if (d >= a + b) return { x: hip.x + ux * a, y: hip.y + uy * a }; // fully stretched
  d = Math.max(d, Math.abs(a - b) + 1e-3);
  const along = (a * a - b * b + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const px = hip.x + ux * along;
  const py = hip.y + uy * along;
  const k1 = { x: px - uy * height, y: py + ux * height };
  const k2 = { x: px + uy * height, y: py - ux * height };
  const d1 = (k1.x - away.x) ** 2 + (k1.y - away.y) ** 2;
  const d2 = (k2.x - away.x) ** 2 + (k2.y - away.y) ** 2;
  return d1 >= d2 ? k1 : k2;
}

function dot(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
