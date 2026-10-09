/**
 * The spider rig: procedural, line-drawn, legs placed by inverse kinematics
 * on the real text.
 *
 *  - Body: a plain outlined rectangle (always upright) with one red eye dot.
 *  - Legs: 1.5 px strokes, 2 px knee dots, 3 px foot rings; reach ~3 lines.
 *  - Feet snap to words (via a Ground) and each planted foot boxes its word
 *    in cyan. A foot re-plants when stretched past 90 % of its reach, or when
 *    it falls too far behind; legs step in an alternating tetrapod gait
 *    (L1 R2 L3 R4 / R1 L2 R3 L4).
 *  - Poses: stand (walk / idle breathing), hang, grab (legs wrap a link),
 *    dance, collapse; plus a wiggle and a carried word for throws.
 *
 * Coordinates are those of the surface the spider stands on (a pane's
 * content coordinates), or stage coordinates while it is airborne: the
 * caller sets up the canvas transform accordingly.
 */
import type { Box, Point } from '../stage/stage';
import type { Word } from '../stage/wordIndex';

export interface Foothold {
  point: Point;
  word: Word | null;
}

/** Decides where a foot lands. */
export interface Ground {
  hold(desired: Point): Foothold;
}

/** Ground for open space (no words to grab). */
export const OPEN_GROUND: Ground = { hold: (point) => ({ point, word: null }) };

export type Pose = 'stand' | 'hang' | 'grab' | 'dance' | 'collapse';

export const COLORS = {
  line: '#F0F4F8',
  page: '#101418',
  footBox: '#4FD8E8',
  eye: '#FF2B3A',
  eyeGlow: 'rgba(255, 43, 58, 0.9)',
  player: '#FFB547',
};

interface Leg {
  side: 1 | -1;
  index: number;
  group: 0 | 1;
  hip: Point;
  /** Direction of the resting foot from the hip (radians, screen space). */
  angle: number;
  foot: Point;
  from: Point;
  to: Point;
  /** Step progress (1 = planted). */
  t: number;
  duration: number;
  word: Word | null;
}

const HALF_W = 12;
const HALF_H = 22;
const FEMUR = 52;
const TIBIA = 56;
const REACH = FEMUR + TIBIA;
const REST = REACH * 0.85;
const HIP_Y = [-15, -5, 5, 15];
/** Resting directions for the right legs (screen space, y down); left mirrors. */
const ANGLES = [-62, -20, 20, 62].map((d) => (d * Math.PI) / 180);

export class SpiderRig {
  x = 0;
  y = 0;
  size = 1;
  scale = 1;
  tilt = 0;
  fold = 0;
  pose: Pose = 'stand';
  grounded = false;
  eyeOpen = 1;
  rage = false;
  /** Where the eye looks (pupil shift), in the rig's coordinates. */
  lookAt: Point | null = null;
  /** Word held up by the front leg before a throw. */
  carried: { text: string; side: 1 | -1 } | null = null;
  /** Link wrapped by the legs (grab pose). */
  grabBox: Box | null = null;
  visible = true;
  /** Seconds, drives breathing, dancing and blinking. */
  time = 0;

  private readonly legs: Leg[] = [];
  private lastX = 0;
  private lastY = 0;
  private vx = 0;
  private vy = 0;
  private wiggleUntil = 0;
  /** Which leg group lifts next (tetrapod gait). */
  private turn = 0;

  constructor(size = 1) {
    this.size = size;
    for (const side of [1, -1] as const) {
      for (let i = 0; i < 4; i++) {
        this.legs.push({
          side,
          index: i,
          group: (side === 1 ? i % 2 : (i + 1) % 2) as 0 | 1,
          hip: { x: HALF_W * side, y: HIP_Y[i] },
          angle: side === 1 ? ANGLES[i] : Math.PI - ANGLES[i],
          foot: { x: 0, y: 0 },
          from: { x: 0, y: 0 },
          to: { x: 0, y: 0 },
          t: 1,
          duration: 0.1,
          word: null,
        });
      }
    }
  }

  /** Full leg reach in the rig's coordinates. */
  get reach(): number {
    return REACH * this.size * this.scale;
  }

  /** The eye dot (where lasers come from). */
  eye(): Point {
    return this.toWorld({ x: 0, y: -12 });
  }

  /** Bottom of the body (where the silk comes out). */
  spinneret(): Point {
    return this.toWorld({ x: 0, y: HALF_H });
  }

  /** Bottom edge centre, used as the jaws when walking along a line. */
  jaws(): Point {
    return { x: this.x, y: this.y };
  }

  /** Where the front leg holds a carried word up (before a throw). */
  carryPoint(side: 1 | -1): Point {
    const p = this.toWorld({ x: 26 * side, y: -62 });
    return { x: p.x, y: p.y - 12 * this.size * this.scale };
  }

  /** Top of the body (where the thread attaches while hanging). */
  top(): Point {
    return this.toWorld({ x: 0, y: -HALF_H });
  }

  /** Stretch of the most stretched leg, as a fraction of the reach. */
  maxStretch(): number {
    return Math.max(...this.legs.map((leg) => {
      const hip = this.toWorld(leg.hip);
      return Math.hypot(leg.foot.x - hip.x, leg.foot.y - hip.y) / this.reach;
    }));
  }

  /** Words currently under a planted foot. */
  heldWords(): Word[] {
    return this.legs.filter((l) => l.t >= 1 && l.word && !l.word.gone).map((l) => l.word!);
  }

  /** A quick celebratory shake (snatches, wins). */
  wiggle(seconds = 0.45): void {
    this.wiggleUntil = this.time + seconds;
  }

  get isWiggling(): boolean {
    return this.time < this.wiggleUntil;
  }

  /** Teleports the body and puts every foot down at once (after landing). */
  plantAll(ground: Ground): void {
    this.grounded = true;
    for (const leg of this.legs) {
      const hold = ground.hold(this.restFoot(leg, { x: 0, y: 0 }));
      leg.foot = leg.from = leg.to = hold.point;
      leg.word = hold.word;
      leg.t = 1;
    }
    this.lastX = this.x;
    this.lastY = this.y;
    this.vx = this.vy = 0;
  }

  /** Lifts every foot: legs then follow the body (hanging, flying, diving). */
  liftAll(): void {
    this.grounded = false;
    for (const leg of this.legs) {
      leg.word = null;
      leg.foot = leg.from = leg.to = this.restFoot(leg, { x: 0, y: 0 });
      leg.t = 1;
    }
  }

  update(dt: number, ground: Ground = OPEN_GROUND): void {
    this.time += dt;
    if (dt > 0) {
      const k = Math.min(1, dt * 10);
      this.vx += ((this.x - this.lastX) / dt - this.vx) * k;
      this.vy += ((this.y - this.lastY) / dt - this.vy) * k;
    }
    this.lastX = this.x;
    this.lastY = this.y;

    if (this.pose === 'grab' && this.grabBox) {
      this.placeAround(this.grabBox, dt);
      return;
    }
    if (this.pose === 'collapse') {
      this.curl(dt);
      return;
    }
    if (!this.grounded || this.pose === 'hang') {
      this.legs.forEach((leg, i) => {
        const rest = this.restFoot(leg, { x: 0, y: 0 });
        const w = 2.2 * this.size * Math.sin(this.time * 2.6 + i * 1.7);
        leg.foot = { x: rest.x + w, y: rest.y - w * 0.4 };
        leg.t = 1;
        leg.word = null;
      });
      return;
    }

    // Steps in progress.
    for (const leg of this.legs) {
      if (leg.t >= 1) continue;
      leg.t = Math.min(1, leg.t + dt / leg.duration);
      const e = leg.t * leg.t * (3 - 2 * leg.t);
      leg.foot = { x: leg.from.x + (leg.to.x - leg.from.x) * e, y: leg.from.y + (leg.to.y - leg.from.y) * e };
    }
    if (this.pose === 'dance') return;

    // New steps. Tetrapod: the group whose turn it is steps together (every
    // leg of it stretched past 90 % or left behind), then the turn passes.
    // Walking, nothing lifts while a foot is in the air; running, the next
    // group may lift once the airborne feet are most of the way there.
    const speed = Math.hypot(this.vx, this.vy);
    const overlap = speed > 220 ? 0.55 : 1;
    if (this.legs.some((leg) => leg.t < overlap)) return;
    if (overlap < 1 && this.legs.some((leg) => leg.t < 1 && leg.group === this.turn)) return;
    // Feet land ahead of the body by about the distance it covers in a step.
    const leadLength = Math.min(80, 6 + speed * 0.075) * this.size;
    const lead = speed > 1 ? { x: (this.vx / speed) * leadLength, y: (this.vy / speed) * leadLength } : { x: 0, y: 0 };
    const reach = this.reach;
    const urgency = (leg: Leg) => {
      const hip = this.toWorld(leg.hip);
      const ideal = this.restFoot(leg, lead);
      const stretch = Math.hypot(leg.foot.x - hip.x, leg.foot.y - hip.y) / reach;
      const away = Math.hypot(leg.foot.x - ideal.x, leg.foot.y - ideal.y);
      return { ideal, value: Math.max(stretch / 0.9, away / (0.3 * reach), leg.word?.gone ? 2 : 0) };
    };
    const scored = this.legs.map((leg) => ({ leg, ...urgency(leg) }));
    const due = (group: number) => scored.filter((s) => s.leg.group === group);
    let group = this.turn;
    if (!due(group).some((s) => s.value > 1)) {
      group = 1 - group;
      if (!due(group).some((s) => s.value > 1)) return;
    }
    for (const { leg, ideal, value } of due(group)) {
      if (leg.t < 1 || value < 0.55) continue; // still landing, or nearly in place
      const hold = ground.hold(ideal);
      const distance = Math.hypot(hold.point.x - leg.foot.x, hold.point.y - leg.foot.y);
      leg.from = { ...leg.foot };
      leg.to = hold.point;
      leg.word = hold.word;
      leg.duration = Math.max(0.04, Math.min(0.18, distance / Math.max(260, speed * 4)));
      leg.t = 0;
    }
    this.turn = 1 - group;
  }

  // ------------------------------------------------------------------ poses

  /** Feet on the outline of a link: the legs wrap around it. */
  private placeAround(box: Box, dt: number): void {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const cy = (box.top + box.bottom) / 2;
    const k = Math.min(1, dt * 14);
    for (const leg of this.legs) {
      const edgeX = leg.side === 1 ? box.right : box.left;
      const inward = -leg.side;
      const targets = [
        { x: edgeX + inward * w * 0.18, y: box.top - 4 },
        { x: edgeX + leg.side * 5, y: cy - h * 0.3 },
        { x: edgeX + leg.side * 5, y: cy + h * 0.3 },
        { x: edgeX + inward * w * 0.18, y: box.bottom + 4 },
      ];
      const target = targets[leg.index];
      leg.foot = { x: leg.foot.x + (target.x - leg.foot.x) * k, y: leg.foot.y + (target.y - leg.foot.y) * k };
      leg.t = 1;
      leg.word = null;
    }
  }

  /** Legs curled under the body (defeat). */
  private curl(dt: number): void {
    const k = Math.min(1, dt * 3);
    for (const leg of this.legs) {
      const hip = this.toWorld(leg.hip);
      const target = { x: hip.x + leg.side * 10 * this.size, y: hip.y + 14 * this.size };
      leg.foot = { x: leg.foot.x + (target.x - leg.foot.x) * k, y: leg.foot.y + (target.y - leg.foot.y) * k };
      leg.word = null;
    }
  }

  // --------------------------------------------------------------- geometry

  private restFoot(leg: Leg, lead: Point): Point {
    const hip = this.toWorld(leg.hip);
    const r = REST * this.size * this.scale * (1 - 0.62 * this.fold);
    return { x: hip.x + Math.cos(leg.angle) * r + lead.x, y: hip.y + Math.sin(leg.angle) * r + lead.y };
  }

  private toWorld(local: Point): Point {
    const k = this.size * this.scale;
    const c = Math.cos(this.tilt);
    const s = Math.sin(this.tilt);
    return { x: this.x + (local.x * c - local.y * s) * k, y: this.y + (local.x * s + local.y * c) * k };
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || this.scale < 0.03) return;
    const k = this.size * this.scale;
    const dancing = this.pose === 'dance';
    const beat = this.time * 2.4;

    // Cyan box around each word held by a foot.
    ctx.save();
    ctx.strokeStyle = COLORS.footBox;
    ctx.lineWidth = 1;
    for (const word of this.heldWords()) {
      const b = word.box;
      ctx.strokeRect(Math.round(b.left) - 2.5, Math.round(b.top) + 0.5, Math.round(b.right - b.left) + 4, Math.round(b.bottom - b.top) - 1);
    }
    ctx.restore();

    // Legs.
    const knees: Point[] = [];
    const feet: Point[] = [];
    ctx.save();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(0.7, 1.5 * Math.min(1, k * 1.2));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const leg of this.legs) {
      const hip = this.toWorld(leg.hip);
      let foot = leg.foot;
      if (dancing) {
        // Feet tap in rhythm: the two groups alternate on the beat.
        const up = Math.max(0, Math.sin((beat + leg.group * 0.5) * Math.PI * 2));
        foot = { x: foot.x + leg.side * up * 4 * k, y: foot.y - up * 7 * k };
      }
      if (this.carried && leg.index === 0 && leg.side === this.carried.side) {
        foot = this.toWorld({ x: 26 * leg.side, y: -62 });
      }
      const lifting = leg.t < 1 ? Math.sin(leg.t * Math.PI) : 0;
      const shrink = 1 - 0.1 * lifting - 0.22 * this.fold;
      const length = (FEMUR + TIBIA) * k * shrink;
      const span = Math.hypot(foot.x - hip.x, foot.y - hip.y);
      if (span > length) foot = { x: hip.x + ((foot.x - hip.x) / span) * length, y: hip.y + ((foot.y - hip.y) / span) * length };
      const knee = solveKnee(hip, foot, FEMUR * k * shrink, TIBIA * k * shrink, { x: this.x, y: this.y });
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      knees.push(knee);
      feet.push(foot);
    }
    ctx.stroke();
    ctx.fillStyle = COLORS.line;
    for (const knee of knees) dot(ctx, knee, 2 * Math.min(1, k * 1.3));
    ctx.fillStyle = COLORS.page;
    ctx.lineWidth = Math.max(0.6, 1.5 * Math.min(1, k * 1.3));
    for (const foot of feet) {
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, 3 * Math.min(1, k * 1.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Carried word, held up by the front leg.
    if (this.carried) {
      const p = this.carryPoint(this.carried.side);
      drawWordTag(ctx, this.carried.text, p.x, p.y, -0.15 * this.carried.side);
    }

    // Body: plain outlined rectangle, breathing slightly.
    const breathe = this.grounded && this.pose === 'stand' ? 1 + 0.03 * Math.sin(this.time * 2.4) : 1;
    const bob = dancing ? Math.abs(Math.sin(beat * Math.PI)) * -3 * k : 0;
    const wiggle = this.isWiggling ? Math.sin(this.time * 70) * 0.28 : 0;
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    ctx.rotate(this.tilt + wiggle);
    ctx.scale(k, k * breathe);
    ctx.fillStyle = COLORS.page;
    ctx.strokeStyle = this.rage ? '#FFD6DA' : COLORS.line;
    ctx.lineWidth = 1.5 / Math.max(0.35, k);
    ctx.fillRect(-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2);
    ctx.strokeRect(-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2);

    // The eye: one red dot with a soft glow (bigger and pulsing in rage).
    const blink = dancing && Math.sin(this.time * 7) > 0.92 ? 0.15 : 1;
    const open = this.eyeOpen * blink;
    if (open > 0.02) {
      let px = 0;
      let py = 0;
      if (this.lookAt) {
        const dx = this.lookAt.x - this.x;
        const dy = this.lookAt.y - (this.y - 12 * k);
        const d = Math.hypot(dx, dy) || 1;
        px = (dx / d) * 3;
        py = (dy / d) * 3;
      }
      const pulse = this.rage ? 1 + 0.25 * Math.sin(this.time * 9) : 1;
      ctx.fillStyle = COLORS.eye;
      ctx.shadowColor = COLORS.eyeGlow;
      ctx.shadowBlur = (this.rage ? 22 : 10) * pulse;
      ctx.globalAlpha = Math.min(1, open);
      ctx.beginPath();
      ctx.ellipse(px, -12 + py, (this.rage ? 5 : 4) * pulse, (this.rage ? 5 : 4) * pulse * Math.max(0.12, open), 0, 0, Math.PI * 2);
      ctx.fill();
      if (this.rage) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.35 * open;
        ctx.strokeStyle = COLORS.eye;
        ctx.lineWidth = 1 / Math.max(0.35, k);
        ctx.beginPath();
        ctx.arc(px, -12 + py, 8 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** A word on a little tag (thrown words, covered links). */
export function drawWordTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, rotation: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = '600 17px "Source Serif 4", "Source Serif Pro", Charter, Georgia, serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(-w / 2, -14, w, 28);
  ctx.strokeStyle = COLORS.footBox;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-w / 2, -14, w, 28);
  ctx.fillStyle = COLORS.line;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
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
